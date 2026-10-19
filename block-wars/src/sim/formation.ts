/**
 * Crowd formation: phyllotaxis (sunflower) packing around the leader.
 * Unit 0 is the leader at the origin; followers spiral outward so the blob
 * grows and shrinks smoothly as the count changes. Once the blob is wider
 * than `maxHalfWidth` it is squashed into an ellipse that keeps its area and
 * trails backwards, so big crews read as a column instead of spilling off
 * the road. Pure math — shared by the sim and the renderer.
 */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface CrowdExtents {
  /** half width of the blob */
  halfWidth: number;
  /** distance from leader to the front edge (+z) */
  front: number;
  /** distance from leader to the back edge (-z) */
  back: number;
  sx: number;
  sz: number;
  shift: number;
}

export function crowdExtents(count: number, spacing: number, maxHalfWidth: number): CrowdExtents {
  const r = spacing * Math.sqrt(Math.max(1, count));
  if (r <= maxHalfWidth) return { halfWidth: r, front: r, back: r, sx: 1, sz: 1, shift: 0 };
  const sx = maxHalfWidth / r;
  const sz = r / maxHalfWidth;
  const shift = (sz - 1) * r;
  return { halfWidth: maxHalfWidth, front: r * sz - shift, back: r * sz + shift, sx, sz, shift };
}

/** Offset of unit i (0 = leader) in a crowd of `count`; writes into out[0..1]. */
export function unitOffset(i: number, ext: CrowdExtents, spacing: number, out: { x: number; z: number }): void {
  if (i === 0) {
    out.x = 0;
    out.z = 0;
    return;
  }
  const rr = spacing * Math.sqrt(i + 0.5);
  const a = i * GOLDEN;
  out.x = Math.cos(a) * rr * ext.sx;
  out.z = Math.sin(a) * rr * ext.sz - ext.shift;
}

/** Fill a Float32Array with x,z offsets for units [0, count). */
export function fillOffsets(count: number, spacing: number, maxHalfWidth: number, out: Float32Array): CrowdExtents {
  const ext = crowdExtents(count, spacing, maxHalfWidth);
  const p = { x: 0, z: 0 };
  for (let i = 0; i < count; i++) {
    unitOffset(i, ext, spacing, p);
    out[i * 2] = p.x;
    out[i * 2 + 1] = p.z;
  }
  return ext;
}
