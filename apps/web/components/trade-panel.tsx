"use client";
import {SOLANA_CLUSTER,NETWORK_LABEL,EXPLORER_QUERY,TRANSACTIONS_ENABLED,requireTransactions} from "../lib/network";

import { useEffect, useState, type FormEvent } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { TradeQuote, TradeSide } from "@stolons/sdk/devnet-trade";
import { STOLONS_PROGRAM_ID } from "../lib/devnet";

export function TradePanel({ mint, graduated }: { mint: string; graduated: boolean }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const walletAddress = wallet.publicKey?.toBase58() ?? "";
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [outputText, setOutputText] = useState("");
  const [minimumText, setMinimumText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceText, setBalanceText] = useState("");
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const [spendText, setSpendText] = useState("");
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => { setQuote(null); setError(""); }, [amount, side, slippage, walletAddress, mint]);
  useEffect(() => { setSignature(""); setUncertain(false); setMessage(""); }, [mint]);

  useEffect(() => {
    let cancelled = false; setBalance(null); setBalanceText('');
    if (!walletAddress) return;
    (async () => { try {
      const api = await import('@stolons/sdk/devnet-trade');
      const value = await api.readTradeBalance(connection, new PublicKey(mint), new PublicKey(walletAddress));
      if (!cancelled) { setBalance(value); setBalanceText(api.formatTradeAmount(value, 6)); }
    } catch { /* Unavailable balances disable shortcuts; manual sells are rechecked. */ } })();
    return () => { cancelled = true; };
  }, [connection, mint, walletAddress, balanceRefresh]);
  async function quickSell(percent: number) {
    if (!walletAddress) return;
    setBusy(true); setError('');
    try {
      const api = await import('@stolons/sdk/devnet-trade');
      const current = await api.readTradeBalance(connection, new PublicKey(mint), new PublicKey(walletAddress));
      const value = api.sellPercentage(current, percent);
      if (!value) throw new Error('No tokens available for this sell amount.');
      setBalance(current); setBalanceText(api.formatTradeAmount(current, 6)); setAmount(api.formatTradeAmount(value, 6)); setQuote(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read your balance.'); }
    finally { setBusy(false); }
  }

  async function preview(event: FormEvent) {
    event.preventDefault();
    try{requireTransactions();}catch(cause){setError((cause as Error).message);return;}
    if (!wallet.publicKey) { setError("Connect your wallet first."); return; }
    setBusy(true); setError(""); setQuote(null); setMessage("Calculating your quote and simulating the trade…");
    try {
      const api = await import("@stolons/sdk/devnet-trade");
      const slippageBps = Number(slippage) * 100;
      const next = await api.quoteDevnetTrade(connection, { programId: new PublicKey(STOLONS_PROGRAM_ID), mint: new PublicKey(mint), owner: wallet.publicKey, side, amount: api.parseTradeAmount(amount, side === "buy" ? 9 : 6), slippageBps,cluster:SOLANA_CLUSTER });
      const prepared = await api.buildDevnetTrade(connection, next);
      await api.simulateDevnetTrade(connection, prepared);
      setOutputText(api.formatTradeAmount(next.output, side === "buy" ? 6 : 9));
      setMinimumText(api.formatTradeAmount(next.minimum, side === "buy" ? 6 : 9));
      setSpendText(api.formatTradeAmount(next.input.amount, 9));
      setQuote(next); setMessage("Simulation passed. Review the minimum received, then confirm within 60 seconds.");
    } catch (cause) { setMessage(""); setError(cause instanceof Error ? cause.message : "Could not preview this trade."); }
    finally { setBusy(false); }
  }

  async function trade() {
    try{requireTransactions();}catch(cause){setError((cause as Error).message);return;}
    if (!quote || !wallet.publicKey || !wallet.signTransaction || !quote.input.owner.equals(wallet.publicKey) || quote.input.mint.toBase58() !== mint) { setQuote(null); setError("Wallet or token changed. Preview again."); return; }
    setBusy(true); setError(""); setMessage("Rechecking the price before wallet approval…");
    try {
      const api = await import("@stolons/sdk/devnet-trade");
      const prepared = await api.buildDevnetTrade(connection, quote);
      const tx = await api.sendDevnetTrade(connection, prepared, tx => wallet.signTransaction!(tx));
      setSignature(tx); setQuote(null); setAmount(""); setBalanceRefresh(value => value + 1); setMessage(`Trade confirmed on ${NETWORK_LABEL}.`);
    } catch (cause) {
      setQuote(null); setMessage("");
      const api = await import("@stolons/sdk/devnet-trade");
      if (cause instanceof api.TradeSubmittedError) { setSignature(cause.signature); setUncertain(true); }
      setError(cause instanceof Error ? cause.message : "Could not complete this trade.");
    } finally { setBusy(false); }
  }

  return <section className="card launch-form trade-panel" aria-labelledby="trade-heading">
    {!TRANSACTIONS_ENABLED&&<p className="notice">Mainnet trading is not open yet.</p>}<div className="panel-title"><h2 id="trade-heading">Trade</h2><span>{NETWORK_LABEL.toUpperCase()}</span></div>
    <p className="small">{graduated ? 'Raydium CPMM.' : 'Raydium bonding curve.'} Quotes include trading fees. Network fees and account rent are additional.</p>
    <>
      <form onSubmit={preview}>
        <fieldset disabled={busy || uncertain || !TRANSACTIONS_ENABLED}>
          <div className="actions" role="group" aria-label="Trade direction">
            <button className={`button ${side === "buy" ? "primary" : ""}`} type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
            <button className={`button ${side === "sell" ? "primary" : ""}`} type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
          </div>
          <label className="label" htmlFor="trade-amount">{side === "buy" ? "SOL to spend" : "Tokens to sell"}</label>
          <input id="trade-amount" inputMode="decimal" placeholder={side === "buy" ? "0.01" : "1000"} value={amount} onChange={event => setAmount(event.target.value)} required />
          {side === "sell" && <><p className="small">Balance: {balance === null ? "Unavailable" : `${balanceText} tokens`}</p><div className="actions" role="group" aria-label="Sell percentage">{[25, 50, 100].map(percent => <button key={percent} className="button compact" type="button" disabled={balance === null || balance === 0n} onClick={() => quickSell(percent)}>{percent}%</button>)}</div></>}
          <label className="label" htmlFor="trade-slippage">Slippage (%)</label>
          <input id="trade-slippage" inputMode="decimal" value={slippage} onChange={event => setSlippage(event.target.value)} required />
          <button className="button primary" type="submit" disabled={!wallet.publicKey}>{busy ? "Checking…" : "Preview trade →"}</button>
        </fieldset>
      </form>
      {quote && quote.input.owner.toBase58() === walletAddress && quote.input.mint.toBase58() === mint && <div className="notice">
        {quote.input.side === "buy" && <p>SOL spend: {spendText}{quote.capped ? " · Limited to the remaining curve allocation. Excess SOL stays in your wallet." : ""}</p>}
        <p>Estimated received: {outputText} {side === "buy" ? "tokens" : "SOL"}</p>
        <p>Minimum received: {minimumText} {side === "buy" ? "tokens" : "SOL"}</p>
        <button className="button primary" type="button" disabled={busy || !wallet.signTransaction || !TRANSACTIONS_ENABLED} onClick={trade}>Confirm {side} ↗</button>
      </div>}
    </>
    {message && <p className="small" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {signature && <p><a href={`https://explorer.solana.com/tx/${signature}${EXPLORER_QUERY}`} target="_blank" rel="noopener noreferrer">View transaction</a></p>}
    {uncertain && <button type="button" className="button" onClick={() => { setUncertain(false); setError(""); }}>I checked the transaction; start a new trade</button>}
  </section>;
}
