// Resume an existing probe using reads and signed simulation only. Never broadcast.
import {readFile,writeFile} from 'node:fs/promises';
import {Connection,Keypair,PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {assertCluster,deriveConfigPda} from '../../sdk/dist/index.js';
import {decodeLaunchConfig} from '../../sdk/dist/launch-validation.js';
import {buildDevnetTrade,quoteDevnetTrade} from '../../sdk/dist/devnet-trade.js';
import {readRetryFetch} from '../../services/keeper/rpc.mjs';
import {clockEvidence} from './fundraising-clock-evidence.mjs';
import {launchInstructions} from './trace-graduation-clock.mjs';
if(process.argv.length!==2)throw Error('Use resume-fundraising-clock.mjs without flags.');
const path='target/devnet/fundraising-clock-test.json';
const report=JSON.parse(await readFile(path,'utf8'));
if(report.status==='passed'){console.log(JSON.stringify(report,null,2));process.exit(0);}
if(report.cluster!=='devnet'||report.status!=='failed'||report.failedStage!=='simulate completing buy'||report.completingBuySubmitted!==false||report.transactions.length!==2||report.transactions.some(t=>t.uncertain))throw Error('Resume requires two confirmed probe transactions and a simulation-stage failure.');
const program=new PublicKey('4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ');
const mint={publicKey:new PublicKey(report.mint)};
const creator=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(`keypairs/clock-creator-${report.mint}.json`,'utf8'))));
if(creator.publicKey.toBase58()!==report.creator)throw Error('Saved creator key does not match the probe.');
const connection=new Connection(process.env.CLOCK_TEST_RPC_URL||'https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()});
const save=()=>writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
let stage='verify existing launch';
console.log('Resuming existing token: RPC reads and signed simulation only. No funding, launch, or buy will be sent.');
try{
 await assertCluster(connection,'devnet');
 const statuses=await connection.getSignatureStatuses(report.transactions.map(t=>t.signature),{searchTransactionHistory:true});
 if(statuses.value.some(s=>!s||s.err||!['confirmed','finalized'].includes(s.confirmationStatus)))throw Error('Saved funding or launch is not confirmed successfully; resume stopped.');
 const configAccount=await connection.getAccountInfo(deriveConfigPda(program),'confirmed');
 if(!configAccount?.owner.equals(program))throw Error('Devnet config unavailable.');
 const config=decodeLaunchConfig(configAccount.data);if(config.version!==2)throw Error('Expected existing v2 devnet profile.');
 const prepared={pool:new PublicKey(report.pool)};
 stage='quote completing buy';
 const quote=await quoteDevnetTrade(connection,{programId:program,mint:mint.publicKey,owner:creator.publicKey,side:'buy',amount:1100000000n,slippageBps:100,cluster:'devnet'});
 if(quote.venue!=='curve')throw Error('Existing token is no longer on its curve; simulation stopped.');
 stage='build completing buy';
 const buy=await buildDevnetTrade(connection,quote);
 stage='simulate completing buy';
 buy.transaction.sign([creator]);
 await assertCluster(connection,'devnet');
 const simulation=await connection.simulateTransaction(buy.transaction,{sigVerify:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:[prepared.pool.toBase58(),SYSVAR_CLOCK_PUBKEY.toBase58()]}});
 report.simulationError=simulation.value.err;report.simulationLogs=simulation.value.logs;
 if(simulation.value.err)throw Error('Completing-buy simulation failed: '+JSON.stringify(simulation.value.err));
 stage='validate simulated clock';
 const [poolAccount,clockAccount]=simulation.value.accounts||[];
 const evidence=clockEvidence(poolAccount,clockAccount,config,mint.publicKey);
 const kinds=launchInstructions(simulation.value.logs,config.launchpad.toBase58());if(!kinds.includes('buy')||kinds.includes('migration'))throw Error('Unexpected instruction trace.');
 Object.assign(report,{status:'passed',simulationSlot:simulation.context.slot,...evidence,simulationLogs:simulation.value.logs,status1TimestampObserved:true,evidenceKind:'signed-completing-buy-simulation-on-devnet',limitation:'This executes the deployed devnet LaunchLab buy logic in simulation. It does not test a live Stolons expire_candidate transaction or the mainnet LaunchLab binary.',transactionsSubmitted:report.transactions.length});delete report.error;delete report.failedStage;delete report.diagnosticStage;await save();console.log(JSON.stringify(report,null,2));
}catch(error){if(error.evidence)report.failedAssertionEvidence=error.evidence;report.status='failed';report.failedStage='simulate completing buy';report.diagnosticStage=stage;report.error=String(error.message||error).replace(/https?:\/\/[^\s]+/g,'[RPC URL redacted]');await save();console.error(JSON.stringify(report,null,2));process.exitCode=1;}
