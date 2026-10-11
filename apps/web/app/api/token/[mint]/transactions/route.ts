import {RPC_ENDPOINT,SOLANA_CLUSTER} from "../../../../../lib/network";
import {Connection,PublicKey} from '@solana/web3.js';
import {readGraduation} from '@stolons/sdk/devnet-graduation';
import {STOLONS_PROGRAM_ID} from '../../../../../lib/devnet';
import {readRecentTransactions} from '../../../../../lib/recent-transactions';
export const runtime='nodejs';
export const maxDuration=30;
const cache=new Map<string,{expires:number;value:unknown}>();
export async function GET(_request:Request,context:{params:Promise<{mint:string}>}) {
 try {
  const {mint}=await context.params;const key=new PublicKey(mint).toBase58(),hit=cache.get(key);
  if(hit&&hit.expires>Date.now())return Response.json(hit.value,{headers:{'Cache-Control':'no-store'}});
  const cluster=SOLANA_CLUSTER;
  const deadline=AbortSignal.timeout(20000);
  const connection=new Connection(RPC_ENDPOINT,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.any([deadline,AbortSignal.timeout(8000)])})});
  const state=await readGraduation(connection,new PublicKey(STOLONS_PROGRAM_ID),new PublicKey(key),cluster);
  const transactions=await readRecentTransactions(connection,state.lineage.launchPool,state.pool.status===2?state.cpmmPool:undefined);
  const value={transactions,cluster,asOf:Date.now()};if(cache.size>2000)cache.clear();cache.set(key,{value,expires:Date.now()+15000});
  return Response.json(value,{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Recent transactions are temporarily unavailable.'},{status:503});}
}
