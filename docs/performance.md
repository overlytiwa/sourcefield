# Rendering performance investigation

## Glow-off regression investigated in 1.2.1

A report described rendering feeling worse with glow disabled. Inspection found
that the old toggle changed more than the glow effect:

| Mode | Base scene target | Final conversion |
| --- | --- | --- |
| Glow on, before fix | EffectComposer's offscreen target, with zero MSAA samples by default | OutputPass |
| Glow off, before fix | Default canvas framebuffer from a renderer created with `antialias: true` | Direct renderer path |
| Both modes, after fix | Same EffectComposer offscreen target | OutputPass |

The canvas requests multisample antialiasing (MSAA), whereas the composer target
is single-sampled. The actual canvas sample count depends on the device/browser.
On hardware where multisampling a dense transparent graph is expensive, switching
the base graph onto that framebuffer can offset the saving from removing bloom.
The two routes also applied output conversion differently. This is a confirmed
render-path inconsistency and a plausible explanation for the reported symptom,
not a measured attribution of that user's frame times.

The fix always renders through EffectComposer and sets `UnrealBloomPass.enabled`
to the effective glow state. Disabled passes are skipped by the composer, so no
bloom extraction, mip blur, composite or blend work runs while glow is off. The
point halo uniform still becomes zero. Manual disable, zero strength and automatic
performance reduction all use the same path. Restoring glow reenables bloom.

## What the toggle does not remove

Nodes, edges, label placement, node picking and the main point shader remain
active. The point sprite size and fragment footprint are unchanged. Labels can
scan many candidates and picking currently visits all nodes per pointer event.
Those are separate potential CPU/overdraw bottlenecks; this investigation has not
measured them as the cause of the user's report. High pixel ratios also increase
rendering cost in both modes. Glow off does not mean all shaders are disabled.

## Verification and its limits

`npm run smoke:render` uses the actual EffectComposer, RenderPass, UnrealBloomPass,
OutputPass and GraphScene's rendering-setting methods with a recording renderer.
It checks that the base scene stays offscreen with the same sample count, output
conversion remains enabled, bloom work is skipped in all three off states, the
view state survives, and glow can be restored.

The recording renderer observes 15 `render()` submissions with bloom and two
without it for this pass configuration. These are renderer submissions, not
measured GPU draw-call totals or FPS. The base scene can itself contain multiple
draw calls. Chromium could not launch in the investigation workspace because its
local IPC socket creation was denied; no live WebGL timings were collected and
no FPS improvement is claimed from this check.

## Reproduce a fair comparison on the affected computer

1. Run the built source app with `npm start` and open one project or saved map.
2. Disable Automatic performance temporarily so it cannot change glow mid-run.
3. Keep the camera, viewport, display scaling, layers and label setting fixed.
4. In View > Toggle Developer Tools, use the Performance panel to record the
   same orbit/zoom action with glow on and off. Warm up both modes before each
   recording so initial shader compilation does not dominate the comparison.
5. Alternate the order and repeat. Compare frame intervals and main-thread work,
   rather than treating one long stall or visual brightness as a frame-rate test.
6. Repeat with labels disabled and with the pointer away from the graph. If only
   these runs improve, label layout or hover picking warrants separate profiling.

Record the app version, GPU/driver, operating system, node/edge counts, viewport,
display pixel ratio and whether hardware acceleration is active alongside the
results. Software-rendered results should not be presented as GPU benchmarks.
