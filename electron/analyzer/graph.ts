import { createHash } from 'node:crypto';
import type { CodeMap, EdgeKind, Issue, MapNode, NodeKind } from '../../shared/types';
export const stableId = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 20);
export class GraphBuilder {
  map: CodeMap;
  byId = new Map<string, MapNode>();
  private edgeIndex = new Map<string, number>();
  constructor(name: string) {
    this.map = { format: 'sourcefield.code-map', version: 1, createdAt: new Date().toISOString(),
      project: { name, files: 0, analyzed: 0, languages: [], ignored: 0 }, nodes: [], edges: [], issues: [],
      layout: { algorithm: 'spherical-graph-v1', seed: 0, radius: 120 } };
  }
  node(id: string, name: string, kind: NodeKind, path: string, extra: Partial<MapNode> = {}) {
    if (this.byId.has(id)) return this.byId.get(id)!;
    const node: MapNode = { id, name, kind, path, position: [0, 0, 0], degree: 0, ...extra };
    this.byId.set(id, node); this.map.nodes.push(node);
    if (node.parent) this.edge(node.parent, id, 'contains');
    return node;
  }
  edge(source: string, target: string, kind: EdgeKind, location?: { path: string; line: number; column?: number }) {
    if (source === target && kind !== 'calls') return;
    const key = `${source}|${target}|${kind}`;
    const existing = this.edgeIndex.get(key);
    if (existing !== undefined) {
      const edge = this.map.edges[existing];
      if (location && !edge.locations?.some(l => l.path === location.path && l.line === location.line && l.column === location.column)) {
        edge.count++; if ((edge.locations?.length ?? 0) < 1000) edge.locations?.push(location);
      }
      return;
    }
    this.edgeIndex.set(key, this.map.edges.length);
    this.map.edges.push({ id: stableId(key), source, target, kind, count: 1,
      ...(location ? { path: location.path, line: location.line, locations: [location] } : {}) });
  }
  issue(issue: Issue) {
    if (this.map.issues.length < 100000) this.map.issues.push(issue);
    else if (this.map.issues.length === 100000) this.map.issues.push({ kind: 'limit', path: '', name: 'Issue limit', reason: 'Additional diagnostics omitted after 100,000 entries.' });
  }
  finalize() {
    for (const n of this.map.nodes) n.degree = 0;
    for (const e of this.map.edges) { const a = this.byId.get(e.source), b = this.byId.get(e.target); if (a) a.degree++; if (b) b.degree++; }
    return this.map;
  }
}
