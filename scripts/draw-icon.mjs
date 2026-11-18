// Sourcefield's original vector artwork. No raster image or external asset.
// Run `node scripts/draw-icon.mjs` to regenerate the editable SVG masters.
import { mkdir, writeFile } from 'node:fs/promises';

const TAU = Math.PI * 2;
const round = v => Number(v.toFixed(2));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function artwork(small = false) {
  let state = 87421;
  const random = () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296; };
  const points = [], count = small ? 28 : 138;
  // An irregular Fibonacci sphere, tilted to reveal both surface and interior.
  for (let i = 0; i < count; i++) {
    const y = 1 - 2 * (i + 0.5) / count, theta = i * Math.PI * (3 - Math.sqrt(5));
    const r = 0.91 + random() * 0.09, v = Math.sqrt(1 - y * y);
    const x = Math.cos(theta) * v * r, z = Math.sin(theta) * v * r;
    const tilt = -0.24;
    points.push({ x: x * Math.cos(tilt) - y * Math.sin(tilt), y: x * Math.sin(tilt) + y * Math.cos(tilt), z, hub: false });
  }
  for (let i = 0; i < (small ? 6 : 36); i++) {
    const theta = random() * TAU, z = random() * 2 - 1, r = Math.cbrt(random()) * 0.72;
    points.push({ x: Math.cos(theta) * Math.sqrt(1 - z * z) * r, y: Math.sin(theta) * Math.sqrt(1 - z * z) * r, z: z * r, hub: false });
  }
  const hubs = [
    { x: -0.62, y: 0.18, z: 0.35, hub: true },
    { x: -0.42, y: -0.60, z: 0.22, hub: true },
    { x: 0.52, y: -0.46, z: 0.42, hub: true },
    { x: 0.44, y: 0.62, z: 0.12, hub: true },
    { x: 0.01, y: 0.01, z: 0.58, hub: true }
  ];
  const start = points.length; points.push(...hubs);
  const project = p => ({ x: round(512 + p.x * 362 * (1 + p.z * 0.1)), y: round(512 + p.y * 362 * (1 + p.z * 0.1)) });
  const edges = new Map();
  function edge(a, b) { if (a === b) return; const key = [a, b].sort((a, b) => a - b).join(':'); edges.set(key, [a, b]); }
  for (let i = 0; i < start; i++) {
    points.map((p, j) => ({ j, d: distance(points[i], p) })).filter(v => v.j !== i).sort((a, b) => a.d - b.d)
      .slice(0, small ? 2 : 3).forEach(({ j }) => edge(i, j));
    const nearestHub = hubs.map((h, j) => ({ j: start + j, d: distance(points[i], h) })).sort((a, b) => a.d - b.d)[0];
    if (nearestHub.d < 1.0 && (small ? i % 3 === 0 : i % 2 === 0)) edge(i, nearestHub.j);
  }
  const links = [...edges.values()].sort(([a, b], [c, d]) => points[a].z + points[b].z - points[c].z - points[d].z).map(([a, b]) => {
    const p = project(points[a]), q = project(points[b]);
    const depth = (points[a].z + points[b].z + 2) / 4;
    const hub = points[a].hub || points[b].hub;
    return `<path d="M${p.x} ${p.y}L${q.x} ${q.y}" stroke="${hub ? '#ff9b18' : '#ed7710'}" stroke-width="${small ? 12 : hub ? 1.9 : 1.35}" opacity="${round((small ? 0.55 : 0.18) + depth * (small ? 0.33 : 0.4))}"/>`;
  }).join('\n');
  const arcs = [[0, 2, -36], [0, 3, 38], [1, 2, -34], [3, 4, 25], [0, 4, -18], [2, 4, -16]].map(([a, b, bend]) => {
    const p = project(hubs[a]), q = project(hubs[b]), cx = round((p.x + q.x) / 2 - bend), cy = round((p.y + q.y) / 2 + bend);
    return `<path d="M${p.x} ${p.y}Q${cx} ${cy} ${q.x} ${q.y}" stroke="#ffae21" stroke-width="${small ? 16 : 3.1}" opacity="${small ? 0.9 : 0.8}"/>`;
  }).join('\n');
  const dots = points.map((p, i) => ({ p, i })).sort((a, b) => a.p.z - b.p.z).map(({ p, i }) => {
    const { x, y } = project(p);
    const radius = p.hub ? small ? 27 : 12 : small ? 12 : 2.4 + ((i * 19) % 5) * 0.57;
    const opacity = p.hub ? 1 : (small ? 0.6 : 0.4) + (p.z + 1) * (small ? 0.2 : 0.28);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${p.hub ? 'url(#hub)' : '#ffab28'}" opacity="${round(opacity)}"/>`;
  }).join('\n');
  const halos = hubs.map(p => { const { x, y } = project(p); return `<circle cx="${x}" cy="${y}" r="${small ? 44 : 37}" fill="url(#halo)"/>`; }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
<title id="title">Sourcefield</title>
<desc id="desc">An amber sphere of connected points, with five luminous hubs and fine connections on black. Original scalable vector artwork.</desc>
<defs>
  <radialGradient id="hub"><stop offset="0" stop-color="#fff9c3"/><stop offset=".42" stop-color="#ffe882"/><stop offset="1" stop-color="#ffad17"/></radialGradient>
  <radialGradient id="halo"><stop offset="0" stop-color="#ffb320" stop-opacity=".68"/><stop offset=".22" stop-color="#ff960a" stop-opacity=".25"/><stop offset="1" stop-color="#ff7d00" stop-opacity="0"/></radialGradient>
  <filter id="bloom" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${small ? 8 : 4.5}"/></filter>
</defs>
<rect x="32" y="32" width="960" height="960" rx="216" fill="#030303"/>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
${links}
<g opacity=".55" filter="url(#bloom)">${arcs}</g>
${arcs}
</g>
<g>${halos}</g>
<g filter="url(#bloom)" opacity=".5">${dots}</g>
<g>${dots}</g>
</svg>
`;
}
await mkdir('resources', { recursive: true });
await writeFile('resources/icon-detailed.svg', artwork());
await writeFile('resources/icon.svg', artwork(true));
await writeFile('resources/icon-small.svg', artwork(true));
console.log('Created vector icon masters.');
