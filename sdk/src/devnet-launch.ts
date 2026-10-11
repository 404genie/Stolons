import { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { DEVNET_PROGRAM_ID, LaunchpadConfig, Curve, CpmmCreatorFeeOn, initializeV2, getPdaLaunchpadAuth, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId, getPdaMetadataKey, getPdaVestId } from "@raydium-io/raydium-sdk-v2";
import { buildInstruction } from "./builders.js";
import { appendAfterInitializeV2 } from "./raydium.js";
import { deriveConfigPda, deriveFamilyPda, deriveLineagePda, deriveReproductionAuthorityPda, deriveVaultAuthorityPda, deriveReproductionVaultPda } from "./pda.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, INSTRUCTIONS_SYSVAR_ID } from "./constants.js";
import { decodeLaunchConfig, DEVNET_GENESIS_HASH, validateLaunchDetails } from "./launch-validation.js";

export interface RootLaunchInput {
  programId: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  metadataUri: string;
}

/** Uses the deployed platform, not a new platform derived from each creator. */
export async function buildDevnetRootLaunch(connection: Connection, input: RootLaunchInput) {
  validateLaunchDetails(input.name, input.symbol, input.metadataUri);
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error("Root launches are enabled on Solana devnet only.");
  const { creator, mint, programId } = input;
  const config = deriveConfigPda(programId);
  const configAccount = await connection.getAccountInfo(config, "confirmed");
  if (!configAccount?.owner.equals(programId)) throw new Error("Stolons configuration is missing.");
  const c = decodeLaunchConfig(configAccount.data);
  if (!c.launchpad.equals(DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM) || !c.launchConfig.equals(DEVNET_PROGRAM_ID.LAUNCHPAD_CONFIG) || !c.quote.equals(new PublicKey("So11111111111111111111111111111111111111112"))) throw new Error("Configuration does not match the supported Raydium devnet launch.");
  const [launchAccount, mintAccount, lineageAccount] = await connection.getMultipleAccountsInfo([c.launchConfig, mint, deriveLineagePda(programId, mint)], "confirmed");
  if (!launchAccount?.owner.equals(c.launchpad)) throw new Error("Raydium launch configuration is missing.");
  if (mintAccount || lineageAccount) throw new Error("This mint already exists. Inspect its token page before starting another launch.");
  const pool = getPdaLaunchpadPoolId(c.launchpad, mint, c.quote).publicKey;
  const reproduction = deriveReproductionAuthorityPda(programId);
  const vesting = getPdaVestId(c.launchpad, pool, reproduction).publicKey;
  const launch = LaunchpadConfig.decode(launchAccount.data);
  const BN = launch.tradeFeeRate.constructor as { new(value: string): typeof launch.tradeFeeRate };
  const bn = (value: bigint) => new BN(value.toString());
  const supply = bn(1_000_000_000_000_000n), locked = bn(150_000_000_000_000n), sell = bn(800_000_000_000_000n), raising = bn(1_000_000_000n);
  Curve.checkParam({ supply, totalFundRaising: raising, totalSell: sell, totalLockedAmount: locked, decimals: 6, config: launch, migrateType: "cpmm" });
  const init = initializeV2(c.launchpad, creator, creator, c.launchConfig, c.platform, getPdaLaunchpadAuth(c.launchpad).publicKey, pool, mint, c.quote,
    getPdaLaunchpadVaultId(c.launchpad, pool, mint).publicKey, getPdaLaunchpadVaultId(c.launchpad, pool, c.quote).publicKey,
    getPdaMetadataKey(mint).publicKey, TOKEN_PROGRAM_ID, 6, input.name, input.symbol, input.metadataUri,
    { type: "ConstantCurve", totalSellA: sell, migrateType: "cpmm", supply, totalFundRaisingB: raising }, locked, bn(0n), bn(0n), CpmmCreatorFeeOn.OnlyTokenB);
  const registration = buildInstruction(programId, "register_root_launch", {
    config, family: deriveFamilyPda(programId, mint), lineage: deriveLineagePda(programId, mint), creator, mint, pool_state: pool,
    platform_config: c.platform, vesting_record: vesting, reproduction_authority: reproduction,
    vault_authority: deriveVaultAuthorityPda(programId, mint), reproduction_vault: deriveReproductionVaultPda(programId, mint),
    quote_mint: c.quote, launchlab_program: c.launchpad, token_program: TOKEN_PROGRAM_ID,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID, system_program: SYSTEM_PROGRAM_ID, instructions: INSTRUCTIONS_SYSVAR_ID
  });
  const instructions = appendAfterInitializeV2([init], c.launchpad, { platformConfig: c.platform, poolState: pool, baseMint: mint, quoteMint: c.quote }, registration);
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: creator, recentBlockhash: latest.blockhash, instructions }).compileToLegacyMessage());
  let size: number;
  try { size = transaction.serialize().length; } catch { throw new Error("Launch exceeds the transaction size limit. Use a shorter metadata URL or token name."); }
  if (size > 1232) throw new Error("Launch exceeds the transaction size limit. Use a shorter metadata URL or token name.");
  return { transaction, latest, pool, mint, creator };
}

export type PreparedRootLaunch = Awaited<ReturnType<typeof buildDevnetRootLaunch>>;

export async function simulateRootLaunch(connection: Connection, prepared: PreparedRootLaunch): Promise<number> {
  const [before, result] = await Promise.all([
    connection.getBalance(prepared.creator, "confirmed"),
    connection.simulateTransaction(prepared.transaction, { sigVerify: false, commitment: "confirmed", accounts: { encoding: "base64", addresses: [prepared.creator.toBase58()] } })
  ]);
  if (result.value.err) throw new Error(`Launch simulation failed: ${JSON.stringify(result.value.err)}. Check your devnet SOL balance and protocol configuration.`);
  const after = result.value.accounts?.[0]?.lamports;
  if (after === undefined) throw new Error("RPC did not return a launch cost estimate.");
  return Math.max(0, before - after);
}

export class LaunchSubmittedError extends Error {
  constructor(readonly signature: string, message: string) { super(message); this.name = "LaunchSubmittedError"; }
}

/** Refresh the prepared launch before calling. No wallet prompt if simulation fails. */
export async function sendRootLaunch(connection: Connection, prepared: PreparedRootLaunch, mintSigner: Keypair, signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>): Promise<string> {
  if (!mintSigner.publicKey.equals(prepared.mint)) throw new Error("Mint signer does not match this launch.");
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error("Root launches are enabled on Solana devnet only.");
  await simulateRootLaunch(connection, prepared);
  prepared.transaction.sign([mintSigner]);
  const signed = await signTransaction(prepared.transaction);
  let signature: string;
  try { signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" }); }
  catch { throw new LaunchSubmittedError("", "Submission status is unavailable. Inspect this mint before retrying; the transaction may have reached the network."); }
  try {
    const confirmed = await connection.confirmTransaction({ signature, ...prepared.latest }, "confirmed");
    if (confirmed.value.err) throw new Error(`On-chain launch failed: ${JSON.stringify(confirmed.value.err)}`);
    return signature;
  } catch (cause) {
    throw new LaunchSubmittedError(signature, `${cause instanceof Error ? cause.message : "Confirmation unavailable"}. Inspect the transaction before retrying.`);
  }
}
