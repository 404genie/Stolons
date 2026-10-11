import { Connection, PublicKey, Keypair, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, ACCOUNT_SIZE, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createInitializeAccountInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import { DEVNET_PROGRAM_ID, LaunchpadPool, LaunchpadConfig, PlatformConfig, Curve, getPdaLaunchpadPoolId, getPdaLaunchpadAuth, getPdaPlatformVault, getPdaCreatorVault, buyExactInInstruction, sellExactInInstruction } from '@raydium-io/raydium-sdk-v2';
import { deriveConfigPda } from './pda.js';
import { StolonsClient } from './client.js';
import { decodeLaunchConfig, DEVNET_GENESIS_HASH } from './launch-validation.js';

export type TradeSide = 'buy' | 'sell';
export interface TradeInput { programId: PublicKey; mint: PublicKey; owner: PublicKey; side: TradeSide; amount: bigint; slippageBps: number }
export function parseTradeAmount(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9 || !/^\d+(\.\d+)?$/.test(text.trim())) throw new Error('Enter a positive decimal amount.');
  const [whole, fraction = ''] = text.trim().split('.');
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const amount = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) throw new Error('Amount is outside the supported range.');
  return amount;
}
export function formatTradeAmount(amount: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const fraction = (amount % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${amount / unit}${fraction ? `.${fraction}` : ''}`;
}
export function tradeMinimum(output: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 1000) throw new Error('Slippage must be between 0.01% and 10%.');
  const minimum = output * BigInt(10_000 - slippageBps) / 10_000n;
  if (minimum <= 0n) throw new Error('Trade is too small to produce a positive minimum output.');
  return minimum;
}
async function readMarket(connection: Connection, input: TradeInput) {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Trading is enabled on Solana devnet only.');
  const account = await connection.getAccountInfo(deriveConfigPda(input.programId), 'confirmed');
  if (!account?.owner.equals(input.programId)) throw new Error('Stolons configuration is missing.');
  const c = decodeLaunchConfig(account.data);
  if (!c.launchpad.equals(DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM) || !c.launchConfig.equals(DEVNET_PROGRAM_ID.LAUNCHPAD_CONFIG) || !c.quote.equals(NATIVE_MINT)) throw new Error('Unsupported trading configuration.');
  const lineage = await new StolonsClient(connection, input.programId).getLineage(input.mint);
  const poolId = getPdaLaunchpadPoolId(c.launchpad, input.mint, NATIVE_MINT).publicKey;
  if (!lineage || !lineage.launchPool.equals(poolId)) throw new Error('This mint is not a registered Stolons launch.');
  const [poolAccount, configAccount, platformAccount, mintAccount] = await connection.getMultipleAccountsInfo([poolId, c.launchConfig, c.platform, input.mint], 'confirmed');
  if (![poolAccount, configAccount, platformAccount].every(a => a?.owner.equals(c.launchpad)) || !mintAccount?.owner.equals(TOKEN_PROGRAM_ID)) throw new Error('Trading accounts are unavailable or have unexpected owners.');
  const pool = LaunchpadPool.decode(poolAccount!.data), config = LaunchpadConfig.decode(configAccount!.data), platform = PlatformConfig.decode(platformAccount!.data);
  if (!pool.mintA.equals(input.mint) || !pool.mintB.equals(NATIVE_MINT) || !pool.configId.equals(c.launchConfig) || !pool.platformId.equals(c.platform) || pool.mintDecimalsA !== 6 || pool.mintDecimalsB !== 9) throw new Error('Pool does not match this token.');
  if (pool.status !== 0) throw new Error('This token has completed its bonding curve. CPMM trading will be available in the next update.');
  return { c, poolId, pool, config, platform };
}
export async function quoteDevnetTrade(connection: Connection, input: TradeInput) {
  if (input.side !== 'buy' && input.side !== 'sell') throw new Error('Choose buy or sell.');
  if (input.amount <= 0n || input.amount > 18_446_744_073_709_551_615n) throw new Error('Amount is outside the supported range.');
  tradeMinimum(10_000n, input.slippageBps);
  const market = await readMarket(connection, input);
  const { pool, config, platform } = market;
  const BN = config.tradeFeeRate.constructor as { new(value: string): typeof config.tradeFeeRate };
  const amount = new BN(input.amount.toString());
  const fees = { poolInfo: pool, protocolFeeRate: config.tradeFeeRate, platformFeeRate: platform.feeRate, creatorFeeRate: platform.creatorFeeRate, curveType: config.curveType, shareFeeRate: new BN('0'), transferFeeConfigA: undefined, transferFeeConfigB: undefined, slot: 0 };
  const result = input.side === 'buy' ? Curve.buyExactIn({ ...fees, amountB: amount }) : Curve.sellExactIn({ ...fees, amountA: amount });
  const actualInput = BigInt((input.side === 'buy' ? result.amountB : result.amountA.amount).toString());
  if (actualInput !== input.amount) throw new Error('This amount exceeds the remaining curve liquidity. Try a smaller trade.');
  const output = BigInt((input.side === 'buy' ? result.amountA.amount : result.amountB).toString());
  return { input, output, minimum: tradeMinimum(output, input.slippageBps), quotedAt: Date.now() };
}
export type TradeQuote = Awaited<ReturnType<typeof quoteDevnetTrade>>;
export async function buildDevnetTrade(connection: Connection, quote: TradeQuote) {
  if (Date.now() - quote.quotedAt > 60_000) throw new Error('Quote expired. Preview the trade again.');
  const fresh = await quoteDevnetTrade(connection, quote.input);
  if (fresh.output < quote.minimum) throw new Error('Price moved beyond your slippage limit. Preview again.');
  const { c, poolId, pool, config } = await readMarket(connection, quote.input);
  const { owner, mint, side, amount } = quote.input;
  const tokenAccount = getAssociatedTokenAddressSync(mint, owner);
  if (side === 'sell') {
    const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed').catch(() => null);
    if (!balance || BigInt(balance.value.amount) < amount) throw new Error('Insufficient token balance in your wallet.');
  }
  const seed = Keypair.generate().publicKey.toBase58().slice(0, 32);
  const wrappedSol = await PublicKey.createWithSeed(owner, seed, TOKEN_PROGRAM_ID);
  const rent = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  const BN = config.tradeFeeRate.constructor as { new(value: string): typeof config.tradeFeeRate };
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...(side === 'buy' ? [createAssociatedTokenAccountIdempotentInstruction(owner, tokenAccount, owner, mint)] : []),
    SystemProgram.createAccountWithSeed({ fromPubkey: owner, basePubkey: owner, seed, newAccountPubkey: wrappedSol, lamports: rent, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
    ...(side === 'buy' ? [SystemProgram.transfer({ fromPubkey: owner, toPubkey: wrappedSol, lamports: amount })] : []),
    createInitializeAccountInstruction(wrappedSol, NATIVE_MINT, owner),
    (side === 'buy' ? buyExactInInstruction : sellExactInInstruction)(c.launchpad, owner, getPdaLaunchpadAuth(c.launchpad).publicKey, pool.configId, pool.platformId, poolId, tokenAccount, wrappedSol, pool.vaultA, pool.vaultB, mint, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getPdaPlatformVault(c.launchpad, pool.platformId, NATIVE_MINT).publicKey, getPdaCreatorVault(c.launchpad, pool.creator, NATIVE_MINT).publicKey, new BN(amount.toString()), new BN(quote.minimum.toString())),
    createCloseAccountInstruction(wrappedSol, owner, owner)];
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
  if (transaction.serialize().length > 1232) throw new Error('Trade transaction exceeds the network size limit.');
  return { transaction, latest, quote, expectedOutput: fresh.output };
}
export type PreparedTrade = Awaited<ReturnType<typeof buildDevnetTrade>>;
export async function simulateDevnetTrade(connection: Connection, prepared: PreparedTrade) {
  const result = await connection.simulateTransaction(prepared.transaction, { sigVerify: false, commitment: 'confirmed' });
  if (result.value.err) throw new Error(`Trade simulation failed: ${JSON.stringify(result.value.err)}. Check your balance or preview a smaller trade.`);
}
export class TradeSubmittedError extends Error {
  constructor(readonly signature: string, message: string) { super(message); this.name = 'TradeSubmittedError'; }
}
function signatureBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n; for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = ''; while (value) { text = alphabet[Number(value % 58n)] + text; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; text = '1' + text; }
  return text;
}
export async function sendDevnetTrade(connection: Connection, prepared: PreparedTrade, signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>) {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Trading is enabled on Solana devnet only.');
  if (Date.now() - prepared.quote.quotedAt > 60_000) throw new Error('Quote expired. Preview the trade again.');
  await simulateDevnetTrade(connection, prepared);
  // Snapshot before the wallet can mutate the transaction in place.
  const original = TransactionMessage.decompile(VersionedTransaction.deserialize(prepared.transaction.serialize()).message);
  const signed = await signTransaction(prepared.transaction);
  const returned = TransactionMessage.decompile(signed.message);
  if (!signed.signatures[0]?.some(byte => byte !== 0)) throw new Error('Wallet did not sign the trade. Reconnect and preview again.');
  if (!returned.payerKey.equals(original.payerKey) || returned.recentBlockhash !== original.recentBlockhash) throw new Error('Wallet changed the trade payer or blockhash. Preview again.');
  const protectedInstructions = (message: TransactionMessage) => message.instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId)).map(ix => ({
    program: ix.programId.toBase58(), keys: ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), data: Array.from(ix.data)
  }));
  if (JSON.stringify(protectedInstructions(original)) !== JSON.stringify(protectedInstructions(returned))) throw new Error('Wallet changed trade instructions. The transaction was not submitted.');
  for (const ix of returned.instructions.filter(ix => ix.programId.equals(ComputeBudgetProgram.programId))) {
    const data = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    const validLimit = ix.data[0] === 2 && ix.data.length === 5 && data.getUint32(1, true) <= 1_400_000;
    const validPrice = ix.data[0] === 3 && ix.data.length === 9 && data.getBigUint64(1, true) <= 1_000_000n;
    if (!validLimit && !validPrice) throw new Error('Wallet requested an unsupported compute budget or excessive priority fee. Reduce the wallet fee and preview again.');
  }
  // Verify the exact wallet-signed transaction, including its priority fee.
  const signedSimulation = await connection.simulateTransaction(signed, { sigVerify: true, commitment: 'confirmed' });
  if (signedSimulation.value.err) throw new Error(`Signed trade simulation failed: ${JSON.stringify(signedSimulation.value.err)}. Preview again.`);
  const signature = signatureBase58(signed.signatures[0]!);
  try {
    await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed' });
    const result = await connection.confirmTransaction({ signature, ...prepared.latest }, 'confirmed');
    if (result.value.err) throw new Error(`On-chain trade failed: ${JSON.stringify(result.value.err)}`);
    return signature;
  } catch (cause) {
    throw new TradeSubmittedError(signature, `${cause instanceof Error ? cause.message : 'Confirmation unavailable'}. Check the transaction before placing another trade.`);
  }
}
