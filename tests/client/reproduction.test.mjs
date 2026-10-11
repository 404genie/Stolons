import test from 'node:test';import assert from 'node:assert/strict';
import {createPrivateKey,sign} from 'node:crypto';
import {Keypair,TransactionMessage,PublicKey} from '@solana/web3.js';
import {fixture} from '../helpers/reproduction-fixture.mjs';
import {readReproduction,buildReproductionAction,decodeEpoch,decodeProposal,decodeCandidate,roundPhase} from '../../sdk/dist/devnet-reproduction.js';
import {recoverChildMint} from '../../sdk/dist/child-mint.js';
import {buildDevnetChildLaunch} from '../../sdk/dist/devnet-launch.js';
import {deriveLineagePda} from '../../sdk/dist/index.js';
const build=(f,action)=>buildReproductionAction(f.connection,f.program,f.mint,f.owner,action);
test('reproduction respects chain-clock proposal/vote boundaries and fresh proposal slots',async()=>{
 const f=fixture();const state=await readReproduction(f.connection,f.program,f.mint,f.owner);assert.equal(roundPhase(state.epoch,149n),'propose');assert.equal(roundPhase(state.epoch,150n),'vote');assert.equal(roundPhase(state.epoch,200n),'finalize');
 const args={proposalId:1,childMint:Keypair.generate().publicKey,name:'Child',symbol:'CHILD',metadataUri:'https://example.com/token.json',metadataHash:new Uint8Array(32)};
 const p=await build(f,{kind:'propose',epoch:f.epoch,args});assert.ok(p.transaction.serialize().length<=1232);
 await assert.rejects(build(f,{kind:'propose',epoch:f.epoch,args:{...args,proposalId:0}}),/slot changed/);
 const closed=fixture({now:150n});await assert.rejects(build(closed,{kind:'propose',epoch:closed.epoch,args}),/window closed/);
});
test('voting checks balance, one receipt per wallet, and exact u64 token amount',async()=>{
 const f=fixture({now:150n});const p=await build(f,{kind:'vote',epoch:f.epoch,proposalId:0,amount:1234567n});const ix=TransactionMessage.decompile(p.transaction.message).instructions.at(-1);assert.equal(ix.data.readBigUInt64LE(8),1234567n);
 for(const bad of [0n,18446744073709551616n])await assert.rejects(build(f,{kind:'vote',epoch:f.epoch,proposalId:0,amount:bad}),/Voting is unavailable/);
 const voted=fixture({now:150n,hasVote:true});await assert.rejects(build(voted,{kind:'vote',epoch:voted.epoch,proposalId:0,amount:1n}),/already voted/);
 f.connection.getTokenAccountBalance=async()=>({value:{amount:'0'}});await assert.rejects(build(f,{kind:'vote',epoch:f.epoch,proposalId:0,amount:1n}),/Not enough parent/);
});
test('winner and no-winner finalization are distinct; votes unlock only after finalization',async()=>{
 for(const highest of [0n,1000000n]){const f=fixture({now:200n,highest,winner:highest?0:255});const p=await build(f,{kind:'finalize',epoch:f.epoch});assert.equal(TransactionMessage.decompile(p.transaction.message).instructions.at(-1).keys.length,highest?7:5);}
 const open=fixture({now:199n,hasVote:true});await assert.rejects(build(open,{kind:'withdraw',epoch:open.epoch}),/remain locked/);
 const finalized=fixture({now:200n,hasVote:true,epochStatus:1});const withdraw=await build(finalized,{kind:'withdraw',epoch:finalized.epoch});assert.equal(TransactionMessage.decompile(withdraw.transaction.message).instructions.length,3);
 const done=fixture({now:200n,hasVote:true,withdrawn:true,epochStatus:1});await assert.rejects(build(done,{kind:'withdraw',epoch:done.epoch}),/already returned/);
});
test('closed rounds allow a new round; paused protocol and active candidates block opening',async()=>{
 const f=fixture({epochStatus:1});assert.ok((await build(f,{kind:'open'})).transaction.serialize().length<=1232);
 for(const options of [{paused:true},{selected:true,epochStatus:1}]){const f=fixture(options);await assert.rejects(build(f,{kind:'open'}));}
});
test('child launch is atomic, checks selection and immutable proposal identity, and supports descendant parents',async()=>{
 const f=fixture({selected:true,epochStatus:1});const input={programId:f.program,parentMint:f.mint,creator:f.owner,mint:f.child.publicKey,name:'Child0',symbol:'CH0',metadataUri:'https://example.com/child.json',lookupTable:f.table.key};
 const prepared=await buildDevnetChildLaunch(f.connection,input);assert.ok(prepared.transaction.serialize().length<=1232);const instructions=TransactionMessage.decompile(prepared.transaction.message,{addressLookupTableAccounts:[f.table]}).instructions;assert.equal(instructions.length,3);assert.ok(instructions.at(-1).programId.equals(f.program));assert.ok(instructions[1].programId.equals(new PublicKey(f.accounts.get([...f.accounts.keys()].find(k=>f.accounts.get(k)?.data.length===307)).data.subarray(72,104))));
 await assert.rejects(buildDevnetChildLaunch(f.connection,{...input,name:'Different'}),/winning proposal/);
 const parent=f.accounts.get(deriveLineagePda(f.program,f.mint).toBase58()).data;parent[137]=5;assert.ok(await buildDevnetChildLaunch(f.connection,input));
 const late=fixture({selected:true,epochStatus:1,expired:true});await assert.rejects(buildDevnetChildLaunch(late.connection,{...input,programId:late.program,parentMint:late.mint,mint:late.child.publicKey,lookupTable:late.table.key}),/deadline passed/);assert.ok(await build(late,{kind:'expire'}));
});
test('child mint recovery survives refresh, is scoped to round and wallet, and rejects unrelated signatures',async()=>{
 const wallet=Keypair.generate(),f=fixture(),privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(wallet.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'}),signMessage=async bytes=>sign(null,bytes,privateKey);
 const first=await recoverChildMint(f.program,f.epoch,0,wallet.publicKey,signMessage),again=await recoverChildMint(f.program,f.epoch,0,wallet.publicKey,signMessage),other=await recoverChildMint(f.program,f.epoch,1,wallet.publicKey,signMessage);assert.ok(first.publicKey.equals(again.publicKey));assert.ok(!first.publicKey.equals(other.publicKey));await assert.rejects(recoverChildMint(f.program,f.epoch,0,wallet.publicKey,async()=>new Uint8Array(64)),/did not match/);
});
test('reproduction decoders reject malformed accounts before constructing actions',()=>{for(const decode of [decodeEpoch,decodeProposal,decodeCandidate])assert.throws(()=>decode(new Uint8Array(400)));});

test('child launch preserves both signatures when a wallet adds a bounded priority fee',async()=>{
 const {ComputeBudgetProgram,TransactionInstruction,VersionedTransaction,SystemProgram}=await import('@solana/web3.js');const {verify,createPublicKey}=await import('node:crypto');const {sendChildLaunch}=await import('../../sdk/dist/devnet-launch.js');
 const payer=Keypair.generate(),mint=Keypair.generate(),blockhash=Keypair.generate().publicKey.toBase58();let sent=0;
 const instruction=new TransactionInstruction({programId:SystemProgram.programId,keys:[{pubkey:mint.publicKey,isSigner:true,isWritable:true}],data:Buffer.from([0])});
 const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions:[instruction]}).compileToV0Message());
 const connection={getGenesisHash:async()=>(await import('../../sdk/dist/launch-validation.js')).DEVNET_GENESIS_HASH,simulateTransaction:async(tx,options)=>{if(options.sigVerify){tx.signatures.forEach((signature,index)=>{const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),tx.message.staticAccountKeys[index].toBuffer()]),format:'der',type:'spki'});assert.equal(verify(null,tx.message.serialize(),key,signature),true);});}return {value:{err:null}};},sendRawTransaction:async()=>{sent++;return 'unused-rpc-signature'},confirmTransaction:async()=>({value:{err:null}})};
 await sendChildLaunch(connection,{transaction,latest:{blockhash,lastValidBlockHeight:100},mint:mint.publicKey,creator:payer.publicKey,pool:mint.publicKey},mint,async tx=>{const message=TransactionMessage.decompile(tx.message);message.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000}));const returned=new VersionedTransaction(message.compileToV0Message());returned.sign([payer]);return returned;});assert.equal(sent,1);
});

test('first proposal opens its round atomically after metadata preparation, with fresh epoch checks',async()=>{
 const {deriveEpochPda}=await import('../../sdk/dist/index.js');const f=fixture({epochStatus:1});const epoch=deriveEpochPda(f.program,f.mint,1n);const args={proposalId:0,childMint:Keypair.generate().publicKey,name:'First child',symbol:'FIRST',metadataUri:'https://example.com/child.json',metadataHash:new Uint8Array(32)};
 const prepared=await build(f,{kind:'open-propose',epoch,args});const instructions=TransactionMessage.decompile(prepared.transaction.message).instructions;assert.equal(instructions.length,3);assert.ok(prepared.transaction.serialize().length<=1232);assert.ok(instructions[1].keys.some(k=>k.pubkey.equals(epoch)));assert.ok(instructions[2].keys.some(k=>k.pubkey.equals(epoch)));
 await assert.rejects(build(f,{kind:'open-propose',epoch:f.epoch,args}),/round slot changed/);
});
