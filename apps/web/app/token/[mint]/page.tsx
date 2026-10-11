"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { TradePanel } from "../../../components/trade-panel";
import { Navigation } from "../../../components/nav";
import { StolonsClient, LineageStatus, deriveReproductionVaultPda } from "@stolons/sdk";
import type { LineageAccount } from "@stolons/sdk";

import { STOLONS_PROGRAM_ID } from "../../../lib/devnet";

const zero = new PublicKey(new Uint8Array(32));

export default function TokenPage() {
  const params = useParams<{ mint: string }>();
  const mintText = Array.isArray(params.mint) ? params.mint[0] : params.mint;
  const { connection } = useConnection();
  const programText = STOLONS_PROGRAM_ID;
  const client = useMemo(() => new StolonsClient(connection, new PublicKey(programText)), [connection, programText]);
  const [lineage, setLineage] = useState<LineageAccount | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null);
  const [reserve, setReserve] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLineage(null); setSupply(null); setReserve(null);
    async function load() {
      try {
        const mint = new PublicKey(mintText);
        const [entry, token, vault] = await Promise.all([
          client.getLineage(mint),
          connection.getAccountInfo(mint, "confirmed"),
          connection.getTokenAccountBalance(deriveReproductionVaultPda(client.programId, mint), "confirmed").catch(() => null)
        ]);
        if (!token || token.data.length < 82) throw new Error("Mint account was not found.");
        if (!token.owner.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))) throw new Error("This is not a standard SPL Token mint.");
        const raw = token.data.readBigUInt64LE(36);
        if (!cancelled) { setLineage(entry); setSupply(raw); setReserve(vault ? BigInt(vault.value.amount) : null); setError(""); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to read this mint.");
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [client, connection, mintText]);

  const status = lineage?.status ?? "Not registered";
  const isActive = lineage?.status === LineageStatus.RootActive || lineage?.status === LineageStatus.DescendantActive;
  return (
    <main>
      <Navigation />
      <div className="shell">
        <section className="token-head">
          <div className="eyebrow">Token lineage</div>
          <h1>{mintText}</h1>
          <span className="pill">{status}</span>
        </section>
        {error && <p className="error" role="alert">{error}</p>}
        {loading && <p className="small" role="status">Loading Devnet lineage…</p>}
        {!error && !loading && !lineage && <p className="small">No Stolons lineage record was found for this mint.</p>}
        {lineage && <>
          <TradePanel mint={mintText} graduated={!lineage.cpmmPool.equals(zero)} />
          <section className="grid">
            <article className="card"><span className="label">Current supply</span><div className="metric">{supply === null ? "…" : (Number(supply) / 1_000_000).toLocaleString("en-US")}</div><p className="small">Tokens · six decimals</p></article>
            <article className="card"><span className="label">Generation</span><div className="metric">G{lineage.generation}</div><p className="small">Direct children {lineage.directChildrenCount} / 15</p></article>
            <article className="card"><span className="label">Self root mass</span><div className="metric">{lineage.selfRootMass.toLocaleString("en-US")}</div><p className="small">Ancestral atoms held by this lineage</p></article>
          </section>
          <section className="section">
            <div className="grid">
              <article className="card"><span className="label">Root</span><div className="value"><Link href={`/token/${lineage.rootMint.toBase58()}`}>{lineage.rootMint.toBase58()}</Link></div></article>
              <article className="card"><span className="label">Parent</span><div className="value">{lineage.parentMint.equals(zero) ? "— (root token)" : <Link href={`/token/${lineage.parentMint.toBase58()}`}>{lineage.parentMint.toBase58()}</Link>}</div></article>
              <article className="card"><span className="label">Reproduction reserve</span><div className="value">{lineage.reproductionReserveClaimed ? "Claimed to the program vault" : "Not claimed"}</div><p className="small">Current balance: {reserve === null ? "unavailable" : `${(Number(reserve) / 1_000_000).toLocaleString("en-US")} tokens`}</p></article>
            </div>
          </section>
          {lineage.cpmmPool.equals(zero) ? null : <p className="small">CPMM pool: <a href={`https://explorer.solana.com/address/${lineage.cpmmPool.toBase58()}?cluster=devnet`} target="_blank" rel="noreferrer">{lineage.cpmmPool.toBase58()}</a></p>}
          {isActive && <div className="actions"><Link className="button primary" href={`/reproduce/${mintText}`}>Open reproduction round</Link></div>}
        </>}
        <footer className="footer"><Link href="/">← Stolons home</Link><span>Read from the configured RPC and program ID.</span></footer>
      </div>
    </main>
  );
}
