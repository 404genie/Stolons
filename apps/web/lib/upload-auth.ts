import { createHash, createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { metadataUploadMessage, MAX_IMAGE_BYTES, type TokenDraft } from "@stolons/sdk/launch-validation";

export function imageExtension(bytes: Uint8Array, mime: string): "png" | "jpg" | "webp" {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Choose an image up to 3 MB.");
  const data = Buffer.from(bytes);
  if (mime === "image/png" && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (mime === "image/jpeg" && data[0] === 255 && data[1] === 216 && data[2] === 255) return "jpg";
  if (mime === "image/webp" && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new Error("Choose a PNG, JPG, or WebP image.");
}

export function verifyMetadataUpload(draft: TokenDraft, image: Uint8Array, wallet: string, origin: string, timestamp: number, signature: string, now = Date.now()): void {
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 5 * 60_000) throw new Error("Upload approval expired. Please preview again.");
  const key = new PublicKey(wallet);
  if (key.toBase58() !== wallet || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw new Error("Invalid wallet approval.");
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.toBuffer()]), format: "der", type: "spki" });
  const hash = createHash("sha256").update(image).digest("hex");
  const message = metadataUploadMessage(draft, hash, wallet, origin, timestamp);
  if (!verify(null, Buffer.from(message), publicKey, Buffer.from(signature, "base64"))) throw new Error("Wallet approval does not match these token details.");
}
