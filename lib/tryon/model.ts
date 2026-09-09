import * as T from "three";
import { Cloth, type Vec3 } from "./cloth";
import { connectedUpperGarment } from "./upper-garment";
import { canDrapeGarment, type Measurements, type Design } from "./schema";
import { armRig, neutralPose, type Pose } from "./pose";
type Ring = { y: number; a: number; b: number };
type Capsule = { start: T.Vector3; end: T.Vector3; r1: number; r2: number };
export type GarmentPart = {
  mesh: T.Mesh;
  cloth: Cloth;
  trims: { line: T.Line; vertices: number[] }[];
};
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
    seed =
      Math.abs(direction.z) > 0.9
        ? new T.Vector3(0, 1, 0)
        : new T.Vector3(0, 0, 1),
    v = new T.Vector3().crossVectors(seed, direction).normalize(),
    u = new T.Vector3().crossVectors(direction, v).normalize(),
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
// One continuous surface along each limb removes the old elbow/knee tube joins.
function limbPoints(segments: Capsule[], rows = 42, columns = 40) {
  const first = segments[0],
    last = segments[1],
    curve = new T.CatmullRomCurve3([
      first.start,
      first.start.clone().lerp(first.end, 0.52),
      first.end,
      last.start.clone().lerp(last.end, 0.46),
      last.end,
    ]);
  const radii = [first.r1, first.r1 * 0.91, first.r2, last.r1 * 1.09, last.r2];
  const points: number[] = [];
  for (let row = 0; row < rows; row++) {
    const t = row / (rows - 1),
      center = curve.getPoint(t),
      axis = curve.getTangent(t),
      seed =
        Math.abs(axis.z) > 0.9
          ? new T.Vector3(0, 1, 0)
          : new T.Vector3(0, 0, 1),
      side = new T.Vector3().crossVectors(seed, axis).normalize(),
      forward = new T.Vector3().crossVectors(axis, side).normalize();
    const f = t * 4,
      i = Math.min(3, Math.floor(f)),
      u = f - i,
      r = T.MathUtils.lerp(radii[i], radii[i + 1], u * u * (3 - 2 * u));
    for (let c = 0; c < columns; c++) {
      const angle = (c / columns) * Math.PI * 2,
        p = center
          .clone()
          .addScaledVector(side, Math.sin(angle) * r)
          .addScaledVector(forward, Math.cos(angle) * r * 0.92);
      points.push(p.x, p.y, p.z);
    }
  }
  return points;
}
export function createMannequin(
  m: Measurements,
  d: Design,
  pose: Pose = neutralPose,
) {
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
  const headGeometry = new T.SphereGeometry(1, 48, 36),
    headVertices = headGeometry.getAttribute("position");
  for (let i = 0; i < headVertices.count; i++) {
    const x = headVertices.getX(i),
      y = headVertices.getY(i),
      z = headVertices.getZ(i);
    headVertices.setXYZ(
      i,
      x * (y < -0.1 ? 1 + (y + 0.1) * 0.2 : 1),
      y,
      z > 0 ? z * 0.91 : z,
    );
  }
  headGeometry.computeVertexNormals();
  const head = addBody(headGeometry);
  head.position.set(0, h * 0.932, 0.006);
  head.scale.set(h * 0.05, h * 0.068, h * 0.056);
  for (const side of [-1, 1])
    sphere(side * h * 0.05, h * 0.937, 0, 0.009, 0.024, 0.014);
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

    sphere(ankle.x, 0.05, 0.058, 0.043, 0.046, 0.1);
    const rig = armRig(
      side,
      shoulderX,
      shoulder,
      arm,
      side < 0 ? pose.right : pose.left,
    );
    const s = rig.shoulder,
      elbow = rig.elbow,
      wrist = rig.wrist;
    arms.push(
      { start: s, end: elbow, r1: 0.054, r2: 0.037 },
      { start: elbow, end: wrist, r1: 0.039, r2: 0.026 },
    );
    sphere(s.x, s.y, s.z, 0.058, 0.058, 0.058);
    sphere(elbow.x, elbow.y, elbow.z, 0.039, 0.039, 0.039);
    sphere(wrist.x, wrist.y, wrist.z, 0.027, 0.027, 0.027);

    sphere(
      wrist.x + side * 0.01,
      wrist.y - 0.035,
      wrist.z,
      0.033,
      0.065,
      0.021,
    );
  }
  for (const pair of [legs.slice(0, 2), legs.slice(2)])
    addBody(geometry(limbPoints(pair), 40, 42));
  // Arm surfaces now follow the same straight segments and joint centres as collision.
  for (const segment of arms)
    addBody(
      geometry(
        segmentPoints(
          segment.start,
          segment.end,
          segment.r1,
          segment.r2,
          24,
          40,
        ),
        40,
        24,
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
  // Clothing rest geometry depends only on garment dimensions. Body measurements
  // supply a single vertical placement anchor; collision may drape but never re-size it.
  const g = d.garment,
    parts: GarmentPart[] = [],
    anchor = d.kind === "trousers" ? waist : shoulder;
  const gChest = radiusForCircumference(g.chest),
    gWaist = radiusForCircumference(g.waist),
    gHip = radiusForCircumference(g.hips),
    gShoulder = g.shoulders / 200;
  const stiffness =
    d.fabric === "denim" ? 0.97 : d.fabric === "silk" ? 0.68 : 0.88;
  const material = new T.MeshStandardMaterial({
    color: d.color,
    roughness: d.fabric === "silk" ? 0.42 : 0.94,
    side: T.DoubleSide,
    metalness: 0,
  });
  const trimMaterial = new T.LineBasicMaterial({
    color: new T.Color(d.color).multiplyScalar(0.64),
    transparent: true,
    opacity: 0.7,
  });
  const part = (
    pts: number[],
    cols: number,
    rows: number,
    neck = false,
    topology?: ReturnType<typeof connectedUpperGarment>,
  ) => {
    const cloth = new Cloth(pts, cols, rows, stiffness, topology);
    if (topology) {
      const bindings = new Map(
        topology.sleeveVertices.map((v) => [v.vertex, v.side]),
      );
      for (let i = 0; i < cloth.count; i++) {
        const point = new T.Vector3(
          ...(pts.slice(i * 3, i * 3 + 3) as [number, number, number]),
        );
        const side = bindings.get(i) ?? Math.sign(point.x);
        // The bodice belongs to the torso. Only sleeve vertices follow the arm;
        // shared armhole vertices blend locally instead of dragging the chest.
        const roots =
          topology.loops[side > 0 ? 2 : d.garment.sleeveLength > 0 ? 4 : 3];
        const isRoot = roots.includes(i);
        let distance = Infinity;
        if (bindings.has(i) && !isRoot)
          for (const v of roots)
            distance = Math.min(
              distance,
              Math.hypot(
                point.x - pts[v * 3],
                point.y - pts[v * 3 + 1],
                point.z - pts[v * 3 + 2],
              ),
            );
        const weight = bindings.has(i)
          ? 0.3 + 0.7 * T.MathUtils.smoothstep(isRoot ? 0 : distance, 0, 0.1)
          : 0;
        cloth.attachment[i] = bindings.has(i) ? 0.07 : 0.035;
        if (!weight) continue;
        const rig = armRig(
          side,
          gShoulder,
          shoulder,
          arm,
          side < 0 ? pose.right : pose.left,
        );
        const posed = point.clone().lerp(rig.transform(point), weight);
        for (let k = 0; k < 3; k++)
          cloth.target[i * 3 + k] = posed.getComponent(k);
      }
      cloth.positions.set(cloth.target);
      cloth.previous.set(cloth.target);
      cloth.anchors.set(cloth.target);
    }
    let geo: T.BufferGeometry;
    if (topology) {
      geo = new T.BufferGeometry();
      geo.setAttribute(
        "position",
        new T.Float32BufferAttribute(cloth.positions, 3),
      );
      geo.setAttribute("uv", new T.Float32BufferAttribute(topology.uv, 2));
      geo.setIndex(topology.indices);
      geo.computeVertexNormals();
    } else geo = geometry(pts, cols, rows);
    const mesh = new T.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    garments.add(mesh);
    const trims: GarmentPart["trims"] = [];
    const trim = (vertices: number[], loop: boolean) => {
      const geo = new T.BufferGeometry();
      geo.setAttribute(
        "position",
        new T.Float32BufferAttribute(
          vertices.flatMap((v) => pts.slice(v * 3, v * 3 + 3)),
          3,
        ),
      );
      const line = loop
        ? new T.LineLoop(geo, trimMaterial)
        : new T.Line(geo, trimMaterial);
      line.renderOrder = 1;
      garments.add(line);
      trims.push({ line, vertices });
    };
    if (topology) {
      for (const loop of topology.loops) trim(loop, true);
    } else {
      trim(
        Array.from({ length: cols }, (_, c) => c),
        true,
      );
      trim(
        Array.from({ length: cols }, (_, c) => (rows - 1) * cols + c),
        true,
      );
      if (neck)
        for (const column of [Math.floor(cols / 4), Math.floor((cols * 3) / 4)])
          trim(
            Array.from({ length: rows }, (_, r) => r * cols + column),
            false,
          );
    }
    parts.push({ mesh, cloth, trims });
  };
  if (d.kind !== "trousers") {
    const hem = anchor - g.length / 100,
      neckWidth = d.neckline === "scoop" ? 0.096 : 0.072;
    const flare =
      d.silhouette === "flared" ? 1.45 : d.silhouette === "tapered" ? 0.9 : 1;
    const hipY =
        anchor -
        (d.tracedShape ? (d.tracedShape.hipAt * g.length) / 100 : 0.44),
      waistY =
        anchor -
        (d.tracedShape ? (d.tracedShape.waistAt * g.length) / 100 : 0.32),
      chestY =
        anchor -
        (d.tracedShape ? (d.tracedShape.chestAt * g.length) / 100 : 0.16);
    const upper: Ring[] = [
      { y: hipY, a: gHip, b: gHip * 0.72 },
      { y: waistY, a: gWaist, b: gWaist * 0.72 },
      { y: chestY, a: gChest, b: gChest * 0.72 },
      { y: anchor - 0.025, a: gShoulder, b: gChest * 0.6 },
      { y: anchor + 0.02, a: gShoulder * 0.7, b: 0.084 },
      { y: anchor + 0.043, a: neckWidth, b: neckWidth * 0.88 },
    ];
    const torsoRings = [
      {
        y: hem,
        a: d.tracedShape
          ? radiusForCircumference(d.tracedShape.hemCircumference)
          : gHip * flare,
        b:
          (d.tracedShape
            ? radiusForCircumference(d.tracedShape.hemCircumference)
            : gHip * flare) * 0.72,
      },
      ...upper.filter((r) => r.y > hem),
    ];
    const points = ringPoints(
      torsoRings,
      48,
      64,
      d.silhouette === "flared" ? 0.006 : 0.001,
    );
    const depth = d.tracedShape
      ? d.tracedShape.neckDepth / 100
      : d.neckline === "v"
        ? 0.125
        : d.neckline === "scoop"
          ? 0.085
          : 0.02;
    for (let r = 0; r < 48; r++)
      for (let c = 0; c < 64; c++) {
        const i = (r * 64 + c) * 3,
          angle = (c / 64) * Math.PI * 2,
          front = Math.max(0, Math.cos(angle));
        const opening =
          d.neckline === "v"
            ? Math.max(0, 1 - Math.abs(Math.sin(angle))) * front
            : front * front;
        points[i + 1] -=
          depth *
          opening *
          Math.max(0, 1 - (anchor + 0.043 - points[i + 1]) / 0.24);
        // A lowered front opening follows the chest surface instead of sinking into it.
        if (front > 0 && points[i + 1] < anchor + 0.02) {
          const section = interpolate(torsoRings, points[i + 1]);
          points[i + 2] = Math.max(points[i + 2], section.b * front);
        }
      }
    const topology = connectedUpperGarment(points, 64, 48, anchor, d, gChest);
    part(topology.points, 64, 48, true, topology);
  } else {
    const crotchY = anchor - g.rise / 100,
      legX = gHip * 0.5,
      flare =
        d.silhouette === "flared" ? 1.5 : d.silhouette === "tapered" ? 0.78 : 1;
    part(
      ringPoints(
        [
          { y: crotchY + 0.012, a: gHip * 0.92, b: gHip * 0.72 },
          { y: anchor - g.rise / 200, a: gHip, b: gHip * 0.72 },
          { y: anchor, a: gWaist, b: gWaist * 0.72 },
        ],
        24,
        64,
      ),
      64,
      24,
      true,
    );
    for (const side of [-1, 1]) {
      const start = new T.Vector3(side * legX, crotchY + 0.055, 0),
        end = new T.Vector3(side * legX, crotchY - g.inseam / 100, 0);
      part(
        segmentPoints(start, end, gHip * 0.51, 0.064 * flare, 36, 40, 0.001),
        40,
        36,
        true,
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
        r = T.MathUtils.lerp(s.r1, s.r2, t) + 0.012;
      if (len < r && len > 1e-7) {
        x = cx + (dx * r) / len;
        y = cy + (dy * r) / len;
        z = cz + (dz * r) / len;
      }
    }
    return [x, y, z];
  };
  const canDrape = canDrapeGarment(m, d);
  if (canDrape)
    for (const part of parts) {
      part.cloth.fitAnchors(collide);
      // Resolve initial intersections for every vertex before the first displayed frame.
      for (let i = 0; i < part.cloth.count; i++)
        if (!part.cloth.pinned.has(i)) {
          let p: Vec3 = [
            part.cloth.positions[i * 3],
            part.cloth.positions[i * 3 + 1],
            part.cloth.positions[i * 3 + 2],
          ];
          for (let j = 0; j < 4; j++) p = collide(p);
          for (let k = 0; k < 3; k++) {
            part.cloth.positions[i * 3 + k] = p[k];
            part.cloth.previous[i * 3 + k] = p[k];
            part.cloth.target[i * 3 + k] = p[k];
          }
        }
      (part.mesh.geometry.getAttribute("position").array as Float32Array).set(
        part.cloth.positions,
      );
      part.mesh.geometry.computeVertexNormals();
    }
  return {
    group,
    parts,
    material,
    collide,
    dim,
    canDrape,
  };
}

/** Compose up to four independently sized garments on one shared mannequin. */
export function createOutfit(
  m: Measurements,
  designs: Design[],
  pose: Pose = neutralPose,
) {
  const models = designs.map((d) => createMannequin(m, d, pose));
  const group = new T.Group();
  const trousers = designs.find((d) => d.kind === "trousers");
  const dim = dimensions(m);
  const parts = models.flatMap((model, index) => {
    const body = model.group.children[0],
      garmentGroup = model.group.children[1];
    if (index === 0) group.add(body);
    else {
      const materials = new Set<T.Material>();
      body.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            materials.add(m),
          );
        }
      });
      materials.forEach((m) => m.dispose());
    }
    group.add(garmentGroup);
    const collide = (p: Vec3): Vec3 => {
      let q = model.collide(p);
      // A clearance envelope for an untucked upper garment over trousers.
      if (
        trousers &&
        designs[index].kind !== "trousers" &&
        q[1] < dim.waist + 0.015 &&
        q[1] > dim.crotch + 0.02
      ) {
        const t = T.MathUtils.clamp(
          (q[1] - dim.crotch) / (dim.waist - dim.crotch),
          0,
          1,
        );
        const a =
            radiusForCircumference(
              T.MathUtils.lerp(
                trousers.garment.hips,
                trousers.garment.waist,
                t,
              ),
            ) + 0.009,
          b = a * 0.72 + 0.003;
        const r = Math.hypot(q[0] / a, q[2] / b);
        if (r > 1e-6 && r < 1) q = [q[0] / r, q[1], q[2] / r];
      }
      return q;
    };
    return model.parts.map((part) => ({
      ...part,
      collide,
      canDrape: model.canDrape,
    }));
  });
  return { group, parts, models, canDrape: parts.some((p) => p.canDrape) };
}
