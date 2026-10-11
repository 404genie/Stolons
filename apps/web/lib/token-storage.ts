import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";

export function localUploadsEnabled(): boolean { return process.env.NODE_ENV === "development" && !process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN; }
export const uploadsDirectory = () => path.join(process.cwd(), ".stolons-uploads");

export async function storeTokenAsset(bytes: Uint8Array, extension: "png" | "jpg" | "webp" | "json", origin: string): Promise<string> {
  const id = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
  const contentType = extension === "json" ? "application/json" : extension === "jpg" ? "image/jpeg" : `image/${extension}`;
  if (localUploadsEnabled()) {
    await mkdir(uploadsDirectory(), { recursive: true });
    try { await writeFile(path.join(uploadsDirectory(), id), bytes, { flag: "wx" }); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
    return `${origin}/api/assets/${id}`;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Token image storage is not configured. Please try again later.");
  const pathname = `tokens/${id}`;
  try { return (await head(pathname)).url; }
  catch (cause) { if (!(cause instanceof BlobNotFoundError)) throw cause; }
  // Content-addressed paths never publish different bytes at an existing URL.
  try { return (await put(pathname, Buffer.from(bytes), { access: "public", contentType, addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 31_536_000 })).url; }
  catch (cause) {
    // A simultaneous identical upload can win between the head and put calls.
    try { return (await head(pathname)).url; } catch { throw cause; }
  }
}

export async function readLocalTokenAsset(id: string): Promise<Buffer | null> {
  if (!localUploadsEnabled() || !/^[a-f0-9]{64}\.(png|jpg|webp|json)$/.test(id)) return null;
  try { return await readFile(path.join(uploadsDirectory(), id)); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
}
