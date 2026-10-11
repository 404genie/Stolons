"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { RootLaunchInput } from "@stolons/sdk/devnet-launch";
import { Navigation } from "../../components/nav";
import { STOLONS_PROGRAM_ID } from "../../lib/devnet";
import { checkLaunchMetadata } from "../../lib/metadata";

type Preview = { input: RootLaunchInput; cost: number; pool: string };

export default function LaunchPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const mintSigner = useRef<Keypair | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri, setUri] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");
  const [launched, setLaunched] = useState(false);
  // A submitted transaction is inspected before another launch is offered.
  const [submitted, setSubmitted] = useState(false);

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!wallet.publicKey) { setError("Connect Phantom or another Solana wallet first."); return; }
    setBusy(true); setError(""); setMessage("Checking metadata and simulating your launch…"); setPreview(null);
    try {
      const inputName = name.trim(), inputSymbol = symbol.trim(), metadataUri = uri.trim();
      await checkLaunchMetadata(inputName, inputSymbol, metadataUri);
      const api = await import("@stolons/sdk/devnet-launch");
      mintSigner.current ??= Keypair.generate();
      const input: RootLaunchInput = { programId: new PublicKey(STOLONS_PROGRAM_ID), creator: wallet.publicKey, mint: mintSigner.current.publicKey, name: inputName, symbol: inputSymbol, metadataUri };
      const prepared = await api.buildDevnetRootLaunch(connection, input);
      const cost = await api.simulateRootLaunch(connection, prepared);
      setPreview({ input, cost, pool: prepared.pool.toBase58() });
      setMessage("Simulation passed. Review the launch, then sign with your wallet.");
    } catch (cause) { setMessage(""); setError(cause instanceof Error ? cause.message : "Could not prepare the launch."); }
    finally { setBusy(false); }
  }

  async function launch() {
    const signTransaction = wallet.signTransaction;
    if (!preview || !mintSigner.current || !signTransaction || !wallet.publicKey?.equals(preview.input.creator)) { setError("Connect the wallet that prepared this launch."); return; }
    setBusy(true); setError(""); setMessage("Rechecking the launch before requesting your signature…");
    try {
      const api = await import("@stolons/sdk/devnet-launch");
      await checkLaunchMetadata(preview.input.name, preview.input.symbol, preview.input.metadataUri);
      const prepared = await api.buildDevnetRootLaunch(connection, preview.input);
      try {
        const txSignature = await api.sendRootLaunch(connection, prepared, mintSigner.current, signTransaction);
        setSignature(txSignature); setSubmitted(true); setLaunched(true);
        setMessage("Your root token is launched and registered on devnet. It can reproduce after graduation and reserve activation.");
      } catch (cause) {
        if (cause instanceof api.LaunchSubmittedError) {
          setSignature(cause.signature); setSubmitted(true); setMessage("The transaction was submitted. Check its status using the links below.");
        }
        throw cause;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Launch failed."); }
    finally { setBusy(false); }
  }

  return (
    <main><Navigation /><div className="shell">
      <section className="token-head"><div className="eyebrow">Start a family · devnet</div><h1>Launch a root token.</h1><p className="small">Create a Raydium token and its Stolons family in one transaction.</p></section>
      <div className="grid">
        <article className="card"><span className="label">Fixed supply</span><div className="metric">1 billion</div><p className="small">Six decimals, with mint and freeze authorities revoked at launch.</p></article>
        <article className="card"><span className="label">Reproduction reserve</span><div className="metric">150 million</div><p className="small">Locked until graduation, then claimed into the family reserve.</p></article>
        <article className="card"><span className="label">Devnet graduation target</span><div className="metric">1 test SOL</div><p className="small">800M tokens on the curve and 50M for migration liquidity.</p></article>
      </div>
      <section className="section"><div className="card launch-form">
        {!preview && <form onSubmit={prepare}>
          <fieldset disabled={busy || submitted}>
            <label className="label" htmlFor="token-name">Token name</label><input id="token-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your token name" required maxLength={32} />
            <label className="label" htmlFor="token-symbol">Ticker</label><input id="token-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="TOKEN" required maxLength={10} />
            <label className="label" htmlFor="metadata-uri">Metadata JSON URL</label><input id="metadata-uri" type="url" value={uri} onChange={(event) => setUri(event.target.value)} placeholder="https://…/token.json" required maxLength={200} />
            <p className="small">Host a public JSON file containing the same name and symbol plus an image URL. The URL must allow browser access. Keep the file available after launch.</p>
            <div className="actions"><button className="button primary" type="submit" disabled={busy || !wallet.publicKey}>{busy ? "Preparing…" : "Preview launch"}</button><button className="button" type="button" onClick={() => { setName("Stolons Root"); setSymbol("STROOT"); setUri("https://raw.githubusercontent.com/404genie/Stolons/devnet/codespaces/root.json"); }}>Use test metadata</button></div>
          </fieldset>
        </form>}
        {preview && <>
          <h2>{preview.input.name} · {preview.input.symbol}</h2>
          <dl className="launch-details"><dt>Mint</dt><dd>{preview.input.mint.toBase58()}</dd><dt>Creator wallet</dt><dd>{preview.input.creator.toBase58()}</dd><dt>Estimated launch cost</dt><dd>{(preview.cost / 1_000_000_000).toFixed(6)} test SOL</dd><dt>Metadata</dt><dd><a href={preview.input.metadataUri} target="_blank" rel="noopener noreferrer">{preview.input.metadataUri}</a></dd></dl>
          {!submitted && <div className="actions"><button className="button primary" disabled={busy || !wallet.publicKey?.equals(preview.input.creator)} onClick={launch}>{busy ? "Launching…" : "Sign and launch"}</button><button className="button" disabled={busy} onClick={() => { setPreview(null); setMessage(""); setError(""); }}>Edit details</button></div>}
          {submitted && <div className="actions"><Link className="button primary" href={`/token/${preview.input.mint.toBase58()}`}>{launched ? "View your token" : "Inspect token status"}</Link>{signature && <a className="button" href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">View transaction</a>}</div>}
        </>}
        {!wallet.publicKey && <p className="small">Connect your wallet using the button in the header. Use devnet SOL for transaction fees.</p>}
        <div aria-live="polite">{message && <p className="small">{message}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      </div></section>
      <footer className="footer"><Link href="/">← Stolons home</Link><span>Devnet launch · Raydium</span></footer>
    </div></main>
  );
}
