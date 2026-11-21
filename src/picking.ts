import { MathUtils, Vector3, type PerspectiveCamera } from "three";
import type { MapNode } from "../shared/types";

/** Pick the closest visible point in CSS pixels, matching the point shader.
 * A world-space ray tolerance shrinks unpredictably when orbiting inside a map
 * and can select a different depth layer instead of the point under the mouse.
 */
export function pickNodeAtPixel(
  nodes: MapNode[],
  camera: PerspectiveCamera,
  width: number,
  height: number,
  x: number,
  y: number,
  graphRadius: number,
  indices?: readonly number[],
): number | null {
  if (width <= 0 || height <= 0) return null;
  camera.updateMatrixWorld();
  const world = new Vector3(),
    view = new Vector3(),
    projected = new Vector3();
  let closest: number | null = null,
    closestDistance = Infinity,
    closestDepth = Infinity;
  for (let slot = 0; slot < (indices?.length ?? nodes.length); slot++) {
    const i = indices ? indices[slot] : slot;
    const n = nodes[i];
    world.fromArray(n.position);
    view.copy(world).applyMatrix4(camera.matrixWorldInverse);
    const depth = -view.z;
    if (depth < camera.near || depth > camera.far) continue;
    projected.copy(world).project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const px = ((projected.x + 1) * width) / 2;
    const py = ((1 - projected.y) * height) / 2;
    const size =
      (n.kind === "folder" ? 9 : n.kind === "file" ? 7 : 4.6) +
      Math.log2(n.degree + 1) * 1.25;
    const renderedDiameter = MathUtils.clamp(
      (size * graphRadius * 4.1) / Math.max(1, depth),
      1,
      65,
    );
    // Minimum 20px target; scale with the visible core when points grow nearby.
    const radius = Math.max(10, renderedDiameter * 0.42);
    const distance = Math.hypot(px - x, py - y);
    if (distance > radius) continue;
    if (
      distance < closestDistance - 0.5 ||
      (Math.abs(distance - closestDistance) <= 0.5 && depth < closestDepth)
    ) {
      closest = i;
      closestDistance = distance;
      closestDepth = depth;
    }
  }
  return closest;
}
