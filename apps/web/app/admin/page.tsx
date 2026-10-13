'use client';
import {useState} from 'react';
import {useWallet} from '@solana/wallet-adapter-react';
import {Navigation} from '../../components/nav';
import {Footer} from '../../components/footer';
export default function Admin(){
 const wallet=useWallet(),[stats,setStats]=useState<Record<string,unknown>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){if(!wallet.publicKey||!wallet.signMessage){setError('Connect the admin wallet with message signing.');return;}setBusy(true);setError('');try{
  const address=wallet.publicKey.toBase58(),origin=window.location.origin,timestamp=Date.now();
  const message=`Stolons admin stats\nWallet: ${address}\nOrigin: ${origin}\nTimestamp: ${timestamp}\nRead-only dashboard access. No transaction or token approval.`;
  const signature=await wallet.signMessage(new TextEncoder().encode(message));
  const response=await fetch('/api/admin/stats',{headers:{'x-admin-wallet':address,'x-admin-origin':origin,'x-admin-timestamp':String(timestamp),'x-admin-signature':btoa(String.fromCharCode(...signature))}});const value=await response.json();if(!response.ok)throw Error(value.error);setStats(value);
 }catch(cause){setStats(null);setError(cause instanceof Error?cause.message:'Could not load stats.');}finally{setBusy(false);}}
 const metrics:[string,string][]=[['signedUploadParticipants','Verified upload participants'],['uniqueObservedWallets','Unique on-chain wallets'],['tokensLaunched','Tokens launched'],['roots','Root tokens'],['offspring','Offspring tokens'],['graduated','Qualified / active tokens'],['orphaned','Orphaned tokens'],['rounds','Reproduction rounds'],['openRounds','Open rounds'],['proposals','Child proposals'],['currentVoteReceipts','Current vote receipts']];
 return <><Navigation/><main className="shell" style={{paddingTop:48,paddingBottom:64}}><h1>Stolons admin</h1><p>Connect your configured admin wallet and sign a read-only message to view on-chain activity.</p><button className="button primary" disabled={busy||!wallet.publicKey} onClick={load}>{busy?'Loading…':'Authorize and refresh stats'}</button>{error&&<p role="alert">{error}</p>}{stats&&<><p>Network: {String(stats.cluster)} · Updated: {String(stats.asOf)}</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16,marginTop:24}}>{metrics.map(([key,label])=><article className="card" key={key}><p>{label}</p><h2>{stats[key]===null?'Unavailable':Number(stats[key]).toLocaleString()}</h2></article>)}</div><p className="small">{String(stats.note)}</p></>}</main><Footer/></>;
}
