import {assertCluster,raydiumPrograms} from './network.js';
import { Connection, PublicKey, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { LaunchpadPool, getPdaLaunchpadAuth, getPdaVestId } from '@raydium-io/raydium-sdk-v2';
import { StolonsClient } from './client.js';
import { buildInstruction } from './builders.js';
import { deriveConfigPda, deriveLineagePda, deriveCandidatePda, deriveFamilyPda, deriveReproductionAuthorityPda, deriveReproductionVaultPda, deriveVaultAuthorityPda } from './pda.js';
import { deriveCpmmPool, deriveLaunchLabPool } from './raydium.js';
import { decodeLaunchConfig } from './launch-validation.js';
import { SYSTEM_PROGRAM_ID } from './constants.js';
export type GraduationPhase = 'trading' | 'migrating' | 'register' | 'claim' | 'activate' | 'active';
export async function readGraduation(connection: Connection, programId: PublicKey, mint: PublicKey, cluster: 'devnet' | 'mainnet-beta' = 'devnet') {
  await assertCluster(connection,cluster);
  const programs=raydiumPrograms(cluster);
  const client = new StolonsClient(connection, programId), config = deriveConfigPda(programId);
  const [account, lineage] = await Promise.all([connection.getAccountInfo(config,'confirmed'),client.getLineage(mint)]);
  if (!account?.owner.equals(programId) || !lineage) throw new Error('Stolons lineage or configuration is missing.');
  const c = decodeLaunchConfig(account.data), cpmmProgram = new PublicKey(account.data.subarray(104,136)), cpmmConfig = new PublicKey(account.data.subarray(232,264));
  if (!c.launchpad.equals(programs.LAUNCHPAD_PROGRAM) || !cpmmProgram.equals(programs.CREATE_CPMM_POOL_PROGRAM) || !c.quote.equals(NATIVE_MINT)) throw new Error('Unsupported graduation configuration.');
  const launchPool = deriveLaunchLabPool(c.launchpad,mint,c.quote), cpmmPool = deriveCpmmPool(cpmmProgram,cpmmConfig,mint,c.quote);
  if (!lineage.launchPool.equals(launchPool)) throw new Error('Launch pool does not match this lineage.');
  const poolAccount = await connection.getAccountInfo(launchPool,'confirmed');
  if (!poolAccount?.owner.equals(c.launchpad)) throw new Error('Raydium launch pool is unavailable.');
  const pool = LaunchpadPool.decode(poolAccount.data);
  if (!pool.mintA.equals(mint) || !pool.mintB.equals(NATIVE_MINT) || !pool.platformId.equals(c.platform)) throw new Error('Launch pool identity mismatch.');
  const migratedAccount = pool.status === 2 ? await connection.getAccountInfo(cpmmPool,'confirmed') : null;
  let phase: GraduationPhase;
  if (pool.status === 0) phase='trading';
  else if (pool.status === 1 || (pool.status === 2 && !migratedAccount?.owner.equals(cpmmProgram))) phase='migrating';
  else if (pool.status !== 2) throw new Error('Unexpected Raydium migration status.');
  else if (['RootActive','DescendantActive'].includes(lineage.status)) phase='active';
  else if (['RootPending','CandidateLaunched'].includes(lineage.status)) phase='register';
  else if (['RootQualified','CandidateQualified'].includes(lineage.status)) phase=lineage.reproductionReserveClaimed ? 'activate' : 'claim';
  else throw new Error('This lineage cannot be activated through graduation.');
  return { phase, lineage, pool, config, c, cpmmProgram, cpmmPool, programId, mint };
}
export async function buildGraduationStep(connection: Connection, programId: PublicKey, mint: PublicKey, payer: PublicKey, lookupTable?: PublicKey, cluster: 'devnet' | 'mainnet-beta' = 'devnet') {
  const state = await readGraduation(connection,programId,mint,cluster);
  const { phase,lineage,pool,config,c,cpmmProgram,cpmmPool } = state;
  if (['trading','migrating','active'].includes(phase)) throw new Error(phase==='active'?'This family is already active.':phase==='trading'?'Finish the bonding curve first.':'Raydium migration is pending. Refresh shortly.');
  const child = !lineage.parentMint.equals(PublicKey.default), lineageKey=deriveLineagePda(programId,mint), candidate=deriveCandidatePda(programId,mint), parent=deriveLineagePda(programId,lineage.parentMint);
  let instruction;
  if (phase==='register') instruction=child ? buildInstruction(programId,'register_candidate_migration',{config,parent,parent_mint:lineage.parentMint,candidate,child_lineage:lineageKey,child_mint:mint,pool_state:lineage.launchPool,cpmm_pool:cpmmPool,launchlab_program:c.launchpad,cpmm_program:cpmmProgram}) : buildInstruction(programId,'register_root_migration',{config,lineage:lineageKey,mint,pool_state:lineage.launchPool,cpmm_pool:cpmmPool,launchlab_program:c.launchpad,cpmm_program:cpmmProgram});
  else if (phase==='claim') {
    const reproduction=deriveReproductionAuthorityPda(programId);
    instruction=buildInstruction(programId,child?'claim_candidate_reproduction_reserve':'claim_root_reproduction_reserve',{payer,config,candidate,lineage:lineageKey,mint,pool_state:lineage.launchPool,base_vault:pool.vaultA,vesting_record:getPdaVestId(c.launchpad,lineage.launchPool,reproduction).publicKey,reproduction_authority:reproduction,authority_ata:getAssociatedTokenAddressSync(mint,reproduction,true),vault_authority:deriveVaultAuthorityPda(programId,mint),reproduction_vault:deriveReproductionVaultPda(programId,mint),launchlab_authority:getPdaLaunchpadAuth(c.launchpad).publicKey,launchlab_program:c.launchpad,token_program:TOKEN_PROGRAM_ID,associated_token_program:ASSOCIATED_TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID});
  } else instruction=child ? buildInstruction(programId,'finalize_child',{config,family:deriveFamilyPda(programId,lineage.rootMint),root_mint:lineage.rootMint,parent,parent_mint:lineage.parentMint,candidate,child:lineageKey,child_mint:mint,parent_vault_authority:deriveVaultAuthorityPda(programId,lineage.parentMint),parent_reproduction_vault:deriveReproductionVaultPda(programId,lineage.parentMint),child_vault_authority:deriveVaultAuthorityPda(programId,mint),child_reproduction_vault:deriveReproductionVaultPda(programId,mint),token_program:TOKEN_PROGRAM_ID}) : buildInstruction(programId,'activate_root',{config,lineage:lineageKey,mint});
  const latest=await connection.getLatestBlockhash('confirmed');
  const table=lookupTable ? (await connection.getAddressLookupTable(lookupTable)).value : null;
  const message=new TransactionMessage({payerKey:payer,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),instruction]});
  const transaction=new VersionedTransaction(message.compileToV0Message(table?[table]:[]));
  if (transaction.serialize().length>1232) throw new Error('Graduation transaction requires the shared lookup table.');
  return { transaction,latest,quote:{quotedAt:Date.now()},phase,state,cluster };
}
