import {readFile} from 'node:fs/promises';
import {Connection,PublicKey,Keypair,TransactionMessage,VersionedTransaction,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createSyncNativeInstruction,createCloseAccountInstruction,getAccount} from '@solana/spl-token';
import {DEVNET_PROGRAM_ID,LaunchpadPool,LaunchpadConfig,PlatformConfig,Curve,buyExactInInstruction,getPdaLaunchpadAuth,getPdaPlatformVault,getPdaCreatorVault,getPdaVestId} from '@raydium-io/raydium-sdk-v2';
import {StolonsClient,buildInstruction,deriveConfigPda,deriveLineagePda,deriveLaunchLabPool,deriveCpmmPool,deriveReproductionAuthorityPda,deriveVaultAuthorityPda,deriveReproductionVaultPda,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,SYSTEM_PROGRAM_ID} from '../dist/index.js';
const [walletText,programText,mintText,mode='']=process.argv.slice(2);
if(!walletText||!programText||!mintText||!['','--apply'].includes(mode))throw Error('Use bash scripts/devnet/graduate-root.sh [--apply]');
const root=new URL('../../',import.meta.url),connection=new Connection('https://api.devnet.solana.com','confirmed');
const wallet=new PublicKey(walletText),program=new PublicKey(programText),mint=new PublicKey(mintText),quote=new PublicKey('So11111111111111111111111111111111111111112');
const launchpad=DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM,cpmm=DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
const config=deriveConfigPda(program),lineageKey=deriveLineagePda(program,mint),poolKey=deriveLaunchLabPool(launchpad,mint,quote),client=new StolonsClient(connection,program);
const must=(ok,message)=>{if(!ok)throw Error(message)};
const configAccount=await connection.getAccountInfo(config);must(configAccount?.owner.equals(program),'Configuration missing');
const c=configAccount.data;
for(const [key,offset] of [[wallet,8],[launchpad,72],[cpmm,104],[quote,200]])must(new PublicKey(c.subarray(offset,offset+32)).equals(key),'Configuration mismatch');
must(c[304]===0,'Protocol paused');
const cpmmConfig=new PublicKey(c.subarray(232,264)),cpmmPool=deriveCpmmPool(cpmm,cpmmConfig,mint,quote);
let lineage=await client.getLineage(mint);must(lineage?.creator.equals(wallet)&&lineage.launchPool.equals(poolKey),'Root identity mismatch');
async function readPool(){const account=await connection.getAccountInfo(poolKey);must(account?.owner.equals(launchpad),'Launch pool owner mismatch');return LaunchpadPool.decode(account.data)}
async function run(label,instructions){
 const latest=await connection.getLatestBlockhash();
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...instructions]}).compileToLegacyMessage());
 must(tx.serialize().length<=1232,'Transaction exceeds packet limit');
 const sim=await connection.simulateTransaction(tx,{sigVerify:false,commitment:'confirmed'});
 console.log((sim.value.logs??[]).join('\n'));must(!sim.value.err,`${label} simulation failed: ${JSON.stringify(sim.value.err)}`);console.log(`${label} simulation passed`);
 if(mode!=='--apply')return false;
 const idl=JSON.parse(await readFile(new URL('target/idl/stolons.json',root),'utf8'));must(idl.address===programText,'IDL identity mismatch');
 const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('keypairs/devnet-wallet.json',root),'utf8'))));must(signer.publicKey.equals(wallet),'Signer mismatch');tx.sign([signer]);
 const signature=await connection.sendRawTransaction(tx.serialize(),{preflightCommitment:'confirmed'});
 const result=await connection.confirmTransaction({signature,...latest},'confirmed');must(!result.value.err,`${label} failed: ${JSON.stringify(result.value.err)}`);console.log(`${label}: ${signature}`);return true;
}
let pool=await readPool();
if(pool.status===0){
 must(lineage.status==='RootPending','Unexpected trading lineage');
 const [launchAccount,platformAccount]=await connection.getMultipleAccountsInfo([pool.configId,pool.platformId]);must(launchAccount?.owner.equals(launchpad)&&platformAccount?.owner.equals(launchpad),'External config owner mismatch');
 const launch=LaunchpadConfig.decode(launchAccount.data),platform=PlatformConfig.decode(platformAccount.data),BN=pool.realB.constructor;
 const budget=new BN('1100000000');
 const calculated=Curve.buyExactIn({poolInfo:pool,amountB:budget,protocolFeeRate:launch.tradeFeeRate,platformFeeRate:platform.feeRate,curveType:launch.curveType,shareFeeRate:new BN(0),creatorFeeRate:platform.creatorFeeRate,slot:await connection.getSlot()});
 const amount=calculated.amountB.lt(budget)?calculated.amountB:budget;
 must(calculated.amountA.amount.gte(pool.totalSellA.sub(pool.realA)),'1.1 SOL budget cannot finish curve');
 const ata=getAssociatedTokenAddressSync(mint,wallet),wsol=getAssociatedTokenAddressSync(quote,wallet);
 // Preserve any pre-existing wrapped SOL account and balance.
 const existing=await connection.getAccountInfo(wsol);
 console.log(JSON.stringify({mint:mintText,buySOL:Number(amount.toString())/1e9,expectedTokens:Number(calculated.amountA.amount.toString())/1e6,cpmmPool:cpmmPool.toBase58()},null,2));
 const instructions=[createAssociatedTokenAccountIdempotentInstruction(wallet,ata,wallet,mint),createAssociatedTokenAccountIdempotentInstruction(wallet,wsol,wallet,quote),SystemProgram.transfer({fromPubkey:wallet,toPubkey:wsol,lamports:BigInt(amount.toString())}),createSyncNativeInstruction(wsol),buyExactInInstruction(launchpad,wallet,getPdaLaunchpadAuth(launchpad).publicKey,pool.configId,pool.platformId,poolKey,ata,wsol,pool.vaultA,pool.vaultB,mint,quote,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,getPdaPlatformVault(launchpad,pool.platformId,quote).publicKey,getPdaCreatorVault(launchpad,pool.creator,quote).publicKey,amount,calculated.amountA.amount,new BN(0)),...(!existing?[createCloseAccountInstruction(wsol,wallet,wallet)]:[])];
 if(!await run('Finish root curve',instructions)){console.log('No transaction sent. Use --apply.');process.exit(0)}
 pool=await readPool();must(pool.status!==0,'Curve still trading; inspect before retrying');
}
if(pool.status===1){
 console.log('Curve complete; waiting up to 30 seconds for Raydium migration.');
 if(mode==='--apply')for(let i=0;i<6&&pool.status===1;i++){await new Promise(resolve=>setTimeout(resolve,5000));pool=await readPool()}
 if(pool.status===1){console.log('Raydium migration pending. Rerun this command later; it will not buy again.');process.exit(0)}
}
must(pool.status===2,'Unexpected LaunchLab status');
const migrated=await connection.getAccountInfo(cpmmPool);must(migrated?.owner.equals(cpmm),'Configured CPMM pool missing after migration');
lineage=await client.getLineage(mint);
const instructions=[];
if(lineage.status==='RootPending')instructions.push(buildInstruction(program,'register_root_migration',{config,lineage:lineageKey,mint,pool_state:poolKey,cpmm_pool:cpmmPool,launchlab_program:launchpad,cpmm_program:cpmm}));
else must(['RootQualified','RootActive'].includes(lineage.status),'Unexpected lineage status');
const reproduction=deriveReproductionAuthorityPda(program),reserve=deriveReproductionVaultPda(program,mint);
if(!lineage.reproductionReserveClaimed)instructions.push(buildInstruction(program,'claim_root_reproduction_reserve',{payer:wallet,config,lineage:lineageKey,mint,pool_state:poolKey,base_vault:pool.vaultA,vesting_record:getPdaVestId(launchpad,poolKey,reproduction).publicKey,reproduction_authority:reproduction,authority_ata:getAssociatedTokenAddressSync(mint,reproduction,true),vault_authority:deriveVaultAuthorityPda(program,mint),reproduction_vault:reserve,launchlab_authority:getPdaLaunchpadAuth(launchpad).publicKey,launchlab_program:launchpad,token_program:TOKEN_PROGRAM_ID,associated_token_program:ASSOCIATED_TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID}));
if(lineage.status!=='RootActive')instructions.push(buildInstruction(program,'activate_root',{config,lineage:lineageKey,mint}));
if(instructions.length&&!await run('Register migration, claim reserve, activate root',instructions)){console.log('No transaction sent. Use --apply.');process.exit(0)}
const [final,reserveAccount]=await Promise.all([client.getLineage(mint),getAccount(connection,reserve)]);
must(final.status==='RootActive'&&final.reproductionReserveClaimed&&final.cpmmPool.equals(cpmmPool)&&reserveAccount.amount===150000000000000n,'Root activation invariant failed');
console.log(`Verified RootActive with 150M reserve tokens and CPMM pool ${cpmmPool}`);
