import type { Design } from "./schema";
/** Cut real side openings and extend their existing boundary vertices into sleeves.
 * The sleeve roots and bodice share vertex IDs, so simulation cannot separate them. */
export function connectedUpperGarment(
  points: number[],
  columns: number,
  rows: number,
  anchor: number,
  design: Design,
  chestRadius: number,
) {
  const uv: number[] = [],
    indices: number[] = [],
    loops: number[][] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++)
      uv.push(c / (columns - 1), 1 - r / (rows - 1));
  const rowNear = (y: number) => {
    let best = 2;
    for (let r = 2; r < rows - 2; r++)
      if (
        Math.abs(points[(r * columns + columns / 4) * 3 + 1] - y) <
        Math.abs(points[(best * columns + columns / 4) * 3 + 1] - y)
      )
        best = r;
    return best;
  };
  const top = rowNear(anchor - 0.035),
    bottom = Math.max(top + 2, rowNear(anchor - 0.19));
  const half = 5,
    patches = [columns / 4, (columns * 3) / 4].map((c) => ({
      left: c - half,
      right: c + half,
      top,
      bottom,
    }));
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < columns; c++) {
      if (
        patches.some(
          (p) => r >= p.top && r < p.bottom && c >= p.left && c < p.right,
        )
      )
        continue;
      const a = r * columns + c,
        b = r * columns + ((c + 1) % columns);
      indices.push(a, a + columns, b, b, a + columns, b + columns);
    }
  const collar = Array.from({ length: columns }, (_, c) => c),
    hem = Array.from({ length: columns }, (_, c) => (rows - 1) * columns + c);
  loops.push(collar, hem);
  const pins = new Set(collar);
  for (let sideIndex = 0; sideIndex < patches.length; sideIndex++) {
    const p = patches[sideIndex],
      side = sideIndex === 0 ? 1 : -1,
      boundary: number[] = [];
    for (let c = p.left; c < p.right; c++) boundary.push(p.top * columns + c);
    for (let r = p.top; r < p.bottom; r++) boundary.push(r * columns + p.right);
    for (let c = p.right; c > p.left; c--)
      boundary.push(p.bottom * columns + c);
    for (let r = p.bottom; r > p.top; r--) boundary.push(r * columns + p.left);
    loops.push(boundary);
    for (let c = p.left; c <= p.right; c++) pins.add(p.top * columns + c);
    if (design.garment.sleeveLength === 0) continue;
    const n = boundary.length,
      center = [0, 0, 0];
    for (const v of boundary)
      for (let k = 0; k < 3; k++) center[k] += points[v * 3 + k] / n;
    const length = design.garment.sleeveLength / 100,
      radius = Math.max(0.062, Math.min(0.13, chestRadius * 0.38)),
      cuff = design.sleeveStyle === "bell" ? radius * 1.6 : radius * 0.78;
    let previous = boundary;
    for (let r = 1; r <= 20; r++) {
      const t = r / 20,
        blend = t * t * (3 - 2 * t),
        ring: number[] = [];
      for (let c = 0; c < n; c++) {
        const root = boundary[c] * 3,
          angle = Math.atan2(
            points[root + 1] - center[1],
            points[root + 2] - center[2],
          );
        const targetX = side * 0.957 * Math.sin(angle) * cuff,
          targetY = 0.29 * Math.sin(angle) * cuff,
          targetZ = Math.cos(angle) * cuff * 0.92;
        ring.push(points.length / 3);
        points.push(
          center[0] +
            side * 0.29 * length * t +
            (points[root] - center[0]) * (1 - blend) +
            targetX * blend,
          center[1] -
            0.957 * length * t +
            (points[root + 1] - center[1]) * (1 - blend) +
            targetY * blend,
          center[2] +
            (points[root + 2] - center[2]) * (1 - blend) +
            targetZ * blend,
        );
        uv.push(c / (n - 1), 1 - t);
      }
      for (let c = 0; c < n; c++) {
        const next = (c + 1) % n;
        indices.push(
          previous[next],
          previous[c],
          ring[c],
          ring[next],
          previous[next],
          ring[c],
        );
      }
      previous = ring;
    }
    loops.push(previous);
  }
  // Drop vertices inside the removed patches; no disconnected phantom cloth remains.
  const used = new Set(indices),
    map = new Map<number, number>(),
    compact: number[] = [],
    compactUv: number[] = [];
  for (const i of used) {
    map.set(i, map.size);
    compact.push(...points.slice(i * 3, i * 3 + 3));
    compactUv.push(...uv.slice(i * 2, i * 2 + 2));
  }
  return {
    points: compact,
    uv: compactUv,
    indices: indices.map((i) => map.get(i)!),
    loops: loops.map((loop) => loop.map((i) => map.get(i)!)),
    pinned: [...pins].map((i) => map.get(i)!).filter((i) => i !== undefined),
  };
}
