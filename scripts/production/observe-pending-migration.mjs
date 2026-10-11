// Bounded read-only observation of canonical mainnet pools. No keys or transactions.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Connection,PublicKey} from '@solana/web3.js';
import {assertCluster,raydiumPrograms} from '../../sdk/dist/network.js';
import {decodeLaunchPool} from '../../sdk/dist/raydium-layout.js';
import {readRetryFetch} from '../../services/keeper/rpc.mjs';
const {getPdaLaunchpadPoolId}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
const quote=new PublicKey('So11111111111111111111111111111111111111112');
export function pendingSnapshot(address,account,ids){
 if(!account.owner.equals(ids.LAUNCHPAD_PROGRAM))return null;
 const p=decodeLaunchPool(account.data);
 if(p.status!==1||p.migrateType!==1||p.baseDecimals!==6||p.quoteDecimals!==9||p.cliff!==0n||p.unlock!==0n||p.locked===0n||p.vestingStart===0n)return null;
 const mint=new PublicKey(p.baseMint);
 if(!new PublicKey(p.config).equals(ids.LAUNCHPAD_CONFIG)||!new PublicKey(p.quoteMint).equals(quote))return null;
 if(!getPdaLaunchpadPoolId(ids.LAUNCHPAD_PROGRAM,mint,quote).publicKey.equals(address))return null;
 return {mint:mint.toBase58(),pool:address.toBase58(),status:p.status,lockedAtoms:p.locked.toString(),cliffSeconds:p.cliff.toString(),unlockSeconds:p.unlock.toString(),vestingStartTime:p.vestingStart.toString(),accountSha256:createHash('sha256').update(account.data).digest('hex'),accountDataBase64:account.data.toString('base64')};
}
async function main(){
 const connection=new Connection(process.env.OBSERVATION_RPC_URL||process.env.MAINNET_RPC_URL||'https://api.mainnet-beta.solana.com',{commitment:'finalized',disableRetryOnRateLimit:true,fetch:readRetryFetch()});
 await assertCluster(connection,'mainnet-beta');
 const ids=raydiumPrograms('mainnet-beta'),until=Date.now()+300000;
 console.log('Observing finalized mainnet status-1 pools for up to five minutes. No keys, buys or deployments.');
 let lastNotice=Date.now();
 while(Date.now()<until){
  const result=await connection.getProgramAccounts(ids.LAUNCHPAD_PROGRAM,{commitment:'finalized',withContext:true,filters:[{memcmp:{offset:17,bytes:'2'}},{memcmp:{offset:141,bytes:ids.LAUNCHPAD_CONFIG.toBase58()}},{memcmp:{offset:237,bytes:quote.toBase58()}},{memcmp:{offset:109,bytes:'11111111'}},{memcmp:{offset:117,bytes:'11111111'}}]});
  for(const row of result.value){
   let sample;try{sample=pendingSnapshot(row.pubkey,row.account,ids);}catch{continue;}
   if(!sample)continue;
   const blockTime=await connection.getBlockTime(result.context.slot);
   if(blockTime===null||BigInt(sample.vestingStartTime)>BigInt(blockTime))continue;
   const evidence={cluster:'mainnet-beta',programId:ids.LAUNCHPAD_PROGRAM.toBase58(),commitment:'finalized',observedSlot:result.context.slot,observedBlockTime:blockTime,...sample,status1TimestampObserved:true,conclusion:'A positive vesting start_time is present in a finalized status-1 pool before migration, with locked tokens and zero cliff/unlock.',limitation:'This observes one canonical pool and current deployment behavior; it is not a runtime test of Stolons expire_candidate or proof about every historical/future Raydium upgrade.',transactionsSent:0};
   await mkdir('target/mainnet',{recursive:true});
   const path=`target/mainnet/status1-clock-${result.context.slot}.json`;
   await writeFile(path,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
   console.log(JSON.stringify({...evidence,evidenceFile:path},null,2));return;
  }
  if(Date.now()-lastNotice>=60000){console.log('No qualifying intermediate snapshot yet; observation remains read-only and will stop at its deadline.');lastNotice=Date.now();}
  await new Promise(resolve=>setTimeout(resolve,Math.min(5000,Math.max(0,until-Date.now()))));
 }
 console.log(JSON.stringify({status:'inconclusive-no-snapshot',status1TimestampObserved:false,transactionsSent:0,releaseApproved:false},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Read-only observation stopped: RPC scan/history unavailable or evidence file could not be saved. Set a dedicated OBSERVATION_RPC_URL privately; no transaction was sent.');process.exitCode=1;});
