import {readFile} from 'node:fs/promises';
import {Connection,PublicKey,Keypair} from '@solana/web3.js';
import {StolonsClient} from '../../sdk/dist/index.js';
import {readGraduation,buildGraduationStep} from '../../sdk/dist/devnet-graduation.js';
const apply=process.argv.includes('--apply');
const cluster=process.env.KEEPER_CLUSTER;
if(!['devnet','mainnet-beta'].includes(cluster))throw Error('Set KEEPER_CLUSTER to devnet or mainnet-beta.');
if(!process.env.KEEPER_RPC_URL||!process.env.KEEPER_PROGRAM_ID)throw Error('Set KEEPER_RPC_URL and KEEPER_PROGRAM_ID.');
const connection=new Connection(process.env.KEEPER_RPC_URL,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})});
const program=new PublicKey(process.env.KEEPER_PROGRAM_ID),client=new StolonsClient(connection,program);
const table=process.env.KEEPER_LOOKUP_TABLE?new PublicKey(process.env.KEEPER_LOOKUP_TABLE):undefined;
const payer=apply?Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(process.env.KEEPER_KEYPAIR_PATH,'utf8')))):null;
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
async function scan(){
 // No authority key is needed: the protocol validates every permissionless transition.
 const accounts=await connection.getProgramAccounts(program,{filters:[{dataSize:317}]});
 for(const {account} of accounts){
  if(stopped)break;
  let mint;
  try{const {decodeLineage}=await import('../../sdk/dist/index.js');const entry=decodeLineage(account.data);if(!['RootPending','RootQualified','CandidateLaunched','CandidateQualified'].includes(entry.status))continue;mint=entry.mint;
   for(let step=0;step<3;step++){
    const state=await readGraduation(connection,program,mint,cluster);
    if(!['register','claim','activate'].includes(state.phase))break;
    console.log(mint.toBase58(),state.phase,apply?'apply':'dry-run');if(!apply)break;
    const prepared=await buildGraduationStep(connection,program,mint,payer.publicKey,table,cluster);
    prepared.transaction.sign([payer]);
    const simulation=await connection.simulateTransaction(prepared.transaction,{sigVerify:true});
    if(simulation.value.err)throw Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    // Broadcast uncertainty must halt this process; an operator checks the signature before restarting.
    try{
     const signature=await connection.sendRawTransaction(prepared.transaction.serialize(),{skipPreflight:false,maxRetries:3});console.log('submitted',signature);
     const confirmed=await connection.confirmTransaction({...prepared.latest,signature},'confirmed');if(confirmed.value.err)throw Error(JSON.stringify(confirmed.value.err));
    }catch(error){console.error('Submission/confirmation uncertain. Inspect keeper wallet transactions before restarting.',error.message);process.exit(1);}
   }
  }catch(error){console.error(mint?.toBase58()||'account',error.message);}
 }
}
do{try{await scan()}catch(error){console.error('Scan failed:',error.message)}if(process.argv.includes('--once')||stopped)break;await new Promise(resolve=>setTimeout(resolve,15000));}while(!stopped);
