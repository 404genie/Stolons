import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAX_METADATA_BYTES = 32_768;

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
  if (bytes[305] !== 1) throw new Error("Unsupported Stolons configuration version.");
  const key = (offset: number) => new PublicKey(bytes.subarray(offset, offset + 32));
  return { launchpad: key(72), launchConfig: key(136), platform: key(168), quote: key(200) };
}
