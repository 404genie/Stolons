"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { Navigation } from "../../../components/nav";
import { StolonsClient, LineageStatus } from "@stolons/sdk";
import type { LineageAccount } from "@stolons/sdk";

const zero = new PublicKey(new Uint8Array(32));

export default function TokenPage() {
  const params = useParams<{ mint: string }>();
  const mintText = Array.isArray(params.mint) ? params.mint[0] : params.mint;
  const { connection } = useConnection();
  const programText = process.env.NEXT_PUBLIC_STOLONS_PROGRAM_ID || "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";
  const client = useMemo(() => new StolonsClient(connection, new PublicKey(programText)), [connection, programText]);
  const [lineage, setLineage] = useState<LineageAccount | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const mint = new PublicKey(mintText);
        const [entry, token] = await Promise.all([
          client.getLineage(mint),
          connection.getAccountInfo(mint, "confirmed")
        ]);
        if (!token || token.data.length < 82) throw new Error("Mint account was not found.");
        if (!token.owner.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))) throw new Error("This is not a standard SPL Token mint.");
        const raw = token.data.readBigUInt64LE(36);
        if (!cancelled) { setLineage(entry); setSupply(raw); setError(""); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to read this mint.");
      }
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
        {error && <p className="error">{error}</p>}
        {!error && !lineage && <p className="small">No Stolons lineage record was found for this mint.</p>}
        {lineage && <>
          <section className="grid">
            <article className="card"><span className="label">Current supply</span><div className="metric">{supply === null ? "…" : (Number(supply) / 1_000_000).toLocaleString("en-US")}</div><p className="small">Tokens · six decimals</p></article>
            <article className="card"><span className="label">Generation</span><div className="metric">G{lineage.generation}</div><p className="small">Direct children {lineage.directChildrenCount} / 15</p></article>
            <article className="card"><span className="label">Self root mass</span><div className="metric">{lineage.selfRootMass.toLocaleString("en-US")}</div><p className="small">Ancestral atoms held by this lineage</p></article>
          </section>
          <section className="section">
            <div className="grid">
              <article className="card"><span className="label">Root</span><div className="value">{lineage.rootMint.toBase58()}</div></article>
              <article className="card"><span className="label">Parent</span><div className="value">{lineage.parentMint.equals(zero) ? "— (root token)" : lineage.parentMint.toBase58()}</div></article>
              <article className="card"><span className="label">Reproduction reserve</span><div className="value">{lineage.reproductionReserveClaimed ? "Claimed to the program vault" : "Not claimed"}</div><p className="small">Vault: {lineage.reproductionReserveClaimed ? "15% of genesis supply" : "inactive until migration"}</p></article>
            </div>
          </section>
          {isActive && <div className="actions"><Link className="button primary" href={`/reproduce/${mintText}`}>Open reproduction round</Link></div>}
        </>}
        <footer className="footer"><Link href="/">← Stolons home</Link><span>Read from the configured RPC and program ID.</span></footer>
      </div>
    </main>
  );
}
