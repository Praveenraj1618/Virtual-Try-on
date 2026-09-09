import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = new DatabaseSync(":memory:");
sql.exec(
  readFileSync(
    new URL("../drizzle/0000_high_zodiak.sql", import.meta.url),
    "utf8",
  ),
);
const d1 = {
  prepare(query) {
    let args = [];
    const stmt = sql.prepare(query);
    const api = {
      bind(...values) {
        args = values;
        return api;
      },
      async all() {
        return { results: stmt.all(...args) };
      },
      async first() {
        return stmt.get(...args) || null;
      },
      async run() {
        return stmt.run(...args);
      },
    };
    return api;
  },
};
const objects = new Map();
const bucket = {
  async put(key, bytes) {
    objects.set(key, bytes);
  },
  async get(key) {
    const bytes = objects.get(key);
    return bytes ? { body: bytes } : null;
  },
  async delete(key) {
    objects.delete(key);
  },
};
globalThis.__tryonTestEnv = { DB: d1, BUCKET: bucket };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers")
      return {
        url: "data:text/javascript,export const env=globalThis.__tryonTestEnv;",
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});
const { default: worker } = await import("../dist/server/index.js");
const env = {
  ...globalThis.__tryonTestEnv,
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
function request(
  path,
  {
    user = "alice",
    method = "GET",
    body,
    origin = "https://example.com",
    mime = "application/json",
  } = {},
) {
  const headers = {};
  if (user) headers["oai-authenticated-user-id"] = user;
  if (method !== "GET") {
    headers.origin = origin;
    headers["content-type"] = mime;
  }
  return worker.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : typeof body === "string" || body instanceof Uint8Array
            ? body
            : JSON.stringify(body),
    }),
    env,
    ctx,
  );
}
test("worker renders the fitting workspace", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/", { headers: { accept: "text/html" } }),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Fitting tools/);
  assert.match(html, /Size &amp; fit|Size & fit/);
  assert.match(html, /3D fitting preview/);
  assert.doesNotMatch(html, /Starter Project/);
});
test("saved measurements are validated and isolated by owner", async () => {
  assert.equal((await request("/api/looks", { user: null })).status, 401);
  assert.equal(
    (
      await request("/api/looks", {
        method: "POST",
        origin: "https://evil.example",
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/looks", { method: "POST", body: { name: "bad" } }))
      .status,
    400,
  );
  const body = {
    name: "First look",
    measurements: {
      height: 172,
      chest: 92,
      waist: 76,
      hips: 96,
      shoulders: 42,
      inseam: 78,
      arm: 58,
    },
    design: {
      kind: "tshirt",
      color: "#315a49",
      ease: 10,
      length: 100,
      sleeve: 32,
      fabric: "cotton",
      texture: "",
      reference: "",
    },
  };
  const save = await request("/api/looks", { method: "POST", body });
  assert.equal(save.status, 201);
  const { look } = await save.json();
  const alice = await (await request("/api/looks")).json();
  assert.equal(alice.looks.length, 1);
  assert.deepEqual(alice.looks[0].measurements, body.measurements);
  const bob = await (await request("/api/looks", { user: "bob" })).json();
  assert.equal(bob.looks.length, 0);
  await request(`/api/looks?id=${look.id}`, { method: "DELETE", user: "bob" });
  assert.equal((await (await request("/api/looks")).json()).looks.length, 1);
  assert.equal(
    (await request(`/api/looks?id=${look.id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal((await (await request("/api/looks")).json()).looks.length, 0);
});
test("uploaded artwork is private and rejects mismatched content types", async () => {
  assert.equal(
    (
      await request("/api/assets", {
        method: "POST",
        mime: "image/png",
        body: "not a png",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/assets", {
        method: "POST",
        mime: "image/svg+xml",
        body: "<svg/>",
      })
    ).status,
    415,
  );
  const file = readFileSync(
    new URL("../public/cobalt-stripe.webp", import.meta.url),
  );
  const upload = await request("/api/assets", {
    method: "POST",
    mime: "image/webp",
    body: file,
  });
  assert.equal(upload.status, 201);
  const { url } = await upload.json();
  const own = await request(url);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get("cache-control"), "private, no-store");
  assert.equal((await own.arrayBuffer()).byteLength, file.length);
  assert.equal((await request(url, { user: "bob" })).status, 404);
  assert.equal((await request(url, { user: null })).status, 401);
});

test("new garment dimensions and style choices survive save and reload", async () => {
  const measurements = {
    height: 172,
    chest: 92,
    waist: 76,
    hips: 96,
    shoulders: 42,
    inseam: 78,
    arm: 58,
  };
  const garment = {
    chest: 104,
    waist: 86,
    hips: 108,
    shoulders: 45,
    length: 110,
    sleeveLength: 24,
    inseam: 80,
    rise: 26,
  };
  const design = {
    kind: "dress",
    color: "#315a49",
    fabric: "cotton",
    texture: "",
    reference: "",
    garment,
    neckline: "v",
    silhouette: "flared",
    sleeveStyle: "bell",
  };
  const response = await request("/api/looks", {
    method: "POST",
    body: { name: "Custom dress", measurements, design },
  });
  assert.equal(response.status, 201);
  const { look } = await response.json();
  const saved = (await (await request("/api/looks")).json()).looks.find(
    (l) => l.id === look.id,
  );
  assert.deepEqual(saved.design.garment, garment);
  assert.equal(saved.design.neckline, "v");
  assert.equal(saved.design.sleeveStyle, "bell");
  await request(`/api/looks?id=${look.id}`, { method: "DELETE" });
});
test("existing first-version database rows remain readable", async () => {
  const id = crypto.randomUUID(),
    m = {
      height: 172,
      chest: 92,
      waist: 76,
      hips: 96,
      shoulders: 42,
      inseam: 78,
      arm: 58,
    },
    d = {
      kind: "tshirt",
      color: "#315a49",
      ease: 8,
      length: 100,
      sleeve: 32,
      fabric: "cotton",
      texture: "",
      reference: "",
    };
  sql
    .prepare(
      "INSERT INTO looks (id,owner_id,name,measurements,design,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      id,
      "alice",
      "Old look",
      JSON.stringify(m),
      JSON.stringify(d),
      new Date().toISOString(),
    );
  const saved = (await (await request("/api/looks")).json()).looks.find(
    (l) => l.id === id,
  );
  assert.equal(saved.design.garment.chest, 100);
  assert.equal(saved.design.neckline, "crew");
  await request(`/api/looks?id=${id}`, { method: "DELETE" });
});

test("outfit layers survive save and reload and validate every layer's image owner", async () => {
  const top = {
    kind: "tshirt",
    color: "#315a49",
    fabric: "cotton",
    texture: "",
    reference: "",
  };
  const pants = { ...top, kind: "trousers", color: "#202d48" };
  const body = {
    height: 172,
    chest: 92,
    waist: 76,
    hips: 96,
    shoulders: 42,
    inseam: 78,
    arm: 58,
  };
  const response = await request("/api/looks", {
    method: "POST",
    body: {
      name: "Layered outfit",
      measurements: body,
      design: { ...top, layers: [pants] },
    },
  });
  assert.equal(response.status, 201);
  const saved = (await response.json()).look;
  const result = (await (await request("/api/looks")).json()).looks.find(
    (l) => l.id === saved.id,
  );
  assert.equal(result.design.layers[0].color, "#202d48");
  const invalid = await request("/api/looks", {
    method: "POST",
    body: {
      name: "Unowned image",
      measurements: body,
      design: {
        ...top,
        layers: [
          {
            ...pants,
            texture: "/api/assets/00000000-0000-4000-8000-000000000000",
          },
        ],
      },
    },
  });
  assert.equal(invalid.status, 400);
});
