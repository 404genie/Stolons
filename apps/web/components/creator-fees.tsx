"use client";
import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SOLANA_CLUSTER, TRANSACTIONS_ENABLED, EXPLORER_QUERY } from '../lib/network';
import { STOLONS_PROGRAM_ID, DEVNET_LAUNCH_LOOKUP_TABLE } from '../lib/devnet';
export function CreatorFees({mint,creator}:{mint:string;creator:string}) {
 const {connection}=useConnection(),wallet=useWallet();
 const [pending,setPending]=useState<{curve:bigint;cpmm:bigint}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[signature,setSignature]=useState(''),[uncertain,setUncertain]=useState(false),[refresh,setRefresh]=useState(0);
 const [readError,setReadError]=useState('');
 useEffect(()=>{setPending(null);setError('');setReadError('');setMessage('');setSignature('');setUncertain(false);},[mint,creator]);
 const isCreator=wallet.publicKey?.toBase58()===creator;
 useEffect(()=>{if(!isCreator)return;let cancelled=false;
  (async()=>{try{const api=await import('@stolons/sdk/fees');const fees=await api.readPendingFees(connection,{programId:new PublicKey(STOLONS_PROGRAM_ID),mint:new PublicKey(mint),payer:new PublicKey(creator),cluster:SOLANA_CLUSTER});if(!cancelled){setPending(fees);setReadError('');}}catch(cause){if(!cancelled)setReadError(cause instanceof Error?cause.message:'Could not read fees.');}})();
  return()=>{cancelled=true};
 },[connection,mint,creator,isCreator,refresh]);
 useEffect(()=>{if(!isCreator)return;const timer=setInterval(()=>setRefresh(v=>v+1),15000);return()=>clearInterval(timer);},[isCreator]);
 async function claim(){if(!TRANSACTIONS_ENABLED||!wallet.publicKey||!wallet.signTransaction||!isCreator||uncertain)return;
  setBusy(true);setError('');setMessage('Checking accrued fees…');
  try{const [fees,trade]=await Promise.all([import('@stolons/sdk/fees'),import('@stolons/sdk/devnet-trade')]);
   const input={programId:new PublicKey(STOLONS_PROGRAM_ID),mint:new PublicKey(mint),payer:wallet.publicKey,cluster:SOLANA_CLUSTER,lookupTable:new PublicKey(DEVNET_LAUNCH_LOOKUP_TABLE)};
   const current=await fees.readPendingFees(connection,input);let count=0;
   for(const kind of ['curve','cpmm'] as const){if(current[kind]===0n)continue;
    setMessage(kind==='curve'?'Approve your curve fee claim.':'Approve the shared pool fee collection.');
    const prepared=await (kind==='curve'?fees.buildCurveCreatorFeeClaim:fees.buildSharedCpmmFeeCollection)(connection,input);
    try{const sig=await trade.sendDevnetTrade(connection,prepared,tx=>wallet.signTransaction!(tx));setSignature(sig);count++;}
    catch(cause){if(cause instanceof trade.TradeSubmittedError){setSignature(cause.signature);setUncertain(true);}throw cause;}
   }
   setMessage(count?'Fees collected to the creator and treasury wallets. SOL fees arrive as wrapped SOL.':'No fees are currently available.');
  }catch(cause){setMessage('');setError(cause instanceof Error?cause.message:'Fee collection failed.');}
  finally{setBusy(false);setRefresh(v=>v+1);}
 }
 if(!isCreator)return null;
 const available=pending&&(pending.curve>0n||pending.cpmm>0n);
 return <article className="card"><div className="panel-title"><h2>Creator fees</h2><span>YOUR TOKEN</span></div>
  <p className="small">Collection pays your wallet directly. The fee keeper can collect for you; you can also claim here. Curve creator fees go to you, and net pool creator fees are split equally with Stolons.</p>
  <p className="small">{pending?(available?'Fees are available to collect.':'No uncollected fees.'): 'Checking accrued fees…'}</p>
  <p className="small">Your wallet pays transaction fees and any required token-account rent when claiming.</p>
  <div className="actions"><button className="button primary" disabled={busy||uncertain||!available||!TRANSACTIONS_ENABLED||!wallet.signTransaction} onClick={claim}>{busy?'Collecting…':'Claim creator fees'}</button><button className="button compact" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh fees</button></div>
  {signature&&<a className="text-link" href={`https://explorer.solana.com/tx/${signature}${EXPLORER_QUERY}`} target="_blank" rel="noopener noreferrer">View collection transaction ↗</a>}
  {readError&&<p className="error" role="alert">{readError}</p>}
  {message&&<p className="small" role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  {uncertain&&<p className="notice">Confirmation is uncertain. Inspect the linked transaction before collecting again.</p>}
 </article>;
}
