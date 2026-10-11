import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PublicKey,Keypair,TransactionMessage } from '@solana/web3.js';
import { readGraduation,buildGraduationStep } from '../../sdk/dist/devnet-graduation.js';
import { quoteDevnetTrade,buildDevnetTrade,readCpmmStats } from '../../sdk/dist/devnet-trade.js';
import { DEVNET_GENESIS_HASH } from '../../sdk/dist/launch-validation.js';
const f=JSON.parse(await readFile(new URL('../fixtures/cpmm-devnet.json',import.meta.url)));
function fixture({status=2,claimed=true,poolStatus=2}={}) {
 const program=new PublicKey(f.programId),mint=new PublicKey(f.mint),owner=new PublicKey(f.owner);
 const accounts=Object.fromEntries(Object.entries(f.accounts).map(([key,a])=>[key,a?{owner:new PublicKey(a.owner),data:Buffer.from(a.data,'base64')}:null]));
 for(const a of Object.values(accounts)){if(a?.data.length===317&&a.owner.equals(program)){a.data[137]=status;a.data[291]=claimed?1:0;}if(a?.data.length>365&&a?.data.subarray(205,237).equals(mint.toBuffer()))a.data[17]=poolStatus;}
 const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getAccountInfo:async key=>accounts[key.toBase58()]??null,getMultipleAccountsInfo:async keys=>keys.map(key=>accounts[key.toBase58()]??null),getMinimumBalanceForRentExemption:async()=>2039280,getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),getTokenAccountBalance:async()=>({value:{amount:'1000000000000'}})};
 return {connection,program,mint,owner};
}
test('graduation resumes the exact remaining step and rejects already-active families',async()=>{
 for(const [options,phase] of [[{status:0,claimed:false},'register'],[{status:1,claimed:false},'claim'],[{status:1,claimed:true},'activate']]){
  const x=fixture(options);assert.equal((await readGraduation(x.connection,x.program,x.mint)).phase,phase);
  const prepared=await buildGraduationStep(x.connection,x.program,x.mint,x.owner);
  assert.equal(prepared.phase,phase);assert.ok(prepared.transaction.serialize().length<=1232);
  const instructions=TransactionMessage.decompile(prepared.transaction.message).instructions;assert.ok(instructions.at(-1).programId.equals(x.program));
 }
 const active=fixture();assert.equal((await readGraduation(active.connection,active.program,active.mint)).phase,'active');await assert.rejects(buildGraduationStep(active.connection,active.program,active.mint,active.owner),/already active/);
 const pending=fixture({status:0,claimed:false,poolStatus:1});assert.equal((await readGraduation(pending.connection,pending.program,pending.mint)).phase,'migrating');await assert.rejects(buildGraduationStep(pending.connection,pending.program,pending.mint,pending.owner),/migration is pending/);
});
test('CPMM buy and sell preserve reviewed minimums and use the migrated pool',async()=>{
 const x=fixture();for(const side of ['buy','sell']){
  const q=await quoteDevnetTrade(x.connection,{programId:x.program,mint:x.mint,owner:x.owner,side,amount:side==='buy'?1000000n:100000000n,slippageBps:100});assert.equal(q.venue,'cpmm');assert.ok(q.output>0n);
  const p=await buildDevnetTrade(x.connection,q),swap=TransactionMessage.decompile(p.transaction.message).instructions.find(ix=>ix.keys.length===13);
  assert.equal(swap.data.readBigUInt64LE(16),q.minimum);assert.equal(swap.keys[3].pubkey.toBase58(),f.stats.pool);
 }
 const stats=await readCpmmStats(x.connection,x.program,x.mint);assert.equal(stats.marketCapSol,f.stats.marketCapSol);assert.equal(stats.liquiditySol,f.stats.liquiditySol);assert.ok(stats.priceSol>0);
});

test('keeper mainnet mode rejects a devnet RPC before reading or signing accounts',async()=>{
 const x=fixture();await assert.rejects(readGraduation(x.connection,x.program,x.mint,'mainnet-beta'),/cluster mismatch/);
});

test('child graduation builds registration, reserve claim, and parent-burn finalization against the right family',async()=>{
 const {deriveLineagePda,deriveCandidatePda,deriveFamilyPda,deriveReproductionVaultPda}=await import('../../sdk/dist/index.js');
 for(const [status,claimed,phase]of [[3,false,'register'],[4,false,'claim'],[4,true,'activate']]){
  const x=fixture({status,claimed}),parent=Keypair.generate().publicKey,root=Keypair.generate().publicKey;
  const account=await x.connection.getAccountInfo(deriveLineagePda(x.program,x.mint));account.data.set(parent.toBytes(),72);account.data.set(root.toBytes(),40);account.data[136]=1;
  const prepared=await buildGraduationStep(x.connection,x.program,x.mint,x.owner);assert.equal(prepared.phase,phase);
  const instruction=TransactionMessage.decompile(prepared.transaction.message).instructions.at(-1);assert.ok(instruction.keys.some(meta=>meta.pubkey.equals(deriveCandidatePda(x.program,x.mint))));
  if(phase==='activate'){assert.ok(instruction.keys.some(meta=>meta.pubkey.equals(deriveFamilyPda(x.program,root))));assert.ok(instruction.keys.some(meta=>meta.pubkey.equals(deriveReproductionVaultPda(x.program,parent))&&meta.isWritable));assert.ok(instruction.keys.some(meta=>meta.pubkey.equals(parent)&&meta.isWritable));}
 }
});
