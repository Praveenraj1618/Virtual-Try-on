import * as T from "three";
import { Cloth, type Vec3 } from "./cloth";
import type { Measurements, Design } from "./schema";
type Ring = { y: number; a: number; b: number };
type Capsule = { start: T.Vector3; end: T.Vector3; r1: number; r2: number };
export type GarmentPart = { mesh: T.Mesh; cloth: Cloth };
// Ramanujan's ellipse perimeter approximation; all input dimensions are cm.
export function radiusForCircumference(cm: number, ratio = 0.72) {
  return (
    cm /
    100 /
    (Math.PI * (3 * (1 + ratio) - Math.sqrt((3 + ratio) * (1 + 3 * ratio))))
  );
}
export function dimensions(m: Measurements) {
  const h = m.height / 100,
    crotch = m.inseam / 100 + 0.065,
    waist = crotch + (h - crotch) * 0.27,
    chest = h * 0.735,
    shoulder = h * 0.825;
  return {
    h,
    crotch,
    waist,
    chest,
    shoulder,
    shoulderX: m.shoulders / 200,
    chestR: radiusForCircumference(m.chest),
    waistR: radiusForCircumference(m.waist),
    hipR: radiusForCircumference(m.hips),
    arm: m.arm / 100,
  };
}
function geometry(points: number[], columns: number, rows: number) {
  const g = new T.BufferGeometry(),
    uv: number[] = [],
    index: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      uv.push(c / (columns - 1), 1 - r / (rows - 1));
      if (r < rows - 1) {
        const a = r * columns + c,
          b = r * columns + ((c + 1) % columns);
        index.push(a, a + columns, b, b, a + columns, b + columns);
      }
    }
  g.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
function interpolate(rings: Ring[], y: number): Ring {
  if (y <= rings[0].y) return { ...rings[0], y };
  for (let i = 1; i < rings.length; i++)
    if (y <= rings[i].y) {
      const t = (y - rings[i - 1].y) / (rings[i].y - rings[i - 1].y),
        u = t * t * (3 - 2 * t);
      return {
        y,
        a: T.MathUtils.lerp(rings[i - 1].a, rings[i].a, u),
        b: T.MathUtils.lerp(rings[i - 1].b, rings[i].b, u),
      };
    }
  return { ...rings[rings.length - 1], y };
}
function ringPoints(rings: Ring[], rows = 30, columns = 48, folds = 0) {
  const pts: number[] = [],
    bottom = rings[0].y,
    top = rings[rings.length - 1].y;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1),
      ring = interpolate(rings, T.MathUtils.lerp(top, bottom, t));
    for (let c = 0; c < columns; c++) {
      const angle = (c / columns) * Math.PI * 2,
        wave = folds * Math.sin(angle * 12 + t * 2) * t * t;
      pts.push(
        (ring.a + wave) * Math.sin(angle),
        ring.y,
        (ring.b + wave) * Math.cos(angle),
      );
    }
  }
  return pts;
}
function segmentPoints(
  start: T.Vector3,
  end: T.Vector3,
  r1: number,
  r2: number,
  rows = 18,
  columns = 32,
  folds = 0,
) {
  const direction = end.clone().sub(start).normalize(),
    u = new T.Vector3(0, 0, 1),
    v = new T.Vector3().crossVectors(u, direction).normalize(),
    pts: number[] = [];
  for (let row = 0; row < rows; row++) {
    const t = row / (rows - 1),
      center = start.clone().lerp(end, t),
      radius = T.MathUtils.lerp(r1, r2, t);
    for (let c = 0; c < columns; c++) {
      const theta = (c / columns) * Math.PI * 2,
        r = radius + folds * Math.sin(theta * 9 + t * 2) * t,
        p = center
          .clone()
          .addScaledVector(u, Math.cos(theta) * r * 0.88)
          .addScaledVector(v, Math.sin(theta) * r);
      pts.push(p.x, p.y, p.z);
    }
  }
  return pts;
}
export function createMannequin(m: Measurements, d: Design) {
  const group = new T.Group(),
    body = new T.Group(),
    garments = new T.Group();
  group.add(body, garments);
  const dim = dimensions(m),
    {
      h,
      crotch,
      waist,
      chest,
      shoulder,
      shoulderX,
      chestR,
      waistR,
      hipR,
      arm,
    } = dim;
  const skin = new T.MeshStandardMaterial({
    color: "#c1b5a5",
    roughness: 0.72,
    metalness: 0.03,
  });
  const addBody = (g: T.BufferGeometry) => {
    const mesh = new T.Mesh(g, skin);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };
  const sphere = (
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
  ) => {
    const mesh = addBody(new T.SphereGeometry(1, 40, 28));
    mesh.position.set(x, y, z);
    mesh.scale.set(rx, ry, rz);
  };
  const rings: Ring[] = [
    { y: crotch - 0.015, a: hipR * 0.57, b: hipR * 0.62 },
    { y: crotch + 0.09, a: hipR, b: hipR * 0.72 },
    { y: waist, a: waistR, b: waistR * 0.72 },
    { y: chest, a: chestR, b: chestR * 0.72 },
    { y: shoulder - 0.015, a: shoulderX, b: chestR * 0.63 },
    { y: shoulder + 0.035, a: shoulderX * 0.66, b: 0.064 },
    { y: h * 0.865, a: 0.047, b: 0.047 },
  ];
  addBody(geometry(ringPoints(rings, 44), 48, 44));
  sphere(0, h * 0.862, 0, 0.048, h * 0.041, 0.046);
  sphere(0, h * 0.935, 0.006, h * 0.051, h * 0.066, h * 0.052);
  const legs: Capsule[] = [],
    arms: Capsule[] = [];
  for (const side of [-1, 1]) {
    const hip = new T.Vector3(side * hipR * 0.49, crotch + 0.06, 0),
      knee = new T.Vector3(side * hipR * 0.5, crotch * 0.53, 0.018),
      ankle = new T.Vector3(side * hipR * 0.5, 0.105, 0);
    legs.push(
      { start: hip, end: knee, r1: hipR * 0.5, r2: 0.049 },
      { start: knee, end: ankle, r1: 0.05, r2: 0.033 },
    );
    sphere(knee.x, knee.y, knee.z, 0.049, 0.056, 0.048);
    sphere(ankle.x, 0.05, 0.058, 0.043, 0.046, 0.1);
    const s = new T.Vector3(side * (shoulderX - 0.015), shoulder - 0.025, 0),
      elbow = new T.Vector3(
        side * (shoulderX + 0.105),
        shoulder - 0.025 - arm * 0.5,
        0,
      ),
      wrist = new T.Vector3(
        side * (shoulderX + 0.18),
        shoulder - 0.025 - arm,
        0,
      );
    arms.push(
      { start: s, end: elbow, r1: 0.054, r2: 0.037 },
      { start: elbow, end: wrist, r1: 0.039, r2: 0.026 },
    );
    sphere(s.x, s.y, 0, 0.058, 0.065, 0.058);
    sphere(elbow.x, elbow.y, 0, 0.038, 0.041, 0.038);
    sphere(wrist.x + side * 0.01, wrist.y - 0.055, 0.004, 0.033, 0.065, 0.021);
  }
  for (const segment of [...legs, ...arms])
    addBody(
      geometry(
        segmentPoints(segment.start, segment.end, segment.r1, segment.r2),
        32,
        18,
      ),
    );
  // Underwear keeps an unclothed mannequin neutral during garment changes.
  const base = new T.MeshStandardMaterial({
    color: "#8d958b",
    roughness: 1,
    side: T.DoubleSide,
  });
  const baseMesh = new T.Mesh(
    geometry(
      ringPoints(
        [
          { y: crotch + 0.015, a: hipR * 0.86, b: hipR * 0.71 },
          { y: crotch + 0.1, a: hipR + 0.003, b: hipR * 0.72 + 0.003 },
          { y: waist - 0.025, a: waistR + 0.004, b: waistR * 0.72 + 0.004 },
        ],
        16,
      ),
      48,
      16,
    ),
    base,
  );
  body.add(baseMesh);
  const ease = d.ease / 100 / (2 * Math.PI),
    parts: GarmentPart[] = [];
  const stiffness =
    d.fabric === "denim" ? 0.96 : d.fabric === "silk" ? 0.53 : 0.8;
  const material = new T.MeshStandardMaterial({
    color: d.color,
    roughness: d.fabric === "silk" ? 0.42 : 0.94,
    side: T.DoubleSide,
    metalness: 0,
  });
  const part = (pts: number[], cols: number, rows: number) => {
    const cloth = new Cloth(pts, cols, rows, stiffness),
      mesh = new T.Mesh(geometry(pts, cols, rows), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    garments.add(mesh);
    parts.push({ mesh, cloth });
  };
  const neckline = { y: shoulder + 0.043, a: 0.071, b: 0.067 };
  const upper: Ring[] = [
    { y: waist, a: waistR + ease, b: waistR * 0.72 + ease },
    { y: chest, a: chestR + ease, b: chestR * 0.72 + ease },
    { y: shoulder - 0.005, a: shoulderX + 0.025, b: chestR * 0.68 + ease },
    { y: shoulder + 0.022, a: shoulderX * 0.7, b: 0.084 },
    neckline,
  ];
  if (d.kind !== "trousers") {
    const hem =
      d.kind === "dress"
        ? Math.max(0.24, waist - (0.62 * d.length) / 100)
        : Math.max(crotch - 0.04, shoulder - (0.6 * d.length) / 100);
    const bottom =
      d.kind === "dress"
        ? hipR + 0.085 + (d.length - 75) * 0.0009
        : Math.max(hipR + ease, waistR + ease);
    const torsoRings = [
      {
        y: hem,
        a: bottom,
        b: d.kind === "dress" ? bottom * 0.85 : hipR * 0.72 + ease,
      },
      ...(hem < crotch + 0.1
        ? [
            {
              y: crotch + 0.1,
              a: hipR + ease + 0.006,
              b: hipR * 0.72 + ease + 0.006,
            },
          ]
        : []),
      ...upper.filter((r) => r.y > hem),
    ];
    part(
      ringPoints(torsoRings, 38, 48, d.kind === "dress" ? 0.012 : 0.003),
      48,
      38,
    );
    if (d.sleeve > 0)
      for (const side of [-1, 1]) {
        const index = side === -1 ? 0 : 2,
          s = arms[index].start.clone();
        s.x -= side * 0.013;
        s.y += 0.012;
        const end = s
          .clone()
          .lerp(arms[index + 1].end, Math.max(0.13, d.sleeve / 100));
        part(
          segmentPoints(
            s,
            end,
            0.069 + ease * 0.4,
            0.054 + ease * 0.4,
            16,
            32,
            0.002,
          ),
          32,
          16,
        );
      }
  } else {
    const pantsRings = [
      { y: crotch - 0.015, a: hipR * 0.85 + ease, b: hipR * 0.7 + ease },
      { y: crotch + 0.1, a: hipR + ease, b: hipR * 0.72 + ease },
      { y: waist + 0.015, a: waistR + ease, b: waistR * 0.72 + ease },
    ];
    part(ringPoints(pantsRings, 18, 48, 0.002), 48, 18);
    for (const side of [-1, 1]) {
      const start = new T.Vector3(side * hipR * 0.49, crotch + 0.06, 0),
        end = new T.Vector3(
          side * hipR * 0.5,
          Math.max(0.065, crotch - ((crotch - 0.085) * d.length) / 100),
          0,
        );
      part(
        segmentPoints(
          start,
          end,
          hipR * 0.51 + ease,
          0.052 + ease * 0.7,
          30,
          40,
          0.003,
        ),
        40,
        30,
      );
    }
  }
  const capsules = [...legs, ...arms].map((s) => ({
    x: s.start.x,
    y: s.start.y,
    z: s.start.z,
    dx: s.end.x - s.start.x,
    dy: s.end.y - s.start.y,
    dz: s.end.z - s.start.z,
    r1: s.r1,
    r2: s.r2,
  }));
  const collide = (input: Vec3): Vec3 => {
    let [x, y, z] = input;
    if (y >= rings[0].y && y <= rings[rings.length - 1].y) {
      const r = interpolate(rings, y),
        a = r.a + 0.004,
        b = r.b + 0.004,
        dist = Math.hypot(x / a, z / b);
      if (dist > 1e-5 && dist < 1) {
        x /= dist;
        z /= dist;
      }
    }
    for (const s of capsules) {
      const t = T.MathUtils.clamp(
          ((x - s.x) * s.dx + (y - s.y) * s.dy + (z - s.z) * s.dz) /
            (s.dx * s.dx + s.dy * s.dy + s.dz * s.dz),
          0,
          1,
        ),
        cx = s.x + t * s.dx,
        cy = s.y + t * s.dy,
        cz = s.z + t * s.dz,
        dx = x - cx,
        dy = y - cy,
        dz = z - cz,
        len = Math.hypot(dx, dy, dz),
        r = T.MathUtils.lerp(s.r1, s.r2, t) + 0.004;
      if (len < r && len > 1e-7) {
        x = cx + (dx * r) / len;
        y = cy + (dy * r) / len;
        z = cz + (dz * r) / len;
      }
    }
    return [x, y, z];
  };
  return { group, parts, material, collide, dim };
}
