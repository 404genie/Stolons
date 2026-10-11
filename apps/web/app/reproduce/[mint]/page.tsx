"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, deriveConfigPda, deriveEpochPda, deriveLineagePda, deriveReproductionVaultPda, deriveVaultAuthorityPda, deriveVoteAuthorityPda, deriveVoteEscrowPda, buildInstruction, StolonsClient, LineageStatus } from "@stolons/sdk";
import { Navigation } from "../../../components/nav";

import { STOLONS_PROGRAM_ID } from "../../../lib/devnet";

import { DEVNET_GENESIS_HASH } from "@stolons/sdk/launch-validation";
import { shortAddress, statusLabel } from "../../../lib/tokens";

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
  const [signature, setSignature] = useState("");

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
      if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error("Reproduction is enabled on devnet only.");
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
      const latest = await connection.getLatestBlockhash("confirmed");
      const preview = new VersionedTransaction(new TransactionMessage({ payerKey: publicKey, recentBlockhash: latest.blockhash, instructions: [instruction] }).compileToV0Message());
      const simulation = await connection.simulateTransaction(preview, { sigVerify: false, commitment: "confirmed" });
      if (simulation.value.err) throw new Error(`Round simulation failed: ${JSON.stringify(simulation.value.err)}`);
      const signature = await client.send({ publicKey, signTransaction }, instruction);
      setSignature(signature);
      setMessage("Your reproduction round is open on devnet.");
      setLineage(await client.getLineage(mint));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Transaction failed.");
    } finally { setBusy(false); }
  }

  const active = lineage?.status === LineageStatus.RootActive || lineage?.status === LineageStatus.DescendantActive;
  const roundOpen = !!lineage && !lineage.activeEpoch.equals(zero);
  const steps = [
    ["Graduated and activated", !!active],
    ["Reserve covers a 10M burn", vaultAmount !== null && vaultAmount >= 10_000_000_000_000n],
    ["Child slots available", !!lineage && lineage.directChildrenCount < 15],
    ["No active round or candidate", !!lineage && lineage.activeEpoch.equals(zero) && lineage.activeCandidate.equals(zero)],
    ["Protocol available", !!settings && !settings.paused]
  ] as const;
  return <main><Navigation /><div className="shell"><section className="page-intro"><div className="breadcrumbs"><Link href="/">Discover</Link><span>/</span><Link href={`/token/${mintText}`}>{shortAddress(mintText)}</Link><span>/</span><span>Reproduction</span></div><div className="eyebrow">THE NEXT BRANCH</div><h1>{roundOpen ? "The family is growing." : "Start the next generation."}</h1><p>Open a round for the community to propose and select a child. A successful child becomes its own token and burns 10M from its parent's reserve.</p></section>
    <div className="workspace-grid"><div className="token-main"><div className="token-metrics"><article className="card"><span className="label">Parent status</span><div className="metric" style={{ fontSize: 16 }}>{lineage ? statusLabel(lineage.status) : "Loading…"}</div><span className="small">{active ? "Ready to reproduce" : "Awaiting activation"}</span></article><article className="card"><span className="label">Available reserve</span><div className="metric">{vaultAmount === null ? "—" : `${(Number(vaultAmount) / 1e12).toLocaleString("en-US")}M`}</div><span className="small">Parent tokens</span></article><article className="card"><span className="label">Child slots</span><div className="metric">{lineage ? 15 - lineage.directChildrenCount : "—"}<span className="muted"> / 15</span></div><span className="small">Available branches</span></article></div>
    <article className="card"><div className="panel-title"><h2>How a round works</h2><span>COMMUNITY SELECTED</span></div><div className="reproduction-flow"><div><b>01 / PROPOSE</b><strong>Choose a direction</strong><p>Submit a child's name, identity, and token details during the proposal window.</p></div><div><b>02 / VOTE</b><strong>Let holders decide</strong><p>Parent-token holders vote for a proposal. Tokens are escrowed until the round is finalized.</p></div><div><b>03 / LAUNCH</b><strong>Grow the family</strong><p>The selected child launches on Raydium. Graduation triggers settlement and the parent burn.</p></div></div><div className="allocation-row"><span>Proposal window</span><b>{settings ? `${settings.proposalWindow} seconds` : "Loading…"}</b></div><div className="allocation-row"><span>Voting window</span><b>{settings ? `${settings.votingWindow} seconds` : "Loading…"}</b></div><div className="allocation-row"><span>Burn on successful settlement</span><b>10,000,000 parent tokens</b></div></article>
    <article className="card"><h2>{roundOpen ? "Round is live" : "Open a reproduction round"}</h2><p className="small">{roundOpen ? "An on-chain round is already active for this parent. It must finish before another round can open." : "Opening a round starts the proposal window immediately. Anyone can open an eligible round; your wallet covers the network and account creation costs."}</p>{roundOpen && <p><a className="text-link" href={`https://explorer.solana.com/address/${lineage!.activeEpoch.toBase58()}?cluster=devnet`} target="_blank" rel="noopener noreferrer">Inspect active round ↗</a></p>}<div className="actions"><button className="button primary" onClick={openRound} disabled={busy || !eligible || !wallet.publicKey || !vaultAmount || vaultAmount < 10_000_000_000_000n}>{busy ? "Opening round…" : roundOpen ? "Round already active" : "Open round ↗"}</button><Link className="button" href={`/token/${mintText}`}>Back to token</Link></div>{!wallet.publicKey && <p className="small" style={{ marginTop: 16 }}>Connect a wallet to open a round.</p>}{message && <p className="notice" role="status">{message}</p>}{signature && <a className="text-link" href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}</article>
    </div><aside className="launch-aside"><article className="card"><div className="aside-label">PARENT ELIGIBILITY</div><h2>Ready to branch out?</h2><ul className="check-list">{steps.map(([label,passed]) => <li key={label}><span>{label}</span><b className={passed ? "" : "pending"}>{passed ? "✓" : "—"}</b></li>)}</ul></article><div className="notice" style={{ margin: 0 }}>Round opening is available in this devnet interface. Proposal submission, voting, and child launch currently run through the project scripts; their web controls are still pending.</div></aside></div><footer className="footer"><Link href="/">STOLONS / Discover</Link><span>On-chain families · Solana devnet</span></footer>
  </div></main>;
}
