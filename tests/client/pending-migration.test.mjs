import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {createRequire} from 'node:module';
import {pendingSnapshot} from '../../scripts/production/observe-pending-migration.mjs';
import {raydiumPrograms} from '../../sdk/dist/network.js';
import {RAYDIUM_ACCOUNT_DISCRIMINATORS} from '../../sdk/dist/raydium-layout.js';
const {getPdaLaunchpadPoolId}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
function fixture(){const ids=raydiumPrograms('mainnet-beta'),mint=Keypair.generate().publicKey,quote=new PublicKey('So11111111111111111111111111111111111111112');const data=Buffer.alloc(429);data.set(RAYDIUM_ACCOUNT_DISCRIMINATORS.poolState);data[17]=1;data[18]=6;data[19]=9;data[20]=1;data.writeBigUInt64LE(150000000000000n,101);data.writeBigUInt64LE(100n,125);data.set(ids.LAUNCHPAD_CONFIG.toBytes(),141);data.set(mint.toBytes(),205);data.set(quote.toBytes(),237);return {ids,address:getPdaLaunchpadPoolId(ids.LAUNCHPAD_PROGRAM,mint,quote).publicKey,account:{owner:ids.LAUNCHPAD_PROGRAM,data}};}
test('pending observer records only canonical pre-migration vesting snapshots',()=>{
 const f=fixture();const p=pendingSnapshot(f.address,f.account,f.ids);assert.equal(p.status,1);assert.equal(p.vestingStartTime,'100');assert.ok(p.accountDataBase64);assert.equal(p.accountSha256.length,64);
 for(const mutate of [f=>f.account.data[17]=2,f=>f.account.data[17]=0,f=>f.account.data[20]=0,f=>f.account.data.writeBigUInt64LE(0n,125),f=>f.account.data.writeBigUInt64LE(1n,109),f=>f.account.data.writeBigUInt64LE(0n,101),f=>f.account.owner=Keypair.generate().publicKey,f=>f.address=Keypair.generate().publicKey,f=>f.account.data.set(Keypair.generate().publicKey.toBytes(),141)]){const f=fixture();mutate(f);assert.equal(pendingSnapshot(f.address,f.account,f.ids),null);}
});
