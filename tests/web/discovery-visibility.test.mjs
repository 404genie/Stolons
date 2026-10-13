import test from 'node:test';import assert from 'node:assert/strict';import {Keypair,PublicKey} from '@solana/web3.js';
import {INTERNAL_DEVNET_MINTS,publicDiscoveryEntries} from '../../apps/web/lib/discovery-visibility.ts';
test('public devnet discovery excludes old fixtures and keeps new launches without changing input records',()=>{
 const old=[...INTERNAL_DEVNET_MINTS].map(mint=>({mint:new PublicKey(mint)}));const fresh={mint:Keypair.generate().publicKey},entries=[...old,fresh];
 assert.deepEqual(publicDiscoveryEntries(entries,'devnet'),[fresh]);assert.equal(entries.length,11);assert.equal(old.length,10);
 assert.equal(publicDiscoveryEntries(entries,'mainnet-beta'),entries);assert.deepEqual(publicDiscoveryEntries(old,'devnet'),[]);
});
