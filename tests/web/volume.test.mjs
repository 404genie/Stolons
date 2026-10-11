import test from 'node:test';import assert from 'node:assert/strict';import {Keypair} from '@solana/web3.js';import {readHourVolume} from '../../apps/web/lib/market-volume.ts';
const pool=Keypair.generate().publicKey,program=Keypair.generate().publicKey,vault=Keypair.generate().publicKey;
function fixture({multiple=false,missing=false}={}){
 return {getSignaturesForAddress:async()=>[{signature:'swap',blockTime:10000,err:null}],getTransaction:async()=>missing?null:{transaction:{message:{getAccountKeys:()=>({length:3,get:i=>[program,pool,vault][i]}),compiledInstructions:Array.from({length:multiple?2:1},()=>({programIdIndex:0,accountKeyIndexes:[1,2],data:new Uint8Array([143,190,90,218,196,30,51,222])}))}},meta:{err:null,preTokenBalances:[{accountIndex:2,uiTokenAmount:{amount:'1000000000'}}],postTokenBalances:[{accountIndex:2,uiTokenAmount:{amount:'1020000000'}}]}}};
}
test('one-hour volume counts actual quote-vault movement for a successful swap',async()=>{assert.equal(await readHourVolume(fixture(),pool.toBase58(),program.toBase58(),vault.toBase58(),10001),0.02);});
test('missing history and multiple netted swaps do not produce misleading volume',async()=>{for(const options of [{missing:true},{multiple:true}])assert.equal(await readHourVolume(fixture(options),pool.toBase58(),program.toBase58(),vault.toBase58(),10001),null);});
