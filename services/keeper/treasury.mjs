import {decodeLaunchConfig} from '../../sdk/dist/launch-validation.js';
// Dedicated platform-vault sweep. Never give this treasury key to the fee keeper.
import {readRetryFetch} from './rpc.mjs';
import {readFile} from 'node:fs/promises';
import {Connection,PublicKey,Keypair} from '@solana/web3.js';
import {createRequire} from 'node:module';
const {getPdaPlatformVault}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
import {assertCluster,deriveConfigPda} from '../../sdk/dist/index.js';
import {buildTreasuryCurveFeeClaim} from '../../sdk/dist/fees.js';
import {sendDevnetTrade} from '../../sdk/dist/devnet-trade.js';
const flags=process.argv.slice(2);if(flags.some(f=>!['--apply','--once'].includes(f)))throw Error('Use treasury.mjs [--apply] [--once]');
const apply=flags.includes('--apply'),cluster=process.env.KEEPER_CLUSTER,program=new PublicKey(process.env.KEEPER_PROGRAM_ID),connection=new Connection(process.env.KEEPER_RPC_URL,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()});
await assertCluster(connection,cluster);
const signer=apply?Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(process.env.TREASURY_KEYPAIR_PATH,'utf8')))):null;
const treasury=signer?.publicKey??new PublicKey(process.env.TREASURY_WALLET);
async function scan(){
 await assertCluster(connection,cluster);
 const config=await connection.getAccountInfo(deriveConfigPda(program),'confirmed');if(!config?.owner.equals(program))throw Error('Config missing.');
 if(!new PublicKey(config.data.subarray(40,72)).equals(treasury))throw Error('Treasury signer differs from configured treasury.');
 const c=decodeLaunchConfig(config.data),vault=await connection.getAccountInfo(getPdaPlatformVault(c.launchpad,c.platform,c.quote).publicKey,'confirmed');
 if(!vault||vault.data.readBigUInt64LE(64)===0n){console.log('Platform fee vault empty.');return;}
 const prepared=await buildTreasuryCurveFeeClaim(connection,{programId:program,mint:PublicKey.default,payer:treasury,cluster});
 const simulation=await connection.simulateTransaction(prepared.transaction,{sigVerify:false});if(simulation.value.err)throw Error('Treasury sweep simulation failed.');
 if(!apply){console.log('Treasury sweep simulation passed; no transaction sent.');return;}
 console.log('Treasury sweep confirmed:',await sendDevnetTrade(connection,prepared,async tx=>{tx.sign([signer]);return tx;}));
}
// Any error, including uncertain submission, exits for operator review.
do {await scan();if(!apply||flags.includes('--once'))break;await new Promise(resolve=>setTimeout(resolve,30000));}while(true);
