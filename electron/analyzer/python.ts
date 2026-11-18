import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { GraphBuilder } from './graph';
import type { Issue, MapEdge, MapNode, ScanProgress } from '../../shared/types';

export async function analyzePython(root: string, files: { relative: string; id: string }[], graph: GraphBuilder, progress: (p: ScanProgress) => void) {
  progress({ phase: 'Analyzing Python', detail: `${files.length} files · local AST analysis`, percent: 76 });
  const payload = JSON.stringify({ root, files });
  // An external interpreter needs a real file, outside Electron's ASAR archive.
  const script = path.join(__dirname, 'python_analyzer.py').replace(/([/\\])app\.asar([/\\])/, '$1app.asar.unpacked$2');
  let output: string | undefined, failure = 'Python 3 was not found on PATH.';
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, ['-I', '-S', script], {
      input: payload, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 128 * 1024 * 1024
    });
    if (result.error && 'code' in result.error && result.error.code === 'ENOENT') continue;
    if (!result.error && result.status === 0) { output = result.stdout; break; }
    failure = result.error?.message ?? result.stderr.slice(0, 500) ?? 'Python analysis failed.';
  }
  if (!output) {
    for (const f of files) {
      graph.byId.get(f.id)!.status = 'skipped';
      graph.issue({ kind: 'skipped', path: f.relative, name: 'Python analysis unavailable', reason: `${failure} Install Python 3.10+ to analyze Python symbols.` });
    }
    return;
  }
  const result = JSON.parse(output) as { nodes: MapNode[]; edges: MapEdge[]; issues: Issue[] };
  for (const n of result.nodes) graph.node(n.id, n.name, n.kind, n.path, n);
  for (const e of result.edges) graph.edge(e.source, e.target, e.kind, e.line ? { path: e.path!, line: e.line } : undefined);
  for (const raw of result.issues) { const issue = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null)) as unknown as Issue; graph.issue(issue); if (issue.kind === 'parse') { const f = files.find(f => f.relative === issue.path); if (f) graph.byId.get(f.id)!.status = 'partial'; } }
}
