import {readFile} from 'node:fs/promises';
import {Connection,PublicKey,Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {assertCluster,deriveConfigPda,feeSharingEnableInstruction} from '../../sdk/dist/index.js';
import {sendDevnetTrade} from '../../sdk/dist/devnet-trade.js';
const flags=process.argv.slice(2);if(flags.some(flag=>flag!=='--apply'))throw Error('Usage: bash scripts/devnet/enable-fees.sh [--apply]');
const apply=flags.includes('--apply'),rpc=process.env.DEVNET_FEE_RPC_URL||'https://api.devnet.solana.com';
const program=new PublicKey(process.env.DEVNET_FEE_PROGRAM_ID||'4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ');
const connection=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true});await assertCluster(connection,'devnet');
const account=await connection.getAccountInfo(deriveConfigPda(program),'confirmed');
if(!account?.owner.equals(program)||account.data.length<307)throw Error('Devnet config missing.');
if(account.data[305]===2){console.log('Devnet fee-sharing version 2 already enabled. No transaction sent.');process.exit(0);}
if(account.data[305]!==1)throw Error('Unsupported config version.');
const authority=new PublicKey(account.data.subarray(8,40)),platform=new PublicKey(account.data.subarray(168,200));
const latest=await connection.getLatestBlockhash('confirmed');const transaction=new VersionedTransaction(new TransactionMessage({payerKey:authority,recentBlockhash:latest.blockhash,instructions:[feeSharingEnableInstruction(program,authority,platform)]}).compileToLegacyMessage());
const sim=await connection.simulateTransaction(transaction,{sigVerify:false,commitment:'confirmed'});
if(sim.value.err)throw Error('Fee enable simulation failed. Build and deploy the new devnet program first; inspect platform override.');
console.log('Simulation passed. This enables per-token fee ownership for future devnet launches; existing tokens and fee rates are unchanged.');
if(!apply){console.log('No transaction sent. Add --apply only after reviewing the program upgrade.');process.exit(0);}
const path=process.env.DEVNET_FEE_AUTHORITY_KEYPAIR||'keypairs/devnet-wallet.json';const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path,'utf8'))));
if(!signer.publicKey.equals(authority))throw Error('Signer does not match config authority.');
const signature=await sendDevnetTrade(connection,{transaction,latest,cluster:'devnet',quote:{quotedAt:Date.now()}},async tx=>{tx.sign([signer]);return tx;});console.log(`Fee sharing enabled on devnet: ${signature}`);
