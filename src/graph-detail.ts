import { Box3, Frustum, Matrix4, Vector3, type PerspectiveCamera } from "three";
import type { CodeMap, EdgeKind } from "../shared/types";

export const DETAIL_LIMITS = {
  nodes: 6000,
  edges: 8000,
  movingNodes: 2000,
  movingEdges: 2500,
};
type Cell = {
  box: Box3;
  representative: number;
  children?: Cell[];
  indices?: number[];
};
export interface DrawPlan {
  nodes: number[];
  edges: number[];
  examined: number;
}

// Reuse the full relationship index between React and the renderer. Rendering
// detail never changes the source graph or the results returned through MCP.
const indices = new WeakMap<CodeMap, GraphDetail>();
export function graphDetail(map: CodeMap) {
  let index = indices.get(map);
  if (!index) {
    index = new GraphDetail(map);
    indices.set(map, index);
  }
  return index;
}

export class GraphDetail {
  readonly byId: Map<string, number>;
  private offsets: Uint32Array;
  private incidents: Uint32Array;
  private sources: Int32Array;
  private targets: Int32Array;
  private root: Cell | null = null;
  private allRoot?: Cell;
  private structureRoot?: Cell;
  private allowed: Set<number> | null = null;
  private scopeKey: string | null = null;
  constructor(readonly map: CodeMap) {
    this.byId = new Map(map.nodes.map((node, i) => [node.id, i]));
    this.offsets = new Uint32Array(map.nodes.length + 1);
    this.sources = new Int32Array(map.edges.length).fill(-1);
    this.targets = new Int32Array(map.edges.length).fill(-1);
    map.edges.forEach((edge, i) => {
      const a = this.byId.get(edge.source),
        b = this.byId.get(edge.target);
      if (a === undefined || b === undefined) return;
      this.sources[i] = a;
      this.targets[i] = b;
      this.offsets[a + 1]++;
      this.offsets[b + 1]++;
    });
    for (let i = 1; i < this.offsets.length; i++)
      this.offsets[i] += this.offsets[i - 1];
    this.incidents = new Uint32Array(this.offsets[this.offsets.length - 1]);
    const cursor = this.offsets.slice();
    map.edges.forEach((_edge, i) => {
      const a = this.sources[i],
        b = this.targets[i];
      if (a < 0 || b < 0) return;
      this.incidents[cursor[a]++] = i;
      this.incidents[cursor[b]++] = i;
    });
  }
  connections(id: string) {
    const i = this.byId.get(id);
    return i === undefined
      ? []
      : Array.from(this.incident(i), (edge) => this.map.edges[edge]);
  }
  neighbors(id: string) {
    const i = this.byId.get(id),
      result = new Set<string>();
    if (i === undefined) return result;
    for (const edge of this.incident(i))
      result.add(this.map.nodes[this.other(edge, i)].id);
    return result;
  }
  private incident(i: number) {
    return this.incidents.subarray(this.offsets[i], this.offsets[i + 1]);
  }
  private other(edge: number, i: number) {
    return this.sources[edge] === i ? this.targets[edge] : this.sources[edge];
  }
  private priority(i: number) {
    const node = this.map.nodes[i];
    return (
      (node.kind === "folder" ? 1000000 : node.kind === "file" ? 500000 : 0) +
      Math.log2(node.degree + 1) * 100
    );
  }
  setScope(ids: string[] | null) {
    const key = ids ? ids.join("\0") : "all";
    if (key === this.scopeKey) return;
    this.scopeKey = key;
    this.allowed = ids
      ? new Set(
          ids.flatMap((id) => {
            const i = this.byId.get(id);
            return i === undefined ? [] : [i];
          }),
        )
      : null;
    const selected = this.allowed
      ? [...this.allowed]
      : this.map.nodes.map((_n, i) => i);
    const structure =
      !!ids &&
      selected.length > 0 &&
      selected.every((i) =>
        ["file", "folder"].includes(this.map.nodes[i].kind),
      );
    if (!ids && this.allRoot) this.root = this.allRoot;
    else if (
      structure &&
      this.structureRoot &&
      selected.length === this.structureCount
    )
      this.root = this.structureRoot;
    else this.root = selected.length ? this.build(selected) : null;
    if (!ids && this.root) this.allRoot = this.root;
    if (
      structure &&
      this.root &&
      selected.length ===
        this.map.nodes.filter((n) => n.kind === "file" || n.kind === "folder")
          .length
    ) {
      this.structureRoot = this.root;
      this.structureCount = selected.length;
    }
  }
  private structureCount = 0;
  private build(list: number[], depth = 0): Cell {
    const box = new Box3(),
      point = new Vector3();
    let representative = list[0];
    for (const i of list) {
      box.expandByPoint(point.fromArray(this.map.nodes[i].position));
      if (this.priority(i) > this.priority(representative)) representative = i;
    }
    if (list.length <= 64 || depth >= 20)
      return { box, representative, indices: list };
    const spans = box.getSize(point),
      axis =
        spans.x >= spans.y && spans.x >= spans.z
          ? 0
          : spans.y >= spans.z
            ? 1
            : 2;
    const midpoint =
      (box.min.getComponent(axis) + box.max.getComponent(axis)) / 2;
    const left: number[] = [],
      right: number[] = [];
    for (const i of list)
      (this.map.nodes[i].position[axis] < midpoint ? left : right).push(i);
    if (!left.length || !right.length)
      return { box, representative, indices: list };
    return {
      box,
      representative,
      children: [this.build(left, depth + 1), this.build(right, depth + 1)],
    };
  }
  plan(
    camera: PerspectiveCamera,
    width: number,
    height: number,
    kinds: Set<EdgeKind>,
    anchors: Set<string>,
    moving = false,
  ): DrawPlan {
    const nodeLimit = moving ? DETAIL_LIMITS.movingNodes : DETAIL_LIMITS.nodes;
    const edgeLimit = moving ? DETAIL_LIMITS.movingEdges : DETAIL_LIMITS.edges;
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    const point = new Vector3(),
      center = new Vector3(),
      size = new Vector3();
    const pinned = new Set<number>(),
      context = new Set<number>();
    for (const id of anchors) {
      const i = this.byId.get(id);
      if (i === undefined) continue;
      pinned.add(i);
      const incident = this.incident(i),
        stride = Math.max(1, Math.ceil(incident.length / 800));
      for (let j = 0; j < incident.length && context.size < 1600; j += stride)
        context.add(this.other(incident[j], i));
    }
    const candidates = new Map<
      number,
      { priority: number; x: number; y: number }
    >();
    let examined = 0;
    const offer = (i: number, priority = this.priority(i)) => {
      if (this.allowed && !this.allowed.has(i) && !pinned.has(i)) return;
      point.fromArray(this.map.nodes[i].position).project(camera);
      if (
        point.z < -1 ||
        point.z > 1 ||
        Math.abs(point.x) > 1.04 ||
        Math.abs(point.y) > 1.04
      )
        return;
      candidates.set(i, {
        priority,
        x: ((point.x + 1) * width) / 2,
        y: ((1 - point.y) * height) / 2,
      });
    };
    for (const i of pinned) offer(i, 1e12);
    for (const i of context) offer(i, 1e9 + this.priority(i));
    const heap: { cell: Cell; score: number }[] = [];
    const enqueue = (cell: Cell) => {
      if (!frustum.intersectsBox(cell.box)) return;
      cell.box.getCenter(center).applyMatrix4(camera.matrixWorldInverse);
      const diameter =
        (cell.box.getSize(size).length() * height) /
        (Math.max(camera.near, -center.z) *
          Math.tan((camera.fov * Math.PI) / 360) *
          2);
      const item = { cell, score: diameter };
      let i = heap.length;
      heap.push(item);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].score >= item.score) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = item;
    };
    if (this.root) enqueue(this.root);
    const candidateLimit = nodeLimit * 4;
    while (heap.length && examined < candidateLimit) {
      const item = heap[0],
        last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let c = i * 2 + 1;
          if (c + 1 < heap.length && heap[c + 1].score > heap[c].score) c++;
          if (heap[c].score <= last.score) break;
          heap[i] = heap[c];
          i = c;
        }
        heap[i] = last;
      }
      examined++;
      const { cell, score } = item;
      if (cell.children && score > (moving ? 28 : 16)) {
        for (const child of cell.children) enqueue(child);
      } else if (cell.indices && score > (moving ? 28 : 16)) {
        for (const i of cell.indices) {
          if (++examined > candidateLimit) break;
          offer(i);
        }
      } else offer(cell.representative);
    }
    const dense = (this.allowed?.size ?? this.map.nodes.length) > nodeLimit;
    const buckets = new Set<string>(),
      nodes: number[] = [];
    for (const [i, candidate] of [...candidates].sort(
      (a, b) => b[1].priority - a[1].priority || a[0] - b[0],
    )) {
      const key =
        Math.floor(candidate.x / (moving ? 20 : 12)) +
        ":" +
        Math.floor(candidate.y / (moving ? 20 : 12));
      if (dense && buckets.has(key) && !pinned.has(i) && !context.has(i))
        continue;
      nodes.push(i);
      buckets.add(key);
      if (nodes.length === nodeLimit) break;
    }
    const drawn = new Set(nodes),
      edges = new Set<number>();
    let visited = 0;
    for (const i of nodes) {
      const incident = this.incident(i);
      const quota = pinned.has(i)
        ? Math.max(64, Math.floor(edgeLimit / 2))
        : Math.max(12, Math.ceil((edgeLimit * 3) / Math.max(1, nodes.length)));
      const stride = Math.max(1, Math.ceil(incident.length / quota));
      for (let j = 0; j < incident.length; j += stride) {
        const edge = incident[j];
        if (++visited > edgeLimit * 8 || edges.size >= edgeLimit) break;
        if (
          kinds.has(this.map.edges[edge].kind) &&
          drawn.has(this.other(edge, i))
        )
          edges.add(edge);
      }
      if (visited > edgeLimit * 8 || edges.size >= edgeLimit) break;
    }
    return { nodes, edges: [...edges], examined };
  }
}
