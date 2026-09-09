import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const output = resolve("node_modules/.cache/tryon-test-model.mjs");
await build({
  entryPoints: ["lib/tryon/model.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { createMannequin, radiusForCircumference } = await import(
  pathToFileURL(output)
);
const schemaOutput = resolve("node_modules/.cache/tryon-test-schema.mjs");
await build({
  entryPoints: ["lib/tryon/schema.ts"],
  outfile: schemaOutput,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const {
  defaultMeasurements: defaults,
  defaultDesign,
  measurementsSchema,
  lookSchema,
  templateDimensions,
  upgradeDesign,
  measurementComparison,
  canDrapeGarment,
} = await import(pathToFileURL(schemaOutput));
function dispose(model) {
  const mats = new Set();
  model.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      mats.add(o.material);
    }
  });
  mats.forEach((m) => m.dispose());
}
test("measurement validation rejects impossible inputs and external image URLs", () => {
  assert.equal(
    measurementsSchema.safeParse({ ...defaults, height: NaN }).success,
    false,
  );
  assert.equal(
    measurementsSchema.safeParse({ ...defaults, height: 140, inseam: 100 })
      .success,
    false,
  );
  assert.equal(
    measurementsSchema.safeParse({ ...defaults, height: 140, arm: 80 }).success,
    false,
  );
  assert.equal(
    lookSchema.safeParse({
      name: "Valid look",
      measurements: defaults,
      design: defaultDesign,
    }).success,
    true,
  );
  assert.equal(
    lookSchema.safeParse({
      name: "Test",
      measurements: defaults,
      design: { ...defaultDesign, texture: "https://example.com/track.png" },
    }).success,
    false,
  );
});
test("elliptical torso circumference matches the requested measurement", () => {
  for (const cm of [65, 92, 150]) {
    const a = radiusForCircumference(cm),
      b = a * 0.72;
    const perimeter =
      Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) * 100;
    assert.ok(Math.abs(perimeter - cm) < 1e-8);
  }
});
test("cloth remains finite, pinned and bounded across garment and body extremes", () => {
  const bodies = [
    defaults,
    {
      height: 140,
      chest: 65,
      waist: 55,
      hips: 70,
      shoulders: 30,
      inseam: 60,
      arm: 45,
    },
    {
      height: 210,
      chest: 150,
      waist: 145,
      hips: 155,
      shoulders: 58,
      inseam: 105,
      arm: 80,
    },
  ];
  for (const body of bodies)
    for (const kind of ["tshirt", "trousers", "dress"]) {
      const model = createMannequin(body, {
        ...defaultDesign,
        kind,
        garment: { ...templateDimensions[kind] },
        fabric: "silk",
        ease: 2,
        length: 120,
        sleeve: 100,
      });
      for (let step = 0; step < 60; step++)
        for (const part of model.parts) part.cloth.step(model.collide);
      for (const { cloth } of model.parts) {
        assert.ok(
          [...cloth.positions].every(
            (n) => Number.isFinite(n) && Math.abs(n) < 3,
          ),
        );
        for (const vertex of cloth.pinned)
          for (let k = 0; k < 3; k++)
            assert.equal(
              cloth.positions[vertex * 3 + k],
              cloth.anchors[vertex * 3 + k],
            );
      }
      dispose(model);
    }
});
test("body changes do not resize the independent garment", () => {
  const a = createMannequin(defaults, defaultDesign),
    b = createMannequin({ ...defaults, waist: 110, hips: 120 }, defaultDesign);
  assert.deepEqual([...a.parts[0].cloth.rest], [...b.parts[0].cloth.rest]);
  assert.notDeepEqual(
    [
      ...a.group.children[0].children[0].geometry.getAttribute("position")
        .array,
    ],
    [
      ...b.group.children[0].children[0].geometry.getAttribute("position")
        .array,
    ],
  );
  assert.equal(b.canDrape, false);
  for (const { mesh, cloth } of a.parts) {
    assert.equal(mesh.geometry.getAttribute("uv").count, cloth.count);
    assert.ok(mesh.geometry.index.count > 0);
  }
  dispose(a);
  dispose(b);
});

test("placement changes with height but garment edge lengths remain fixed", () => {
  for (const kind of ["tshirt", "trousers", "dress"]) {
    const design = {
      ...defaultDesign,
      kind,
      garment: { ...templateDimensions[kind] },
    };
    const a = createMannequin(defaults, design),
      b = createMannequin({ ...defaults, height: 185, inseam: 88 }, design);
    for (let i = 0; i < a.parts.length; i++)
      for (let j = 0; j < a.parts[i].cloth.edges.length; j++)
        assert.ok(
          Math.abs(
            a.parts[i].cloth.edges[j].rest - b.parts[i].cloth.edges[j].rest,
          ) < 1e-6,
        );
    dispose(a);
    dispose(b);
  }
});
test("measurement comparisons change with body size and block impossible draping", () => {
  const design = {
    ...defaultDesign,
    garment: { ...defaultDesign.garment, chest: 100 },
  };
  assert.equal(
    measurementComparison({ ...defaults, chest: 92 }, design).find(
      (r) => r.key === "chest",
    ).difference,
    8,
  );
  assert.equal(
    measurementComparison({ ...defaults, chest: 104 }, design).find(
      (r) => r.key === "chest",
    ).difference,
    -4,
  );
  assert.equal(canDrapeGarment({ ...defaults, chest: 104 }, design), false);
  assert.equal(canDrapeGarment(defaults, design), true);
  assert.equal(
    lookSchema.safeParse({
      name: "Bad dimensions",
      measurements: defaults,
      design: { ...design, garment: { ...design.garment, chest: -3 } },
    }).success,
    false,
  );
});
test("legacy designs upgrade using their saved body once, without changing new designs", () => {
  const legacy = {
    kind: "dress",
    color: "#315a49",
    ease: 8,
    length: 100,
    sleeve: 50,
    fabric: "cotton",
    texture: "",
    reference: "",
  };
  const upgraded = upgradeDesign(legacy, defaults);
  assert.equal(upgraded.garment.chest, defaults.chest + 8);
  assert.equal(upgraded.garment.sleeveLength, defaults.arm * 0.5);
  assert.deepEqual(
    upgradeDesign(upgraded, { ...defaults, chest: 120 }),
    upgraded,
  );
  assert.equal(
    lookSchema.parse({ name: "Legacy", measurements: defaults, design: legacy })
      .design.garment.chest,
    100,
  );
});
test("neckline, sleeve and silhouette choices change garment geometry", () => {
  const base = createMannequin(defaults, defaultDesign);
  for (const override of [
    { neckline: "scoop" },
    { neckline: "v" },
    { silhouette: "flared" },
    { sleeveStyle: "bell" },
  ]) {
    const changed = createMannequin(defaults, {
      ...defaultDesign,
      ...override,
    });
    const index = 0;
    assert.notDeepEqual(
      [...changed.parts[index].cloth.rest],
      [...base.parts[index].cloth.rest],
    );
    for (const part of changed.parts)
      assert.ok([...part.cloth.rest].every(Number.isFinite));
    dispose(changed);
  }
  dispose(base);
});

test("sleeved upper garments are one manifold surface with no open shoulder seams", () => {
  for (const kind of ["tshirt", "dress"])
    for (const sleeveLength of [0, 20, 58]) {
      const model = createMannequin(defaults, {
        ...defaultDesign,
        kind,
        garment: { ...templateDimensions[kind], sleeveLength },
      });
      assert.equal(model.parts.length, 1);
      const mesh = model.parts[0].mesh,
        idx = mesh.geometry.index.array,
        edges = new Map(),
        neighbors = new Map();
      for (let i = 0; i < idx.length; i += 3)
        for (let j = 0; j < 3; j++) {
          const a = idx[i + j],
            b = idx[i + ((j + 1) % 3)],
            key = a < b ? `${a}:${b}` : `${b}:${a}`;
          const list = edges.get(key) || [];
          list.push([a, b]);
          edges.set(key, list);
          if (!neighbors.has(a)) neighbors.set(a, new Set());
          neighbors.get(a).add(b);
          if (!neighbors.has(b)) neighbors.set(b, new Set());
          neighbors.get(b).add(a);
        }
      const seen = new Set(),
        stack = [0];
      while (stack.length) {
        const n = stack.pop();
        if (seen.has(n)) continue;
        seen.add(n);
        for (const next of neighbors.get(n) || []) stack.push(next);
      }
      assert.equal(
        seen.size,
        mesh.geometry.getAttribute("position").count,
        "all sleeve vertices connect to the bodice",
      );
      const boundary = new Map();
      for (const pair of edges.values()) {
        assert.ok(pair.length <= 2, "no non-manifold edges");
        if (pair.length === 2) {
          assert.equal(
            pair[0][0],
            pair[1][1],
            "adjacent faces have consistent winding",
          );
        } else {
          const [a, b] = pair[0];
          if (!boundary.has(a)) boundary.set(a, []);
          if (!boundary.has(b)) boundary.set(b, []);
          boundary.get(a).push(b);
          boundary.get(b).push(a);
        }
      }
      for (const adjacent of boundary.values())
        assert.equal(adjacent.length, 2);
      const visited = new Set();
      let loops = 0;
      for (const start of boundary.keys()) {
        if (visited.has(start)) continue;
        loops++;
        const queue = [start];
        while (queue.length) {
          const v = queue.pop();
          if (visited.has(v)) continue;
          visited.add(v);
          queue.push(...boundary.get(v));
        }
      }
      assert.equal(
        loops,
        4,
        "only neckline, hem and two cuffs/armholes are open",
      );
      dispose(model);
    }
});
test("neckline anchors clear the collision surface without changing rest dimensions", () => {
  for (const neckline of ["crew", "scoop", "v"]) {
    const model = createMannequin(defaults, { ...defaultDesign, neckline });
    assert.equal(model.canDrape, true);
    const cloth = model.parts[0].cloth,
      rest = cloth.rest.slice();
    for (let step = 0; step < 30; step++) cloth.step(model.collide);
    for (const v of cloth.pinned) {
      const p = Array.from(cloth.positions.slice(v * 3, v * 3 + 3)),
        resolved = model.collide(p);
      assert.ok(
        Math.hypot(...p.map((n, k) => n - resolved[k])) < 0.001,
        "pinned neckline/shoulder stays outside body",
      );
    }
    assert.deepEqual(cloth.rest, rest);
    dispose(model);
  }
});

test("sleeve cuffs surround the upper arms before and after relaxation", () => {
  const model = createMannequin(defaults, defaultDesign);
  const part = model.parts[0];
  for (const steps of [0, 55]) {
    for (let n = 0; n < steps; n++) part.cloth.step(model.collide);
    for (const [trimIndex, side] of [
      [3, 1],
      [5, -1],
    ]) {
      const vertices = part.trims[trimIndex].vertices;
      const centre = [0, 0, 0];
      for (const v of vertices)
        for (let k = 0; k < 3; k++)
          centre[k] += part.cloth.positions[v * 3 + k] / vertices.length;
      const sy = model.dim.shoulder - 0.025;
      const along = (sy - centre[1]) / Math.sqrt(1 - 0.37 ** 2);
      const armX = side * (model.dim.shoulderX - 0.015 + 0.37 * along);
      assert.ok(
        Math.abs(centre[0] - armX) < 0.045,
        "cuff stays centred around arm, not beside it",
      );
      const zs = vertices.map((v) => part.cloth.positions[v * 3 + 2]);
      assert.ok(
        Math.min(...zs) < -0.025 && Math.max(...zs) > 0.025,
        "cuff encloses front and back of arm",
      );
    }
  }
  dispose(model);
});

test("articulated arms preserve garment rest dimensions and keep cloth finite", () => {
  const neutral = createMannequin(defaults, defaultDesign);
  for (const pose of [
    {
      left: { raise: 68, forward: 0, bend: 0 },
      right: { raise: 68, forward: 0, bend: 0 },
    },
    {
      left: { raise: 0, forward: 80, bend: 110 },
      right: { raise: 55, forward: 20, bend: 110 },
    },
    {
      left: { raise: 110, forward: -40, bend: 135 },
      right: { raise: -10, forward: 100, bend: 135 },
    },
  ]) {
    const model = createMannequin(defaults, defaultDesign, pose);
    const cloth = model.parts[0].cloth;
    assert.deepEqual(cloth.rest, neutral.parts[0].cloth.rest);
    assert.notDeepEqual(cloth.target, neutral.parts[0].cloth.target);
    for (let n = 0; n < 35; n++) cloth.step(model.collide);
    assert.ok(
      [...cloth.positions].every((n) => Number.isFinite(n) && Math.abs(n) < 3),
    );
    for (const v of cloth.pinned) {
      const p = Array.from(cloth.positions.slice(v * 3, v * 3 + 3));
      const resolved = model.collide(p);
      assert.ok(Math.hypot(...p.map((n, k) => n - resolved[k])) < 0.003);
    }
    dispose(model);
  }
  dispose(neutral);
});

const traceOutput = resolve("node_modules/.cache/tryon-test-trace.mjs");
await build({
  entryPoints: ["lib/tryon/design-trace.ts"],
  outfile: traceOutput,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { traceToDesign, initialTrace } = await import(
  pathToFileURL(traceOutput)
);
test("image landmarks generate and persist real geometry, with validation", () => {
  const design = traceToDesign(initialTrace, 0.8, 110, false, {
    ...defaultDesign,
    kind: "dress",
  });
  assert.ok(design.tracedShape);
  assert.equal(design.texture, "");
  assert.deepEqual(
    lookSchema.parse({ name: "Traced", measurements: defaults, design }).design,
    design,
  );
  const a = createMannequin(defaults, design);
  const changed = initialTrace.map((p, i) =>
    i === 5 ? { ...p, x: p.x + 8 } : p,
  );
  const b = createMannequin(
    defaults,
    traceToDesign(changed, 0.8, 110, false, {
      ...defaultDesign,
      kind: "dress",
    }),
  );
  assert.notDeepEqual(a.parts[0].cloth.rest, b.parts[0].cloth.rest);
  assert.throws(() =>
    traceToDesign(initialTrace, NaN, 110, false, defaultDesign),
  );
  assert.throws(() =>
    traceToDesign(
      initialTrace.map((p, i) => (i === 3 ? { ...p, y: 95 } : p)),
      0.8,
      110,
      false,
      defaultDesign,
    ),
  );
  dispose(a);
  dispose(b);
});
