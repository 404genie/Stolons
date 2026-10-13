import { readLocalTokenAsset } from "../../../../lib/token-storage";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const data = await readLocalTokenAsset(id);
  if (!data) return new Response("Not found", { status: 404 });
  const extension = id.split(".").pop();
  const type = extension === "json" ? "application/json" : extension === "jpg" ? "image/jpeg" : `image/${extension}`;
  return new Response(new Uint8Array(data), { headers: { "Content-Type": type, "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable" } });
}
