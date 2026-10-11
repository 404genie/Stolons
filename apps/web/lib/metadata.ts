import { MAX_METADATA_BYTES, validateLaunchDetails, validateLaunchMetadata } from "@stolons/sdk/launch-validation";

/** Runs in the browser so user-provided URLs never reach the app server. */
export async function checkLaunchMetadata(name: string, symbol: string, uri: string): Promise<void> {
  validateLaunchDetails(name, symbol, uri);
  let response: Response;
  try {
    response = await fetch(uri, { signal: AbortSignal.timeout(12_000), cache: "no-store", credentials: "omit", redirect: "error" });
  } catch { throw new Error("Cannot read metadata. Use a direct public HTTPS JSON URL that allows browser access (CORS)."); }
  if (!response.ok || !response.body) throw new Error("Metadata URL did not return readable JSON.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_METADATA_BYTES) throw new Error("Metadata JSON exceeds 32 KB.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  validateLaunchMetadata(new TextDecoder("utf-8", { fatal: true }).decode(bytes), name, symbol);
}
