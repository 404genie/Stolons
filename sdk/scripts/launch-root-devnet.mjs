import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getMint } from '@solana/spl-token';
import { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { DEVNET_PROGRAM_ID, LaunchpadConfig, Curve, CpmmCreatorFeeOn, initializeV2, getPdaLaunchpadAuth, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId, getPdaMetadataKey, getPdaPlatformId, getPdaVestId } from '@raydium-io/raydium-sdk-v2';
import { buildInstruction, appendAfterInitializeV2, deriveConfigPda, deriveFamilyPda, deriveLineagePda, deriveReproductionAuthorityPda, deriveVaultAuthorityPda, deriveReproductionVaultPda, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, INSTRUCTIONS_SYSVAR_ID, StolonsClient, decodeVestingRecord } from '../dist/index.js';
const [walletText, programText, mintText, mode='']=process.argv.slice(2);
if(!walletText||!programText||!mintText||!['','--apply'].includes(mode))throw new Error('Use bash scripts/devnet/launch-root.sh [--apply]');
const root=new URL('../../',import.meta.url);
const connection=new Connection('https://api.devnet.solana.com','confirmed');
const wallet=new PublicKey(walletText),program=new PublicKey(programText),mint=new PublicKey(mintText);
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
 must(lineage?.creator.equals(wallet)&&lineage.launchPool.equals(pool),'Existing lineage mismatch');
 console.log(`Root already registered: ${mintText} (${lineage.status})`);process.exit(0);
}
must(!loaded[2],'Root mint already exists without registration. Do not reuse it.');
const launch=LaunchpadConfig.decode(loaded[1].data);
const BN=launch.tradeFeeRate.constructor;
const bn=(value)=>new BN(value.toString());
const supply=bn(1_000_000_000_000_000n),locked=bn(150_000_000_000_000n),sell=bn(700_000_000_000_000n),raising=bn(1_000_000_000n);
Curve.checkParam({supply,totalFundRaising:raising,totalSell:sell,totalLockedAmount:locked,decimals:6,config:launch,migrateType:'cpmm'});
const init=initializeV2(launchpad,wallet,wallet,launchConfig,platform,getPdaLaunchpadAuth(launchpad).publicKey,pool,mint,quote,
 getPdaLaunchpadVaultId(launchpad,pool,mint).publicKey,getPdaLaunchpadVaultId(launchpad,pool,quote).publicKey,getPdaMetadataKey(mint).publicKey,TOKEN_PROGRAM_ID,
 6,'Stolons Root','STROOT','https://raw.githubusercontent.com/404genie/Stolons/devnet/codespaces/root.json',
 {type:'ConstantCurve',totalSellA:sell,migrateType:'cpmm',supply,totalFundRaisingB:raising},locked,bn(0),bn(0),CpmmCreatorFeeOn.OnlyTokenB);
const register=buildInstruction(program,'register_root_launch',{
 config,family:deriveFamilyPda(program,mint),lineage:deriveLineagePda(program,mint),creator:wallet,mint,pool_state:pool,
 platform_config:platform,vesting_record:vesting,reproduction_authority:reproduction,vault_authority:deriveVaultAuthorityPda(program,mint),
 reproduction_vault:deriveReproductionVaultPda(program,mint),quote_mint:quote,launchlab_program:launchpad,token_program:TOKEN_PROGRAM_ID,
 associated_token_program:ASSOCIATED_TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID,instructions:INSTRUCTIONS_SYSVAR_ID});
const instructions=appendAfterInitializeV2([init],launchpad,
 {platformConfig:platform,poolState:pool,baseMint:mint,quoteMint:quote},register);
const latest=await connection.getLatestBlockhash('confirmed');
const transaction=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:latest.blockhash,instructions}).compileToLegacyMessage());
const bytes=transaction.serialize().length;
must(bytes<=1232,`Atomic launch needs ${bytes} bytes; packet limit is 1232. No transaction sent.`);
console.log(JSON.stringify({cluster:'devnet',mint:mintText,pool:pool.toBase58(),vesting:vesting.toBase58(),transactionBytes:bytes,supplyTokens:1000000000,reserveTokens:150000000,curveSaleTokens:700000000,migrationTokens:150000000,graduationTargetSOL:1},null,2));
const simulated=await connection.simulateTransaction(transaction,{sigVerify:false,commitment:'confirmed'});
console.log((simulated.value.logs??[]).join('\n'));
must(!simulated.value.err,`Root simulation failed: ${JSON.stringify(simulated.value.err)}`);
console.log('Atomic root launch simulation passed.');
if(mode!=='--apply'){console.log('No transaction sent. Run bash scripts/devnet/launch-root.sh --apply to launch.');process.exit(0);}
const idl=JSON.parse(await readFile(new URL('target/idl/stolons.json',root),'utf8'));must(idl.address===programText,'IDL identity mismatch');
const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('keypairs/devnet-wallet.json',root),'utf8'))));
const mintSigner=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('keypairs/devnet-root-mint.json',root),'utf8'))));
must(signer.publicKey.equals(wallet)&&mintSigner.publicKey.equals(mint),'Signer mismatch');
transaction.sign([signer,mintSigner]);
const signature=await connection.sendRawTransaction(transaction.serialize(),{preflightCommitment:'confirmed'});
const confirmed=await connection.confirmTransaction({signature,...latest},'confirmed');must(!confirmed.value.err,`Launch failed: ${JSON.stringify(confirmed.value.err)}`);
await mkdir(new URL('target/devnet/',root),{recursive:true});
await writeFile(new URL('target/devnet/root-launch.json',root),JSON.stringify({mint:mintText,pool:pool.toBase58(),vesting:vesting.toBase58(),signature},null,2)+'\n');
console.log(`Root launched and registered: ${signature}`);
const [mintState,lineage,vestingAccount]=await Promise.all([getMint(connection,mint,'confirmed',TOKEN_PROGRAM_ID),new StolonsClient(connection,program).getLineage(mint),connection.getAccountInfo(vesting,'confirmed')]);
must(mintState.supply===1000000000000000n && mintState.decimals===6 && mintState.mintAuthority===null && mintState.freezeAuthority===null,'Post-launch mint invariant failed');
must(lineage?.creator.equals(wallet) && lineage.launchPool.equals(pool) && lineage.status==='RootPending','Post-launch lineage invariant failed');
must(vestingAccount?.owner.equals(launchpad),'Post-launch vesting owner mismatch');
const record=decodeVestingRecord(vestingAccount.data);
must(record.shareAmount===150000000000000n && record.claimedAmount===0n && new PublicKey(record.beneficiary).equals(reproduction),'Post-launch vesting invariant failed');
console.log(`Verified RootPending lineage, fixed supply, revoked authorities, and 150M vesting reserve for ${mintText}`);
