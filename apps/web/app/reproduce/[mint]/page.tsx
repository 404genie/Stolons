"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, deriveConfigPda, deriveEpochPda, deriveLineagePda, deriveReproductionVaultPda, deriveVaultAuthorityPda, deriveVoteAuthorityPda, deriveVoteEscrowPda, buildInstruction, StolonsClient, LineageStatus } from "@stolons/sdk";
import { Navigation } from "../../../components/nav";

export default function ReproductionPage() {
  const { mint: mintText } = useParams<{ mint: string }>();
  const { connection } = useConnection();
  const wallet = useWallet();
  const programId = useMemo(() => new PublicKey(process.env.NEXT_PUBLIC_STOLONS_PROGRAM_ID || "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"), []);
  const client = useMemo(() => new StolonsClient(connection, programId), [connection, programId]);
  const [lineage, setLineage] = useState<Awaited<ReturnType<StolonsClient["getLineage"]>>>(null);
  const [vaultAmount, setVaultAmount] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const mint = new PublicKey(mintText);
        const [entry, vault] = await Promise.all([
          client.getLineage(mint),
          connection.getTokenAccountBalance(deriveReproductionVaultPda(programId, mint), "confirmed").catch(() => null)
        ]);
        if (cancelled) return;
        setLineage(entry);
        setVaultAmount(vault ? BigInt(vault.value.amount) : 0n);
      } catch { if (!cancelled) setMessage("Could not load this lineage from devnet."); }
    }
    void load();
    return () => { cancelled = true; };
  }, [client, connection, mintText, programId]);

  const eligible = lineage && (lineage.status === LineageStatus.RootActive || lineage.status === LineageStatus.DescendantActive);

  async function openRound() {
    if (!wallet.publicKey || !wallet.signTransaction || !lineage) { setMessage("Connect a wallet to open a round."); return; }
    setBusy(true); setMessage("");
    try {
      const mint = new PublicKey(mintText);
      const epoch = deriveEpochPda(programId, mint, lineage.nextEpochId);
      const instruction = buildInstruction(programId, "open_epoch", {
        payer: wallet.publicKey,
        config: deriveConfigPda(programId),
        parent: deriveLineagePda(programId, mint),
        parent_mint: mint,
        vault_authority: deriveVaultAuthorityPda(programId, mint),
        reproduction_vault: deriveReproductionVaultPda(programId, mint),
        epoch,
        vote_authority: deriveVoteAuthorityPda(programId, epoch),
        vote_escrow: deriveVoteEscrowPda(programId, epoch),
        token_program: TOKEN_PROGRAM_ID,
        system_program: SYSTEM_PROGRAM_ID
      }, lineage.nextEpochId);
      const signature = await client.send(wallet, instruction);
      setMessage(`Round opened: ${signature}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Transaction failed.");
    } finally { setBusy(false); }
  }

  return (
    <main><Navigation /><div className="shell">
      <section className="token-head"><div className="eyebrow">Reproduction</div><h1>Open a child round</h1><p className="small">Parent mint: {mintText}</p></section>
      <div className="grid">
        <article className="card"><span className="label">Lineage status</span><div className="metric">{lineage?.status ?? "Loading"}</div><p className="small">One active candidate or voting epoch at a time.</p></article>
        <article className="card"><span className="label">Reserve balance</span><div className="metric">{vaultAmount === null ? "…" : (Number(vaultAmount) / 1_000_000).toLocaleString("en-US")}</div><p className="small">Parent tokens in the program controlled reproduction vault.</p></article>
        <article className="card"><span className="label">Children</span><div className="metric">{lineage?.directChildrenCount ?? "…"} / 15</div><p className="small">A settled child burns 10M parent tokens.</p></article>
      </div>
      <section className="section"><div className="card">
        <h2>Proposal and vote window</h2>
        <p className="small">Opening an epoch locks the parent's reproduction state for one 24 hour proposal period and one 24 hour vote period. Each wallet can vote once and may withdraw its escrow after finalization.</p>
        <div className="notice">This action only opens the on-chain epoch. The proposal submission and vote forms will be enabled after the generated IDL and devnet account layouts have passed the integration gate.</div>
        <div className="actions"><button className="button primary" onClick={openRound} disabled={busy || !eligible || !vaultAmount || vaultAmount < 10_000_000_000_000n}>{busy ? "Submitting…" : "Open epoch"}</button><Link className="button" href={`/token/${mintText}`}>Back to token</Link></div>
        {message && <p className="small" role="status">{message}</p>}
      </div></section>
      <footer className="footer"><Link href="/">Stolons</Link><span>Wallet action · devnet only</span></footer>
    </div></main>
  );
}
