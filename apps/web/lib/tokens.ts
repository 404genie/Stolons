import { PublicKey, type Connection } from "@solana/web3.js";
import { decodeLineage, type LineageAccount } from "@stolons/sdk";
import { STOLONS_PROGRAM_ID } from "./devnet";

export const shortAddress = (value: string) => `${value.slice(0, 5)}…${value.slice(-5)}`;
export const statusLabel = (value: string) => ({ RootPending: "On the curve", RootQualified: "Graduated", RootActive: "Active root", CandidateLaunched: "On the curve", CandidateQualified: "Graduated", DescendantActive: "Active child", Orphan: "Independent" }[value] || value);
export interface TokenInfo { name: string; symbol: string; image: string; description: string; website: string; twitter: string; telegram: string }
const emptyInfo = (mint: string): TokenInfo => ({ name: shortAddress(mint), symbol: "TOKEN", image: "", description: "", website: "", twitter: "", telegram: "" });
function publicUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
export async function readTokenInfo(connection: Connection, mintText: string): Promise<TokenInfo> {
  let fallback = emptyInfo(mintText);
  try {
    const mint = new PublicKey(mintText), metadataProgram = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const [address] = PublicKey.findProgramAddressSync([new TextEncoder().encode("metadata"), metadataProgram.toBytes(), mint.toBytes()], metadataProgram);
    const account = await connection.getAccountInfo(address, "confirmed");
    if (!account || !account.owner.equals(metadataProgram) || account.data.length < 77) return fallback;
    let offset = 65;
    function string() { const length = account!.data.readUInt32LE(offset); offset += 4; if (length > 1024 || offset + length > account!.data.length) throw Error("Invalid metadata"); const value = account!.data.subarray(offset, offset + length).toString("utf8").replace(/\0/g, "").trim(); offset += length; return value; }
    const name = string(), symbol = string(), uri = publicUrl(string());
    const base = { ...fallback, name: name || fallback.name, symbol: symbol || fallback.symbol };
    fallback = base;
    if (!uri) return base;
    const response = await fetch(uri, { signal: AbortSignal.timeout(6000), credentials: new URL(uri).origin === window.location.origin ? "same-origin" : "omit", redirect: "error" });
    if (!response.ok) return base;
    const reader = response.body?.getReader(); if (!reader) return base;
    let length = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > 32768) return base; chunks.push(next.value); } } finally { await reader.cancel().catch(() => {}); }
    const data = new Uint8Array(length); let position = 0; for (const chunk of chunks) { data.set(chunk, position); position += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(data));
    const links = value.extensions || {};
    return { ...base, description: typeof value.description === "string" ? value.description.slice(0, 2000) : "", image: publicUrl(value.image), website: publicUrl(links.website), twitter: publicUrl(links.twitter), telegram: publicUrl(links.telegram) };
  } catch { return fallback; }
}
export async function readLineages(connection: Connection): Promise<LineageAccount[]> {
  const programId = new PublicKey(STOLONS_PROGRAM_ID);
  const accounts = await connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [{ dataSize: 317 }] });
  return accounts.flatMap(({ account }) => { try { return [decodeLineage(account.data)]; } catch { return []; } }).sort((a, b) => Number(b.createdAt - a.createdAt));
}
export async function readCurve(connection: Connection, lineage: LineageAccount) {
  const pool = await connection.getAccountInfo(lineage.launchPool, "confirmed");
  if (!pool || pool.data.length < 365) return null;
  const raised = pool.data.readBigUInt64LE(61), target = pool.data.readBigUInt64LE(69);
  return { raised: Number(raised) / 1e9, target: Number(target) / 1e9, progress: target > 0n ? Math.min(pool.data[17] === 0 ? 99.9 : 100, Number(raised * 10000n / target) / 100) : 0, complete: pool.data[17] !== 0, migrated: pool.data[17] === 2 };
}
