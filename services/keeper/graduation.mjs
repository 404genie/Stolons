import {readFile} from 'node:fs/promises';
import {Connection,PublicKey,Keypair} from '@solana/web3.js';
import {decodeLineage} from '../../sdk/dist/index.js';
import {runGraduation,KeeperSubmissionUncertain} from './run-graduation.mjs';
const apply=process.argv.includes('--apply');
const cluster=process.env.KEEPER_CLUSTER;
if(!['devnet','mainnet-beta'].includes(cluster))throw Error('Set KEEPER_CLUSTER to devnet or mainnet-beta.');
if(!process.env.KEEPER_RPC_URL||!process.env.KEEPER_PROGRAM_ID)throw Error('Set KEEPER_RPC_URL and KEEPER_PROGRAM_ID.');
const connection=new Connection(process.env.KEEPER_RPC_URL,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})});
const program=new PublicKey(process.env.KEEPER_PROGRAM_ID);
const table=process.env.KEEPER_LOOKUP_TABLE?new PublicKey(process.env.KEEPER_LOOKUP_TABLE):undefined;
const payer=apply?Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(process.env.KEEPER_KEYPAIR_PATH,'utf8')))):null;
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
async function scan(){
 // No authority key is needed: the protocol validates every permissionless transition.
 const accounts=await connection.getProgramAccounts(program,{filters:[{dataSize:317}]});
 for(const {account} of accounts){
  if(stopped)break;
  let mint;
  try{const entry=decodeLineage(account.data);if(!['RootPending','RootQualified','CandidateLaunched','CandidateQualified'].includes(entry.status))continue;mint=entry.mint;
   await runGraduation(connection,program,mint,{payer,table,cluster,apply});
  }catch(error){console.error(mint?.toBase58()||'account',error.message);if(error instanceof KeeperSubmissionUncertain){console.error('Inspect the keeper wallet transaction before restarting.');process.exit(1);}}
 }
}
if(await connection.getGenesisHash()!==(cluster==='devnet'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2dZ'))throw Error('Keeper RPC cluster mismatch.');
do{try{await scan()}catch(error){console.error('Scan failed:',error.message)}if(process.argv.includes('--once')||stopped)break;await new Promise(resolve=>setTimeout(resolve,15000));}while(!stopped);
