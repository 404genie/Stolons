import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAX_METADATA_BYTES = 32_768;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export interface TokenDraft { name: string; symbol: string; description: string; website: string; twitter: string; telegram: string }

export function normalizeTokenDraft(value: TokenDraft): TokenDraft {
  // Multipart form uploads normalize line endings to CRLF. Sign canonical LF text.
  const text = (value: string) => value.replace(/\r\n?/g, "\n").trim();
  const draft = { name: text(value.name), symbol: text(value.symbol), description: text(value.description), website: text(value.website), twitter: text(value.twitter), telegram: text(value.telegram) };
  validateLaunchDetails(draft.name, draft.symbol, "https://example.com/token.json");
  if (new TextEncoder().encode(draft.description).length > 2000) throw new Error("Description must fit within 2,000 UTF-8 bytes.");
  for (const [label, text] of Object.entries({ website: draft.website, twitter: draft.twitter, telegram: draft.telegram })) {
    if (!text) continue;
    if (text.length > 300) throw new Error(`${label} link is too long.`);
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error(`Use an HTTPS ${label} link without credentials.`);
    if (label === "twitter" && !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) throw new Error("Use an X or Twitter profile link.");
    if (label === "telegram" && url.hostname !== "t.me") throw new Error("Use a t.me Telegram link.");
  }
  return draft;
}

export function metadataUploadMessage(draft: TokenDraft, imageHash: string, wallet: string, origin: string, timestamp: number): string {
  return `Stolons: publish token details\nSite: ${origin}\nWallet: ${wallet}\nTime: ${timestamp}\nImage SHA-256: ${imageHash}\nDetails: ${JSON.stringify(normalizeTokenDraft(draft))}\nThis publishes the token image and details. It does not authorize a transaction.`;
}

export function createTokenMetadata(draft: TokenDraft, image: string, imageType = "image/png") {
  const normalized = normalizeTokenDraft(draft);
  const extensions = Object.fromEntries(Object.entries({ website: normalized.website, twitter: normalized.twitter, telegram: normalized.telegram }).filter(([, value]) => value));
  const value = { name: normalized.name, symbol: normalized.symbol, description: normalized.description, image, ...(Object.keys(extensions).length ? { extensions } : {}), properties: { files: [{ uri: image, type: imageType }], category: "image" } };
  validateLaunchMetadata(JSON.stringify(value), normalized.name, normalized.symbol);
  return value;
}

export function validateLaunchDetails(name: string, symbol: string, uri: string): void {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  if (!name.trim() || name !== name.trim() || bytes(name) > 32) throw new Error("Token name must contain 1–32 UTF-8 bytes with no outer spaces.");
  if (!symbol.trim() || symbol !== symbol.trim() || bytes(symbol) > 10) throw new Error("Ticker must contain 1–10 UTF-8 bytes with no outer spaces.");
  if (bytes(uri) > 200) throw new Error("Metadata URL must fit within 200 UTF-8 bytes.");
  const url = new URL(uri);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use a public HTTPS metadata URL without credentials.");
}

export function validateLaunchMetadata(text: string, name: string, symbol: string): void {
  if (new TextEncoder().encode(text).length > MAX_METADATA_BYTES) throw new Error("Metadata JSON exceeds 32 KB.");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Metadata must be a JSON object.");
  const metadata = value as Record<string, unknown>;
  if (metadata.name !== name || metadata.symbol !== symbol) throw new Error("Metadata name and symbol must exactly match the launch form.");
  if (typeof metadata.image !== "string") throw new Error("Metadata must include an image URL.");
  const image = new URL(metadata.image);
  if (!["https:", "ipfs:", "ar:"].includes(image.protocol) || image.username || image.password) throw new Error("Image must use HTTPS, IPFS, or Arweave.");
}

export function decodeLaunchConfig(data: Uint8Array) {
  const bytes = Buffer.from(data);
  if (bytes.length < 307 || !bytes.subarray(0, 8).equals(Buffer.from([149, 8, 156, 202, 160, 252, 176, 217]))) throw new Error("Invalid Stolons configuration account.");
  if (bytes[304] !== 0) throw new Error("Stolons is paused.");
  if (![1,2].includes(bytes[305]!)) throw new Error("Unsupported Stolons configuration version.");
  const key = (offset: number) => new PublicKey(bytes.subarray(offset, offset + 32));
  return { version:bytes[305]!, launchpad: key(72), launchConfig: key(136), platform: key(168), quote: key(200) };
}
