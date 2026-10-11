import { Connection,PublicKey } from '@solana/web3.js';
import { readCpmmStats } from '@stolons/sdk/devnet-trade';
import { STOLONS_PROGRAM_ID } from '../../../../../lib/devnet';
import { readHourVolume } from '../../../../../lib/market-volume';
export const runtime='nodejs';
export const maxDuration=30;
const cache=new Map<string,{expires:number;value:unknown}>();
export async function GET(_request:Request,context:{params:Promise<{mint:string}>}) {
 try {
  const {mint}=await context.params,key=new PublicKey(mint).toBase58();
  const hit=cache.get(key);if(hit&&hit.expires>Date.now())return Response.json(hit.value);
  const deadline=AbortSignal.timeout(20000);
  const connection=new Connection(process.env.NEXT_PUBLIC_RPC_URL||'https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.any([deadline,AbortSignal.timeout(8000)])})});
  const stats=await readCpmmStats(connection,new PublicKey(STOLONS_PROGRAM_ID),new PublicKey(key));
  if(!stats)return Response.json({available:false});
  let volume1hSol:number|null=null;
  try{volume1hSol=await readHourVolume(connection,stats.pool,stats.program,stats.quoteVault);}catch{/* History may be rate-limited or unavailable. */}
  const value={available:true,...stats,volume1hSol,asOf:Date.now()};
  if(cache.size>2000)cache.clear();cache.set(key,{expires:Date.now()+30000,value});
  return Response.json(value,{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({available:false,error:'Market data is temporarily unavailable.'},{status:503});}
}
