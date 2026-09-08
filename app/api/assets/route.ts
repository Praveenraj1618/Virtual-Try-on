import {
  database,
  bucket,
  owner,
  writeOriginAllowed,
  unavailable,
  privateHeaders,
} from "@/lib/server";
const MAX = 5 * 1024 * 1024;
export async function POST(request: Request) {
  const user = owner(request);
  if (!user)
    return Response.json(
      { error: "Sign in to upload a design." },
      { status: 401 },
    );
  if (!writeOriginAllowed(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > MAX)
    return Response.json(
      { error: "Choose an image under 5 MB." },
      { status: 413 },
    );
  const mime = request.headers.get("content-type")?.split(";")[0];
  if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime))
    return Response.json(
      { error: "Use a PNG, JPEG or WebP image." },
      { status: 415 },
    );
  try {
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "An image is required." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX) {
        await reader.cancel();
        return Response.json(
          { error: "Choose an image under 5 MB." },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const png =
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71 &&
        bytes[4] === 13 &&
        bytes[5] === 10 &&
        bytes[6] === 26 &&
        bytes[7] === 10,
      jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      webp =
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (
      !(
        (mime === "image/png" && png) ||
        (mime === "image/jpeg" && jpg) ||
        (mime === "image/webp" && webp)
      )
    )
      return Response.json(
        { error: "The image format does not match its contents." },
        { status: 400 },
      );
    const id = crypto.randomUUID(),
      key = `designs/${id}`,
      storage = bucket();
    await storage.put(key, bytes, { httpMetadata: { contentType: mime } });
    try {
      await database()
        .prepare(
          "INSERT INTO assets (id,owner_id,object_key,content_type,created_at) VALUES (?,?,?,?,?)",
        )
        .bind(id, user, key, mime, new Date().toISOString())
        .run();
    } catch (e) {
      await storage.delete(key);
      throw e;
    }
    return Response.json(
      { id, url: `/api/assets/${id}` },
      { status: 201, headers: privateHeaders },
    );
  } catch (e) {
    return unavailable(e);
  }
}
