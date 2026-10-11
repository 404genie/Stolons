import {Connection,PublicKey,TransactionMessage,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {CpmmPoolInfoLayout,getPdaPoolAuthority,getPdaCreatorVault,getPdaCreatorFeeVaultAuth,getPdaPlatformVault,getPdaPlatformFeeVaultAuth,claimPlatformFeeFromVault} from '@raydium-io/raydium-sdk-v2';
import {assertCluster,type SolanaCluster} from './network.js';
import {decodeLaunchConfig} from './launch-validation.js';
import {decodeLaunchPool} from './raydium-layout.js';
import {StolonsClient} from './client.js';
import {buildInstruction} from './builders.js';
import {deriveConfigPda,deriveLineagePda,deriveFeeAuthorityPda,deriveFeeDistributionPda} from './pda.js';
import {ASSOCIATED_TOKEN_PROGRAM_ID,SYSTEM_PROGRAM_ID} from './constants.js';
import {deriveCpmmPool} from './raydium.js';

export function splitFeeCollection(previous:bigint,amount:bigint){
 if(previous<0n||previous>(1n<<128n)-1n||amount<0n||amount>(1n<<64n)-1n||previous+amount>(1n<<128n)-1n)throw Error('Fee accounting overflow.');
 const total=previous+amount,creator=(total+1n)/2n-(previous+1n)/2n;
 return {total,creator,treasury:amount-creator};
}
export function creatorFeeSharePda(cpmm:PublicKey,creator:PublicKey,config:PublicKey){return PublicKey.findProgramAddressSync([Buffer.from('creator_fee_share'),creator.toBuffer(),config.toBuffer()],cpmm)[0];}
export interface FeeInput {programId:PublicKey;mint:PublicKey;payer:PublicKey;cluster?:SolanaCluster;lookupTable?:PublicKey}
async function state(connection:Connection,input:FeeInput){
 await assertCluster(connection,input.cluster??'devnet');
 const config=deriveConfigPda(input.programId),[account,lineage]=await Promise.all([connection.getAccountInfo(config,'confirmed'),new StolonsClient(connection,input.programId).getLineage(input.mint)]);
 if(!account?.owner.equals(input.programId)||!lineage)throw Error('Registered token or config missing.');
 const c=decodeLaunchConfig(account.data);if(c.version!==2)throw Error('Enable fee sharing after the program upgrade before creating fee-sharing tokens.');
 return {config,c,lineage,authority:deriveFeeAuthorityPda(input.programId,input.mint),treasury:new PublicKey(account.data.subarray(40,72)),cpmm:new PublicKey(account.data.subarray(104,136)),cpmmConfig:new PublicKey(account.data.subarray(232,264))};
}
async function prepare(connection:Connection,input:FeeInput,instruction:ReturnType<typeof buildInstruction>){
 const latest=await connection.getLatestBlockhash('confirmed');
 const table=input.lookupTable?(await connection.getAddressLookupTable(input.lookupTable)).value:null;
 if(input.lookupTable&&(!table||!table.isActive()))throw Error('Fee collection lookup table is unavailable.');
 const message=new TransactionMessage({payerKey:input.payer,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:600000}),instruction]});
 const transaction=new VersionedTransaction(message.compileToV0Message(table?[table]:[]));
 try{if(transaction.serialize().length>1232)throw Error();}catch{throw Error('Fee collection requires an extended lookup table.');}
 return {transaction,latest,cluster:input.cluster??'devnet',quote:{quotedAt:Date.now()}};
}
export async function buildSharedCpmmFeeCollection(connection:Connection,input:FeeInput){
 const s=await state(connection,input),account=await connection.getAccountInfo(s.lineage.cpmmPool,'confirmed');
 if(!account?.owner.equals(s.cpmm)||!account.data.subarray(0,8).equals(Buffer.from([247,237,227,245,215,195,222,70])))throw Error('Registered CPMM pool missing.');
 const pool=CpmmPoolInfoLayout.decode(account.data);
 if(!pool.poolCreator.equals(s.authority))throw Error('This token retains legacy creator fee ownership; it cannot use shared collection.');
 if(!pool.configId.equals(s.cpmmConfig)||!deriveCpmmPool(s.cpmm,s.cpmmConfig,input.mint,s.c.quote).equals(s.lineage.cpmmPool)||!((pool.mintA.equals(input.mint)&&pool.mintB.equals(s.c.quote))||(pool.mintB.equals(input.mint)&&pool.mintA.equals(s.c.quote))))throw Error('CPMM pool does not match this token and configuration.');
 if(!pool.mintProgramA.equals(TOKEN_PROGRAM_ID)||!pool.mintProgramB.equals(TOKEN_PROGRAM_ID))throw Error('Shared fee collection supports classic SPL Token pools only.');
 const ata=(mint:PublicKey,owner:PublicKey)=>getAssociatedTokenAddressSync(mint,owner,true);
 const instruction=buildInstruction(input.programId,'collect_shared_cpmm_fees',{
 payer:input.payer,config:s.config,lineage:deriveLineagePda(input.programId,input.mint),mint:input.mint,creator:s.lineage.creator,treasury:s.treasury,fee_authority:s.authority,distribution:deriveFeeDistributionPda(input.programId,input.mint),pool_state:s.lineage.cpmmPool,amm_config:s.cpmmConfig,cpmm_authority:getPdaPoolAuthority(s.cpmm).publicKey,vault_0:pool.vaultA,vault_1:pool.vaultB,mint_0:pool.mintA,mint_1:pool.mintB,fee_0:ata(pool.mintA,s.authority),fee_1:ata(pool.mintB,s.authority),creator_0:ata(pool.mintA,s.lineage.creator),creator_1:ata(pool.mintB,s.lineage.creator),treasury_0:ata(pool.mintA,s.treasury),treasury_1:ata(pool.mintB,s.treasury),creator_fee_share:creatorFeeSharePda(s.cpmm,s.authority,s.cpmmConfig),cpmm_program:s.cpmm,token_program:TOKEN_PROGRAM_ID,associated_token_program:ASSOCIATED_TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID});
 return prepare(connection,input,instruction);
}
export async function buildCurveCreatorFeeClaim(connection:Connection,input:FeeInput){
 const s=await state(connection,input),account=await connection.getAccountInfo(s.lineage.launchPool,'confirmed');
 if(!account?.owner.equals(s.c.launchpad))throw Error('Registered LaunchLab pool missing.');
 const pool=decodeLaunchPool(account.data);
 if(!new PublicKey(pool.creator).equals(s.authority)||!new PublicKey(pool.baseMint).equals(input.mint))throw Error('This token retains legacy creator fee ownership.');
 return prepare(connection,input,buildInstruction(input.programId,'claim_curve_creator_fees',{
 payer:input.payer,config:s.config,lineage:deriveLineagePda(input.programId,input.mint),mint:input.mint,creator:s.lineage.creator,fee_authority:s.authority,pool_state:s.lineage.launchPool,creator_vault_authority:getPdaCreatorFeeVaultAuth(s.c.launchpad).publicKey,creator_fee_vault:getPdaCreatorVault(s.c.launchpad,s.authority,s.c.quote).publicKey,quote_mint:s.c.quote,fee_ata:getAssociatedTokenAddressSync(s.c.quote,s.authority,true),destination:getAssociatedTokenAddressSync(s.c.quote,s.lineage.creator,true),launchlab_program:s.c.launchpad,token_program:TOKEN_PROGRAM_ID,associated_token_program:ASSOCIATED_TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID}));
}
export function feeSharingEnableInstruction(programId:PublicKey,authority:PublicKey,platform:PublicKey){return buildInstruction(programId,'enable_fee_sharing',{config:deriveConfigPda(programId),authority,platform_config:platform});}

/** Treasury signs this sweep; the keeper never receives treasury authority. */
export async function buildTreasuryCurveFeeClaim(connection:Connection,input:FeeInput){
 await assertCluster(connection,input.cluster??'devnet');
 const account=await connection.getAccountInfo(deriveConfigPda(input.programId),'confirmed');
 if(!account?.owner.equals(input.programId))throw Error('Stolons config missing.');
 const c=decodeLaunchConfig(account.data),treasury=new PublicKey(account.data.subarray(40,72));
 if(!input.payer.equals(treasury))throw Error('Only the configured treasury may sign its platform fee claim.');
 const instruction=claimPlatformFeeFromVault(c.launchpad,c.platform,treasury,getPdaPlatformFeeVaultAuth(c.launchpad).publicKey,getPdaPlatformVault(c.launchpad,c.platform,c.quote).publicKey,getAssociatedTokenAddressSync(c.quote,treasury,true),c.quote,TOKEN_PROGRAM_ID);
 return prepare(connection,input,instruction);
}

export async function readPendingFees(connection:Connection,input:FeeInput){
 const s=await state(connection,input);
 const ata=(mint:PublicKey)=>getAssociatedTokenAddressSync(mint,s.authority,true);
 const [curve,pool,heldQuote,heldBase]=await connection.getMultipleAccountsInfo([getPdaCreatorVault(s.c.launchpad,s.authority,s.c.quote).publicKey,s.lineage.cpmmPool,ata(s.c.quote),ata(input.mint)],'confirmed');
 const amount=(account:typeof curve)=>account?.owner.equals(TOKEN_PROGRAM_ID)&&account.data.length>=165?account.data.readBigUInt64LE(64):0n;
 let cpmm=amount(heldQuote)+amount(heldBase);
 if(pool?.owner.equals(s.cpmm)){const p=CpmmPoolInfoLayout.decode(pool.data);if(!p.poolCreator.equals(s.authority))throw Error('Legacy CPMM creator.');cpmm+=BigInt(p.creatorFeesMintA.toString())+BigInt(p.creatorFeesMintB.toString());}
 return {curve:amount(curve),cpmm};
}
