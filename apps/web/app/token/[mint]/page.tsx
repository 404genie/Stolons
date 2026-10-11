"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { Navigation } from "../../../components/nav";
import { RecentTransactions } from "../../../components/recent-transactions";
import { MarketStats } from "../../../components/market-stats";
import { GraduationPanel } from "../../../components/graduation-panel";
import { TradePanel } from "../../../components/trade-panel";
import { StolonsClient, LineageStatus, deriveReproductionVaultPda, type LineageAccount } from "@stolons/sdk";
import { STOLONS_PROGRAM_ID } from "../../../lib/devnet";
import { readTokenInfo, readCurve, shortAddress, statusLabel, type TokenInfo } from "../../../lib/tokens";

const zero = PublicKey.default;
export default function TokenPage() {
  const params = useParams<{ mint: string }>();
  const mintText = Array.isArray(params.mint) ? params.mint[0] : params.mint;
  const { connection } = useConnection();
  const client = useMemo(() => new StolonsClient(connection, new PublicKey(STOLONS_PROGRAM_ID)), [connection]);
  const [lineage, setLineage] = useState<LineageAccount | null>(null), [info, setInfo] = useState<TokenInfo | null>(null);
  const [supply, setSupply] = useState<bigint | null>(null), [reserve, setReserve] = useState<bigint | null>(null);
  const [curve, setCurve] = useState<Awaited<ReturnType<typeof readCurve>>>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [copied, setCopied] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => { let cancelled = false; setLoading(true); setLineage(null); setInfo(null); setSupply(null); setReserve(null); setCurve(null); setError(""); setCopied(false);
    async function load() { try {
      const mint = new PublicKey(mintText);
      const [entry, token, vault] = await Promise.all([client.getLineage(mint), connection.getAccountInfo(mint, "confirmed"), connection.getTokenAccountBalance(deriveReproductionVaultPda(client.programId, mint), "confirmed").catch(() => null)]);
      if (!token || token.data.length < 82 || !token.owner.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))) throw new Error("A standard SPL token was not found at this mint address.");
      if (!cancelled) { setLineage(entry); setSupply(token.data.readBigUInt64LE(36)); setReserve(vault ? BigInt(vault.value.amount) : null); setLoading(false); }
      const [details, market] = await Promise.all([readTokenInfo(connection, mintText), entry ? readCurve(connection, entry) : Promise.resolve(null)]);
      if (!cancelled) { setInfo(details); setCurve(market); }
    } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load this token."); } finally { if (!cancelled) setLoading(false); } }
    void load(); return () => { cancelled = true; };
  }, [client, connection, mintText, refresh]);
  useEffect(()=>{if(!lineage)return;let cancelled=false,pending=false;const mint=lineage.mint;const timer=setInterval(async()=>{if(pending)return;pending=true;try{const [entry,token,vault]=await Promise.all([client.getLineage(mint),connection.getAccountInfo(mint,'confirmed'),connection.getTokenAccountBalance(deriveReproductionVaultPda(client.programId,mint),'confirmed').catch(()=>null)]);if(!entry)return;const market=await readCurve(connection,entry);if(!cancelled){setLineage(entry);setCurve(market);if(token?.data.length&&token.data.length>=82&&token.owner.equals(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')))setSupply(token.data.readBigUInt64LE(36));setReserve(vault?BigInt(vault.value.amount):null);}}catch{/* Keep the last confirmed snapshot on a transient RPC error. */}finally{pending=false;}},15000);return()=>{cancelled=true;clearInterval(timer)};},[client,connection,lineage?.mint.toBase58()]);
  const active = lineage?.status === LineageStatus.RootActive || lineage?.status === LineageStatus.DescendantActive;
  async function copy() { try { await navigator.clipboard.writeText(mintText); setCopied(true); } catch { setCopied(false); } }
  return <main><Navigation /><div className="shell">
    <section className="page-intro"><div className="breadcrumbs"><Link href="/">Discover</Link><span>/</span><span>{info?.name || shortAddress(mintText)}</span></div><div className="token-heading"><div className="token-avatar">{info?.image ? <img src={info.image} alt="" /> : <span>{info?.symbol.slice(0, 2) || "ST"}</span>}</div><div><h1>{info?.name || shortAddress(mintText)}</h1><div className="token-subtitle"><span>${info?.symbol || "TOKEN"}</span>{lineage && <span className="pill">{curve?.migrated ? "Graduated" : curve?.complete ? "Migration pending" : statusLabel(lineage.status)}</span>}<button className="address-button" onClick={copy} title={mintText}>{copied ? "Copied ✓" : `${shortAddress(mintText)} ⧉`}</button><a href={`https://explorer.solana.com/address/${mintText}?cluster=devnet`} target="_blank" rel="noopener noreferrer">Explorer ↗</a></div></div></div></section>
    {error && <p className="error" role="alert">{error}</p>}{loading && <p className="small" role="status">Reading token data from Solana…</p>}
    {!loading && !error && !lineage && <div className="empty-state"><h3>This token is not registered with Stolons</h3><p>Check the mint address or discover a token in the ecosystem.</p><Link className="button" href="/">Back to discover</Link></div>}
    {lineage && <div className="workspace-grid"><div className="token-main">
      {!curve?.migrated && !active && <article className="card"><div className="curve-header"><div><div className="eyebrow">{curve?.migrated ? "GRADUATED" : curve?.complete ? "CURVE COMPLETE" : "BONDING CURVE"}</div><h2>{curve?.complete ? "Ready for the next stage." : "The road to graduation."}</h2></div><button className="button compact" disabled={loading} onClick={() => setRefresh(value => value + 1)}>↻ Refresh</button></div><div className="curve-number">{curve ? `${curve.progress.toFixed(1)}%` : "—"}</div><div className="progress-track" role="progressbar" aria-label="Graduation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={curve?.progress || 0}><div className="progress-fill" style={{ width: `${curve?.progress || 0}%` }} /></div><div className="progress-labels"><span>{curve ? `${curve.raised.toFixed(4)} SOL raised` : "Loading curve…"}</span><span>{curve ? `${curve.target} SOL target` : "Devnet"}</span></div><div className="curve-facts"><div><span>Trading venue</span><strong>{curve?.migrated ? "Raydium CPMM" : curve?.complete ? "Migration pending" : "Raydium LaunchLab"}</strong></div><div><span>Token standard</span><strong>SPL · 6 decimals</strong></div><div><span>Creator</span><strong><a href={`https://explorer.solana.com/address/${lineage.creator.toBase58()}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{shortAddress(lineage.creator.toBase58())} ↗</a></strong></div></div></article>}
      {(curve?.migrated || active) && <MarketStats mint={mintText} createdAt={Number(lineage.createdAt)} refresh={refresh} />}
      <GraduationPanel mint={mintText} onUpdated={() => setRefresh(value => value + 1)} />
      <div className="token-metrics"><article className="card"><span className="label">Current supply</span><div className="metric">{supply === null ? "—" : `${(Number(supply) / 1e6 / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`}</div><span className="small">Total minted supply*</span></article><article className="card"><span className="label">Generation</span><div className="metric">G{lineage.generation}</div><span className="small">{lineage.generation === 0 ? "Root of the family" : "Family descendant"}</span></article><article className="card"><span className="label">Direct children</span><div className="metric">{lineage.directChildrenCount}<span className="muted"> / 15</span></div><span className="small">10M burned per child</span></article></div>
      <article className="card"><div className="panel-title"><h2>About {info?.name || "this token"}</h2><span>ON-CHAIN IDENTITY</span></div><p className="small" style={{ whiteSpace: "pre-wrap" }}>{info?.description || "This token is part of the Stolons ecosystem. Its ancestry and reproduction history are recorded on-chain."}</p>{info && <div className="social-links">{([['Website',info.website],['X',info.twitter],['Telegram',info.telegram]] as const).filter(([,url]) => url).map(([label,url]) => <a key={label} href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a>)}</div>}<p className="small" style={{ marginTop: 18, marginBottom: 0, fontSize: 10 }}>*Current supply includes market tokens and locked reserves.</p></article>
      <article className="card"><div className="panel-title"><h2>Family & reproduction</h2><span>GENERATION {lineage.generation}</span></div><div className="family-panel"><div><span className="label">Root family</span><Link href={`/token/${lineage.rootMint.toBase58()}`}>{shortAddress(lineage.rootMint.toBase58())} ↗</Link></div><div><span className="label">Parent token</span>{lineage.parentMint.equals(zero) ? <span className="small">This token is the root.</span> : <Link href={`/token/${lineage.parentMint.toBase58()}`}>{shortAddress(lineage.parentMint.toBase58())} ↗</Link>}</div><div><span className="label">Reproduction reserve</span><span>{reserve === null ? "Unavailable" : `${(Number(reserve) / 1e6).toLocaleString("en-US")} tokens`}</span></div><div><span className="label">Reserve status</span><span>{lineage.reproductionReserveClaimed ? "Activated" : "Locked until graduation"}</span></div></div><div className="notice">{active ? "This token can reproduce. Open a round to start selecting the family's next child." : "Reproduction unlocks after graduation and reserve activation. A successful selected child burns 10M tokens from the parent reserve."}</div><div className="actions"><Link className={`button ${active ? "primary" : ""}`} href={`/reproduce/${mintText}`}>{active ? "Start reproduction round ↗" : "View reproduction eligibility →"}</Link></div></article>
      <RecentTransactions mint={mintText} />
    </div><aside className="token-sidebar"><TradePanel mint={mintText} graduated={!!curve?.migrated || !lineage.cpmmPool.equals(zero)} /></aside></div>}
    <footer className="footer"><Link href="/">STOLONS / Discover</Link><span>Live on-chain data · Solana devnet</span></footer>
  </div></main>;
}
