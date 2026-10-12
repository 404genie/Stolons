import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {clockEvidence} from '../../scripts/devnet/fundraising-clock-evidence.mjs';
import {RAYDIUM_ACCOUNT_DISCRIMINATORS} from '../../sdk/dist/raydium-layout.js';
function fixture(){const [launchpad,launchConfig,platform,quote,mint]=Array.from({length:5},()=>Keypair.generate().publicKey);const bytes=Buffer.alloc(429),clock=Buffer.alloc(40);bytes.set(RAYDIUM_ACCOUNT_DISCRIMINATORS.poolState);bytes[17]=1;bytes[18]=6;bytes[19]=9;bytes[20]=1;for(const [offset,value]of [[21,1000000000000000n],[29,700000000000000n],[69,1000000000n],[101,150000000000000n],[125,100n]])bytes.writeBigUInt64LE(value,offset);for(const [offset,key]of [[141,launchConfig],[173,platform],[205,mint],[237,quote]])bytes.set(key.toBytes(),offset);clock.writeBigInt64LE(100n,32);return {bytes,clock,config:{launchpad,launchConfig,platform,quote},mint};}
function inspect(f){return clockEvidence({owner:f.config.launchpad.toBase58(),data:[f.bytes.toString('base64'),'base64']},{data:[f.clock.toString('base64'),'base64']},f.config,f.mint);}
test('clock evidence binds authentic intermediate pool fields to the simulated bank clock',()=>{
 const f=fixture(),report=inspect(f);assert.equal(report.poolStatusAfterSimulatedBuy,1);assert.equal(report.vestingStartTime,report.clockUnixTimestamp);assert.equal(report.poolAccountSha256.length,64);
 for(const mutate of [f=>f.bytes[17]=2,f=>f.bytes.writeBigUInt64LE(0n,125),f=>f.clock.writeBigInt64LE(101n,32),f=>f.bytes.writeBigUInt64LE(24000000000n,69),f=>f.bytes.writeBigUInt64LE(0n,101),f=>f.bytes.writeBigUInt64LE(1n,109),f=>f.bytes.set(Keypair.generate().publicKey.toBytes(),205),f=>f.config.launchConfig=Keypair.generate().publicKey]){const f=fixture();mutate(f);assert.throws(()=>inspect(f));}
});

test('failed timestamp assertion preserves status-1 zero timestamp and raw evidence',()=>{
 const f=fixture();f.bytes.writeBigUInt64LE(0n,125);
 assert.throws(()=>inspect(f),error=>{
  assert.equal(error.evidence.poolStatusAfterSimulatedBuy,1);
  assert.equal(error.evidence.vestingStartTime,'0');
  assert.equal(error.evidence.clockUnixTimestamp,'100');
  assert.equal(error.evidence.observedPoolFields.locked,'150000000000000');
  assert.equal(error.evidence.postSimulationPoolDataBase64,f.bytes.toString('base64'));
  assert.doesNotThrow(()=>JSON.stringify(error.evidence));return true;
 });
});
