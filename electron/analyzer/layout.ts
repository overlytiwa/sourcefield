import type { CodeMap, MapNode } from '../../shared/types';

// One position per real node. The hierarchy seeds communities; actual graph
// links relax them into a bounded, approximately spherical volume.
export function layoutGraph(map: CodeMap) {
  let seed = 2166136261;
  for (const n of map.nodes) for (let j = 0; j < n.id.length; j++) seed = Math.imul(seed ^ n.id.charCodeAt(j), 16777619) >>> 0;
  map.layout.seed = seed;
  let state = seed || 1;
  function random() { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }
  const nodes = map.nodes, count = nodes.length, radius = Math.max(80, Math.cbrt(count) * 14);
  map.layout.radius = radius;
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const children = new Map<string, MapNode[]>();
  for (const n of nodes) if (n.parent) { const list = children.get(n.parent) ?? []; list.push(n); children.set(n.parent, list); }
  const weights = new Map<string, number>();
  function weight(n: MapNode): number { const w = 1 + (children.get(n.id) ?? []).reduce((s, c) => s + weight(c), 0); weights.set(n.id, w); return w; }
  const roots = nodes.filter(n => !n.parent); roots.forEach(weight);
  const golden = Math.PI * (3 - Math.sqrt(5));
  let cursor = 0;
  function place(n: MapNode, depth: number) {
    const w = weights.get(n.id) ?? 1;
    const slot = cursor + w / 2;
    const t = (slot + 0.5) / Math.max(1, count);
    const z = 1 - 2 * t, theta = golden * slot;
    const r = radius * (n.kind === 'folder' ? 0.24 + Math.min(depth, 5) * 0.09 : n.kind === 'file' ? 0.63 : 0.70 + random() * 0.30);
    const planar = Math.sqrt(Math.max(0, 1 - z * z));
    n.position = [r * planar * Math.cos(theta), r * z, r * planar * Math.sin(theta)];
    cursor++;
    for (const c of children.get(n.id) ?? []) place(c, depth + 1);
  }
  roots.forEach(n => place(n, 0));
  const original = nodes.map(n => [...n.position]);
  const links = map.edges.map(e => ({ a: byId.get(e.source)!, b: byId.get(e.target)!, kind: e.kind })).filter(e => e.a !== undefined && e.b !== undefined);
  // Deterministic pair sampling keeps the layout bounded in O(nodes + edges).
  const iterations = count > 20000 ? 24 : 58;
  const force = new Float64Array(count * 3);
  for (let tick = 0; tick < iterations; tick++) {
    force.fill(0);
    const alpha = (1 - tick / iterations) * 0.65;
    for (const e of links) {
      const a = nodes[e.a].position, b = nodes[e.b].position;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.1;
      const ideal = e.kind === 'contains' ? radius * 0.19 : radius * 0.35;
      const spring = (d - ideal) / d * (e.kind === 'contains' ? 0.028 : 0.012) * alpha;
      const scaleA = 1 / Math.sqrt(Math.max(1, nodes[e.a].degree)), scaleB = 1 / Math.sqrt(Math.max(1, nodes[e.b].degree));
      for (let k = 0; k < 3; k++) { const delta = (b[k] - a[k]) * spring; force[e.a * 3 + k] += delta * scaleA; force[e.b * 3 + k] -= delta * scaleB; }
    }
    for (let i = 0; i < count; i++) {
      const a = nodes[i].position;
      for (let j = 0; j < 5; j++) {
        const other = Math.floor(random() * count); if (other === i) continue;
        const b = nodes[other].position;
        const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        const sq = dx * dx + dy * dy + dz * dz + 4;
        const f = Math.min(radius * 0.12 / sq, 0.3) * alpha;
        force[i * 3] += dx * f; force[i * 3 + 1] += dy * f; force[i * 3 + 2] += dz * f;
      }
      for (let k = 0; k < 3; k++) a[k] += force[i * 3 + k] + (original[i][k] - a[k]) * 0.024;
      const length = Math.hypot(...a);
      if (length > radius) for (let k = 0; k < 3; k++) a[k] *= radius / length;
    }
  }
  // Center the actual bounding volume, preserving all relative geometry.
  const center = [0, 0, 0];
  for (const n of nodes) for (let k = 0; k < 3; k++) center[k] += n.position[k] / Math.max(1, count);
  for (const n of nodes) n.position = n.position.map((v, k) => Number((v - center[k]).toFixed(5))) as [number, number, number];
}
