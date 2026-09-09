/** Small position-based cloth relaxation solver. This is a visual approximation,
 * not a calibrated fabric or garment-fit model. SI units throughout. */
export type Vec3 = [number, number, number];
export type Edge = { a: number; b: number; rest: number; stiffness: number };
export class Cloth {
  positions: Float32Array;
  previous: Float32Array;
  rest: Float32Array;
  edges: Edge[] = [];
  pinned: Set<number>;
  count: number;
  anchors: Float32Array;
  target: Float32Array;
  attachment: Float32Array;
  constructor(
    points: number[],
    public columns: number,
    public rows: number,
    public stiffness = 0.8,
    topology?: { indices: number[]; pinned: number[] },
  ) {
    this.positions = new Float32Array(points);
    this.previous = this.positions.slice();
    this.rest = this.positions.slice();
    this.target = this.positions.slice();
    this.anchors = this.positions.slice();
    this.count = points.length / 3;
    this.attachment = new Float32Array(this.count).fill(0.004);
    this.pinned = new Set(Array.from({ length: columns }, (_, i) => i));
    const connect = (a: number, b: number, k: number) => {
      const i = a * 3,
        j = b * 3;
      this.edges.push({
        a,
        b,
        rest: Math.hypot(
          points[i] - points[j],
          points[i + 1] - points[j + 1],
          points[i + 2] - points[j + 2],
        ),
        stiffness: k,
      });
    };
    if (topology) {
      this.pinned = new Set(topology.pinned);
      const edges = new Map<
        string,
        { a: number; b: number; opposite: number }
      >();
      for (let i = 0; i < topology.indices.length; i += 3) {
        const tri = topology.indices.slice(i, i + 3);
        for (let j = 0; j < 3; j++) {
          const a = tri[j],
            b = tri[(j + 1) % 3],
            opposite = tri[(j + 2) % 3],
            key = a < b ? `${a}:${b}` : `${b}:${a}`,
            previous = edges.get(key);
          if (!previous) {
            connect(a, b, stiffness);
            edges.set(key, { a, b, opposite });
          } else connect(previous.opposite, opposite, stiffness * 0.18);
        }
      }
      return;
    }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < columns; c++) {
        const a = r * columns + c,
          n = r * columns + ((c + 1) % columns);
        connect(a, n, stiffness);
        if (r + 1 < rows) {
          connect(a, a + columns, stiffness);
          connect(a, (r + 1) * columns + ((c + 1) % columns), stiffness * 0.65);
          connect(n, a + columns, stiffness * 0.65);
        }
        if (r + 2 < rows) connect(a, a + columns * 2, stiffness * 0.15);
      }
  }
  fitAnchors(collide: (p: Vec3) => Vec3) {
    for (const vertex of this.pinned) {
      const i = vertex * 3;
      let p: Vec3 = [this.target[i], this.target[i + 1], this.target[i + 2]];
      for (let pass = 0; pass < 4; pass++) p = collide(p);
      for (let k = 0; k < 3; k++) {
        this.anchors[i + k] = p[k];
        this.positions[i + k] = p[k];
        this.previous[i + k] = p[k];
      }
    }
  }
  step(collide: (p: Vec3) => Vec3) {
    const p = this.positions,
      old = this.previous;
    for (let a = 0; a < this.count; a++) {
      if (this.pinned.has(a)) continue;
      for (let c = 0; c < 3; c++) {
        const i = a * 3 + c,
          now = p[i];
        p[i] += (p[i] - old[i]) * 0.88;
        old[i] = now;
      }
      p[a * 3 + 1] -= 0.0006;
    }
    for (let pass = 0; pass < 6; pass++) {
      for (const { a, b, rest, stiffness } of this.edges) {
        const i = a * 3,
          j = b * 3,
          dx = p[j] - p[i],
          dy = p[j + 1] - p[i + 1],
          dz = p[j + 2] - p[i + 2],
          len = Math.hypot(dx, dy, dz);
        if (len < 1e-8) continue;
        const wa = this.pinned.has(a) ? 0 : 1,
          wb = this.pinned.has(b) ? 0 : 1;
        if (!wa && !wb) continue;
        const f = (((len - rest) / len) * stiffness) / (wa + wb);
        for (let k = 0; k < 3; k++) {
          const d = k === 0 ? dx : k === 1 ? dy : dz;
          p[i + k] += d * f * wa;
          p[j + k] -= d * f * wb;
        }
      }
      for (let a = 0; a < this.count; a++) {
        if (this.pinned.has(a)) continue;
        const i = a * 3;
        // Gentle attachment to the tailored rest shape keeps this preview stable.
        for (let k = 0; k < 3; k++)
          p[i + k] += (this.target[i + k] - p[i + k]) * this.attachment[a];
        const v = collide([p[i], p[i + 1], p[i + 2]]);
        p[i] = v[0];
        p[i + 1] = Math.max(0.035, v[1]);
        p[i + 2] = v[2];
      }
    }
  }
}
