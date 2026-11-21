// Large-map regression: exercise the real view planner and GPU draw ranges.
// This checks work submitted to the renderer, not hardware frame rates.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import * as THREE from "three";
import largeMap from "./detail-fixture.cjs";
const apiFile = path.resolve("dist-electron/detail-smoke-api.cjs");
await build({
  stdin: {
    contents:
      "export {GraphScene} from './src/graph'; export {graphDetail,DETAIL_LIMITS} from './src/graph-detail'; export {pickNodeAtPixel} from './src/picking';",
    resolveDir: process.cwd(),
  },
  outfile: apiFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["three", "three/*"],
});
const { GraphScene, graphDetail, DETAIL_LIMITS, pickNodeAtPixel } =
  createRequire(import.meta.url)(apiFile);
let subject;
try {
  const map = largeMap(),
    { nodes, edges } = map;
  const started = performance.now();
  const detail = graphDetail(map);
  detail.setScope(null);
  assert.strictEqual(
    graphDetail(map),
    detail,
    "React and the renderer reuse the full index",
  );
  const recursive = graphDetail({
    ...map,
    nodes: [nodes[0]],
    edges: [
      {
        id: "recursive",
        source: nodes[0].id,
        target: nodes[0].id,
        kind: "calls",
        count: 1,
      },
    ],
  });
  assert.equal(
    recursive.connections(nodes[0].id).length,
    1,
    "Recursive calls appear once in the inspector",
  );
  const camera = new THREE.PerspectiveCamera(46, 1.5, 0.1, 10000);
  camera.position.set(0, 0, 500);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const kinds = new Set(["calls", "imports"]),
    anchors = new Set(["n25000"]);
  const plan = detail.plan(camera, 1200, 800, kinds, anchors);
  assert(plan.nodes.length > 0 && plan.edges.length > 0);
  assert(
    plan.nodes.length <= DETAIL_LIMITS.nodes &&
      plan.edges.length <= DETAIL_LIMITS.edges,
  );
  assert(
    plan.examined <= DETAIL_LIMITS.nodes * 4 + 1,
    "Candidate work stays bounded on dense maps",
  );
  assert(
    plan.nodes.includes(25000),
    "Selected symbols take priority over spatial sampling",
  );
  const visible = new Set(plan.nodes.map((i) => nodes[i].id));
  for (const i of plan.edges)
    assert(
      visible.has(edges[i].source) && visible.has(edges[i].target),
      "Draw only real edges between rendered nodes",
    );
  const moving = detail.plan(camera, 1200, 800, kinds, anchors, true);
  assert(
    moving.nodes.length <= DETAIL_LIMITS.movingNodes &&
      moving.edges.length <= DETAIL_LIMITS.movingEdges,
  );

  camera.lookAt(0, 0, 1000);
  camera.updateMatrixWorld();
  const away = detail.plan(camera, 1200, 800, kinds, new Set());
  assert.equal(away.nodes.length, 0, "Cull regions outside the view");
  assert.equal(away.edges.length, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  detail.setScope(["n25000", "n25001"]);
  const scoped = detail.plan(camera, 1200, 800, new Set(["calls"]), anchors);
  assert(scoped.nodes.every((i) => i === 25000 || i === 25001));
  assert(scoped.edges.every((i) => edges[i].kind === "calls"));
  detail.setScope([]);
  assert.equal(
    detail.plan(camera, 1200, 800, kinds, new Set()).nodes.length,
    0,
  );
  detail.setScope(null);

  // Run the real geometry allocation and update paths with only the native
  // renderer/controls substituted. This catches accidental full-graph buffers.
  globalThis.window = { devicePixelRatio: 1 };
  subject = Object.create(GraphScene.prototype);
  Object.assign(subject, {
    scene: new THREE.Scene(),
    camera,
    width: 1200,
    height: 800,
    renderer: { setPixelRatio: () => {} },
    composer: { setPixelRatio: () => {} },
    controls: {
      target: new THREE.Vector3(),
      update: () => {
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
      },
    },
    performanceMonitor: { reset: () => {} },
    context: { clearRect: () => {} },
    renderSettings: { glowStrength: 0.72 },
    glowActive: true,
    invalidate: () => {
      subject.detailDirty = true;
      subject.dirty = true;
    },
    index: new Map(),
    emphasized: new Set(),
    connected: new Set(),
    visibleEdges: kinds,
    lines: new Map(),
    onRenderStatus: () => {},
  });
  subject.load(map);
  subject.setSelected("n25000");
  subject.setEdges([...kinds]);
  const pointsGeometry = subject.points.geometry;
  assert.equal(
    pointsGeometry.getAttribute("position").count,
    DETAIL_LIMITS.nodes,
    "Geometry allocation is bounded independently of source node count",
  );
  for (const line of subject.lines.values())
    assert.equal(
      line.geometry.getAttribute("position").count,
      DETAIL_LIMITS.edges * 2,
      "Line buffers never allocate all 193,000 connections",
    );
  const buffer = pointsGeometry.getAttribute("position").array;
  subject.updateDetail(1, false);
  assert(pointsGeometry.drawRange.count <= DETAIL_LIMITS.nodes);
  const lineCount = () =>
    [...subject.lines.values(), subject.highlight].reduce(
      (sum, line) => sum + line.geometry.drawRange.count / 2,
      0,
    );
  assert(lineCount() <= DETAIL_LIMITS.edges);
  subject.updateDetail(101, true);
  assert(
    pointsGeometry.drawRange.count <= DETAIL_LIMITS.movingNodes &&
      lineCount() <= DETAIL_LIMITS.movingEdges,
  );
  assert.strictEqual(
    pointsGeometry.getAttribute("position").array,
    buffer,
    "Camera changes reuse GPU buffers",
  );
  assert.equal(
    map.edges.length,
    193000,
    "Rendering never truncates the analysis graph",
  );
  const overlapping = [
    { ...nodes[0], position: [0, 0, 10] },
    { ...nodes[1], position: [0, 0, 0] },
  ];
  assert.equal(
    pickNodeAtPixel(overlapping, camera, 1200, 800, 600, 400, 200, [1]),
    1,
    "Picking ignores nodes omitted from the rendered detail",
  );
  console.log(
    `Large-map checks passed: ${nodes.length} nodes / ${edges.length} connections; overview submitted ${plan.nodes.length} nodes / ${plan.edges.length} connections; moving ${moving.nodes.length} / ${moving.edges.length}. Culling, selection priority, layers, reusable buffers and visible-only picking verified. CPU check ${Math.round(performance.now() - started)}ms; no GPU FPS claim.`,
  );
} finally {
  subject?.clear();
  await rm(apiFile, { force: true });
}
