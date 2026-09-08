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
  assert.match(html, /Your measurements/);
  assert.match(html, /Your wardrobe/);
  assert.match(html, /Sample measurements/);
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
