import {
  database,
  owner,
  writeOriginAllowed,
  unavailable,
  privateHeaders,
} from "@/lib/server";
import { lookSchema, assetIdSchema } from "@/lib/tryon/schema";
export async function GET(request: Request) {
  const user = owner(request);
  if (!user)
    return Response.json(
      { error: "Sign in to access saved looks." },
      { status: 401 },
    );
  try {
    const { results } = await database()
      .prepare(
        "SELECT id,name,measurements,design,created_at FROM looks WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(user)
      .all<{
        id: string;
        name: string;
        measurements: string;
        design: string;
        created_at: string;
      }>();
    return Response.json(
      {
        looks: results.map((r) => ({
          id: r.id,
          name: r.name,
          measurements: JSON.parse(r.measurements),
          design: JSON.parse(r.design),
          createdAt: r.created_at,
        })),
      },
      { headers: privateHeaders },
    );
  } catch (e) {
    return unavailable(e);
  }
}
export async function POST(request: Request) {
  const user = owner(request);
  if (!user)
    return Response.json({ error: "Sign in to save a look." }, { status: 401 });
  if (!writeOriginAllowed(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > 20000)
    return Response.json({ error: "Look is too large." }, { status: 413 });
  try {
    const raw = await request.text();
    if (raw.length > 20000)
      return Response.json({ error: "Look is too large." }, { status: 413 });
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid JSON." }, { status: 400 });
    }
    const parsed = lookSchema.safeParse(data);
    if (!parsed.success)
      return Response.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    const { name, measurements, design } = parsed.data,
      db = database();
    for (const path of [design.texture, design.reference])
      if (path.startsWith("/api/assets/")) {
        const asset = await db
          .prepare("SELECT id FROM assets WHERE id = ? AND owner_id = ?")
          .bind(path.split("/").pop(), user)
          .first();
        if (!asset)
          return Response.json(
            { error: "Upload this image again before saving." },
            { status: 400 },
          );
      }
    const id = crypto.randomUUID(),
      createdAt = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO looks (id,owner_id,name,measurements,design,created_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        id,
        user,
        name,
        JSON.stringify(measurements),
        JSON.stringify(design),
        createdAt,
      )
      .run();
    return Response.json(
      { look: { id, name, measurements, design, createdAt } },
      { status: 201, headers: privateHeaders },
    );
  } catch (e) {
    return unavailable(e);
  }
}
export async function DELETE(request: Request) {
  const user = owner(request);
  if (!user)
    return Response.json(
      { error: "Sign in to remove a look." },
      { status: 401 },
    );
  if (!writeOriginAllowed(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  const id = new URL(request.url).searchParams.get("id");
  if (!assetIdSchema.safeParse(id).success)
    return Response.json({ error: "Invalid look." }, { status: 400 });
  try {
    await database()
      .prepare("DELETE FROM looks WHERE id = ? AND owner_id = ?")
      .bind(id, user)
      .run();
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (e) {
    return unavailable(e);
  }
}
