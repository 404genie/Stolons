"use client";
import { SOLANA_CLUSTER } from "../lib/network";
import { useEffect, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import type { GraduationPhase } from '@stolons/sdk/devnet-graduation';
import { STOLONS_PROGRAM_ID } from '../lib/devnet';
const labels: Record<GraduationPhase, string> = {
 trading: 'Bonding curve in progress', migrating: 'Waiting for Raydium migration',
 register: 'Registering migrated pool', claim: 'Activating reproduction reserve',
 activate: 'Finalizing family activation', active: 'Family is active',
};
export function GraduationPanel({ mint, onUpdated }: { mint: string; onUpdated: () => void }) {
 const { connection } = useConnection();
 const [phase, setPhase] = useState<GraduationPhase | null>(null);
 const [error, setError] = useState('');
 const [refresh, setRefresh] = useState(0);
 const previous = useRef<GraduationPhase | null>(null);
 const updated = useRef(onUpdated);
 useEffect(() => { updated.current = onUpdated; }, [onUpdated]);
 useEffect(() => { previous.current = null; setPhase(null); setError(''); }, [mint]);
 useEffect(() => {
  let cancelled = false;
  (async () => {
   try {
    const api = await import('@stolons/sdk/devnet-graduation');
    const state = await api.readGraduation(connection, new PublicKey(STOLONS_PROGRAM_ID), new PublicKey(mint), SOLANA_CLUSTER);
    if (cancelled) return;
    const changed = previous.current !== null && previous.current !== state.phase;
    previous.current = state.phase;
    setPhase(state.phase); setError('');
    if (changed) updated.current();
   } catch (cause) {
    if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not read graduation.');
   }
  })();
  return () => { cancelled = true; };
 }, [connection, mint, refresh]);
 useEffect(() => {
  if (phase === 'active') return;
  const timer = setInterval(() => setRefresh(value => value + 1), 15000);
  return () => clearInterval(timer);
 }, [phase]);
 if (phase === 'trading') return null;
 return <article className="card">
  <div className="panel-title"><h2>Graduation & activation</h2><span>{phase === 'active' ? 'COMPLETE' : 'AUTOMATIC'}</span></div>
  <p className="small" role="status">{phase ? labels[phase] : 'Checking migration status…'}</p>
  <div className="notice">{phase === 'migrating'
   ? 'The curve is complete. Raydium migrates liquidity automatically. This page checks every 15 seconds.'
   : phase === 'active'
   ? 'The migrated pool is registered and the reproduction reserve is active. Trading continues in Raydium CPMM.'
   : 'The keeper registers the migrated pool, claims the reproduction reserve and activates the family automatically. No wallet approval is needed. This page checks every 15 seconds.'}</div>
  <div className="actions"><button className="button compact" onClick={() => { setRefresh(value => value + 1); updated.current(); }}>↻ Refresh status</button></div>
  {error && <p className="error" role="alert">Status refresh failed: {error}</p>}
 </article>;
}
