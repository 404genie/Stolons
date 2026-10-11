"use client";
import {Footer} from "../../components/footer";
import {SOLANA_CLUSTER,IS_MAINNET,NETWORK_LABEL,SOL_LABEL,EXPLORER_QUERY,GRADUATION_TARGET_LAMPORTS,TRANSACTIONS_ENABLED,requireTransactions} from "../../lib/network";

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
    try{requireTransactions();}catch(cause){setError((cause as Error).message);return;}
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
      const input: RootLaunchInput = { programId: new PublicKey(STOLONS_PROGRAM_ID), creator, mint: mintSigner.current.publicKey, name: draft.name, symbol: draft.symbol, metadataUri, lookupTable: new PublicKey(DEVNET_LAUNCH_LOOKUP_TABLE),cluster:SOLANA_CLUSTER,graduationTargetLamports:GRADUATION_TARGET_LAMPORTS };
      const prepared = await api.buildDevnetRootLaunch(connection, input);
      const cost = await api.simulateRootLaunch(connection, prepared);
      setPreview({ input, cost, pool: prepared.pool.toBase58(), imageUrl: uploaded.imageUrl, description: draft.description });
      setMessage("Simulation passed. Review the launch, then sign with your wallet.");
    } catch (cause) { setMessage(""); setError(cause instanceof Error ? cause.message : "Could not prepare the launch."); }
    finally { setBusy(false); }
  }

  async function launch() {
    try{requireTransactions();}catch(cause){setError((cause as Error).message);return;}
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
        setMessage(`Your root token is launched and registered on ${NETWORK_LABEL}. It can reproduce after graduation and reserve activation.`);
      } catch (cause) {
        if (cause instanceof api.LaunchSubmittedError) {
          setSignature(cause.signature); setSubmitted(true); setMessage("The transaction was submitted. Check its status using the links below.");
        }
        throw cause;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Launch failed."); }
    finally { setBusy(false); }
  }

  return <main><Navigation /><div className="shell">
    {!TRANSACTIONS_ENABLED&&<p className="notice">Mainnet launches are not open yet.</p>}<section className="page-intro"><div className="breadcrumbs"><Link href="/">Discover</Link><span>/</span><span>Create token</span></div><div className="eyebrow">EVERY FAMILY STARTS HERE</div><h1>Create your root token.</h1><p>Give it a name. Give it a face. Launch it on Raydium and start a family that can keep growing.</p></section>
    <div className="workspace-grid launch-workspace"><section className="card launch-form">
      <div className="panel-title"><h2>{preview ? (launched ? "Token launched" : "Review your launch") : "Token details"}</h2><span>{preview ? "02 / CONFIRM" : "01 / CREATE"}</span></div>
      {!preview && <form onSubmit={prepare}><fieldset disabled={busy || submitted || !TRANSACTIONS_ENABLED}>
        <div className="form-row"><div><label className="label" htmlFor="token-name">Token name</label><input id="token-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Stolons" required maxLength={32} /></div><div><label className="label" htmlFor="token-symbol">Ticker</label><input id="token-symbol" value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="e.g. STLN" required maxLength={10} /></div></div>
        <label className="label" htmlFor="token-description">Description <span className="muted">(optional)</span></label><textarea id="token-description" rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="What's the story behind your token?" maxLength={2000} />
        <label className="label" htmlFor="token-image">Token image</label><label className="upload-zone" htmlFor="token-image">{imagePreview ? <img src={imagePreview} alt="Selected token image" /> : <span className="upload-icon">↑</span>}<div><strong>{image ? image.name : "Choose a token image"}</strong><span>PNG, JPG or WebP · Up to 3 MB</span></div></label><input className="visually-hidden" id="token-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setImage(event.target.files?.[0] ?? null)} />
        <p className="small">Your image and token details will be public.</p>
        <details><summary className="small">Social links <span className="muted">— optional</span></summary><label className="label" htmlFor="token-website">Website</label><input id="token-website" type="url" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://your-project.com" maxLength={300} /><div className="form-row"><div><label className="label" htmlFor="token-twitter">X profile</label><input id="token-twitter" type="url" value={twitter} onChange={event => setTwitter(event.target.value)} placeholder="https://x.com/yourproject" maxLength={300} /></div><div><label className="label" htmlFor="token-telegram">Telegram</label><input id="token-telegram" type="url" value={telegram} onChange={event => setTelegram(event.target.value)} placeholder="https://t.me/yourproject" maxLength={300} /></div></div></details>
        <div className="actions"><button className="button primary" type="submit" disabled={busy || !wallet.publicKey}>{busy ? "Preparing launch…" : "Preview launch →"}</button></div>
      </fieldset></form>}
      {preview && <><div className="token-heading"><div className="token-avatar"><img src={preview.imageUrl} alt="" /></div><div><h2>{preview.input.name}</h2><span className="small">${preview.input.symbol} · Root token</span></div></div>{preview.description && <p className="small">{preview.description}</p>}<dl className="launch-details"><dt>Mint address</dt><dd>{preview.input.mint.toBase58()}</dd><dt>Creator wallet</dt><dd>{preview.input.creator.toBase58()}</dd><dt>Estimated launch cost</dt><dd>{(preview.cost / 1_000_000_000).toFixed(6)} {SOL_LABEL}</dd></dl>
        {!submitted && <div className="actions"><button className="button primary" disabled={busy || !wallet.publicKey?.equals(preview.input.creator)} onClick={launch}>{busy ? "Launching…" : "Sign and launch ↗"}</button><button className="button" disabled={busy} onClick={() => { setPreview(null); setMessage(""); setError(""); }}>Edit details</button></div>}
        {submitted && <div className="actions"><Link className="button primary" href={`/token/${preview.input.mint.toBase58()}`}>{launched ? "Open token page →" : "Inspect token status →"}</Link>{signature && <a className="button" href={`https://explorer.solana.com/tx/${signature}${EXPLORER_QUERY}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}</div>}
      </>}
      {!wallet.publicKey && <div className="notice">Connect your wallet in the header to preview your launch. You'll need {SOL_LABEL} for transaction fees.</div>}
      <div aria-live="polite">{message && <p className="notice">{message}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
    </section><aside className="launch-aside"><article className="card"><div className="aside-label">YOUR TOKEN PREVIEW</div><div className="token-heading"><div className="token-avatar">{imagePreview ? <img src={imagePreview} alt="" /> : <span>{symbol.slice(0, 2) || "ST"}</span>}</div><div><h2>{name || "Your token name"}</h2><span className="small">${symbol || "TICKER"}</span></div></div><p className="small">{description || "Your token's story starts here."}</p><span className="pill">Generation 0 · Root family</span></article>
      <article className="card"><div className="aside-label">FIXED TOKEN ECONOMICS</div><div className="metric">1,000,000,000</div><p className="small">Total tokens · 6 decimals</p><div className="allocation-bar"><i /><i /><i /></div><div className="allocation-row"><span>Bonding curve</span><b>70%</b></div><div className="allocation-row"><span>Migration liquidity</span><b>15%</b></div><div className="allocation-row"><span>Reproduction reserve</span><b>15%</b></div><p className="small" style={{ marginTop: 18, marginBottom: 0 }}>Mint and freeze authorities are revoked at launch. The reproduction reserve stays locked until graduation.</p></article>
      <div className="notice" style={{ margin: 0 }}>Graduation target: <strong>{Number(GRADUATION_TARGET_LAMPORTS??0n)/1e9} {SOL_LABEL}.</strong>  Your wallet stays in control throughout the launch.</div>
    </aside></div><Footer />
  </div></main>;
}
