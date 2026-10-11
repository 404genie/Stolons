import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {TransactionMessage} from '@solana/web3.js';
import {fixture} from '../helpers/reproduction-fixture.mjs';
import {buildDevnetRootLaunch,buildDevnetChildLaunch} from '../../sdk/dist/devnet-launch.js';
import {CURVE_ALLOCATION,MIGRATION_ALLOCATION,REPRODUCTION_RESERVE,GENESIS_SUPPLY} from '../../sdk/dist/constants.js';
const {LaunchpadConfig,DEVNET_PROGRAM_ID}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
test('root and child instructions encode 70/15/15 and satisfy a 15% migration minimum',async()=>{
 assert.equal(CURVE_ALLOCATION+MIGRATION_ALLOCATION+REPRODUCTION_RESERVE,GENESIS_SUPPLY);
 for(const child of [false,true]){
  const f=fixture({selected:true,epochStatus:1});
  const data=f.accounts.get(DEVNET_PROGRAM_ID.LAUNCHPAD_CONFIG.toBase58()).data;
  data.writeBigUInt64LE(150000n,LaunchpadConfig.offsetOf('minMigrateRateA'));
  const input={programId:f.program,creator:f.owner,mint:f.child.publicKey,name:'Child0',symbol:'CH0',metadataUri:'https://example.com/child.json',lookupTable:f.table.key,...(child?{parentMint:f.mint}:{})};
  const prepared=await (child?buildDevnetChildLaunch:buildDevnetRootLaunch)(f.connection,input);
  const init=TransactionMessage.decompile(prepared.transaction.message,{addressLookupTableAccounts:[f.table]}).instructions.find(ix=>ix.programId.equals(DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM));
  let offset=9;for(let i=0;i<3;i++){const size=init.data.readUInt32LE(offset);offset+=4+size;}
  assert.equal(init.data.readBigUInt64LE(offset+1),GENESIS_SUPPLY);
  assert.equal(init.data.readBigUInt64LE(offset+9),CURVE_ALLOCATION);
  assert.equal(init.data.readBigUInt64LE(offset+26),REPRODUCTION_RESERVE);
  assert.equal(GENESIS_SUPPLY-CURVE_ALLOCATION-REPRODUCTION_RESERVE,MIGRATION_ALLOCATION);
 }
});
