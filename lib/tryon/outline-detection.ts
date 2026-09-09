import type { TracePoint } from "./design-trace";
/** Local image processing for a single centred garment on a plain background.
 * Border-colour segmentation for photos; local contrast for pencil sketches.
 * It does not recognise garment semantics or infer a hidden back. */
export function detectOutline(
  data: ArrayLike<number>,
  width: number,
  height: number,
  mode: "sketch" | "photo" = "sketch",
) {
  if (
    width < 32 ||
    height < 32 ||
    width * height > 512 * 512 ||
    data.length !== width * height * 4
  )
    throw new Error("Choose an image with a clear garment outline.");
  const n = width * height,
    gray = new Float32Array(n),
    integral = new Float64Array((width + 1) * (height + 1));
  const border: number[][] = [[], [], []];
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        alpha = data[i * 4 + 3] / 255;
      gray[i] =
        (data[i * 4] * 0.299 +
          data[i * 4 + 1] * 0.587 +
          data[i * 4 + 2] * 0.114) *
          alpha +
        255 * (1 - alpha);
      sum += gray[i];
      integral[(y + 1) * (width + 1) + x + 1] =
        integral[y * (width + 1) + x + 1] + sum;
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3)
        for (let k = 0; k < 3; k++)
          border[k].push(data[i * 4 + k] * alpha + 255 * (1 - alpha));
    }
  }
  const bg = border.map(
      (a) => a.sort((a, b) => a - b)[Math.floor(a.length / 2)],
    ),
    mask = new Uint8Array(n);
  const radius = 9,
    stride = width + 1;
  for (let y = 3; y < height - 3; y++)
    for (let x = 3; x < width - 3; x++) {
      const i = y * width + x,
        x0 = Math.max(0, x - radius),
        x1 = Math.min(width, x + radius + 1),
        y0 = Math.max(0, y - radius),
        y1 = Math.min(height, y + radius + 1);
      const mean =
        (integral[y1 * stride + x1] -
          integral[y0 * stride + x1] -
          integral[y1 * stride + x0] +
          integral[y0 * stride + x0]) /
        ((x1 - x0) * (y1 - y0));
      const alpha = data[i * 4 + 3] / 255;
      const distance = Math.hypot(
        ...bg.map((b, k) => data[i * 4 + k] * alpha + 255 * (1 - alpha) - b),
      );
      mask[i] =
        mode === "sketch"
          ? +(gray[i] < mean - 9 && distance > 18)
          : +(distance > 55);
    }
  // Join nearby pencil strokes before choosing a component; ignore isolated specks.
  const joined = new Uint8Array(n);
  for (let y = 2; y < height - 2; y++)
    for (let x = 2; x < width - 2; x++)
      if (mask[y * width + x])
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            joined[(y + dy) * width + x + dx] = 1;
  const visited = new Uint8Array(n);
  let best: number[] = [];
  let bestScore = 0;
  for (let i = 0; i < n; i++)
    if (joined[i] && !visited[i]) {
      const queue = [i];
      visited[i] = 1;
      let minX = width,
        maxX = 0,
        minY = height,
        maxY = 0;
      for (let q = 0; q < queue.length; q++) {
        const p = queue[q],
          x = p % width,
          y = Math.floor(p / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (const [xx, yy] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ])
          if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
            const j = yy * width + xx;
            if (joined[j] && !visited[j]) {
              visited[j] = 1;
              queue.push(j);
            }
          }
      }
      const centre = (minX + maxX) / 2,
        h = maxY - minY;
      const score = queue.length * (1 - Math.abs(centre - width / 2) / width);
      if (h > height * 0.2 && maxX - minX > width * 0.12 && score > bestScore) {
        best = queue;
        bestScore = score;
      }
    }
  if (best.length < 60)
    throw new Error(
      "No clear outline found. Try a brighter, closer crop on a plain background, or adjust the points manually.",
    );
  const xs = best.map((i) => i % width).sort((a, b) => a - b),
    ys = best.map((i) => Math.floor(i / width)).sort((a, b) => a - b);
  const left = xs[Math.floor(xs.length * 0.015)],
    right = xs[Math.floor(xs.length * 0.985)],
    top = ys[Math.floor(ys.length * 0.01)],
    bottom = ys[Math.floor(ys.length * 0.99)];
  const h = bottom - top,
    centre = (left + right) / 2;
  if (h < height * 0.2 || (right - left) * h > width * height * 0.9)
    throw new Error(
      "The background is mixed with the design. Crop to one garment or switch Sketch / Photo.",
    );
  const edge = (fraction: number) => {
    const y = top + h * fraction,
      band = best
        .filter(
          (i) => Math.abs(Math.floor(i / width) - y) < Math.max(3, h * 0.035),
        )
        .map((i) => i % width)
        .sort((a, b) => a - b);
    return band.length ? band[Math.floor(band.length * 0.95)] : right;
  };
  const p = (x: number, y: number): TracePoint => ({
    x: (x / width) * 100,
    y: (y / height) * 100,
  });
  const shoulderX = Math.max(centre + (right - left) * 0.2, edge(0.08)),
    chestX = Math.max(centre + (right - left) * 0.2, edge(0.25));
  const points = [
    p(centre, top + h * 0.07),
    p(shoulderX, top + h * 0.03),
    p(chestX, top + h * 0.25),
    p(edge(0.43), top + h * 0.43),
    p(edge(0.66), top + h * 0.66),
    p(edge(0.92), top + h * 0.95),
    p(edge(0.22), top + h * 0.22),
    p(edge(0.28), top + h * 0.28),
  ];
  return {
    points,
    message:
      "Suggested outline — check the shoulder and bottom edge, especially for layered designs.",
  };
}
