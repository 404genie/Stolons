import {TradeSubmittedError} from '../../sdk/dist/devnet-trade.js';
import {readRetryFetch,useHttpConfirmation,runScanLoop} from './rpc.mjs';
import {readFile} from 'node:fs/promises';
import {Connection,PublicKey,Keypair} from '@solana/web3.js';
import {assertCluster,decodeLineage} from '../../sdk/dist/index.js';
import {runFeeCollection} from './run-fees.mjs';
const flags=process.argv.slice(2),apply=flags.includes('--apply');
if(flags.some(flag=>!['--apply','--watch'].includes(flag)))throw Error('Usage: node services/keeper/fees.mjs [--apply] [--watch]');
const cluster=process.env.KEEPER_CLUSTER;
if(!['devnet','mainnet-beta'].includes(cluster))throw Error('Set KEEPER_CLUSTER.');
if(!process.env.KEEPER_RPC_URL||!process.env.KEEPER_PROGRAM_ID)throw Error('Set KEEPER_RPC_URL, KEEPER_PROGRAM_ID.');
const connection=new Connection(process.env.KEEPER_RPC_URL,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()});
useHttpConfirmation(connection);
await assertCluster(connection,cluster);
const program=new PublicKey(process.env.KEEPER_PROGRAM_ID),table=process.env.KEEPER_LOOKUP_TABLE?new PublicKey(process.env.KEEPER_LOOKUP_TABLE):undefined;
const payer=apply?Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(process.env.KEEPER_KEYPAIR_PATH,'utf8')))):null;
const payerPublicKey=payer?.publicKey??(process.env.KEEPER_WALLET?new PublicKey(process.env.KEEPER_WALLET):null);
if(!payerPublicKey)throw Error('Set KEEPER_WALLET for dry-run.');
if(await connection.getBalance(payerPublicKey,'confirmed')<50000000)throw Error('Keeper needs at least 0.05 SOL of fee/rent headroom.');
async function scan(){
const mints=process.env.FEE_KEEPER_MINTS?process.env.FEE_KEEPER_MINTS.split(',').map(s=>new PublicKey(s.trim())):(await connection.getProgramAccounts(program,{filters:[{dataSize:317}]})).map(({account})=>decodeLineage(account.data).mint);
for(const mint of mints){
 // Stop on all failures, including ambiguous submissions. Do not continue or
 // auto-restart this process without inspecting an uncertain transaction.
 await runFeeCollection(connection,program,mint,{cluster,payer,table,apply,payerPublicKey});
}

}
let stopped=false;process.on("SIGTERM",()=>{stopped=true});process.on("SIGINT",()=>{stopped=true});
await runScanLoop(scan,{watch:flags.includes('--watch'),stopped:()=>stopped,isUncertain:error=>error instanceof TradeSubmittedError});
