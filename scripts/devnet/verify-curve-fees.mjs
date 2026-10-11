import {decodeLaunchConfig} from '../../sdk/dist/launch-validation.js';
import {readRetryFetch,useHttpConfirmation} from '../../services/keeper/rpc.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Connection,PublicKey,Keypair,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {createRequire} from 'node:module';
const sdkRequire=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {getAssociatedTokenAddressSync}=sdkRequire('@solana/spl-token');
const {PlatformConfig,updatePlatformConfig,getPdaCreatorVault,getPdaPlatformVault,LaunchpadConfig}=sdkRequire('@raydium-io/raydium-sdk-v2');
import {assertCluster,deriveConfigPda,deriveFeeAuthorityPda} from '../../sdk/dist/index.js';
import {buildDevnetRootLaunch,sendRootLaunch} from '../../sdk/dist/devnet-launch.js';
import {quoteDevnetTrade,buildDevnetTrade,sendDevnetTrade,TradeSubmittedError} from '../../sdk/dist/devnet-trade.js';
import {buildCurveCreatorFeeClaim,buildTreasuryCurveFeeClaim} from '../../sdk/dist/fees.js';
const apply=process.argv.includes('--apply');if(process.argv.slice(2).some(x=>x!=='--apply'))throw Error('Usage: node scripts/devnet/verify-curve-fees.mjs [--apply]');
const c=new Connection(process.env.DEVNET_FEE_RPC_URL||'https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()});
useHttpConfirmation(c);
await assertCluster(c,'devnet');
const program=new PublicKey('4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ'),table=new PublicKey(process.env.NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE||'88XLHEm7T4SEhSzMx3vqZjGXmzo2bbeJq4VK2sgJHGwx');
const raw=await c.getAccountInfo(deriveConfigPda(program));if(!raw?.owner.equals(program))throw Error('Config missing.');const config=decodeLaunchConfig(raw.data);if(config.version!==2)throw Error('Requires fee sharing v2.');
const admin=new PublicKey(raw.data.subarray(8,40)),treasury=new PublicKey(raw.data.subarray(40,72));if(!admin.equals(treasury))throw Error('This test requires the existing devnet admin/treasury profile.');
const original=(await c.getAccountInfo(config.platform)).data,p=PlatformConfig.decode(original),launch=LaunchpadConfig.decode((await c.getAccountInfo(config.launchConfig)).data);const BN=launch.tradeFeeRate.constructor,bn=n=>new BN(n.toString());
const text=v=>Buffer.from(v).toString('utf8').replace(/\0.*$/s,'');
function platformIx(fee,creator){return updatePlatformConfig(config.launchpad,admin,config.platform,{type:'updateAll',value:{platformClaimFeeWallet:p.platformClaimFeeWallet,platformLockNftWallet:p.platformLockNftWallet,platformVestingWallet:p.platformVestingWallet,cpConfigId:p.cpConfigId,migrateCpLockNftScale:{platformScale:p.platformScale,creatorScale:p.creatorScale,burnScale:p.burnScale},feeRate:bn(fee),creatorFeeRate:bn(creator),name:text(p.name),web:text(p.web),img:text(p.img),transferFeeExtensionAuth:p.transferFeeExtensionAuth,platformVestingScale:p.platformVestingScale}});}
const lookup=(await c.getAddressLookupTable(table)).value;if(!lookup?.isActive())throw Error('Lookup table unavailable.');
async function prepare(ixs,payer){const latest=await c.getLatestBlockhash();return {transaction:new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:latest.blockhash,instructions:ixs}).compileToV0Message([lookup])),latest,cluster:'devnet',quote:{quotedAt:Date.now()}};}
const trial=await prepare([platformIx(1000,1000)],admin);const sim=await c.simulateTransaction(trial.transaction,{sigVerify:false});if(sim.value.err)throw Error('Fee profile simulation failed: '+JSON.stringify(sim.value.err));
console.log('Devnet only: temporarily set 0.10% platform + 0.10% creator curve fees, create a test token, spend 0.01 test SOL on a buy, verify claims and restore the original rates. Existing tokens may use the temporary rates while the test runs.');
if(!apply){console.log('Simulation passed. No transactions sent. Use --apply for the complete live test.');process.exit(0);}
await mkdir('target/devnet',{recursive:true});await mkdir('keypairs',{recursive:true});
const reportPath='target/devnet/curve-fees-verification.json';
try{const old=JSON.parse(await readFile(reportPath,'utf8'));if(old.status!=='passed')throw Error('An earlier run is unfinished. Inspect its signatures and restore the recorded profile before retrying.');}catch(e){if(e.code!=='ENOENT')throw e;}
const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile('keypairs/devnet-wallet.json','utf8'))));if(!signer.publicKey.equals(admin))throw Error('Wrong admin key.');
const creator=Keypair.generate(),mint=Keypair.generate();await writeFile(`keypairs/curve-fees-${mint.publicKey}.json`,JSON.stringify([...mint.secretKey]),{mode:0o600});await writeFile(`keypairs/curve-creator-${mint.publicKey}.json`,JSON.stringify([...creator.secretKey]),{mode:0o600});
const report={status:'running',mint:mint.publicKey.toBase58(),creator:creator.publicKey.toBase58(),originalPlatformRate:p.feeRate.toString(),originalCreatorRate:p.creatorFeeRate.toString(),transactions:[]};
const save=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await save();
async function send(label,prepared,key){await save();try{const sig=await sendDevnetTrade(c,prepared,async tx=>{tx.sign([key]);return tx;});report.transactions.push({label,signature:sig});await save();console.log(label,sig);return sig;}catch(e){if(e instanceof TradeSubmittedError){report.transactions.push({label,signature:e.signature,uncertain:true});report.status='uncertain';await save();}throw e;}}
async function amount(address){const a=await c.getAccountInfo(address);return a&&a.data.length>=165?a.data.readBigUInt64LE(64):0n;}
const must=(ok,msg)=>{if(!ok)throw Error(msg);};
try{
 await send('enable temporary curve fee profile',trial,signer);
 await send('fund test creator',await prepare([SystemProgram.transfer({fromPubkey:admin,toPubkey:creator.publicKey,lamports:150000000})],admin),signer);
 const launchTx=await buildDevnetRootLaunch(c,{programId:program,creator:creator.publicKey,mint:mint.publicKey,name:'Stolons Root',symbol:'STROOT',metadataUri:'https://raw.githubusercontent.com/404genie/Stolons/devnet/codespaces/root.json',lookupTable:table,cluster:'devnet'});
 try{const sig=await sendRootLaunch(c,launchTx,mint,async tx=>{tx.sign([creator]);return tx;});report.transactions.push({label:'test token launch',signature:sig});await save();console.log('test token launch',sig);}catch(e){if(e instanceof TradeSubmittedError){report.status='uncertain';report.transactions.push({label:'test token launch',signature:e.signature,uncertain:true});await save();}throw e;}
 const authority=deriveFeeAuthorityPda(program,mint.publicKey),creatorVault=getPdaCreatorVault(config.launchpad,authority,config.quote).publicKey,platformVault=getPdaPlatformVault(config.launchpad,config.platform,config.quote).publicKey;
 const platformBefore=await amount(platformVault);
 const quote=await quoteDevnetTrade(c,{programId:program,mint:mint.publicKey,owner:creator.publicKey,side:'buy',amount:10000000n,slippageBps:100,cluster:'devnet'});await send('curve buy',await buildDevnetTrade(c,quote),creator);
 const accrued=await amount(creatorVault),platformAccrued=await amount(platformVault);must(accrued>0n&&platformAccrued>platformBefore,'Actual creator and platform accrual must both be nonzero.');report.creatorAccrued=accrued.toString();report.platformAccrued=(platformAccrued-platformBefore).toString();await save();
 const input={programId:program,mint:mint.publicKey,payer:creator.publicKey,cluster:'devnet',lookupTable:table};
 const claim=await buildCurveCreatorFeeClaim(c,input);
 // Simulate a non-creator payer against the deployed instruction, not just SDK validation.
 const decoded=TransactionMessage.decompile(claim.transaction.message,{addressLookupTableAccounts:[lookup]});const ix=decoded.instructions[1];ix.keys[0].pubkey=admin;const bad=await prepare(decoded.instructions,admin);const rejected=await c.simulateTransaction(bad.transaction,{sigVerify:false});must(rejected.value.err,'On-chain claim accepted a non-creator.');report.wrongSignerRejected=true;
 const creatorAta=getAssociatedTokenAddressSync(config.quote,creator.publicKey),treasuryAta=getAssociatedTokenAddressSync(config.quote,treasury);
 const before=await amount(creatorAta);await send('creator manual curve claim',await buildCurveCreatorFeeClaim(c,input),creator);must(await amount(creatorAta)-before===accrued,'Creator payout did not match accrued fees.');must(await amount(creatorVault)===0n,'Creator vault was not drained.');
 const repeated=await buildCurveCreatorFeeClaim(c,input);await send('empty repeat creator claim',repeated,creator);must(await amount(creatorAta)===before+accrued,'Repeated claim paid twice.');
 const treasuryBefore=await amount(treasuryAta);const sweep=await buildTreasuryCurveFeeClaim(c,{...input,payer:treasury});await send('protocol curve treasury sweep',sweep,signer);must(await amount(treasuryAta)-treasuryBefore===platformAccrued,'Treasury sweep differs from vault balance.');must(await amount(platformVault)===0n,'Platform vault not drained.');
 report.status='passed';
}catch(e){if(report.status==='uncertain'){console.error('STOP: inspect the uncertain signature before restoring rates or rerunning.');throw e;}report.status='failed';report.error=e.message;
}finally{
 if(report.status!=='uncertain'){await send('restore original curve rates',await prepare([platformIx(p.feeRate,p.creatorFeeRate)],admin),signer);const restored=PlatformConfig.decode((await c.getAccountInfo(config.platform)).data);must(restored.feeRate.eq(p.feeRate)&&restored.creatorFeeRate.eq(p.creatorFeeRate),'Original rates were not restored.');report.originalRatesRestored=true;await save();}
}
console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
