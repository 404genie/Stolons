import test from 'node:test';
import assert from 'node:assert/strict';
import {TransactionMessage} from '@solana/web3.js';
import {fixture} from '../helpers/reproduction-fixture.mjs';
import {buildDevnetChildLaunch} from '../../sdk/dist/devnet-launch.js';
import {appendAfterInitializeV2,assertInitializeV2Metadata} from '../../sdk/dist/raydium.js';
function encoded(expected){const parts=[Buffer.from([67,153,175,39,218,16,38,32,6])];for(const text of [expected.name,expected.symbol,expected.metadataUri]){const bytes=Buffer.from(text);const prefix=Buffer.alloc(4);prefix.writeUInt32LE(bytes.length);parts.push(prefix,bytes);}return Buffer.concat(parts);}
test('metadata proof validates real pinned Raydium SDK InitializeV2 bytes and rejects substitutions',async()=>{
 const f=fixture({selected:true,epochStatus:1});const metadata={name:'Child0',symbol:'CH0',metadataUri:'https://example.com/child.json'};
 const prepared=await buildDevnetChildLaunch(f.connection,{programId:f.program,parentMint:f.mint,creator:f.owner,mint:f.child.publicKey,...metadata,lookupTable:f.table.key});
 const instructions=TransactionMessage.decompile(prepared.transaction.message,{addressLookupTableAccounts:[f.table]}).instructions;
 const init=instructions[1],registration=instructions[2],proof={platformConfig:init.keys[3].pubkey,poolState:init.keys[5].pubkey,baseMint:init.keys[6].pubkey,quoteMint:init.keys[7].pubkey,metadata};
 assert.doesNotThrow(()=>assertInitializeV2Metadata(init.data,metadata));
 assert.equal(appendAfterInitializeV2([init],init.programId,proof,registration).length,2);
 for(const changed of [{name:'Other'},{symbol:'OTHER'},{metadataUri:'https://example.com/other.json'}]){
  assert.throws(()=>appendAfterInitializeV2([init],init.programId,{...proof,metadata:{...metadata,...changed}},registration),/winning proposal/);
 }
});
test('metadata proof rejects malformed lengths, all truncated prefixes, and altered headers',()=>{
 const metadata={name:'Child 🌱',symbol:'CH',metadataUri:'https://example.com/child.json'},data=encoded(metadata);
 assert.doesNotThrow(()=>assertInitializeV2Metadata(data,metadata));
 for(let length=0;length<data.length;length++)assert.throws(()=>assertInitializeV2Metadata(data.subarray(0,length),metadata));
 for(const offset of [0,8]){const malformed=Buffer.from(data);malformed[offset]^=1;assert.throws(()=>assertInitializeV2Metadata(malformed,metadata),/header/);}
 const huge=Buffer.from(data);huge.writeUInt32LE(0xffffffff,9);assert.throws(()=>assertInitializeV2Metadata(huge,metadata),/length/);
});
