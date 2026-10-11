import test from 'node:test';
import assert from 'node:assert/strict';
import {readCurve,readGraduatedMints} from '../../apps/web/lib/tokens.ts';
const entry={mint:{toBase58:()=> 'mint'},launchPool:{}};
function account(status,raised=0n){const data=Buffer.alloc(365);data[17]=status;data.writeBigUInt64LE(raised,61);data.writeBigUInt64LE(1000000000n,69);return {data};}
test('migrated curves remain 100 percent when quote reserves have moved into CPMM',async()=>{
 const value=await readCurve({getAccountInfo:async()=>account(2)},entry);
 assert.equal(value.progress,100);assert.equal(value.migrated,true);
 const pending=await readCurve({getAccountInfo:async()=>account(1)},entry);assert.equal(pending.progress,100);assert.equal(pending.migrated,false);
});
test('discovery classifies migration from Raydium rather than stale Stolons registration',async()=>{
 const result=await readGraduatedMints({getMultipleAccountsInfo:async()=>[account(2)]},[entry]);assert.equal(result.mint,true);
 const incomplete=await readCurve({getAccountInfo:async()=>account(0,999999999n)},entry);assert.equal(incomplete.progress,99.9);
});
