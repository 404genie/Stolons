import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PublicKey, Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { quoteDevnetTrade, buildDevnetTrade, sendDevnetTrade, TradeSubmittedError, parseTradeAmount, formatTradeAmount, tradeMinimum } from '../../sdk/dist/devnet-trade.js';
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
  await assert.rejects(quoteDevnetTrade(market({ graduated: true }).connection, f.input), /completed its bonding curve/);
  await assert.rejects(buildDevnetTrade(f.connection, { ...q, quotedAt: Date.now() - 60001 }), /expired/);
  await assert.rejects(buildDevnetTrade(market({ moved: true }).connection, q), /Price moved/);
});
function sendFixture(options = {}) {
  const owner = Keypair.generate();
  const latest = { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 };
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: latest.blockhash, instructions: [] }).compileToV0Message());
  const calls = { signed: 0, sent: 0 };
  const connection = { getGenesisHash: async () => options.genesis ?? DEVNET_GENESIS_HASH, simulateTransaction: async () => ({ value: { err: options.simulationError ?? null } }), sendRawTransaction: async () => { calls.sent++; if (options.transportError) throw Error('timeout'); return 'unused'; }, confirmTransaction: async () => { if (options.confirmationTimeout) throw Error('timeout'); return { value: { err: options.chainError ?? null } }; } };
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
  }), /changed trade/);
  assert.equal(f.calls.sent, 0);
});
