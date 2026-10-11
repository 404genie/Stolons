"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { RootLaunchInput } from "@stolons/sdk/devnet-launch";
import { Navigation } from "../../components/nav";
import { STOLONS_PROGRAM_ID, DEVNET_LAUNCH_LOOKUP_TABLE } from "../../lib/devnet";
import { checkLaunchMetadata } from "../../lib/metadata";
import { MAX_IMAGE_BYTES, metadataUploadMessage, normalizeTokenDraft } from "@stolons/sdk/launch-validation";

type Preview = { input: RootLaunchInput; cost: number; pool: string; imageUrl: string; description: string };

export default function LaunchPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const mintSigner = useRef<Keypair | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");
  const [launched, setLaunched] = useState(false);
  // A submitted transaction is inspected before another launch is offered.
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!image) { setImagePreview(""); return; }
    const url = URL.createObjectURL(image); setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!wallet.publicKey || !wallet.signMessage) { setError("Connect a wallet that can approve token details, such as Phantom."); return; }
    if (!image || image.size > MAX_IMAGE_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(image.type)) { setError("Choose a PNG, JPG, or WebP image up to 3 MB."); return; }
    setBusy(true); setError(""); setMessage("Approve publishing your token details in your wallet…"); setPreview(null);
    try {
      const draft = normalizeTokenDraft({ name, symbol, description, website, twitter, telegram });
      const creator = wallet.publicKey;
      const imageHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await image.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const timestamp = Date.now();
      const signedOrigin = window.location.origin;
      const signedMessage = new TextEncoder().encode(metadataUploadMessage(draft, imageHash, creator.toBase58(), signedOrigin, timestamp));
      const approval = await wallet.signMessage(signedMessage);
      const approvalKey = await crypto.subtle.importKey("raw", new Uint8Array(creator.toBytes()), "Ed25519", false, ["verify"]);
      if (!await crypto.subtle.verify("Ed25519", approvalKey, new Uint8Array(approval), signedMessage)) {
        throw new Error("Your wallet signed with a different account or changed the approval message. Reconnect your wallet and preview again.");
      }
      const form = new FormData();
      for (const [key, value] of Object.entries(draft)) form.set(key, value);
      form.set("image", image); form.set("wallet", creator.toBase58()); form.set("timestamp", String(timestamp));
      form.set("signature", btoa(String.fromCharCode(...approval)));
      form.set("signedOrigin", signedOrigin);
      setMessage("Saving your image and token details…");
      const response = await fetch("/api/metadata", { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
      const uploaded = await response.json() as { metadataUri?: string; imageUrl?: string; error?: string };
      if (!response.ok || !uploaded.metadataUri || !uploaded.imageUrl) throw new Error(uploaded.error || "Could not save token details.");
      const metadataUri = uploaded.metadataUri;
      await checkLaunchMetadata(draft.name, draft.symbol, metadataUri);
      setMessage("Simulating your launch…");
      const api = await import("@stolons/sdk/devnet-launch");
      mintSigner.current ??= Keypair.generate();
      const input: RootLaunchInput = { programId: new PublicKey(STOLONS_PROGRAM_ID), creator, mint: mintSigner.current.publicKey, name: draft.name, symbol: draft.symbol, metadataUri, lookupTable: new PublicKey(DEVNET_LAUNCH_LOOKUP_TABLE) };
      const prepared = await api.buildDevnetRootLaunch(connection, input);
      const cost = await api.simulateRootLaunch(connection, prepared);
      setPreview({ input, cost, pool: prepared.pool.toBase58(), imageUrl: uploaded.imageUrl, description: draft.description });
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
            <label className="label" htmlFor="token-description">Description</label><textarea id="token-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Tell people what your token is about" maxLength={2000} />
            <label className="label" htmlFor="token-image">Token image</label><input id="token-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
            {imagePreview && <img className="token-image-preview" src={imagePreview} alt="Your selected token image" />}
            <p className="small">PNG, JPG, or WebP up to 3 MB. Your image and token details will be public.</p>
            <details><summary className="small">Add social links (optional)</summary><label className="label" htmlFor="token-website">Website</label><input id="token-website" type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://your-project.com" maxLength={300} /><label className="label" htmlFor="token-twitter">X</label><input id="token-twitter" type="url" value={twitter} onChange={(event) => setTwitter(event.target.value)} placeholder="https://x.com/yourproject" maxLength={300} /><label className="label" htmlFor="token-telegram">Telegram</label><input id="token-telegram" type="url" value={telegram} onChange={(event) => setTelegram(event.target.value)} placeholder="https://t.me/yourproject" maxLength={300} /></details>
            <div className="actions"><button className="button primary" type="submit" disabled={busy || !wallet.publicKey}>{busy ? "Preparing…" : "Preview launch"}</button></div>
          </fieldset>
        </form>}
        {preview && <>
          <h2>{preview.input.name} · {preview.input.symbol}</h2>
          <img className="token-image-preview" src={preview.imageUrl} alt={`${preview.input.name} token image`} />
          {preview.description && <p className="small">{preview.description}</p>}
          <dl className="launch-details"><dt>Mint</dt><dd>{preview.input.mint.toBase58()}</dd><dt>Creator wallet</dt><dd>{preview.input.creator.toBase58()}</dd><dt>Estimated launch cost</dt><dd>{(preview.cost / 1_000_000_000).toFixed(6)} test SOL</dd></dl>
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
