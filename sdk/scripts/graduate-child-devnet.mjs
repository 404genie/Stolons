import {readFile} from 'node:fs/promises';
import {Connection,PublicKey,Keypair,TransactionMessage,VersionedTransaction,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createSyncNativeInstruction,createCloseAccountInstruction,getAccount,getMint} from '@solana/spl-token';
import {DEVNET_PROGRAM_ID,LaunchpadPool,LaunchpadConfig,PlatformConfig,Curve,buyExactInInstruction,getPdaLaunchpadAuth,getPdaPlatformVault,getPdaCreatorVault,getPdaVestId} from '@raydium-io/raydium-sdk-v2';
import {StolonsClient,buildInstruction,deriveConfigPda,deriveCandidatePda,deriveFamilyPda,deriveLineagePda,deriveLaunchLabPool,deriveCpmmPool,deriveReproductionAuthorityPda,deriveVaultAuthorityPda,deriveReproductionVaultPda,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,SYSTEM_PROGRAM_ID} from '../dist/index.js';
const [walletText,programText,parentText,mintText,mode='']=process.argv.slice(2);
if(!walletText||!programText||!parentText||!mintText||!['','--apply'].includes(mode))throw Error('Use bash scripts/devnet/graduate-child.sh [--apply]');
const root=new URL('../../',import.meta.url),connection=new Connection('https://api.devnet.solana.com','confirmed');
const wallet=new PublicKey(walletText),program=new PublicKey(programText),mint=new PublicKey(mintText),parentMint=new PublicKey(parentText),quote=new PublicKey('So11111111111111111111111111111111111111112');
const launchpad=DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM,cpmm=DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
const config=deriveConfigPda(program),lineageKey=deriveLineagePda(program,mint),poolKey=deriveLaunchLabPool(launchpad,mint,quote),client=new StolonsClient(connection,program);
const must=(ok,message)=>{if(!ok)throw Error(message)};
const configAccount=await connection.getAccountInfo(config);must(configAccount?.owner.equals(program),'Configuration missing');
const c=configAccount.data;
for(const [key,offset] of [[wallet,8],[launchpad,72],[cpmm,104],[quote,200]])must(new PublicKey(c.subarray(offset,offset+32)).equals(key),'Configuration mismatch');
must(c[304]===0,'Protocol paused');
const cpmmConfig=new PublicKey(c.subarray(232,264)),cpmmPool=deriveCpmmPool(cpmm,cpmmConfig,mint,quote);
let lineage=await client.getLineage(mint);must(lineage?.creator.equals(wallet)&&lineage.launchPool.equals(poolKey)&&lineage.parentMint.equals(parentMint),'Child identity mismatch');
const parent=deriveLineagePda(program,parentMint),candidate=deriveCandidatePda(program,mint),parentState=await client.getLineage(parentMint);
must(parentState?.status==='RootActive'&&lineage.rootMint.equals(parentState.rootMint),'Expected root parent');
const savedTable=JSON.parse(await readFile(new URL('target/devnet/child-launch-table.json',root),'utf8'));
must(savedTable.wallet===walletText&&savedTable.mint===mintText,'Lookup table identity mismatch');
const lookup=(await connection.getAddressLookupTable(new PublicKey(savedTable.table))).value;must(lookup?.state.authority?.equals(wallet),'Lookup table missing or authority mismatch');
async function readPool(){const account=await connection.getAccountInfo(poolKey);must(account?.owner.equals(launchpad),'Launch pool owner mismatch');return LaunchpadPool.decode(account.data)}
async function run(label,instructions){
 const latest=await connection.getLatestBlockhash();
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...instructions]}).compileToV0Message([lookup]));
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
 must(lineage.status==='CandidateLaunched','Unexpected trading lineage');
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
 if(!await run('Finish child curve',instructions)){console.log('No transaction sent. Use --apply.');process.exit(0)}
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
if(lineage.status==='CandidateLaunched')instructions.push(buildInstruction(program,'register_candidate_migration',{config,parent,parent_mint:parentMint,candidate,child_lineage:lineageKey,child_mint:mint,pool_state:poolKey,cpmm_pool:cpmmPool,launchlab_program:launchpad,cpmm_program:cpmm}));
else must(['CandidateQualified','DescendantActive'].includes(lineage.status),'Unexpected child lineage status');
const reproduction=deriveReproductionAuthorityPda(program),reserve=deriveReproductionVaultPda(program,mint);
if(!lineage.reproductionReserveClaimed)instructions.push(buildInstruction(program,'claim_candidate_reproduction_reserve',{payer:wallet,config,candidate,lineage:lineageKey,mint,pool_state:poolKey,base_vault:pool.vaultA,vesting_record:getPdaVestId(launchpad,poolKey,reproduction).publicKey,reproduction_authority:reproduction,authority_ata:getAssociatedTokenAddressSync(mint,reproduction,true),vault_authority:deriveVaultAuthorityPda(program,mint),reproduction_vault:reserve,launchlab_authority:getPdaLaunchpadAuth(launchpad).publicKey,launchlab_program:launchpad,token_program:TOKEN_PROGRAM_ID,associated_token_program:ASSOCIATED_TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID}));
if(lineage.status!=='DescendantActive')instructions.push(buildInstruction(program,'finalize_child',{config,family:deriveFamilyPda(program,parentState.rootMint),root_mint:parentState.rootMint,parent,parent_mint:parentMint,candidate,child:lineageKey,child_mint:mint,parent_vault_authority:deriveVaultAuthorityPda(program,parentMint),parent_reproduction_vault:deriveReproductionVaultPda(program,parentMint),child_vault_authority:deriveVaultAuthorityPda(program,mint),child_reproduction_vault:reserve,token_program:TOKEN_PROGRAM_ID}));
if(instructions.length){
 must(parentState.directChildrenCount===0&&parentState.activeCandidate.equals(mint),'This helper tests the first child only');
 if(!await run('Register child migration, claim reserve, settle child',instructions)){console.log('No transaction sent. Use --apply.');process.exit(0)}
}
const [final,reserveAccount,finalParent,parentReserve,parentMintState,childMintState,familyAccount,candidateAccount]=await Promise.all([client.getLineage(mint),getAccount(connection,reserve),client.getLineage(parentMint),getAccount(connection,deriveReproductionVaultPda(program,parentMint)),getMint(connection,parentMint),getMint(connection,mint),connection.getAccountInfo(deriveFamilyPda(program,parentState.rootMint)),connection.getAccountInfo(candidate)]);
must(final.status==='DescendantActive'&&final.reproductionReserveClaimed&&final.cpmmPool.equals(cpmmPool)&&reserveAccount.amount===150000000000000n,'Child activation invariant failed');
must(finalParent.directChildrenCount===1&&finalParent.activeCandidate.equals(PublicKey.default)&&finalParent.activeEpoch.equals(PublicKey.default),'Parent lifecycle invariant failed');
must(parentMintState.supply===990000000000000n&&parentReserve.amount===140000000000000n&&childMintState.supply===1000000000000000n,'Parent burn or child supply invariant failed');
must(finalParent.selfRootMass===990000000000000n&&final.selfRootMass===10000000000000n&&finalParent.selfRootMass+final.selfRootMass===1000000000000000n,'Root mass conservation invariant failed');
must(familyAccount?.owner.equals(program)&&familyAccount.data.readBigUInt64LE(56)===1n&&candidateAccount?.owner.equals(program)&&candidateAccount.data[168]===5&&candidateAccount.data[274]===1,'Family or candidate settlement invariant failed');
console.log(JSON.stringify({status:'DescendantActive',child:mintText,cpmmPool:cpmmPool.toBase58(),childReserveTokens:150000000,parentBurnedTokens:10000000,parentSupplyTokens:990000000,parentReserveTokens:140000000,parentRootMass:finalParent.selfRootMass.toString(),childRootMass:final.selfRootMass.toString(),familyRootMassConserved:true},null,2));
console.log('Verified DescendantActive child, 10M parent burn, 150M child reserve, and conserved family root mass.');
