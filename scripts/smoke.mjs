// One short integration smoke check, intentionally not an extensive test suite.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, cp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const project = process.cwd();
const apiFile = path.join(project, 'dist-electron/smoke-api.cjs');
await build({ stdin: { contents: "export { scanProject } from './electron/analyzer/scan'; export { writeMap, readMap } from './electron/format';", resolveDir: project },
  outfile: apiFile, bundle: true, platform: 'node', format: 'cjs', external: ['typescript', 'web-tree-sitter'] });
const { scanProject, writeMap, readMap } = createRequire(import.meta.url)(apiFile);
const temp = await mkdtemp(path.join(os.tmpdir(), 'sourcefield-smoke-'));
try {
  const original = path.join(temp, 'field-notes');
  await cp(path.join(project, 'example'), original, { recursive: true });
  const map = await scanProject(original, () => {});
  const target = map.nodes.find(n => n.name === 'matchesQuery' && n.kind === 'function');
  assert(target, 'Function was analyzed');
  const edge = map.edges.find(e => e.kind === 'calls' && e.target === target.id && map.nodes.find(n => n.id === e.source)?.path !== target.path);
  assert(edge, 'Cross-file function call was resolved');
  map.view = { position: [100, 30, 300], target: [0, 0, 0], selected: target.id,
    visibleEdges: ['contains', 'imports', 'exports', 'calls', 'inherits', 'references'], labels: true };
  const exported = path.join(temp, 'field-notes.sourcefield');
  await writeMap(exported, map);
  await rename(original, path.join(temp, 'moved-project'));
  const reopened = await readMap(exported);
  assert.deepEqual(reopened.nodes, JSON.parse(JSON.stringify(map.nodes)), 'Nodes and layout survive moving the source');
  assert.deepEqual(reopened.edges, JSON.parse(JSON.stringify(map.edges)), 'Connections survive the round trip');
  assert.deepEqual(reopened.view, map.view, 'Camera, selection, and label settings survive');
  console.log(`Smoke check passed: ${map.nodes.length} nodes, ${map.edges.length} relationships; cross-file call, moved-source reopen, layout, and view preserved.`);
} finally { await rm(temp, { recursive: true, force: true }); await rm(apiFile, { force: true }); }
