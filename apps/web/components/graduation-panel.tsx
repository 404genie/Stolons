"use client";
import {SOLANA_CLUSTER,IS_MAINNET,EXPLORER_QUERY} from "../lib/network";
import { useEffect,useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection,useWallet } from '@solana/wallet-adapter-react';
import type { GraduationPhase } from '@stolons/sdk/devnet-graduation';
import { STOLONS_PROGRAM_ID,DEVNET_LAUNCH_LOOKUP_TABLE } from '../lib/devnet';
const labels:Record<GraduationPhase,string>={trading:'Bonding curve in progress',migrating:'Waiting for Raydium migration',register:'Register migrated pool',claim:'Activate reproduction reserve',activate:'Finalize family activation',active:'Family is active'};
export function GraduationPanel({mint,onUpdated}:{mint:string;onUpdated:()=>void}) {
 const {connection}=useConnection(),wallet=useWallet();
 const [phase,setPhase]=useState<GraduationPhase|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[signature,setSignature]=useState(''),[uncertain,setUncertain]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let cancelled=false;setError('');(async()=>{try{const api=await import('@stolons/sdk/devnet-graduation');const state=await api.readGraduation(connection,new PublicKey(STOLONS_PROGRAM_ID),new PublicKey(mint),SOLANA_CLUSTER);if(!cancelled)setPhase(state.phase);}catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:'Could not read graduation.');}})();return()=>{cancelled=true};},[connection,mint,refresh]);
 useEffect(()=>{if(phase==='active')return;const timer=setInterval(()=>setRefresh(value=>value+1),15000);return()=>clearInterval(timer);},[phase]);
 async function activate(){if(IS_MAINNET)return;if(!wallet.publicKey||!wallet.signTransaction)return;setBusy(true);setError('');setMessage('Preparing the next activation step…');try{
  const [api,trade]=await Promise.all([import('@stolons/sdk/devnet-graduation'),import('@stolons/sdk/devnet-trade')]);
  const prepared=await api.buildGraduationStep(connection,new PublicKey(STOLONS_PROGRAM_ID),new PublicKey(mint),wallet.publicKey,new PublicKey(DEVNET_LAUNCH_LOOKUP_TABLE),SOLANA_CLUSTER);
  setMessage(`${labels[prepared.phase]}: approve this step in your wallet.`);
  try {const tx=await trade.sendDevnetTrade(connection,prepared,tx=>wallet.signTransaction!(tx));setSignature(tx);setMessage('Step confirmed. Refreshing the family state…');setRefresh(value=>value+1);onUpdated();}
  catch(cause){if(cause instanceof trade.TradeSubmittedError){setSignature(cause.signature);setUncertain(true);}throw cause;}
 }catch(cause){setMessage('');setError(cause instanceof Error?cause.message:'Activation failed.');}finally{setBusy(false);}}
 if(phase==='trading')return null;
 return <article className="card"><div className="panel-title"><h2>Graduation & activation</h2><span>{phase==='active'?'COMPLETE':'NEXT STAGE'}</span></div><p className="small">{phase?labels[phase]:'Checking migration status…'}</p><div className="notice">{phase==='migrating'?'The curve is complete. Raydium migrates liquidity automatically; this page checks every 15 seconds. There is no additional buy required.':phase==='active'?'The migrated pool is registered and the reproduction reserve is active. Trading continues in Raydium CPMM.':IS_MAINNET?'The keeper activates graduated tokens automatically. This page refreshes as registration, reserve claim and family activation finish.':'Complete the remaining steps one at a time: register the migrated pool, claim the 150M reserve, and activate the family. Your wallet pays transaction fees and reserve-account rent. Child finalization also burns 10M parent tokens.'}</div>{!IS_MAINNET&&phase&&['register','claim','activate'].includes(phase)&&<div className="actions"><button className="button primary" disabled={busy||uncertain||!wallet.signTransaction} onClick={activate}>{busy?'Processing…':labels[phase]+' ↗'}</button></div>}
 <div className="actions"><button className="button compact" disabled={busy} onClick={()=>{setError('');setRefresh(value=>value+1);onUpdated();}}>↻ Refresh status</button>{signature&&<a className="text-link" href={`https://explorer.solana.com/tx/${signature}${EXPLORER_QUERY}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}</div>{message&&<p className="small" role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}{uncertain&&<button className="button" onClick={()=>{setUncertain(false);setRefresh(value=>value+1);}}>I checked the transaction; refresh state</button>}
 </article>;
}
