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
  const sleeveVertices = new Map<number, number>();
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
    for (const v of boundary) sleeveVertices.set(v, side);
    for (let c = p.left; c <= p.right; c++) pins.add(p.top * columns + c);
    if (design.garment.sleeveLength === 0) continue;
    const n = boundary.length,
      center = [0, 0, 0];
    for (const v of boundary)
      for (let k = 0; k < 3; k++) center[k] += points[v * 3 + k] / n;
    const length = design.garment.sleeveLength / 100,
      radius = Math.max(0.075, Math.min(0.13, chestRadius * 0.42)),
      cuff = design.sleeveStyle === "bell" ? radius * 1.6 : radius * 0.9;
    let previous = boundary;
    for (let r = 1; r <= 20; r++) {
      const t = r / 20,
        blend = Math.min(1, t * 5) ** 2 * (3 - 2 * Math.min(1, t * 5)),
        ring: number[] = [];
      for (let c = 0; c < n; c++) {
        const root = boundary[c] * 3,
          angle = Math.atan2(
            points[root + 1] - center[1],
            points[root + 2] - center[2],
          );
        const radial = radius + (cuff - radius) * t;
        const targetX = side * 0.929 * Math.sin(angle) * radial,
          targetY = 0.37 * Math.sin(angle) * radial,
          targetZ = Math.cos(angle) * radial;
        const distance = 0.075 + Math.max(0.005, length - 0.075) * t;
        const target = [
          side * (design.garment.shoulders / 200 - 0.015 + 0.37 * distance) +
            targetX,
          anchor - 0.025 - 0.929 * distance + targetY,
          targetZ,
        ];
        const id = points.length / 3;
        ring.push(id);
        sleeveVertices.set(id, side);
        for (let k = 0; k < 3; k++)
          points.push(points[root + k] * (1 - blend) + target[k] * blend);
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
    sleeveVertices: [...sleeveVertices]
      .map(([v, side]) => ({ vertex: map.get(v)!, side }))
      .filter((v) => v.vertex !== undefined),
    points: compact,
    uv: compactUv,
    indices: indices.map((i) => map.get(i)!),
    loops: loops.map((loop) => loop.map((i) => map.get(i)!)),
    pinned: [...pins].map((i) => map.get(i)!).filter((i) => i !== undefined),
  };
}
