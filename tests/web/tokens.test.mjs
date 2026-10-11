import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { readFile } from 'node:fs/promises';
import { readTokenInfo, readLineages, readCurve } from '../../apps/web/lib/tokens.ts';
const metadataProgram = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
function metadata() {
  const string = value => { const bytes = Buffer.from(value), size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); return Buffer.concat([size, bytes]); };
  return { owner: metadataProgram, data: Buffer.concat([Buffer.alloc(65), string('Test root'), string('ROOT'), string('https://stolons.test/root.json')]) };
}
test('token names survive inaccessible hosted JSON', async () => {
  const previous = globalThis.fetch; globalThis.window = { location: { origin: 'https://stolons.test' } };
  globalThis.fetch = async () => { throw Error('Metadata host unavailable'); };
  try { const info = await readTokenInfo({ getAccountInfo: async () => metadata() }, Keypair.generate().publicKey.toBase58()); assert.equal(info.name, 'Test root'); assert.equal(info.symbol, 'ROOT'); assert.equal(info.image, ''); } finally { globalThis.fetch = previous; }
});
test('metadata enriches identity while dropping unsafe external links', async () => {
  const previous = globalThis.fetch; globalThis.window = { location: { origin: 'https://stolons.test' } };
  globalThis.fetch = async () => Response.json({description:'Token story',image:'https://stolons.test/root.png',extensions:{website:'javascript:alert(1)',twitter:'https://x.com/stolons'}});
  try { const info = await readTokenInfo({ getAccountInfo: async () => metadata() }, Keypair.generate().publicKey.toBase58()); assert.equal(info.description, 'Token story'); assert.equal(info.image, 'https://stolons.test/root.png'); assert.equal(info.website, ''); assert.equal(info.twitter, 'https://x.com/stolons'); } finally { globalThis.fetch = previous; }
});
test('discovery and graduation progress decode real public devnet account snapshots', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/trade-devnet.json', import.meta.url)));
  const accounts = Object.entries(fixture.accounts).filter(([,a]) => a).map(([address,a]) => ({pubkey:new PublicKey(address),account:{owner:new PublicKey(a.owner),data:Buffer.from(a.data,'base64')}}));
  const connection = {getProgramAccounts:async () => accounts,getAccountInfo:async key => accounts.find(a=>a.pubkey.equals(key))?.account};
  const lineages = await readLineages(connection); assert.equal(lineages.length,1); assert.equal(lineages[0].mint.toBase58(),fixture.mint);
  const curve = await readCurve(connection,lineages[0]); assert.equal(curve.target,1);assert.equal(curve.progress,0);assert.equal(curve.complete,false);
});
