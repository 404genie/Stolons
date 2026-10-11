import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, TransactionInstruction } from '@solana/web3.js';
import { StolonsClient, decodeLineage } from '../../sdk/dist/client.js';

function fixture(err) {
  const wallet = Keypair.generate();
  const programId = Keypair.generate().publicKey;
  const signature = 'test-signature';
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: async () => signature,
    confirmTransaction: async () => ({ value: { err } })
  };
  const signer = {
    publicKey: wallet.publicKey,
    signTransaction: async (transaction) => { transaction.partialSign(wallet); return transaction; }
  };
  return { client: new StolonsClient(connection, programId), signer, signature,
    instruction: new TransactionInstruction({ programId, keys: [], data: Buffer.alloc(0) }) };
}

test('send returns a signature only after successful confirmation', async () => {
  const f = fixture(null);
  assert.equal(await f.client.send(f.signer, f.instruction), f.signature);
});

test('send rejects an on-chain execution failure after submission', async () => {
  const f = fixture({ InstructionError: [0, { Custom: 6000 }] });
  await assert.rejects(f.client.send(f.signer, f.instruction), /Transaction test-signature failed:.*6000/);
});

test('lineage decoder rejects unknown status and truncated accounts', () => {
  const bytes = Buffer.alloc(317);
  bytes.set([125, 53, 5, 134, 108, 167, 89, 101]);
  bytes[137] = 255;
  assert.throws(() => decodeLineage(bytes), /unknown lineage status/);
  assert.throws(() => decodeLineage(bytes.subarray(0, 316)), /shorter/);
});
