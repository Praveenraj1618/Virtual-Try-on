import { env } from "cloudflare:workers";
export function database() {
  if (!env.DB) throw new Error("Database unavailable");
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET) throw new Error("Image storage unavailable");
  return env.BUCKET;
}
export function owner(request: Request) {
  const user = request.headers.get("oai-authenticated-user-id");
  if (user) return user;
  // Explicit localhost-only development identity. Production requires trusted Sites dispatch.
  const host = new URL(request.url).hostname;
  if (
    (host === "localhost" || host === "127.0.0.1") &&
    process.env.NODE_ENV !== "production"
  )
    return "local-developer";
  return null;
}
export function writeOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
export function unavailable(error: unknown) {
  console.error("Storage operation failed:", error);
  return Response.json(
    {
      error:
        "We could not reach your saved data. Your current edits are still here. Please try again.",
    },
    { status: 503 },
  );
}
export const privateHeaders = { "Cache-Control": "private, no-store" };
