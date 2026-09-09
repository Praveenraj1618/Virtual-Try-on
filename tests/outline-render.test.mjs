import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
async function moduleAt(name) {
  const out = resolve(`node_modules/.cache/v5-${name}.mjs`);
  await build({
    entryPoints: [`lib/tryon/${name}.ts`],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  });
  return import(pathToFileURL(out));
}
const { detectOutline } = await moduleAt("outline-detection");
const { estimateDesign, initialTrace } = await moduleAt("design-trace");
const { createRenderSurface } = await moduleAt("render-surface");
const { createMannequin } = await moduleAt("model");
const { defaultDesign, defaultMeasurements, canDrapeGarment, lookSchema } =
  await moduleAt("schema");
function fixture(offset = 0, filled = false) {
  const w = 160,
    h = 220,
    pixels = new Uint8Array(w * h * 4).fill(255);
  for (let y = 25; y < 200; y++) {
    const half = 25 + (y - 25) * 0.16;
    for (let x = 0; x < w; x++) {
      const edge = Math.abs(x - (80 + offset));
      if (edge < half && (filled || edge > half - 2 || y < 28 || y > 197)) {
        const i = (y * w + x) * 4;
        pixels[i] = filled ? 35 : 70;
        pixels[i + 1] = filled ? 90 : 70;
        pixels[i + 2] = filled ? 60 : 70;
      }
    }
  }
  return { pixels, w, h };
}
test("outline detector follows image position for pencil and filled silhouettes", () => {
  for (const mode of ["sketch", "photo"]) {
    const a = fixture(0, mode === "photo"),
      b = fixture(12, mode === "photo");
    const first = detectOutline(a.pixels, a.w, a.h, mode),
      second = detectOutline(b.pixels, b.w, b.h, mode);
    assert.ok(Math.abs(second.points[0].x - first.points[0].x - 7.5) < 2);
    assert.ok(first.points[5].y > 80);
    assert.ok(first.points[5].x > first.points[3].x);
  }
  assert.throws(
    () => detectOutline(new Uint8Array(160 * 220 * 4).fill(255), 160, 220),
    /No clear outline/,
  );
});
test("estimated sizing handles narrow stylised drawings without a supplied length", () => {
  const narrow = initialTrace.map((p) => ({ ...p, x: 50 + (p.x - 50) * 0.28 }));
  for (const ending of ["hip", "knee", "ankle"]) {
    const d = estimateDesign(
      narrow,
      defaultMeasurements,
      defaultDesign,
      ending,
      true,
    );
    assert.equal(canDrapeGarment(defaultMeasurements, d), true);
    assert.equal(d.garment.sleeveLength, 0);
    assert.deepEqual(
      lookSchema.parse({
        name: "Estimated",
        measurements: defaultMeasurements,
        design: d,
      }).design,
      d,
    );
  }
  assert.throws(
    () =>
      estimateDesign(
        initialTrace.map((p, i) => (i === 5 ? { ...p, y: 10 } : p)),
        defaultMeasurements,
        defaultDesign,
        "knee",
        true,
      ),
    /in order/,
  );
});
test("subdivided posed cloth has four times the faces with contact clearance", () => {
  const model = createMannequin(defaultMeasurements, defaultDesign, {
    left: { raise: 68, forward: 60, bend: 90 },
    right: { raise: 68, forward: 60, bend: 90 },
  });
  const part = model.parts[0];
  for (let n = 0; n < 30; n++) part.cloth.step(model.collide);
  const render = createRenderSurface(part.mesh.geometry);
  render.update(part.cloth.positions, model.collide);
  assert.equal(render.geometry.index.count, part.mesh.geometry.index.count * 4);
  const positions = render.geometry.getAttribute("position");
  let maxPenetration = 0;
  for (let i = 0; i < positions.count; i++) {
    const p = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    assert.ok(p.every(Number.isFinite));
    const q = model.collide(p);
    maxPenetration = Math.max(
      maxPenetration,
      Math.hypot(...p.map((v, k) => v - q[k])),
    );
  }
  assert.ok(maxPenetration < 0.003, `surface penetration ${maxPenetration}`);
  render.geometry.dispose();
  model.group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) o.material.dispose();
  });
});

test("outfits share one body and preserve separate garment geometry and materials", async () => {
  const { createOutfit } = await moduleAt("model");
  const { templateDimensions } = await moduleAt("schema");
  const trousers = {
    ...defaultDesign,
    kind: "trousers",
    color: "#202d48",
    garment: { ...templateDimensions.trousers },
  };
  const saved = lookSchema.parse({
    name: "Two-piece outfit",
    measurements: defaultMeasurements,
    design: { ...defaultDesign, layers: [trousers] },
  });
  assert.equal(saved.design.layers.length, 1);
  const outfit = createOutfit(defaultMeasurements, [
    saved.design,
    ...saved.design.layers,
  ]);
  assert.equal(
    outfit.group.children.length,
    3,
    "one body and two clothing groups",
  );
  assert.equal(
    outfit.parts.length,
    4,
    "one upper garment and three trouser panels",
  );
  assert.notEqual(outfit.models[0].material, outfit.models[1].material);
  for (const part of outfit.parts) {
    part.cloth.step(part.collide);
    assert.ok([...part.cloth.positions].every(Number.isFinite));
  }
  outfit.group.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
});
test("wide-arm pose leaves centre chest targets attached to the torso", () => {
  const normal = createMannequin(defaultMeasurements, defaultDesign);
  const wide = createMannequin(defaultMeasurements, defaultDesign, {
    left: { raise: 68, forward: 0, bend: 0 },
    right: { raise: 68, forward: 0, bend: 0 },
  });
  const a = normal.parts[0].cloth,
    b = wide.parts[0].cloth;
  let checked = 0;
  for (let i = 0; i < a.count; i++)
    if (
      Math.abs(a.rest[i * 3]) < 0.11 &&
      a.rest[i * 3 + 1] > normal.dim.chest &&
      a.rest[i * 3 + 1] < normal.dim.shoulder - 0.06
    ) {
      assert.ok(
        Math.hypot(
          ...[0, 1, 2].map((k) => a.target[i * 3 + k] - b.target[i * 3 + k]),
        ) < 0.003,
      );
      checked++;
    }
  assert.ok(checked > 30);
  for (const model of [normal, wide])
    model.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
});
