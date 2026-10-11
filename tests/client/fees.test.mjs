import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {CpmmPoolInfoLayout,getPdaCreatorVault}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
import {readFile} from 'node:fs/promises';
import {Keypair,PublicKey,TransactionMessage} from '@solana/web3.js';
import {fixture} from '../helpers/reproduction-fixture.mjs';
import {deriveConfigPda,deriveLineagePda,deriveFeeAuthorityPda,deriveFeeDistributionPda,decodeLineage,ACCOUNT_SCHEMAS} from '../../sdk/dist/index.js';
import {splitFeeCollection,buildSharedCpmmFeeCollection,buildSharedCreatorFeeClaim,buildCurveCreatorFeeClaim,buildTreasuryCurveFeeClaim,creatorFeeSharePda} from '../../sdk/dist/fees.js';
import {buildDevnetChildLaunch} from '../../sdk/dist/devnet-launch.js';
import {runFeeCollection} from '../../services/keeper/run-fees.mjs';
function sharedFixture(){
 const f=fixture();f.config=f.accounts.get(deriveConfigPda(f.program).toBase58()).data;f.config[305]=2;
 const lineage=decodeLineage(f.accounts.get(deriveLineagePda(f.program,f.mint).toBase58()).data);
 f.lineage=lineage;f.authority=deriveFeeAuthorityPda(f.program,f.mint);f.cpmm=f.accounts.get(lineage.cpmmPool.toBase58());f.cpmm.data.set(f.authority.toBytes(),40);
 f.accounts.get(lineage.launchPool.toBase58()).data.set(f.authority.toBytes(),333);
 f.payer=Keypair.generate().publicKey;f.input={programId:f.program,mint:f.mint,payer:f.payer,lookupTable:f.table.key};
 return f;
}
test('cumulative fee division conserves value, survives repeated dust and rejects overflow',()=>{
 let previous=0n,creator=0n,treasury=0n;
 for(const amount of [1n,1n,3n,0n,(1n<<64n)-1n,...Array.from({length:1000},(_,i)=>BigInt(i*37%101))]){
  const next=splitFeeCollection(previous,amount);assert.equal(next.creator+next.treasury,amount);previous=next.total;creator+=next.creator;treasury+=next.treasury;
  assert.equal(creator,(previous+1n)/2n);assert.equal(creator+treasury,previous);
 }
 for(const [previous,amount]of [[-1n,1n],[0n,-1n],[0n,1n<<64n],[(1n<<128n)-1n,1n]])assert.throws(()=>splitFeeCollection(previous,amount));
});
test('fee-sharing launch keeps payer distinct from per-token Raydium creator',async()=>{
 const f=fixture({selected:true,epochStatus:1});f.accounts.get(deriveConfigPda(f.program).toBase58()).data[305]=2;
 const prepared=await buildDevnetChildLaunch(f.connection,{programId:f.program,parentMint:f.mint,creator:f.owner,mint:f.child.publicKey,name:'Child0',symbol:'CH0',metadataUri:'https://example.com/child.json',lookupTable:f.table.key});
 const init=TransactionMessage.decompile(prepared.transaction.message,{addressLookupTableAccounts:[f.table]}).instructions[1];
 assert.ok(init.keys[0].pubkey.equals(f.owner));assert.ok(init.keys[1].pubkey.equals(deriveFeeAuthorityPda(f.program,f.child.publicKey)));assert.equal(init.keys[1].isSigner,false);
});
test('CPMM fee builder binds original creator, treasury, fee authority and latest share PDA',async()=>{
 const f=sharedFixture(),prepared=await buildSharedCpmmFeeCollection(f.connection,f.input);
 const ix=TransactionMessage.decompile(prepared.transaction.message,{addressLookupTableAccounts:[f.table]}).instructions[1];
 const at=name=>ix.keys[ACCOUNT_SCHEMAS.collect_shared_cpmm_fees.findIndex(([n])=>n===name)].pubkey;
 assert.ok(at('creator').equals(f.lineage.creator));assert.ok(at('treasury').equals(new PublicKey(f.config.subarray(40,72))));assert.ok(at('fee_authority').equals(f.authority));assert.ok(at('distribution').equals(deriveFeeDistributionPda(f.program,f.mint)));
 assert.ok(at('creator_fee_share').equals(creatorFeeSharePda(new PublicKey(f.config.subarray(104,136)),f.authority,new PublicKey(f.config.subarray(232,264)))));
 assert.ok(prepared.transaction.serialize().length<=1232);
 f.cpmm.data.set(Keypair.generate().publicKey.toBytes(),40);await assert.rejects(buildSharedCpmmFeeCollection(f.connection,f.input),/legacy/);
});
test('curve creator and treasury claims enforce distinct signed roles and registered fee ownership',async()=>{
 const f=sharedFixture();await assert.rejects(buildCurveCreatorFeeClaim(f.connection,f.input),/Only the creator/);await buildCurveCreatorFeeClaim(f.connection,{...f.input,payer:f.lineage.creator});
 await assert.rejects(buildSharedCreatorFeeClaim(f.connection,f.input),/Only the creator/);await buildSharedCreatorFeeClaim(f.connection,{...f.input,payer:f.lineage.creator});
 await assert.rejects(buildTreasuryCurveFeeClaim(f.connection,f.input),/Only the configured treasury/);
 const treasury=new PublicKey(f.config.subarray(40,72));const result=await buildTreasuryCurveFeeClaim(f.connection,{...f.input,payer:treasury});assert.ok(result.transaction);
 f.accounts.get(f.lineage.launchPool.toBase58()).data.set(f.owner.toBytes(),333);await assert.rejects(buildCurveCreatorFeeClaim(f.connection,{...f.input,payer:f.lineage.creator}),/legacy/);
});
test('fee collection ABI carries mandatory share account after system program and Rust offsets match SDK layout',async()=>{
 const source=await readFile(new URL('../../programs/stolons/src/instructions.rs',import.meta.url),'utf8');
 assert.ok(source.indexOf('a.system_program.to_account_info(), a.creator_fee_share.to_account_info()')>=0);
 for(const name of ['collect_creator_fee','claim_creator_fee'])assert.ok(source.includes(`global:${name}`));
 const abi=await readFile(new URL('../../sdk/node_modules/@raydium-io/raydium-sdk-v2/src/raydium/cpmm/layout.ts',import.meta.url),'utf8');assert.ok(abi.includes('creatorFeesMintA'));
 const f=sharedFixture();f.cpmm.data.writeBigUInt64LE(23n,397);f.cpmm.data.writeBigUInt64LE(29n,405);
 const pool=CpmmPoolInfoLayout.decode(f.cpmm.data);assert.equal(pool.creatorFeesMintA.toString(),'23');assert.equal(pool.creatorFeesMintB.toString(),'29');
});
test('fee keeper refuses authority payer, cross-network and failed simulation before signing',async()=>{
 const f=sharedFixture();f.connection.simulateTransaction=async()=>({value:{err:{InstructionError:[1,1]}}});
 await assert.rejects(runFeeCollection(f.connection,f.program,f.mint,{cluster:'mainnet-beta',payerPublicKey:f.payer,log:()=>{}}),/cluster mismatch/);
 await assert.rejects(runFeeCollection(f.connection,f.program,f.mint,{cluster:'devnet',payerPublicKey:new PublicKey(f.config.subarray(40,72)),log:()=>{}}),/separate/);
 const pending=Buffer.alloc(165);pending.writeBigUInt64LE(1n,64);f.accounts.set(getPdaCreatorVault(new PublicKey(f.config.subarray(72,104)),f.authority,new PublicKey(f.config.subarray(200,232))).publicKey.toBase58(),{owner:new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),data:pending});
 assert.deepEqual(await runFeeCollection(f.connection,f.program,f.mint,{cluster:'devnet',payerPublicKey:f.payer,log:()=>{}}),{status:'empty',transactions:[]});
 f.cpmm.data.writeBigUInt64LE(23n,397);
 const payer={publicKey:f.payer,secretKey:new Uint8Array()};await assert.rejects(runFeeCollection(f.connection,f.program,f.mint,{cluster:'devnet',table:f.table.key,payer,apply:true,log:()=>{}}),/simulation failed/);
});
