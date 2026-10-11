"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, deriveConfigPda, deriveEpochPda, deriveLineagePda, deriveReproductionVaultPda, deriveVaultAuthorityPda, deriveVoteAuthorityPda, deriveVoteEscrowPda, buildInstruction, StolonsClient, LineageStatus } from "@stolons/sdk";
import { Navigation } from "../../../components/nav";

import { STOLONS_PROGRAM_ID } from "../../../lib/devnet";

const zero = PublicKey.default;

export default function ReproductionPage() {
  const { mint: mintText } = useParams<{ mint: string }>();
  const { connection } = useConnection();
  const wallet = useWallet();
  const programId = useMemo(() => new PublicKey(STOLONS_PROGRAM_ID), []);
  const client = useMemo(() => new StolonsClient(connection, programId), [connection, programId]);
  const [lineage, setLineage] = useState<Awaited<ReturnType<StolonsClient["getLineage"]>>>(null);
  const [vaultAmount, setVaultAmount] = useState<bigint | null>(null);
  const [settings, setSettings] = useState<{ proposalWindow: number; votingWindow: number; paused: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const mint = new PublicKey(mintText);
        const [entry, vault, config] = await Promise.all([
          client.getLineage(mint),
          connection.getTokenAccountBalance(deriveReproductionVaultPda(programId, mint), "confirmed").catch(() => null),
          connection.getAccountInfo(deriveConfigPda(programId), "confirmed")
        ]);
        if (cancelled) return;
        if (!config || !config.owner.equals(programId) || config.data.length < 307) throw new Error("Protocol configuration missing.");
        setSettings({ proposalWindow: Number(config.data.readBigUInt64LE(264)), votingWindow: Number(config.data.readBigUInt64LE(272)), paused: config.data[304] !== 0 });
        setLineage(entry);
        setVaultAmount(vault ? BigInt(vault.value.amount) : 0n);
      } catch { if (!cancelled) setMessage("Could not load this lineage from devnet."); }
    }
    void load();
    return () => { cancelled = true; };
  }, [client, connection, mintText, programId]);

  const eligible = lineage && settings && !settings.paused && lineage.activeEpoch.equals(zero) && lineage.activeCandidate.equals(zero) && lineage.directChildrenCount < 15 && (lineage.status === LineageStatus.RootActive || lineage.status === LineageStatus.DescendantActive);

  async function openRound() {
    const publicKey = wallet.publicKey;
    const signTransaction = wallet.signTransaction;
    if (!publicKey || !signTransaction || !lineage) { setMessage("Connect a wallet to open a round."); return; }
    setBusy(true); setMessage("");
    try {
      const mint = new PublicKey(mintText);
      const current = await client.getLineage(mint);
      if (!current || !current.activeEpoch.equals(zero) || !current.activeCandidate.equals(zero)) throw new Error("This token already has an active round or candidate.");
      const epoch = deriveEpochPda(programId, mint, current.nextEpochId);
      const instruction = buildInstruction(programId, "open_epoch", {
        payer: publicKey,
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
      }, current.nextEpochId);
      const signature = await client.send({ publicKey, signTransaction }, instruction);
      setMessage(`Round opened: ${signature}`);
      setLineage(await client.getLineage(mint));
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
        <p className="small">{settings ? `Opening a round starts a ${settings.proposalWindow}-second proposal window followed by a ${settings.votingWindow}-second voting window.` : "Loading proposal and voting windows…"} Each wallet can vote once and may withdraw its escrow after finalization.</p>
        <div className="notice">{settings?.paused ? "Protocol is paused. " : lineage && (!lineage.activeEpoch.equals(zero) || !lineage.activeCandidate.equals(zero)) ? "This token already has an active round or candidate. " : ""}This action only opens the on-chain epoch. Use the Devnet scripts for proposal submission, voting, and child launches while the web forms are being completed.</div>
        <div className="actions"><button className="button primary" onClick={openRound} disabled={busy || !eligible || !vaultAmount || vaultAmount < 10_000_000_000_000n}>{busy ? "Submitting…" : "Open epoch"}</button><Link className="button" href={`/token/${mintText}`}>Back to token</Link></div>
        {message && <p className="small" role="status">{message}</p>}
      </div></section>
      <footer className="footer"><Link href="/">Stolons</Link><span>Wallet action · devnet only</span></footer>
    </div></main>
  );
}
