import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {readRecentTransactions} from '../../apps/web/lib/recent-transactions.ts';
const launch=PublicKey.default,cpmm=new PublicKey('So11111111111111111111111111111111111111112');
test('recent activity merges both venues, deduplicates migration transactions, and preserves failures',async()=>{
 const connection={getSignaturesForAddress:async address=>address.equals(launch)?[{signature:'both',slot:10,blockTime:100,err:null},{signature:'old',slot:8,blockTime:null,err:{}}]:[{signature:'new',slot:12,blockTime:102,err:null},{signature:'both',slot:10,blockTime:100,err:null}]};
 const rows=await readRecentTransactions(connection,launch,cpmm);assert.deepEqual(rows.map(row=>row.signature),['new','both','old']);assert.equal(rows[1].venue,'LaunchLab + CPMM');assert.equal(rows[2].failed,true);assert.equal(rows[2].blockTime,null);
});
test('curve-only tokens read only LaunchLab activity and RPC failures do not become empty history',async()=>{
 let calls=0;const rows=await readRecentTransactions({getSignaturesForAddress:async()=>{calls++;return []}},launch);assert.equal(calls,1);assert.deepEqual(rows,[]);
 await assert.rejects(readRecentTransactions({getSignaturesForAddress:async()=>{throw Error('RPC unavailable')}},launch),/RPC unavailable/);
});
