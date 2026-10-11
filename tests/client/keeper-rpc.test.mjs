import test from 'node:test';import assert from 'node:assert/strict';
import {readRetryFetch} from '../../services/keeper/rpc.mjs';
test('keeper retries bounded read rate limits but never resubmits a signed transaction',async()=>{
 let calls=0;const pauses=[];const fetcher=readRetryFetch(async()=>new Response('',{status:++calls<3?429:200}),async ms=>pauses.push(ms));
 assert.equal((await fetcher('https://example.com',{body:JSON.stringify({method:'getAccountInfo'})})).status,200);assert.equal(calls,3);assert.deepEqual(pauses,[2000,4000]);
 calls=0;await fetcher('https://example.com',{body:JSON.stringify({method:'sendTransaction'})});assert.equal(calls,1);
 calls=0;const bounded=readRetryFetch(async()=>{calls++;return new Response('',{status:429});},async()=>{});assert.equal((await bounded('https://example.com',{body:JSON.stringify({method:'getBalance'})})).status,429);assert.equal(calls,4);
});
