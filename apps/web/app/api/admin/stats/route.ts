import {Connection,PublicKey} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {verifiedParticipantCount} from '../../../../lib/token-storage';
import {requireAdmin} from '../../../../lib/admin-auth';
import {RPC_ENDPOINT,PROGRAM_ID,SOLANA_CLUSTER} from '../../../../lib/network';
export const runtime='nodejs';export const maxDuration=30;
let cache:{expires:number,value:unknown}|null=null;
export async function GET(request:Request){
 if(process.env.ADMIN_BACKEND_URL){
  const headers:Record<string,string>={};for(const key of ['x-admin-wallet','x-admin-origin','x-admin-timestamp','x-admin-signature'])headers[key]=request.headers.get(key)||'';
  const target=new URL('/api/admin/stats',process.env.ADMIN_BACKEND_URL);if(target.protocol!=='https:')return Response.json({error:'Admin backend unavailable.'},{status:503});
  try{const response=await fetch(target,{headers,signal:AbortSignal.timeout(25000),redirect:'error'});return new Response(await response.arrayBuffer(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}catch{return Response.json({error:'Stats temporarily unavailable.'},{status:503});}
 }
 try{requireAdmin(request,process.env.ADMIN_WALLET_PUBLIC_KEY);}catch{return Response.json({error:'Sign with the configured admin wallet to access stats.'},{status:403});}
 if(cache&&cache.expires>Date.now())return Response.json(cache.value,{headers:{'Cache-Control':'no-store'}});
 try{
  const connection=new Connection(RPC_ENDPOINT,{commitment:'confirmed',disableRetryOnRateLimit:true});
  const accounts=await connection.getProgramAccounts(new PublicKey(PROGRAM_ID),{commitment:'confirmed'});
  const disc=(name:string)=>createHash('sha256').update('account:'+name).digest().subarray(0,8);
  const lineage=disc('Lineage'),epoch=disc('Epoch'),candidate=disc('Candidate'),vote=disc('VoteReceipt');
  const users=new Set<string>(),counts={tokensLaunched:0,roots:0,offspring:0,graduated:0,orphaned:0,rounds:0,openRounds:0,proposals:0,currentVoteReceipts:0};
  for(const {account}of accounts){const b=account.data;if(b.subarray(0,8).equals(lineage)&&b.length>=138){counts.tokensLaunched++;const parent=new PublicKey(b.subarray(72,104));if(parent.equals(PublicKey.default))counts.roots++;else counts.offspring++;if([1,2,4,5].includes(b[137]))counts.graduated++;if(b[137]===6)counts.orphaned++;users.add(new PublicKey(b.subarray(104,136)).toBase58());}
   else if(b.subarray(0,8).equals(epoch)&&b.length>=92){counts.rounds++;if(b[90]===0)counts.openRounds++;}
   else if(b.subarray(0,8).equals(candidate)&&b.length>=168){counts.proposals++;users.add(new PublicKey(b.subarray(136,168)).toBase58());}
   else if(b.subarray(0,8).equals(vote)&&b.length>=40){counts.currentVoteReceipts++;users.add(new PublicKey(b.subarray(8,40)).toBase58());}
  }
  const signedUploadParticipants=await verifiedParticipantCount();
  const value={signedUploadParticipants,cluster:SOLANA_CLUSTER,programId:PROGRAM_ID,asOf:new Date().toISOString(),uniqueObservedWallets:users.size,...counts,note:'Signed-upload participants are unique verified upload wallets recorded by this beta backend; older uploads are not included. On-chain wallet count includes creators, proposers and voters in current on-chain accounts. It is not website visitors, sign-ups, or a complete historical user count. Closed vote receipts are absent. Graduation count reflects currently qualified/active lineage states.'};cache={expires:Date.now()+60000,value};return Response.json(value,{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'On-chain stats temporarily unavailable. Try again shortly.'},{status:503});}
}
