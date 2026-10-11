import test from 'node:test';import assert from 'node:assert/strict';
import {readRetryFetch} from '../../services/keeper/rpc.mjs';
test('keeper retries bounded read rate limits but never resubmits a signed transaction',async()=>{
 let calls=0;const pauses=[];const fetcher=readRetryFetch(async()=>new Response('',{status:++calls<3?429:200}),async ms=>pauses.push(ms));
 assert.equal((await fetcher('https://example.com',{body:JSON.stringify({method:'getAccountInfo'})})).status,200);assert.equal(calls,3);assert.deepEqual(pauses,[2000,4000]);
 calls=0;await fetcher('https://example.com',{body:JSON.stringify({method:'sendTransaction'})});assert.equal(calls,1);
 calls=0;const bounded=readRetryFetch(async()=>{calls++;return new Response('',{status:429});},async()=>{});assert.equal((await bounded('https://example.com',{body:JSON.stringify({method:'getBalance'})})).status,429);assert.equal(calls,4);
});
import {useHttpConfirmation} from '../../services/keeper/rpc.mjs';
test('HTTP confirmation reports chain failures and stops after blockhash expiry',async()=>{
 let polls=0;const c=useHttpConfirmation({getSignatureStatuses:async()=>({context:{slot:10},value:[++polls===1?null:{confirmationStatus:'confirmed',err:{InstructionError:[0,1]}}]}),getBlockHeight:async()=>90},async()=>{});
 assert.deepEqual((await c.confirmTransaction({signature:'test',lastValidBlockHeight:100})).value.err,{InstructionError:[0,1]});
 const expired=useHttpConfirmation({getSignatureStatuses:async()=>({context:{slot:10},value:[null]}),getBlockHeight:async()=>101},async()=>{});
 await assert.rejects(expired.confirmTransaction({signature:'test',lastValidBlockHeight:100}),/expired/);
});
import {runScanLoop} from '../../services/keeper/rpc.mjs';
test('continuous collectors resume after read rate limits but stop on uncertain submissions',async()=>{
 let calls=0;const waits=[];
 await runScanLoop(async()=>{if(++calls===1)throw Error('429 Too Many Requests');},{pause:async ms=>waits.push(ms),log:()=>{}});
 assert.equal(calls,2);assert.deepEqual(waits,[30000,30000]);
 calls=0;const uncertain=Error('429 after submission');
 await assert.rejects(runScanLoop(async()=>{calls++;throw uncertain;},{isUncertain:e=>e===uncertain,pause:async()=>{},log:()=>{}}),e=>e===uncertain);assert.equal(calls,1);
});
