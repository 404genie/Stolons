import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { sendRootLaunch, LaunchSubmittedError, simulateRootLaunch } from '../../sdk/dist/devnet-launch.js';
import { DEVNET_GENESIS_HASH, validateLaunchDetails, validateLaunchMetadata, decodeLaunchConfig } from '../../sdk/dist/launch-validation.js';

function fixture(options = {}) {
  const payer = Keypair.generate(), mint = Keypair.generate();
  const latest = { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 };
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: latest.blockhash, instructions: [new TransactionInstruction({programId:SystemProgram.programId,keys:[{pubkey:mint.publicKey,isSigner:true,isWritable:true}],data:Buffer.from([0])})] }).compileToLegacyMessage());
  const calls = { signed: 0, sent: 0 };
  const connection = {
    getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:200}),
    getGenesisHash: async () => options.genesis ?? DEVNET_GENESIS_HASH,
    getBalance: async () => 1_000_000_000,
    simulateTransaction: async () => ({ value: { err: options.simulationError ?? null, accounts: [{ lamports: 990_000_000 }] } }),
    sendRawTransaction: async () => { calls.sent++; if (options.transportError) throw Error('RPC timeout'); return 'test-signature'; },
    confirmTransaction: async () => { if (options.confirmationTimeout) throw Error('Confirmation timeout'); return { value: { err: options.confirmationError ?? null } }; }
  };
  const sign = async tx => { calls.signed++; tx.sign([payer]); return tx; };
  return { connection, prepared: { transaction, latest, pool: mint.publicKey, mint: mint.publicKey, creator: payer.publicKey }, mint, sign, calls };
}

test('failed simulation and wrong cluster never prompt or send', async () => {
  for (const options of [{ simulationError: { InstructionError: [0, 'InsufficientFunds'] } }, { genesis: 'mainnet' }]) {
    const f = fixture(options);
    await assert.rejects(sendRootLaunch(f.connection, f.prepared, f.mint, f.sign));
    assert.deepEqual(f.calls, { signed: 0, sent: 0 });
  }
});

test('launch confirms successfully and preview estimates payer cost', async () => {
  const f = fixture();
  assert.equal(await simulateRootLaunch(f.connection, f.prepared), 10_000_000);
  assert.ok((await sendRootLaunch(f.connection, f.prepared, f.mint, f.sign)).length>80);
  assert.deepEqual(f.calls, { signed: 1, sent: 1 });
});

test('root launch supports explicitly selected mainnet and rejects cross-network sending',async()=>{
 const genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 const mainnet=fixture({genesis});mainnet.prepared.cluster='mainnet-beta';
 assert.ok((await sendRootLaunch(mainnet.connection,mainnet.prepared,mainnet.mint,mainnet.sign)).length>80);
 const wrong=fixture();wrong.prepared.cluster='mainnet-beta';
 await assert.rejects(sendRootLaunch(wrong.connection,wrong.prepared,wrong.mint,wrong.sign),/cluster mismatch/);
 assert.deepEqual(wrong.calls,{signed:0,sent:0});
});

test('root launch rejects wallet changes to protected instructions before broadcasting',async()=>{
 const f=fixture();
 await assert.rejects(sendRootLaunch(f.connection,f.prepared,f.mint,async tx=>{
  const message=TransactionMessage.decompile(tx.message);
  message.instructions[0].data[0]=99;
  return f.sign(new VersionedTransaction(message.compileToLegacyMessage()));
 }));
 assert.equal(f.calls.sent,0);
});

test('submission uncertainty and failed confirmations preserve inspection state', async () => {
  for (const options of [{ transportError: true }, { confirmationTimeout: true }, { confirmationError: { InstructionError: [1, { Custom: 6000 }] } }]) {
    const f = fixture(options);
    await assert.rejects(sendRootLaunch(f.connection, f.prepared, f.mint, f.sign), (error) => {
      assert.ok(error instanceof LaunchSubmittedError);
      assert.ok(error.signature.length>80);
      return true;
    });
    assert.deepEqual(f.calls, { signed: 1, sent: 1 });
  }
});

test('metadata rejects mismatches, unsafe URLs and oversized UTF-8 fields', () => {
  const valid = JSON.stringify({ name: 'Root', symbol: 'ROOT', image: 'https://example.com/image.png' });
  validateLaunchDetails('Root', 'ROOT', 'https://example.com/root.json');
  validateLaunchMetadata(valid, 'Root', 'ROOT');
  assert.throws(() => validateLaunchMetadata(valid, 'Different', 'ROOT'), /exactly match/);
  assert.throws(() => validateLaunchMetadata(JSON.stringify({ name: 'Root', symbol: 'ROOT', image: 'javascript:alert(1)' }), 'Root', 'ROOT'), /Image must/);
  assert.throws(() => validateLaunchDetails('🌱'.repeat(9), 'ROOT', 'https://example.com/root.json'), /UTF-8/);
  assert.throws(() => validateLaunchDetails('Root', 'ROOT', 'http://example.com/root.json'), /HTTPS/);
  assert.throws(() => validateLaunchDetails('Root', 'ROOT', 'https://user:password@example.com/root.json'), /credentials/);
  assert.throws(() => validateLaunchMetadata(' '.repeat(32769), 'Root', 'ROOT'), /32 KB/);
});

test('configuration rejects unrelated accounts, paused state and unknown versions', () => {
  const bytes = Buffer.alloc(307);
  assert.throws(() => decodeLaunchConfig(bytes), /Invalid/);
  bytes.set([149, 8, 156, 202, 160, 252, 176, 217]); bytes[305] = 1;
  assert.doesNotThrow(() => decodeLaunchConfig(bytes));
  bytes[304] = 1;
  assert.throws(() => decodeLaunchConfig(bytes), /paused/);
  bytes[304] = 0; bytes[305] = 3;
  assert.throws(() => decodeLaunchConfig(bytes), /version/);
});
