import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { metadataUploadMessage, normalizeTokenDraft, createTokenMetadata } from '../../sdk/dist/launch-validation.js';
import { imageExtension, verifyMetadataUpload } from '../../apps/web/lib/upload-auth.ts';
import { storeTokenAsset, readLocalTokenAsset } from '../../apps/web/lib/token-storage.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const draft = { name: 'Root', symbol: 'ROOT', description: 'A token family', website: 'https://example.com', twitter: 'https://x.com/stolons', telegram: 'https://t.me/stolons' };
const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function approval(details = draft) {
  const key = Keypair.generate();
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), key.secretKey.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
  const wallet = key.publicKey.toBase58(), origin = 'https://stolons.test', timestamp = Date.now();
  const hash = createHash('sha256').update(image).digest('hex');
  const signature = sign(null, Buffer.from(metadataUploadMessage(details, hash, wallet, origin, timestamp)), privateKey).toString('base64');
  return { wallet, origin, timestamp, signature };
}

test('wallet approval binds the image, token fields and site', () => {
  const a = approval();
  const check = (value, bytes, origin) => verifyMetadataUpload(value, bytes, a.wallet, origin, a.timestamp, a.signature);
  assert.doesNotThrow(() => check(draft, image, a.origin));
  assert.throws(() => check({ ...draft, description: 'Tampered' }, image, a.origin), /does not match/);
  assert.throws(() => check(draft, Buffer.concat([image, Buffer.from([1])]), a.origin), /does not match/);
  assert.throws(() => check(draft, image, 'https://other.test'), /does not match/);
  assert.throws(() => verifyMetadataUpload(draft, image, a.wallet, a.origin, a.timestamp, a.signature, a.timestamp + 300_001), /expired/);
});

test('multiline descriptions retain wallet approval through multipart line-ending normalization', async () => {
  const details = { ...draft, description: 'First line\nSecond line\nThird line' };
  const a = approval(details);
  const form = new FormData();
  for (const [key, value] of Object.entries(details)) form.set(key, value);
  const request = new Request(a.origin, { method: 'POST', body: form });
  const received = Object.fromEntries((await request.formData()).entries());
  assert.equal(received.description, 'First line\r\nSecond line\r\nThird line');
  assert.doesNotThrow(() => verifyMetadataUpload(received, image, a.wallet, a.origin, a.timestamp, a.signature));
  assert.equal(createTokenMetadata(received, 'https://example.com/root.png').description, details.description);
});

test('image validation rejects disguised active content and large uploads', () => {
  assert.equal(imageExtension(image, 'image/png'), 'png');
  assert.throws(() => imageExtension(Buffer.from('<svg onload="alert(1)">'), 'image/png'), /PNG/);
  assert.throws(() => imageExtension(image, 'image/jpeg'), /PNG/);
  assert.throws(() => imageExtension(new Uint8Array(3 * 1024 * 1024 + 1), 'image/png'), /3 MB/);
});

test('generated token JSON carries description, image and social links', () => {
  const metadata = createTokenMetadata(draft, 'https://example.com/root.png');
  assert.equal(metadata.name, 'Root');
  assert.equal(metadata.description, draft.description);
  assert.deepEqual(metadata.extensions, { website: draft.website, twitter: draft.twitter, telegram: draft.telegram });
  assert.throws(() => normalizeTokenDraft({ ...draft, twitter: 'https://evil.test/profile' }), /X or Twitter/);
  assert.throws(() => normalizeTokenDraft({ ...draft, website: 'javascript:alert(1)' }), /HTTPS/);
});

test('local storage persists identical bytes and blocks path traversal; deployment requires durable storage', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'stolons-upload-test-'));
  const previousDirectory = process.cwd(), previousEnv = process.env.NODE_ENV;
  try {
    process.chdir(folder); process.env.NODE_ENV = 'development';
    const url = await storeTokenAsset(image, 'png', 'https://stolons.test');
    assert.equal(await storeTokenAsset(image, 'png', 'https://stolons.test'), url);
    assert.deepEqual(await readLocalTokenAsset(url.split('/').pop()), image);
    assert.equal(await readLocalTokenAsset('../root.json'), null);
    process.env.NODE_ENV = 'production';
    assert.equal(await readLocalTokenAsset(url.split('/').pop()), null);
    await assert.rejects(storeTokenAsset(image, 'png', 'https://stolons.test'), /not configured/);
  } finally {
    process.chdir(previousDirectory);
    if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
    await rm(folder, { recursive: true, force: true });
  }
});
