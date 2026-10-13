import { MAX_IMAGE_BYTES, normalizeTokenDraft, createTokenMetadata, type TokenDraft } from "@stolons/sdk/launch-validation";
import { imageExtension, verifyMetadataUpload } from "../../../lib/upload-auth";
import { storeTokenAsset, localUploadsEnabled, recordVerifiedParticipant } from "../../../lib/token-storage";

export const runtime = "nodejs";
export const maxDuration = 30;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64_000;
const bursts = new Map<string, { count: number; reset: number }>();

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new Error("Expected a token image and form details.");
    if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return Response.json({ error: "Choose an image up to 3 MB." }, { status: 413 });
    const originText = request.headers.get("origin");
    if (!originText) return Response.json({ error: "Open the launch form to upload token details." }, { status: 403 });
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Token details are missing.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > MAX_REQUEST_BYTES) return Response.json({ error: "Choose an image up to 3 MB." }, { status: 413 });
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if(process.env.UPLOAD_BACKEND_URL){
      const backend=new URL(process.env.UPLOAD_BACKEND_URL);
      if(backend.protocol!=="https:")throw new Error("Invalid upload backend.");
      const response=await fetch(new URL('/api/metadata',backend),{method:'POST',headers:{'Content-Type':request.headers.get('content-type')!,'Origin':originText},body:bytes,signal:AbortSignal.timeout(25000),redirect:'error'});
      return new Response(await response.arrayBuffer(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
    const text = (name: string) => { const value = form.get(name); if (typeof value !== "string") throw new Error(`Missing ${name}.`); return value; };
    // Codespaces can rewrite Origin while forwarding a request. The public site
    // is part of the wallet-signed payload, so transport headers must not replace it.
    const signedOrigin = text("signedOrigin");
    const origin = new URL(signedOrigin);
    if (origin.origin !== signedOrigin || (origin.protocol !== "https:" && !(localUploadsEnabled() && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new Error("Use the secure launch page.");
    const draft = normalizeTokenDraft(Object.fromEntries(["name", "symbol", "description", "website", "twitter", "telegram"].map((key) => [key, text(key)])) as unknown as TokenDraft);
    const file = form.get("image");
    if (!(file instanceof File)) throw new Error("Choose a token image.");
    const image = new Uint8Array(await file.arrayBuffer());
    const extension = imageExtension(image, file.type);
    const wallet = text("wallet");
    verifyMetadataUpload(draft, image, wallet, signedOrigin, Number(text("timestamp")), text("signature"));
    const now = Date.now();
    for (const [key, entry] of bursts) if (entry.reset <= now) bursts.delete(key);
    const burst = bursts.get(wallet) ?? { count: 0, reset: now + 5 * 60_000 };
    if (burst.count >= 10 || bursts.size >= 10_000) return Response.json({ error: "Too many uploads. Please wait a few minutes." }, { status: 429 });
    bursts.set(wallet, { ...burst, count: burst.count + 1 });
    const imageUrl = await storeTokenAsset(image, extension, signedOrigin);
    const metadata = createTokenMetadata(draft, imageUrl, file.type);
    const metadataUri = await storeTokenAsset(new TextEncoder().encode(JSON.stringify(metadata)), "json", signedOrigin);
    await recordVerifiedParticipant(wallet);
    return Response.json({ metadataUri, imageUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not publish token details.";
    // Never return storage provider errors, credentials, or local paths.
    const safe = /^(Choose |Use |Upload approval|Wallet approval|Invalid wallet|Token |Ticker |Description |website |twitter |telegram |Expected |Missing |Open |Token image storage)/.test(message);
    return Response.json({ error: safe ? message : "Could not publish token details. Check the fields and try again." }, { status: 400 });
  }
}
