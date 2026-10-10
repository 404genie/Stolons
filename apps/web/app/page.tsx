"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { Navigation } from "../components/nav";
import { GENESIS_SUPPLY, MARKET_ALLOCATION, REPRODUCTION_RESERVE, CHILD_BURN_ATOMS, MAX_DIRECT_CHILDREN } from "@stolons/sdk";

const tokenAmount = (amount: bigint) => (Number(amount) / 1_000_000).toLocaleString("en-US");

export default function HomePage() {
  const [mint, setMint] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  function openToken(event: FormEvent) {
    event.preventDefault();
    try {
      const key = new PublicKey(mint.trim());
      router.push(`/token/${key.toBase58()}`);
      setError("");
    } catch {
      setError("Enter a valid Solana mint address.");
    }
  }

  return (
    <main>
      <Navigation />
      <div className="shell">
        <section className="hero">
          <div className="eyebrow">An on-chain family tree for tokens</div>
          <h1>Memecoins that reproduce.</h1>
          <p>Each token trades on Raydium. When a selected child graduates, its parent permanently burns 10 million tokens and passes on a small share of its ancestral mass.</p>
          <div className="actions">
            <a className="button primary" href="#launch">Explore a token</a>
            <a className="button" href="#protocol">How Stolons works</a>
          </div>
          <form className="lookup" onSubmit={openToken}>
            <input aria-label="Token mint" placeholder="Paste a token mint address" value={mint} onChange={(event) => setMint(event.target.value)} />
            <button className="button" type="submit">Open</button>
          </form>
          {error && <p className="error">{error}</p>}
          <p className="small">The app defaults to Solana devnet. No token launch or trade is submitted from this page yet; launch construction uses the pinned Raydium SDK and atomic Stolons registration builder.</p>
        </section>

        <section className="section" id="protocol">
          <div className="section-head"><h2>One fixed mutation rule</h2><span className="pill">V1 · Solana</span></div>
          <div className="grid">
            <article className="card"><span className="label">Genesis supply</span><div className="metric">{tokenAmount(GENESIS_SUPPLY)}</div><p className="small">Six decimals. Standard SPL Token. Mint and freeze authorities are revoked.</p></article>
            <article className="card"><span className="label">Market / reproduction</span><div className="metric">85% / 15%</div><p className="small">{tokenAmount(MARKET_ALLOCATION)} tokens go through Raydium; {tokenAmount(REPRODUCTION_RESERVE)} are locked for offspring.</p></article>
            <article className="card"><span className="label">A successful child</span><div className="metric">{tokenAmount(CHILD_BURN_ATOMS)}</div><p className="small">The parent reserve burns this amount exactly. A token can have up to {MAX_DIRECT_CHILDREN} direct children.</p></article>
          </div>
        </section>

        <section className="section" id="launch">
          <div className="section-head"><h2>Find a family</h2></div>
          <div className="card">
            <h3>Inspect a Stolons token</h3>
            <p className="small">Enter its mint address to read the on-chain lineage PDA from the configured devnet program.</p>
            <form className="lookup" onSubmit={openToken}>
              <input aria-label="Token mint" placeholder="Mint address" value={mint} onChange={(event) => setMint(event.target.value)} />
              <button className="button primary" type="submit">View token</button>
            </form>
            {error && <p className="error">{error}</p>}
          </div>
          <div className="notice" style={{ marginTop: 14 }}>Ancestry changes only after Raydium CPMM migration is verified, the 150M reserve is claimed, and the parent burn succeeds. Raydium remains responsible for launch and trading.</div>
        </section>
        <footer className="footer"><span>Stolons · devnet first</span><span>Protocol code is under review before live testing.</span></footer>
      </div>
    </main>
  );
}
