import test from 'node:test';
import assert from 'node:assert/strict';
import {TransactionMessage} from '@solana/web3.js';
import {fixture} from '../helpers/reproduction-fixture.mjs';
import {deriveConfigPda,deriveCandidatePda} from '../../sdk/dist/index.js';
import {decodeEpoch,decodeCandidate,buildReproductionAction} from '../../sdk/dist/devnet-reproduction.js';
function guarded(options={}){
 const f=fixture({selected:true,...options});f.accounts.get(deriveConfigPda(f.program).toBase58()).data[305]=3;
 const epoch=f.accounts.get(f.epoch.toBase58());epoch.data=Buffer.concat([epoch.data,Buffer.alloc(16)]);epoch.data.writeBigUInt64LE(1000000000000n,92);epoch.data.writeBigInt64LE(3800n,100);
 const candidate=f.accounts.get(deriveCandidatePda(f.program,f.child.publicKey).toBase58());candidate.data=Buffer.concat([candidate.data,Buffer.alloc(9)]);candidate.data.writeBigUInt64LE(50000000n,276);
 return f;
}
test('new governance account extensions decode quorum, capped deadline and isolated bond',()=>{
 const f=guarded(),epoch=decodeEpoch(f.accounts.get(f.epoch.toBase58()).data),candidate=decodeCandidate(f.accounts.get(deriveCandidatePda(f.program,f.child.publicKey).toBase58()).data);
 assert.equal(epoch.winningQuorum,1000000000000n);assert.equal(epoch.maxVoteEnd,3800n);assert.equal(candidate.bondLamports,50000000n);assert.equal(candidate.bondSettled,false);
});
test('one-atom support closes without a winner when below the snapshotted quorum',async()=>{
 const f=guarded({now:201n,highest:1n,winner:0});
 // Open round remains active until finalized.
 const lineage=[...f.accounts.values()].find(a=>a?.data.length===317&&a.data[137]===2);
 lineage.data.set(f.epoch.toBytes(),195);lineage.data.fill(0,163,195);
 const prepared=await buildReproductionAction(f.connection,f.program,f.mint,f.owner,{kind:'finalize',epoch:f.epoch});
 const instructions=TransactionMessage.decompile(prepared.transaction.message).instructions;
 assert.deepEqual([...instructions[1].data],[103,124,250,9,182,76,198,96]);
});
test('losing bonds bind the original proposer and treasury; active winner bonds cannot be released',async()=>{
 const f=guarded({epochStatus:2});
 const action={kind:'claim-bond',epoch:f.epoch,proposalId:0};
 const prepared=await buildReproductionAction(f.connection,f.program,f.mint,f.owner,action);
 const ix=TransactionMessage.decompile(prepared.transaction.message).instructions[1];assert.ok(ix.keys[5].pubkey.equals(f.owner));
 f.accounts.get(f.epoch.toBase58()).data[90]=1;f.accounts.get(f.epoch.toBase58()).data[89]=0;
 await assert.rejects(buildReproductionAction(f.connection,f.program,f.mint,f.owner,action),/stays locked/);
 const candidate=f.accounts.get(deriveCandidatePda(f.program,f.child.publicKey).toBase58()).data;candidate[168]=5;
 await buildReproductionAction(f.connection,f.program,f.mint,f.owner,action);
 candidate[284]=1;await assert.rejects(buildReproductionAction(f.connection,f.program,f.mint,f.owner,action),/already settled/);
});
