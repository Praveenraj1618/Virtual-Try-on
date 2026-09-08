import {
  database,
  bucket,
  owner,
  unavailable,
  privateHeaders,
} from "@/lib/server";
import { assetIdSchema } from "@/lib/tryon/schema";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = owner(request);
  if (!user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  if (!assetIdSchema.safeParse(id).success)
    return new Response("Not found", { status: 404 });
  try {
    const asset = await database()
      .prepare(
        "SELECT object_key,content_type FROM assets WHERE id = ? AND owner_id = ?",
      )
      .bind(id, user)
      .first<{ object_key: string; content_type: string }>();
    if (!asset) return new Response("Not found", { status: 404 });
    const object = await bucket().get(asset.object_key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        ...privateHeaders,
        "Content-Type": asset.content_type,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return unavailable(e);
  }
}
