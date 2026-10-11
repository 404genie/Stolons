// Focused devnet runtime probe: fund + launch, then simulate (never submit) final buy.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Connection,Keypair,PublicKey,SystemProgram,TransactionMessage,VersionedTransaction,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {assertCluster,deriveConfigPda} from '../../sdk/dist/index.js';
import {decodeLaunchConfig} from '../../sdk/dist/launch-validation.js';
import {clockEvidence} from './fundraising-clock-evidence.mjs';
import {buildDevnetRootLaunch,sendRootLaunch} from '../../sdk/dist/devnet-launch.js';
import {buildDevnetTrade,quoteDevnetTrade,sendDevnetTrade} from '../../sdk/dist/devnet-trade.js';
import {readRetryFetch,useHttpConfirmation} from '../../services/keeper/rpc.mjs';
import {launchInstructions} from './trace-graduation-clock.mjs';
const flags=process.argv.slice(2);if(flags.some(x=>x!=='--apply'))throw Error('Use verify-fundraising-clock.mjs [--apply]');
const apply=flags.includes('--apply'),program=new PublicKey('4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ'),admin=new PublicKey('HJD8UegSzgEdFUGb5Kmu68NsH752jB2EeAVPr2zZk6Wp');
const connection=new Connection(process.env.CLOCK_TEST_RPC_URL||'https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()});useHttpConfirmation(connection);
await assertCluster(connection,'devnet');
const path='target/devnet/fundraising-clock-test.json';
try{const previous=JSON.parse(await readFile(path,'utf8'));if(previous.status==='passed'){console.log(JSON.stringify(previous,null,2));process.exit(0);}throw Error('An earlier clock test is unfinished. Inspect its saved signatures; automatic reruns are disabled.');}catch(error){if(error.code!=='ENOENT')throw error;}
const configAccount=await connection.getAccountInfo(deriveConfigPda(program),'confirmed');if(!configAccount?.owner.equals(program))throw Error('Existing devnet config unavailable.');
const config=decodeLaunchConfig(configAccount.data);if(config.version!==2)throw Error('This isolated probe requires the existing v2 devnet profile; do not upgrade the program for this test.');
const fundLamports=1300000000;
console.log('Devnet only: transfer 1.3 test SOL to a new test creator, launch one test root, then simulate a completing buy and inspect its post-instruction pool/clock accounts. The buy will not be sent.');
if(!apply){console.log('Configuration checks passed. No transactions sent. Use --apply for the focused probe.');process.exit(0);}
const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile('keypairs/devnet-wallet.json','utf8'))));if(!signer.publicKey.equals(admin))throw Error('Unexpected devnet funding wallet.');
if(await connection.getBalance(admin,'confirmed')<fundLamports+50000000)throw Error('Fund the devnet wallet with test SOL before this probe.');
await mkdir('keypairs',{recursive:true});await mkdir('target/devnet',{recursive:true});
const creator=Keypair.generate(),mint=Keypair.generate();
for(const [name,key]of [['creator',creator],['mint',mint]])await writeFile(`keypairs/clock-${name}-${mint.publicKey}.json`,JSON.stringify([...key.secretKey]),{flag:'wx',mode:0o600});
const report={status:'running',cluster:'devnet',mint:mint.publicKey.toBase58(),creator:creator.publicKey.toBase58(),fundLamports,transactions:[],completingBuySubmitted:false};
const save=()=>writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});await save();let stage='fund creator';
try{
 const latest=await connection.getLatestBlockhash('confirmed');
 const funding={transaction:new VersionedTransaction(new TransactionMessage({payerKey:admin,recentBlockhash:latest.blockhash,instructions:[SystemProgram.transfer({fromPubkey:admin,toPubkey:creator.publicKey,lamports:fundLamports})]}).compileToLegacyMessage()),latest,cluster:'devnet',quote:{quotedAt:Date.now()}};
 const signature=await sendDevnetTrade(connection,funding,async tx=>{tx.sign([signer]);return tx;});report.transactions.push({label:stage,signature});await save();console.log(stage,signature);
 stage='launch test root';
 const prepared=await buildDevnetRootLaunch(connection,{programId:program,creator:creator.publicKey,mint:mint.publicKey,name:'Stolons Root',symbol:'STROOT',metadataUri:'https://raw.githubusercontent.com/404genie/Stolons/main/root.json',lookupTable:new PublicKey('88XLHEm7T4SEhSzMx3vqZjGXmzo2bbeJq4VK2sgJHGwx'),cluster:'devnet'});
 const launched=await sendRootLaunch(connection,prepared,mint,async tx=>{tx.sign([creator]);return tx;});report.transactions.push({label:stage,signature:launched});report.pool=prepared.pool.toBase58();await save();console.log(stage,launched);
 stage='simulate completing buy';
 const quote=await quoteDevnetTrade(connection,{programId:program,mint:mint.publicKey,owner:creator.publicKey,side:'buy',amount:1100000000n,slippageBps:100,cluster:'devnet'});
 const buy=await buildDevnetTrade(connection,quote);
 buy.transaction.sign([creator]);
 await assertCluster(connection,'devnet');
 const simulation=await connection.simulateTransaction(buy.transaction,{sigVerify:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:[prepared.pool.toBase58(),SYSVAR_CLOCK_PUBKEY.toBase58()]}});
 if(simulation.value.err)throw Error('Completing-buy simulation failed.');
 const [poolAccount,clockAccount]=simulation.value.accounts||[];
 const evidence=clockEvidence(poolAccount,clockAccount,config,mint.publicKey);
 const kinds=launchInstructions(simulation.value.logs,config.launchpad.toBase58());if(!kinds.includes('buy')||kinds.includes('migration'))throw Error('Unexpected instruction trace.');
 Object.assign(report,{status:'passed',simulationSlot:simulation.context.slot,...evidence,simulationLogs:simulation.value.logs,status1TimestampObserved:true,evidenceKind:'signed-completing-buy-simulation-on-devnet',limitation:'This executes the deployed devnet LaunchLab buy logic in simulation. It does not test a live Stolons expire_candidate transaction or the mainnet LaunchLab binary.',transactionsSubmitted:report.transactions.length});await save();console.log(JSON.stringify(report,null,2));
}catch(error){report.status=error.signature?'uncertain':'failed';report.failedStage=stage;if(error.signature)report.transactions.push({label:stage,signature:error.signature,uncertain:true});report.error=String(error.message||error).replace(/https?:\/\/[^\s]+/g,'[RPC URL redacted]');await save();console.error(JSON.stringify(report,null,2));process.exitCode=1;}
