import { Connection, PublicKey, Keypair, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, ACCOUNT_SIZE, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createInitializeAccountInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import { DEVNET_PROGRAM_ID, ALL_PROGRAM_ID, LaunchpadPool, LaunchpadConfig, PlatformConfig, Curve, getPdaLaunchpadPoolId, getPdaLaunchpadAuth, getPdaPlatformVault, getPdaCreatorVault, buyExactInInstruction, sellExactInInstruction, CpmmPoolInfoLayout, CpmmConfigInfoLayout, CurveCalculator, FeeOn, makeSwapCpmmBaseInInstruction, getPdaPoolAuthority } from '@raydium-io/raydium-sdk-v2';
import { deriveCpmmPool } from "./raydium.js";
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
async function readMarket(connection: Connection, input: TradeInput, cluster: 'devnet' | 'mainnet-beta' = 'devnet') {
  const expectedGenesis=cluster==='devnet'?DEVNET_GENESIS_HASH:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2dZ';
  if (await connection.getGenesisHash() !== expectedGenesis) throw new Error('Trading is enabled on Solana devnet only; market RPC cluster mismatch.');
  const programs=cluster==='devnet'?DEVNET_PROGRAM_ID:ALL_PROGRAM_ID;
  const account = await connection.getAccountInfo(deriveConfigPda(input.programId), 'confirmed');
  if (!account?.owner.equals(input.programId)) throw new Error('Stolons configuration is missing.');
  const c = decodeLaunchConfig(account.data);
  if (!c.launchpad.equals(programs.LAUNCHPAD_PROGRAM) || !c.launchConfig.equals(programs.LAUNCHPAD_CONFIG) || !c.quote.equals(NATIVE_MINT)) throw new Error('Unsupported trading configuration.');
  const lineage = await new StolonsClient(connection, input.programId).getLineage(input.mint);
  const poolId = getPdaLaunchpadPoolId(c.launchpad, input.mint, NATIVE_MINT).publicKey;
  if (!lineage || !lineage.launchPool.equals(poolId)) throw new Error('This mint is not a registered Stolons launch.');
  const [poolAccount, configAccount, platformAccount, mintAccount] = await connection.getMultipleAccountsInfo([poolId, c.launchConfig, c.platform, input.mint], 'confirmed');
  if (![poolAccount, configAccount, platformAccount].every(a => a?.owner.equals(c.launchpad)) || !mintAccount?.owner.equals(TOKEN_PROGRAM_ID)) throw new Error('Trading accounts are unavailable or have unexpected owners.');
  const pool = LaunchpadPool.decode(poolAccount!.data), config = LaunchpadConfig.decode(configAccount!.data), platform = PlatformConfig.decode(platformAccount!.data);
  if (!pool.mintA.equals(input.mint) || !pool.mintB.equals(NATIVE_MINT) || !pool.configId.equals(c.launchConfig) || !pool.platformId.equals(c.platform) || pool.mintDecimalsA !== 6 || pool.mintDecimalsB !== 9) throw new Error('Pool does not match this token.');
  if (pool.status === 1) throw new Error('Curve complete. Raydium migration is pending; refresh shortly.');
  let cpmm: Awaited<ReturnType<typeof readCpmmMarket>> | null = null;
  if (pool.status === 2) {
    const cpmmProgram = new PublicKey(account.data.subarray(104,136)), cpmmConfig = new PublicKey(account.data.subarray(232,264));
    if (!cpmmProgram.equals(programs.CREATE_CPMM_POOL_PROGRAM)) throw new Error('Unsupported CPMM program.');
    const address = deriveCpmmPool(cpmmProgram, cpmmConfig, input.mint, NATIVE_MINT);
    cpmm = await readCpmmMarket(connection, address, cpmmProgram, cpmmConfig, input.mint);
  } else if (pool.status !== 0) throw new Error('Unknown Raydium market status.');
  return { c, poolId, pool, config, platform, cpmm };
}
async function readCpmmMarket(connection: Connection, address: PublicKey, program: PublicKey, configId: PublicKey, mint: PublicKey) {
  const [account, configAccount] = await connection.getMultipleAccountsInfo([address, configId], 'confirmed');
  if (!account?.owner.equals(program) || !configAccount?.owner.equals(program)) throw new Error('Migrated CPMM pool is not available yet. Refresh shortly.');
  const pool = CpmmPoolInfoLayout.decode(account.data), config = CpmmConfigInfoLayout.decode(configAccount.data);
  const pair = [pool.mintA.toBase58(), pool.mintB.toBase58()];
  if (!pair.includes(mint.toBase58()) || !pair.includes(NATIVE_MINT.toBase58()) || !pool.configId.equals(configId) || !pool.mintProgramA.equals(TOKEN_PROGRAM_ID) || !pool.mintProgramB.equals(TOKEN_PROGRAM_ID)) throw new Error('CPMM pool does not match this token.');
  if ((pool.status & 4) !== 0 || BigInt(pool.openTime.toString()) > BigInt(Math.floor(Date.now()/1000))) throw new Error('CPMM trading is not open yet.');
  const [vaultA, vaultB] = await connection.getMultipleAccountsInfo([pool.vaultA, pool.vaultB], 'confirmed');
  if (!vaultA?.owner.equals(TOKEN_PROGRAM_ID) || !vaultB?.owner.equals(TOKEN_PROGRAM_ID) || !new PublicKey(vaultA.data.subarray(0,32)).equals(pool.mintA) || !new PublicKey(vaultB.data.subarray(0,32)).equals(pool.mintB)) throw new Error('CPMM vaults are unavailable.');
  const BN = config.tradeFeeRate.constructor as { new(value: string): typeof config.tradeFeeRate };
  const reserveA = new BN(vaultA.data.readBigUInt64LE(64).toString()).sub(pool.protocolFeesMintA).sub(pool.fundFeesMintA).sub(pool.creatorFeesMintA);
  const reserveB = new BN(vaultB.data.readBigUInt64LE(64).toString()).sub(pool.protocolFeesMintB).sub(pool.fundFeesMintB).sub(pool.creatorFeesMintB);
  if (reserveA.lte(new BN('0')) || reserveB.lte(new BN('0'))) throw new Error('CPMM liquidity is unavailable.');
  return { address, program, pool, config, reserveA, reserveB };

}
export async function quoteDevnetTrade(connection: Connection, input: TradeInput) {
  if (input.side !== 'buy' && input.side !== 'sell') throw new Error('Choose buy or sell.');
  if (input.amount <= 0n || input.amount > 18_446_744_073_709_551_615n) throw new Error('Amount is outside the supported range.');
  tradeMinimum(10_000n, input.slippageBps);
  const market = await readMarket(connection, input);
  const { pool, config, platform, cpmm } = market;
  if (cpmm) {
    const BN = cpmm.config.tradeFeeRate.constructor as { new(value: string): typeof config.tradeFeeRate };
    const inputMint = input.side === 'buy' ? NATIVE_MINT : input.mint;
    const inputIsA = cpmm.pool.mintA.equals(inputMint);
    const creatorOnInput = cpmm.pool.feeOn === FeeOn.BothToken || (inputIsA ? cpmm.pool.feeOn === FeeOn.OnlyTokenA : cpmm.pool.feeOn === FeeOn.OnlyTokenB);
    const result = CurveCalculator.swapBaseInput(new BN(input.amount.toString()), inputIsA ? cpmm.reserveA : cpmm.reserveB, inputIsA ? cpmm.reserveB : cpmm.reserveA, cpmm.config.tradeFeeRate, cpmm.pool.enableCreatorFee ? cpmm.config.creatorFeeRate : new BN('0'), cpmm.config.protocolFeeRate, cpmm.config.fundFeeRate, creatorOnInput);
    const output = BigInt(result.outputAmount.toString());
    return { input, requestedAmount: input.amount, capped: false, output, minimum: tradeMinimum(output, input.slippageBps), quotedAt: Date.now(), venue: 'cpmm' as const };
  }
  const BN = config.tradeFeeRate.constructor as { new(value: string): typeof config.tradeFeeRate };
  const amount = new BN(input.amount.toString());
  const fees = { poolInfo: pool, protocolFeeRate: config.tradeFeeRate, platformFeeRate: platform.feeRate, creatorFeeRate: platform.creatorFeeRate, curveType: config.curveType, shareFeeRate: new BN('0'), transferFeeConfigA: undefined, transferFeeConfigB: undefined, slot: 0 };
  const result = input.side === 'buy' ? Curve.buyExactIn({ ...fees, amountB: amount }) : Curve.sellExactIn({ ...fees, amountA: amount });
  const actualInput = BigInt((input.side === 'buy' ? result.amountB : result.amountA.amount).toString());
  if (actualInput <= 0n || actualInput > input.amount || (input.side === 'sell' && actualInput !== input.amount)) throw new Error('This amount exceeds the remaining curve liquidity. Try a smaller trade.');
  const output = BigInt((input.side === 'buy' ? result.amountA.amount : result.amountB).toString());
  return { input: { ...input, amount: actualInput }, requestedAmount: input.amount, capped: actualInput < input.amount, output, minimum: tradeMinimum(output, input.slippageBps), quotedAt: Date.now(), venue: 'curve' as const };
}
export type TradeQuote = Awaited<ReturnType<typeof quoteDevnetTrade>>;
export async function buildDevnetTrade(connection: Connection, quote: TradeQuote) {
  if (Date.now() - quote.quotedAt > 60_000) throw new Error('Quote expired. Preview the trade again.');
  const fresh = await quoteDevnetTrade(connection, quote.input);
  if (fresh.venue !== quote.venue) throw new Error('Trading venue changed. Preview again.');
  if (fresh.output < quote.minimum) throw new Error('Price moved beyond your slippage limit. Preview again.');
  const { c, poolId, pool, config, cpmm } = await readMarket(connection, quote.input);
  const { owner, mint, side, amount } = fresh.input;
  const tokenAccount = getAssociatedTokenAddressSync(mint, owner);
  if (side === 'sell') {
    const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed').catch(() => null);
    if (!balance || BigInt(balance.value.amount) < amount) throw new Error('Insufficient token balance in your wallet.');
  }
  const seed = Keypair.generate().publicKey.toBase58().slice(0, 32);
  const wrappedSol = await PublicKey.createWithSeed(owner, seed, TOKEN_PROGRAM_ID);
  const rent = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  const BN = config.tradeFeeRate.constructor as { new(value: string): typeof config.tradeFeeRate };
  const inputIsA = cpmm?.pool.mintA.equals(side === 'buy' ? NATIVE_MINT : mint);
  const cpmmSwap = cpmm ? makeSwapCpmmBaseInInstruction(cpmm.program, owner, getPdaPoolAuthority(cpmm.program).publicKey, cpmm.pool.configId, cpmm.address, side === 'buy' ? wrappedSol : tokenAccount, side === 'buy' ? tokenAccount : wrappedSol, inputIsA ? cpmm.pool.vaultA : cpmm.pool.vaultB, inputIsA ? cpmm.pool.vaultB : cpmm.pool.vaultA, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, side === 'buy' ? NATIVE_MINT : mint, side === 'buy' ? mint : NATIVE_MINT, cpmm.pool.observationId, new BN(amount.toString()), new BN(quote.minimum.toString())) : null;
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...(side === 'buy' ? [createAssociatedTokenAccountIdempotentInstruction(owner, tokenAccount, owner, mint)] : []),
    SystemProgram.createAccountWithSeed({ fromPubkey: owner, basePubkey: owner, seed, newAccountPubkey: wrappedSol, lamports: rent, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
    ...(side === 'buy' ? [SystemProgram.transfer({ fromPubkey: owner, toPubkey: wrappedSol, lamports: amount })] : []),
    createInitializeAccountInstruction(wrappedSol, NATIVE_MINT, owner),
    cpmmSwap ?? (side === 'buy' ? buyExactInInstruction : sellExactInInstruction)(c.launchpad, owner, getPdaLaunchpadAuth(c.launchpad).publicKey, pool.configId, pool.platformId, poolId, tokenAccount, wrappedSol, pool.vaultA, pool.vaultB, mint, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getPdaPlatformVault(c.launchpad, pool.platformId, NATIVE_MINT).publicKey, getPdaCreatorVault(c.launchpad, pool.creator, NATIVE_MINT).publicKey, new BN(amount.toString()), new BN(quote.minimum.toString())),
    createCloseAccountInstruction(wrappedSol, owner, owner)];
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
  if (transaction.serialize().length > 1232) throw new Error('Trade transaction exceeds the network size limit.');
  return { transaction, latest, quote, expectedOutput: fresh.output };
}
export type PreparedTrade = Awaited<ReturnType<typeof buildDevnetTrade>>;
export async function simulateDevnetTrade(connection: Connection, prepared: { transaction: VersionedTransaction }) {
  const result = await connection.simulateTransaction(prepared.transaction, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
  if (result.value.err) throw new Error(`Trade simulation failed: ${JSON.stringify(result.value.err)}. Check your balance or preview a smaller trade.`);
  return result.context?.slot;
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
export async function sendDevnetTrade(connection: Connection, prepared: { transaction: VersionedTransaction; latest: { blockhash: string; lastValidBlockHeight: number }; quote: { quotedAt: number } }, signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>) {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Trading is enabled on Solana devnet only.');
  if (Date.now() - prepared.quote.quotedAt > 60_000) throw new Error('Quote expired. Preview the trade again.');
  const simulationSlot = await simulateDevnetTrade(connection, prepared);
  // Snapshot before the wallet can mutate the transaction in place.
  const tables = await Promise.all(prepared.transaction.message.addressTableLookups.map(async entry => { const value = (await connection.getAddressLookupTable(entry.accountKey)).value; if (!value) throw new Error('Transaction lookup table is unavailable.'); return value; }));
  const template = prepared.transaction.serialize();
  for (let attempt = 0; attempt < 2; attempt++) {
    // Use a blockhash already rooted across RPC nodes, after slow preparation.
    const latest = await connection.getLatestBlockhash('finalized');
    const transaction = VersionedTransaction.deserialize(template);
    transaction.message.recentBlockhash = latest.blockhash;
    transaction.signatures.forEach(signature => signature.fill(0));
    const original = TransactionMessage.decompile(VersionedTransaction.deserialize(transaction.serialize()).message, { addressLookupTableAccounts: tables });
    const signed = await signTransaction(transaction);
    const returned = TransactionMessage.decompile(signed.message, { addressLookupTableAccounts: tables });
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
    const signedSimulation = await connection.simulateTransaction(signed, { sigVerify: true, commitment: 'confirmed', ...(simulationSlot !== undefined ? { minContextSlot: simulationSlot } : {}) });
    if (signedSimulation.value.err === 'BlockhashNotFound') {
      // Nothing has been broadcast. Rebuild and request signatures again once.
      if (attempt === 0) continue;
      throw new Error('Transaction blockhash expired during wallet approval. Retry this action and approve promptly. Nothing was submitted.');
    }
    if (signedSimulation.value.err) throw new Error(`Signed trade simulation failed: ${JSON.stringify(signedSimulation.value.err)}. Preview again.`);
    const signature = signatureBase58(signed.signatures[0]!);
    try {
      await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed', ...(simulationSlot !== undefined ? { minContextSlot: simulationSlot } : {}) });
      const result = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
      if (result.value.err) throw new Error(`On-chain trade failed: ${JSON.stringify(result.value.err)}`);
      return signature;
    } catch (cause) {
      throw new TradeSubmittedError(signature, `${cause instanceof Error ? cause.message : 'Confirmation unavailable'}. Check the transaction before placing another trade.`);
    }
  }
  throw new Error('Transaction could not be signed with a fresh blockhash.');
}

export function sellPercentage(balance: bigint, percent: number): bigint {
  if (![25, 50, 100].includes(percent) || balance < 0n) throw new Error('Invalid sell percentage.');
  return balance * BigInt(percent) / 100n;
}
export async function readTradeBalance(connection: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  const account = await connection.getAccountInfo(getAssociatedTokenAddressSync(mint, owner), 'confirmed');
  if (!account) return 0n;
  if (!account.owner.equals(TOKEN_PROGRAM_ID) || account.data.length < ACCOUNT_SIZE || !new PublicKey(account.data.subarray(0,32)).equals(mint) || !new PublicKey(account.data.subarray(32,64)).equals(owner)) throw new Error('Unexpected wallet token account.');
  return account.data.readBigUInt64LE(64);
}

/** SOL-denominated market values, from current CPMM vault reserves. */
export async function readCpmmStats(connection: Connection, programId: PublicKey, mint: PublicKey, cluster: 'devnet' | 'mainnet-beta' = 'devnet') {
  const market = await readMarket(connection, { programId, mint, owner: PublicKey.default, side:'buy',amount:1n,slippageBps:100 },cluster);
  const cpmm=market.cpmm;
  if (!cpmm) return null;
  const nativeIsA=cpmm.pool.mintA.equals(NATIVE_MINT), quoteReserve=nativeIsA?cpmm.reserveA:cpmm.reserveB, tokenReserve=nativeIsA?cpmm.reserveB:cpmm.reserveA;
  const mintAccount=await connection.getAccountInfo(mint,'confirmed');
  if (!mintAccount?.owner.equals(TOKEN_PROGRAM_ID)) throw new Error('Mint account unavailable.');
  const supply=mintAccount.data.readBigUInt64LE(36);
  const quoteSol=Number(quoteReserve.toString())/1e9;
  return { pool:cpmm.address.toBase58(), program:cpmm.program.toBase58(), quoteVault:(nativeIsA?cpmm.pool.vaultA:cpmm.pool.vaultB).toBase58(), priceSol:quoteSol/(Number(tokenReserve.toString())/1e6), marketCapSol:quoteSol*Number(supply)/Number(tokenReserve.toString()), liquiditySol:quoteSol*2 };
}
