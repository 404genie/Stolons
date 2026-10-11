import test from 'node:test';import assert from 'node:assert/strict';import {Keypair} from '@solana/web3.js';
import {fixture} from '../helpers/reproduction-fixture.mjs';
import {verifyDevnetFamily} from '../../sdk/dist/verify-family.js';
import {deriveFamilyPda,deriveLineagePda,deriveReproductionVaultPda,TOKEN_PROGRAM_ID} from '../../sdk/dist/index.js';
function settled(){const f=fixture({epochStatus:1}),root=f.accounts.get(deriveLineagePda(f.program,f.mint).toBase58()).data,childMint=Keypair.generate().publicKey,child=Buffer.from(root);
 root.fill(0,146,162);root.writeBigUInt64LE(990000000000000n,146);root[162]=1;
 child.set(childMint.toBytes(),8);child.set(f.mint.toBytes(),72);child[136]=1;child[137]=5;child.fill(0,146,162);child.writeBigUInt64LE(10000000000000n,146);child[162]=0;
 const family=Buffer.alloc(73);family.set(f.mint.toBytes(),8);family.writeBigUInt64LE(1000000000000000n,40);family.writeBigUInt64LE(1n,56);f.accounts.set(deriveFamilyPda(f.program,f.mint).toBase58(),{owner:f.program,data:family});
 for(const [mint,supply,reserve]of [[f.mint,990000000000000n,140000000000000n],[childMint,1000000000000000n,150000000000000n]]){const data=Buffer.alloc(82);data.writeBigUInt64LE(supply,36);data[44]=6;data[45]=1;const vault=Buffer.alloc(165);vault.set(mint.toBytes(),0);vault.writeBigUInt64LE(reserve,64);f.accounts.set(mint.toBase58(),{owner:TOKEN_PROGRAM_ID,data});f.accounts.set(deriveReproductionVaultPda(f.program,mint).toBase58(),{owner:TOKEN_PROGRAM_ID,data:vault});}
 f.connection.getProgramAccounts=async()=>[{account:{owner:f.program,data:root}},{account:{owner:f.program,data:child}}];return {...f,child,childMint};}
test('family verification checks exact 10M reserve burn, child activation, and conserved ancestry',async()=>{const f=settled();const result=await verifyDevnetFamily(f.connection,f.program,f.mint);assert.equal(result.activeTokens,2);assert.equal(result.tokens[0].reserve,'140000000000000');assert.equal(result.tokens[0].requiredParentBurn,'10000000000000');assert.equal(result.genesisRootMass,'1000000000000000');});
test('family verification rejects wrong reserve consumption, ancestry duplication and uncleared mint authority',async()=>{
 for(const mutate of [f=>f.accounts.get(deriveReproductionVaultPda(f.program,f.mint).toBase58()).data.writeBigUInt64LE(150000000000000n,64),f=>f.child.writeBigUInt64LE(20000000000000n,146),f=>f.accounts.get(f.childMint.toBase58()).data.writeUInt32LE(1,0)]){const f=settled();mutate(f);await assert.rejects(verifyDevnetFamily(f.connection,f.program,f.mint));}
});
