import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getMint } from '@solana/spl-token';
import { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, AddressLookupTableProgram, AddressLookupTableAccount, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import { DEVNET_PROGRAM_ID, LaunchpadConfig, Curve, CpmmCreatorFeeOn, initializeV2, getPdaLaunchpadAuth, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId, getPdaMetadataKey, getPdaPlatformId, getPdaVestId } from '@raydium-io/raydium-sdk-v2';
import { buildInstruction, appendAfterInitializeV2, deriveConfigPda, deriveFamilyPda, deriveCandidatePda, deriveLineagePda, deriveReproductionAuthorityPda, deriveVaultAuthorityPda, deriveReproductionVaultPda, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, INSTRUCTIONS_SYSVAR_ID, StolonsClient, decodeVestingRecord } from '../dist/index.js';
const [walletText, programText, parentText, mintText, mode='']=process.argv.slice(2);
if(!walletText||!programText||!parentText||!mintText||!['','--apply'].includes(mode))throw new Error('Use bash scripts/devnet/launch-child.sh [--apply]');
const root=new URL('../../',import.meta.url);
const connection=new Connection('https://api.devnet.solana.com','confirmed');
const wallet=new PublicKey(walletText),program=new PublicKey(programText),mint=new PublicKey(mintText),parentMint=new PublicKey(parentText);
const launchpad=DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM,launchConfig=DEVNET_PROGRAM_ID.LAUNCHPAD_CONFIG;
const quote=new PublicKey('So11111111111111111111111111111111111111112');
const platform=getPdaPlatformId(launchpad,wallet).publicKey;
const pool=getPdaLaunchpadPoolId(launchpad,mint,quote).publicKey;
const reproduction=deriveReproductionAuthorityPda(program);
const vesting=getPdaVestId(launchpad,pool,reproduction).publicKey;
const config=deriveConfigPda(program);
const must=(condition,message)=>{if(!condition)throw new Error(message)};
const loaded=await connection.getMultipleAccountsInfo([config,launchConfig,mint,deriveLineagePda(program,mint)]);
must(loaded[0]?.owner.equals(program),'Stolons configuration missing');
must(loaded[1]?.owner.equals(launchpad),'LaunchLab configuration missing');
const c=loaded[0].data;
must(new PublicKey(c.subarray(8,40)).equals(wallet),'Wrong Stolons authority');
for(const[key,offset]of[[launchpad,72],[launchConfig,136],[platform,168],[quote,200]])must(new PublicKey(c.subarray(offset,offset+32)).equals(key),'Stolons external configuration mismatch');
must(c[304]===0,'Stolons is paused');
if(loaded[3]){
 const lineage=await new StolonsClient(connection,program).getLineage(mint);
 must(lineage?.creator.equals(wallet)&&lineage.launchPool.equals(pool)&&lineage.parentMint.equals(parentMint),'Existing lineage mismatch');
 console.log(`Child already registered: ${mintText} (${lineage.status})`);process.exit(0);
}
must(!loaded[2],'Child mint already exists without registration. Do not reuse it.');
const candidate=deriveCandidatePda(program,mint),client=new StolonsClient(connection,program);
const [candidateAccount,parentState,clock]=await Promise.all([connection.getAccountInfo(candidate),client.getLineage(parentMint),connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY)]);
must(candidateAccount?.owner.equals(program),'Candidate missing');
const candidateData=candidateAccount.data;
must(candidateData[168]===1 && new PublicKey(candidateData.subarray(8,40)).equals(parentMint) && new PublicKey(candidateData.subarray(40,72)).equals(mint),'Candidate identity or selection mismatch');
must(parentState?.activeCandidate.equals(mint) && parentState.status==='RootActive','Parent candidate mismatch');
must(clock.data.readBigInt64LE(32)<=candidateData.readBigInt64LE(177),'Candidate launch deadline passed');
const proposal=new PublicKey(candidateData.subarray(104,136));
const launch=LaunchpadConfig.decode(loaded[1].data);
const BN=launch.tradeFeeRate.constructor;
const bn=(value)=>new BN(value.toString());
const supply=bn(1_000_000_000_000_000n),locked=bn(150_000_000_000_000n),sell=bn(700_000_000_000_000n),raising=bn(1_000_000_000n);
Curve.checkParam({supply,totalFundRaising:raising,totalSell:sell,totalLockedAmount:locked,decimals:6,config:launch,migrateType:'cpmm'});
const init=initializeV2(launchpad,wallet,wallet,launchConfig,platform,getPdaLaunchpadAuth(launchpad).publicKey,pool,mint,quote,
 getPdaLaunchpadVaultId(launchpad,pool,mint).publicKey,getPdaLaunchpadVaultId(launchpad,pool,quote).publicKey,getPdaMetadataKey(mint).publicKey,TOKEN_PROGRAM_ID,
 6,'Stolons Child','STCHILD','https://raw.githubusercontent.com/404genie/Stolons/devnet/codespaces/child.json',
 {type:'ConstantCurve',totalSellA:sell,migrateType:'cpmm',supply,totalFundRaisingB:raising},locked,bn(0),bn(0),CpmmCreatorFeeOn.OnlyTokenB);
const register=buildInstruction(program,'register_candidate_launch',{
 launcher:wallet,config,parent:deriveLineagePda(program,parentMint),parent_mint:parentMint,candidate,proposal,child_mint:mint,child_lineage:deriveLineagePda(program,mint),family:deriveFamilyPda(program,parentState.rootMint),root_mint:parentState.rootMint,pool_state:pool,
 platform_config:platform,vesting_record:vesting,reproduction_authority:reproduction,vault_authority:deriveVaultAuthorityPda(program,mint),
 reproduction_vault:deriveReproductionVaultPda(program,mint),quote_mint:quote,launchlab_program:launchpad,token_program:TOKEN_PROGRAM_ID,
 associated_token_program:ASSOCIATED_TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID,instructions:INSTRUCTIONS_SYSVAR_ID});
const instructions=appendAfterInitializeV2([init],launchpad,
 {platformConfig:platform,poolState:pool,baseMint:mint,quoteMint:quote},register);
let signer;
if(mode==='--apply'){
 const idl=JSON.parse(await readFile(new URL('target/idl/stolons.json',root),'utf8'));must(idl.address===programText,'IDL identity mismatch');
 signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('keypairs/devnet-wallet.json',root),'utf8'))));must(signer.publicKey.equals(wallet),'Wallet mismatch');
}
const tableReceipt=new URL('target/devnet/child-launch-table.json',root);
let tableKey;
try {const saved=JSON.parse(await readFile(tableReceipt,'utf8'));must(saved.mint===mintText && saved.wallet===walletText,'Lookup table receipt mismatch');tableKey=new PublicKey(saved.table)}catch(error){if(error.code!=='ENOENT')throw error}
const addresses=[...new Map(instructions.flatMap(ix=>ix.keys).filter(k=>!k.isSigner).map(k=>[k.pubkey.toBase58(),k.pubkey])).values()];
async function sendTable(label,ixs){
 const latest=await connection.getLatestBlockhash();
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:latest.blockhash,instructions:ixs}).compileToLegacyMessage());tx.sign([signer]);
 const signature=await connection.sendRawTransaction(tx.serialize(),{preflightCommitment:'confirmed'});
 const result=await connection.confirmTransaction({signature,...latest},'confirmed');must(!result.value.err,`${label} failed: ${JSON.stringify(result.value.err)}`);console.log(`${label}: ${signature}`);
}
let table=tableKey?(await connection.getAddressLookupTable(tableKey)).value:null;
if(tableKey)must(table && table.state.authority?.equals(wallet),'Saved lookup table missing or wrong authority');
if(!table){
 if(mode!=='--apply'){
  const preview=new AddressLookupTableAccount({key:wallet,state:{deactivationSlot:18446744073709551615n,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,authority:wallet,addresses}});
  const latest=await connection.getLatestBlockhash();const previewTx=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:latest.blockhash,instructions}).compileToV0Message([preview]));
  must(previewTx.serialize().length<=1232,'Child launch exceeds packet limit even with lookup table');
  console.log(`Child launch needs an address lookup table; projected size ${previewTx.serialize().length} bytes. No transaction sent. Run with --apply to create the table, simulate, and launch.`);process.exit(0);
 }
 const slot=await connection.getSlot('finalized');const [create,key]=AddressLookupTableProgram.createLookupTable({authority:wallet,payer:wallet,recentSlot:slot});tableKey=key;
 await sendTable('Create child launch lookup table',[create]);
 await mkdir(new URL('target/devnet/',root),{recursive:true});await writeFile(tableReceipt,JSON.stringify({mint:mintText,wallet:walletText,table:tableKey.toBase58()},null,2)+'\n');
 table=(await connection.getAddressLookupTable(tableKey)).value;must(table,'Lookup table not visible');
}
const missing=addresses.filter(key=>!table.state.addresses.some(existing=>existing.equals(key)));
if(missing.length){
 must(mode==='--apply','Lookup table needs extension; rerun with --apply');
 for(let i=0;i<missing.length;i+=20)await sendTable('Extend child launch lookup table',[AddressLookupTableProgram.extendLookupTable({authority:wallet,payer:wallet,lookupTable:tableKey,addresses:missing.slice(i,i+20)})]);
 table=(await connection.getAddressLookupTable(tableKey)).value;
}
for(let i=0;(await connection.getSlot('confirmed'))<=table.state.lastExtendedSlot;i++){must(i<30,'Lookup table activation timed out; rerun safely');await new Promise(resolve=>setTimeout(resolve,500))}
const latest=await connection.getLatestBlockhash('confirmed');
const transaction=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:latest.blockhash,instructions}).compileToV0Message([table]));
const bytes=transaction.serialize().length;must(bytes<=1232,`Atomic child launch needs ${bytes} bytes`);
console.log(JSON.stringify({cluster:'devnet',parent:parentText,mint:mintText,pool:pool.toBase58(),vesting:vesting.toBase58(),transactionBytes:bytes,lookupTable:tableKey.toBase58()},null,2));
const simulated=await connection.simulateTransaction(transaction,{sigVerify:false,commitment:'confirmed'});
console.log((simulated.value.logs??[]).join('\n'));
must(!simulated.value.err,`Child simulation failed: ${JSON.stringify(simulated.value.err)}`);
console.log('Atomic child launch simulation passed.');
if(mode!=='--apply'){console.log('No transaction sent. Run bash scripts/devnet/launch-child.sh --apply to launch.');process.exit(0);}
const mintSigner=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('keypairs/devnet-child-mint.json',root),'utf8'))));
must(signer.publicKey.equals(wallet)&&mintSigner.publicKey.equals(mint),'Signer mismatch');
transaction.sign([signer,mintSigner]);
const signature=await connection.sendRawTransaction(transaction.serialize(),{preflightCommitment:'confirmed'});
const confirmed=await connection.confirmTransaction({signature,...latest},'confirmed');must(!confirmed.value.err,`Launch failed: ${JSON.stringify(confirmed.value.err)}`);
await mkdir(new URL('target/devnet/',root),{recursive:true});
await writeFile(new URL('target/devnet/child-launch.json',root),JSON.stringify({mint:mintText,pool:pool.toBase58(),vesting:vesting.toBase58(),signature},null,2)+'\n');
console.log(`Child launched and registered: ${signature}`);
const [mintState,lineage,vestingAccount]=await Promise.all([getMint(connection,mint,'confirmed',TOKEN_PROGRAM_ID),new StolonsClient(connection,program).getLineage(mint),connection.getAccountInfo(vesting,'confirmed')]);
must(mintState.supply===1000000000000000n && mintState.decimals===6 && mintState.mintAuthority===null && mintState.freezeAuthority===null,'Post-launch mint invariant failed');
must(lineage?.creator.equals(wallet) && lineage.launchPool.equals(pool) && lineage.status==='CandidateLaunched' && lineage.parentMint.equals(parentMint) && lineage.rootMint.equals(parentState.rootMint) && lineage.generation===1,'Post-launch lineage invariant failed');
must(vestingAccount?.owner.equals(launchpad),'Post-launch vesting owner mismatch');
const record=decodeVestingRecord(vestingAccount.data);
must(record.shareAmount===150000000000000n && record.claimedAmount===0n && new PublicKey(record.beneficiary).equals(reproduction),'Post-launch vesting invariant failed');
console.log(`Verified CandidateLaunched lineage, fixed supply, revoked authorities, and 150M vesting reserve for ${mintText}`);
