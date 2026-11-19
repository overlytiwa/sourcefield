// Regression check for glow switching. Uses real Three.js passes and a recording
// renderer, not a GPU: this verifies render routing, not frame-rate improvement.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
const apiFile = path.resolve('dist-electron/render-smoke-api.cjs');
await build({ stdin: { contents: "export { GraphScene } from './src/graph';", resolveDir: process.cwd() }, outfile: apiFile,
  bundle: true, platform: 'node', format: 'cjs', external: ['three', 'three/*'] });
const { GraphScene } = createRequire(import.meta.url)(apiFile);
let target = null;
const draws = [], clearColor = new THREE.Color();
let clearAlpha = 1;
const renderer = {
  autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
  outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.25,
  getPixelRatio: () => 1, getSize: value => value.set(800, 600),
  getRenderTarget: () => target, setRenderTarget: value => { target = value; },
  getClearColor: value => value.copy(clearColor), getClearAlpha: () => clearAlpha,
  setClearColor: (value, alpha = clearAlpha) => { clearColor.set(value); clearAlpha = alpha; },
  clear: () => {}, render: object => draws.push({ object, target })
};
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
const bloom = new UnrealBloomPass(new THREE.Vector2(800, 600), .72, .42, .18);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(new OutputPass());
const subject = Object.create(GraphScene.prototype);
Object.assign(subject, { camera, controls: { target: new THREE.Vector3(1, 2, 3) }, selected: 'kept-selection', visibleEdges: new Set(['calls']), showLabels: true,
  bloom, composer, points: { material: { uniforms: { uGlow: { value: 1 } } } }, reduced: false,
  performanceMonitor: { reset: () => {} }, onRenderStatus: () => {} });
const view = subject.capture();
function render(glow, strength = .72, reduced = false) {
  subject.setRendering({ glowEnabled: glow, glowStrength: strength, autoPerformance: true });
  if (reduced) { subject.reduced = true; subject.updateRendering(); }
  draws.length = 0; composer.render(1 / 60);
  const graphDraw = draws.find(draw => draw.object === scene);
  assert(graphDraw?.target, 'Graph always renders offscreen, not directly onto the MSAA canvas');
  assert.equal(graphDraw.target.samples, 0, 'Base scene sample count stays the same');
  assert.equal(draws.at(-1).target, null, 'Output pass still writes to the canvas');
  assert.deepEqual(subject.capture(), view, 'Rendering settings preserve camera, layers, selection and labels');
  if (!glow || !strength || reduced) {
    assert.equal(bloom.enabled, false); assert.equal(subject.points.material.uniforms.uGlow.value, 0);
    assert.equal(draws.length, 2, 'No bloom extraction, blur or blend draws run when glow is off');
  } else { assert(bloom.enabled); assert(draws.length > 2); }
  return draws.length;
}
try {
  const on = render(true), off = render(false); render(true, 0); render(true, .72, true);
  subject.restoreGlow(); assert(bloom.enabled, 'Manual restore reenables bloom');
  assert.equal(render(true), on, 'Repeated toggles restore the same render pipeline');
  console.log(`Render smoke passed: glow-on ${on} draw submissions, glow-off ${off}; stable offscreen scene, output conversion and view state. No GPU timings measured.`);
} finally { for (const pass of composer.passes) pass.dispose(); composer.dispose(); await rm(apiFile, { force: true }); }
