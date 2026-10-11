import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Connection,PublicKey,Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {readRetryFetch,useHttpConfirmation} from '../../services/keeper/rpc.mjs';
import {assertCluster,deriveConfigPda} from '../../sdk/dist/index.js';
import {decodeLaunchConfig} from '../../sdk/dist/launch-validation.js';
import {buildTreasuryCurveFeeClaim} from '../../sdk/dist/fees.js';
import {sendDevnetTrade,TradeSubmittedError} from '../../sdk/dist/devnet-trade.js';
const {PlatformConfig,updatePlatformConfig,getPdaPlatformVault}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
const path='target/devnet/curve-fees-verification.json',r=JSON.parse(await readFile(path,'utf8'));
if(r.status==='passed'){console.log('Curve verification already passed.');process.exit(0);}
const uncertain=r.transactions.findLast(t=>t.uncertain);if(!uncertain||uncertain.label!=='protocol curve treasury sweep')throw Error('This recovery handles only the interrupted treasury sweep.');
const c=useHttpConfirmation(new Connection(process.env.DEVNET_FEE_RPC_URL||'https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()}));await assertCluster(c,'devnet');
const program=new PublicKey('4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ'),raw=await c.getAccountInfo(deriveConfigPda(program)),config=decodeLaunchConfig(raw.data),admin=new PublicKey(raw.data.subarray(8,40));
const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile('keypairs/devnet-wallet.json','utf8'))));if(!signer.publicKey.equals(admin)||!admin.equals(new PublicKey(raw.data.subarray(40,72))))throw Error('Wrong devnet authority/treasury.');
let status=(await c.getSignatureStatuses([uncertain.signature],{searchTransactionHistory:true})).value[0];
if(!status){
 // The old blockhash predates this observed confirmed height. Waiting 151
 // additional blocks guarantees it cannot land after a replacement is sent.
 const observed=await c.getBlockHeight('confirmed');console.log('Old sweep is absent. Waiting for its blockhash to expire before any replacement…');
 while(await c.getBlockHeight('confirmed')<=observed+151){await new Promise(resolve=>setTimeout(resolve,5000));}
 status=(await c.getSignatureStatuses([uncertain.signature],{searchTransactionHistory:true})).value[0];
}
if(status&&!status.err&&!['confirmed','finalized'].includes(status.confirmationStatus))throw Error('Original sweep is still pending. Inspect before resuming.');
const save=()=>writeFile(path,JSON.stringify(r,null,2)+'\n');
async function send(label,prepared){try{const signature=await sendDevnetTrade(c,prepared,async tx=>{tx.sign([signer]);return tx;});r.transactions.push({label,signature});await save();console.log(label,signature);return signature;}catch(e){if(e instanceof TradeSubmittedError){r.transactions.push({label,signature:e.signature,uncertain:true});await save();}throw e;}}
const vault=getPdaPlatformVault(config.launchpad,config.platform,config.quote).publicKey;const amount=async()=>{const a=await c.getAccountInfo(vault);return a?.data.length>=165?a.data.readBigUInt64LE(64):0n;};
if(!status||status.err){if(await amount()>0n)await send('protocol curve treasury sweep',await buildTreasuryCurveFeeClaim(c,{programId:program,mint:new PublicKey(r.mint),payer:admin,cluster:'devnet'}));}
else console.log('Original sweep confirmed:',uncertain.signature);
if(await amount()!==0n)throw Error('Platform vault still has pending fees.');
if(!r.wrongSignerRejected||!r.creatorAccrued||!r.transactions.some(t=>t.label==='creator manual curve claim')||!r.transactions.some(t=>t.label==='empty repeat creator claim'))throw Error('Earlier creator validation evidence is incomplete.');
const p=PlatformConfig.decode((await c.getAccountInfo(config.platform)).data),BN=p.feeRate.constructor,bn=n=>new BN(n.toString()),text=v=>Buffer.from(v).toString('utf8').replace(/\0.*$/s,'');
const ix=updatePlatformConfig(config.launchpad,admin,config.platform,{type:'updateAll',value:{platformClaimFeeWallet:p.platformClaimFeeWallet,platformLockNftWallet:p.platformLockNftWallet,platformVestingWallet:p.platformVestingWallet,cpConfigId:p.cpConfigId,migrateCpLockNftScale:{platformScale:p.platformScale,creatorScale:p.creatorScale,burnScale:p.burnScale},feeRate:bn(r.originalPlatformRate),creatorFeeRate:bn(r.originalCreatorRate),name:text(p.name),web:text(p.web),img:text(p.img),transferFeeExtensionAuth:p.transferFeeExtensionAuth,platformVestingScale:p.platformVestingScale}});
const latest=await c.getLatestBlockhash();await send('restore original curve rates',{transaction:new VersionedTransaction(new TransactionMessage({payerKey:admin,recentBlockhash:latest.blockhash,instructions:[ix]}).compileToV0Message()),latest,cluster:'devnet',quote:{quotedAt:Date.now()}});
const restored=PlatformConfig.decode((await c.getAccountInfo(config.platform)).data);if(!restored.feeRate.eq(bn(r.originalPlatformRate))||!restored.creatorFeeRate.eq(bn(r.originalCreatorRate)))throw Error('Rates not restored.');
r.status='passed';r.originalRatesRestored=true;r.treasurySweepVerified=true;uncertain.resolved=true;await save();console.log(JSON.stringify(r,null,2));
