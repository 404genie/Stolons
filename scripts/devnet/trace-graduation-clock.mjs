// Read-only history inspection of an existing graduated pool. No signer required.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Connection,PublicKey} from '@solana/web3.js';
import {assertCluster,raydiumPrograms} from '../../sdk/dist/network.js';
import {readRetryFetch} from '../../services/keeper/rpc.mjs';
const {getPdaLaunchpadPoolId,LaunchpadPool}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
export function launchInstructions(logs,program){
 const stack=[],kinds=new Set();
 for(const line of logs||[]){
  const invoke=line.match(/^Program (\S+) invoke \[(\d+)\]$/);
  if(invoke){stack.length=Number(invoke[2])-1;stack.push(invoke[1]);continue;}
  if(/^Program \S+ (success|failed:)/.test(line)){stack.pop();continue;}
  if(stack.at(-1)!==program)continue;
  if(/^Program log: Instruction: BuyExact(In|Out)$/.test(line))kinds.add('buy');
  if(/^Program log: Instruction: MigrateTo(Cpswap|CpSwap|Cpmm|Amm)$/i.test(line))kinds.add('migration');
 }
 return [...kinds];
}
export function timestampComparison(start,finalBuy,migration){
 if(!finalBuy||!migration||finalBuy.blockTime===null||migration.blockTime===null)return 'inconclusive-history';
 if(finalBuy.blockTime===migration.blockTime)return 'inconclusive-same-second';
 if(start===migration.blockTime)return 'final-stored-timestamp-matches-migration';
 if(start===finalBuy.blockTime)return 'final-stored-timestamp-matches-final-buy';
 return 'inconclusive-timestamp-differs';
}
async function main(){
 const mint=new PublicKey(process.argv[2]||'GKQWxEXuhPCKH4awCBJ4gb2QSiS2xEUcDxyFAwVTfrg6');
 const connection=new Connection(process.env.TRACE_RPC_URL||'https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()});
 await assertCluster(connection,'devnet');
 const program=raydiumPrograms('devnet').LAUNCHPAD_PROGRAM,quote=new PublicKey('So11111111111111111111111111111111111111112');
 const pool=getPdaLaunchpadPoolId(program,mint,quote).publicKey;
 const account=await connection.getAccountInfo(pool,'confirmed');
 if(!account?.owner.equals(program))throw Error('Pool unavailable.');
 const state=LaunchpadPool.decode(account.data);
 if(!state.mintA.equals(mint)||!state.mintB.equals(quote)||state.status!==2||!state.vestingSchedule.cliffPeriod.isZero())throw Error('Expected an already migrated pool with zero cliff.');
 const history=await connection.getSignaturesForAddress(pool,{limit:100},'confirmed');
 const rows=[];let missing=0;
 for(const entry of history){
  if(entry.err)continue;
  const transaction=await connection.getTransaction(entry.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
  if(!transaction){missing++;continue;}if(transaction.meta?.err)continue;
  for(const kind of launchInstructions(transaction.meta?.logMessages,program.toBase58()))rows.push({kind,signature:entry.signature,slot:entry.slot,blockTime:transaction.blockTime??null});
  // Latest-first scan ends once it has the migration and an earlier curve buy.
  if(rows.some(x=>x.kind==='migration')&&rows.some(x=>x.kind==='buy'&&x.slot<=rows.find(y=>y.kind==='migration').slot))break;
  await new Promise(resolve=>setTimeout(resolve,400));
 }
 const migration=rows.find(x=>x.kind==='migration'),finalBuy=rows.find(x=>x.kind==='buy'&&(!migration||x.slot<=migration.slot));
 const start=Number(state.vestingSchedule.startTime.toString());
 console.log(JSON.stringify({cluster:'devnet',mint:mint.toBase58(),pool:pool.toBase58(),status:state.status,vestingStartTime:start,finalBuy:finalBuy??null,migration:migration??null,comparison:timestampComparison(start,finalBuy,migration),missingTransactions:missing,historyLimitedTo100:true,provesStatus1Timestamp:false,limitation:'A final account snapshot cannot prove whether status-1 start_time was zero, nonzero, or subsequently overwritten. This trace alone does not close finding 2.',transactionsSent:0},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Read-only trace failed. Check RPC availability/history privately; do not rerun a launch or submit a transaction.');process.exitCode=1;});
