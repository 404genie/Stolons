import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PublicKey, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { quoteDevnetTrade, buildDevnetTrade, sendDevnetTrade, TradeSubmittedError, parseTradeAmount, formatTradeAmount, tradeMinimum, sellPercentage } from '../../sdk/dist/devnet-trade.js';
import { DEVNET_GENESIS_HASH } from '../../sdk/dist/launch-validation.js';
const fixture = JSON.parse(await readFile(new URL('../fixtures/trade-devnet.json', import.meta.url)));
function market({ post = false, balance = fixture.buyOutput, moved = false, graduated = false } = {}) {
  const input = { programId: new PublicKey(fixture.programId), mint: new PublicKey(fixture.mint), owner: new PublicKey(fixture.owner), side: 'buy', amount: 10000000n, slippageBps: 100 };
  const account = key => {
    const value = fixture.accounts[key.toBase58()];
    if (!value) return null;
    const data = Buffer.from(value.data, 'base64');
    if (data.length > 365 && data[17] === 0 && data.subarray(205,237).equals(input.mint.toBuffer())) {
      const pool = post || moved ? Buffer.from(fixture.postPool, 'base64') : data;
      if (graduated) pool[17] = 1;
      return { owner: new PublicKey(value.owner), data: pool };
    }
    return { owner: new PublicKey(value.owner), data };
  };
  const connection = { getGenesisHash: async () => DEVNET_GENESIS_HASH, getAccountInfo: async key => account(key), getMultipleAccountsInfo: async keys => keys.map(account), getTokenAccountBalance: async () => ({ value: { amount: balance } }), getMinimumBalanceForRentExemption: async () => 2039280, getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }) };
  return { connection, input };
}
test('amounts preserve precision and slippage floors the minimum', () => {
  assert.equal(parseTradeAmount('0.000000001', 9), 1n);
  assert.equal(parseTradeAmount('18446744073709.551615', 6), 18446744073709551615n);
  assert.equal(formatTradeAmount(123400000n, 6), '123.4');
  for (const value of ['0', '-1', '1e3', '0.0000001', '18446744073709.551616']) assert.throws(() => parseTradeAmount(value, 6));
  assert.equal(tradeMinimum(10001n, 100), 9900n);
  assert.throws(() => tradeMinimum(1n, 100));
  assert.throws(() => tradeMinimum(10000n, 1001));
});
test('buy and sell quote from actual devnet pool snapshots and encode the reviewed minimum', async () => {
  const f = market(); const q = await quoteDevnetTrade(f.connection, f.input);
  assert.equal(q.output.toString(), fixture.buyOutput);
  const buy = await buildDevnetTrade(f.connection, q);
  const buySwap = TransactionMessage.decompile(buy.transaction.message).instructions.find(i => i.keys.length === 18);
  assert.equal(buySwap.data.readBigUInt64LE(16), q.minimum);
  const s = market({ post: true }); s.input.side = 'sell'; s.input.amount = q.output / 2n;
  const sellQuote = await quoteDevnetTrade(s.connection, s.input);
  assert.ok(sellQuote.output > 0n);
  const sell = await buildDevnetTrade(s.connection, sellQuote);
  const swap = TransactionMessage.decompile(sell.transaction.message).instructions.find(i => i.keys.length === 18);
  assert.equal(swap.data.readBigUInt64LE(8), s.input.amount);
  assert.equal(swap.data.readBigUInt64LE(16), sellQuote.minimum);
  await assert.rejects(buildDevnetTrade(market({ post: true, balance: '0' }).connection, sellQuote), /Insufficient token/);
  await assert.rejects(quoteDevnetTrade(market({ graduated: true }).connection, f.input), /migration is pending/);
  await assert.rejects(buildDevnetTrade(f.connection, { ...q, quotedAt: Date.now() - 60001 }), /expired/);
  await assert.rejects(buildDevnetTrade(market({ moved: true }).connection, q), /Price moved/);
});
function sendFixture(options = {}) {
  const owner = Keypair.generate();
  const latest = { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 };
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: latest.blockhash, instructions: [] }).compileToV0Message());
  const calls = { signed: 0, sent: 0 };
  const connection = { getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 200 }), getGenesisHash: async () => options.genesis ?? DEVNET_GENESIS_HASH, simulateTransaction: async () => ({ value: { err: options.simulationError ?? null } }), sendRawTransaction: async () => { calls.sent++; if (options.transportError) throw Error('timeout'); return 'unused'; }, confirmTransaction: async () => { if (options.confirmationTimeout) throw Error('timeout'); return { value: { err: options.chainError ?? null } }; } };
  const sign = async tx => { calls.signed++; tx.sign([owner]); return tx; };
  return { connection, calls, sign, prepared: { transaction, latest, quote: { quotedAt: Date.now() - (options.expired ? 60001 : 0) } } };
}
test('simulation failure, wrong cluster and expiry stop before wallet approval', async () => {
  for (const options of [{ simulationError: 'InsufficientFunds' }, { genesis: 'mainnet' }, { expired: true }]) {
    const f = sendFixture(options); await assert.rejects(sendDevnetTrade(f.connection, f.prepared, f.sign)); assert.deepEqual(f.calls, { signed: 0, sent: 0 });
  }
});
test('successful trades confirm; uncertain sends retain the signed transaction ID', async () => {
  const f = sendFixture(); assert.ok((await sendDevnetTrade(f.connection, f.prepared, f.sign)).length > 80);
  for (const options of [{ transportError: true }, { confirmationTimeout: true }, { chainError: 'Failed' }]) {
    const f = sendFixture(options); await assert.rejects(sendDevnetTrade(f.connection, f.prepared, f.sign), error => error instanceof TradeSubmittedError && error.signature.length > 80);
    assert.deepEqual(f.calls, { signed: 1, sent: 1 });
  }
});

test('wallet cannot substitute a different transaction after simulation', async () => {
  const f = sendFixture();
  await assert.rejects(sendDevnetTrade(f.connection, f.prepared, async tx => {
    tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
    tx.signatures[0].fill(1);
    return tx;
  }), /changed the trade/);
  assert.equal(f.calls.sent, 0);
});

 test('wallet can add a priority fee while preserving the trade', async () => {
  const f = sendFixture();
  const owner = Keypair.generate();
  f.prepared.transaction = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: f.prepared.latest.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({units: 400000})] }).compileToV0Message());
  let verifiedSigned = false;
  f.connection.simulateTransaction = async (tx, options) => { if (options.sigVerify) verifiedSigned = true; return { value: { err: null } }; };
  const signature = await sendDevnetTrade(f.connection, f.prepared, async tx => {
    const message = TransactionMessage.decompile(tx.message);
    message.instructions.push(ComputeBudgetProgram.setComputeUnitPrice({microLamports: 10000}));
    const returned = new VersionedTransaction(message.compileToV0Message()); returned.sign([owner]); return returned;
  });
  assert.ok(signature.length > 80); assert.equal(verifiedSigned, true); assert.equal(f.calls.sent, 1);
});
test('wallet-added transfers and excessive priority fees are rejected', async () => {
  const owner = Keypair.generate();
  for (const instruction of [ComputeBudgetProgram.setComputeUnitPrice({microLamports: 1000001}), { programId: Keypair.generate().publicKey, keys: [], data: Buffer.from([1]) }]) {
    const f = sendFixture();
    f.prepared.transaction = new VersionedTransaction(new TransactionMessage({payerKey: owner.publicKey, recentBlockhash: f.prepared.latest.blockhash, instructions: []}).compileToV0Message());
    await assert.rejects(sendDevnetTrade(f.connection, f.prepared, async tx => { const message = TransactionMessage.decompile(tx.message); message.instructions.push(instruction); const returned = new VersionedTransaction(message.compileToV0Message()); returned.sign([owner]); return returned; }), /changed trade instructions|excessive priority fee/);
    assert.equal(f.calls.sent, 0);
  }
});

test('oversized buys cap SOL input at curve completion rather than rejecting', async () => {
  const f = market(); f.input.amount = 2000000000n;
  const quote = await quoteDevnetTrade(f.connection, f.input);
  assert.equal(quote.capped, true); assert.equal(quote.requestedAmount, 2000000000n);
  assert.ok(quote.input.amount < quote.requestedAmount); assert.ok(quote.input.amount > 0n);
  const prepared = await buildDevnetTrade(f.connection, quote);
  const swap = TransactionMessage.decompile(prepared.transaction.message).instructions.find(i => i.keys.length === 18);
  assert.ok(swap.data.readBigUInt64LE(8) <= quote.input.amount);
  assert.equal(swap.data.readBigUInt64LE(16), quote.minimum);
});
test('sell shortcuts round down integer atoms and 100% leaves no dust', () => {
  assert.equal(sellPercentage(101n, 25), 25n); assert.equal(sellPercentage(101n, 50), 50n); assert.equal(sellPercentage(101n, 100), 101n);
  assert.equal(sellPercentage(0n, 100), 0n); assert.throws(() => sellPercentage(1n, 200));
});

test('expired wallet blockhash is re-signed once and only the fresh transaction is sent', async () => {
  const f = sendFixture();
  let signedSimulations = 0;
  let confirmed;
  f.connection.simulateTransaction = async (tx, options) => {
    if (!options.sigVerify) { assert.equal(options.replaceRecentBlockhash, true); return {value:{err:null}}; }
    assert.equal(options.replaceRecentBlockhash, undefined);
    signedSimulations++;
    return {value:{err:signedSimulations === 1 ? 'BlockhashNotFound' : null}};
  };
  let lastHash;
  f.connection.getLatestBlockhash = async commitment => {
    assert.equal(commitment, 'finalized');
    lastHash = Keypair.generate().publicKey.toBase58();
    return {blockhash:lastHash,lastValidBlockHeight:200};
  };
  f.connection.confirmTransaction = async strategy => { confirmed = strategy; return {value:{err:null}}; };
  await sendDevnetTrade(f.connection, f.prepared, f.sign);
  assert.deepEqual(f.calls,{signed:2,sent:1});
  assert.equal(confirmed.blockhash,lastHash);
  assert.equal(confirmed.lastValidBlockHeight,200);
});
test('repeated blockhash failures stop before broadcast', async () => {
  const f = sendFixture();
  f.connection.simulateTransaction = async (tx, options) => ({value:{err:options.sigVerify ? 'BlockhashNotFound' : null}});
  await assert.rejects(sendDevnetTrade(f.connection,f.prepared,f.sign),/Nothing was submitted/);
  assert.deepEqual(f.calls,{signed:2,sent:0});
});
