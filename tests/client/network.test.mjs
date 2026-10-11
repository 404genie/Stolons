import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {sign,createPrivateKey,webcrypto} from 'node:crypto';
import {assertCluster,clusterGenesis,raydiumPrograms,launchTarget} from '../../sdk/dist/network.js';
import {childMintRecoveryMessage,recoverChildMint} from '../../sdk/dist/child-mint.js';
globalThis.crypto??=webcrypto;
test('network selection rejects unsupported clusters and mismatched RPCs',async()=>{
 for(const cluster of ['devnet','mainnet-beta']){
  await assertCluster({getGenesisHash:async()=>clusterGenesis(cluster)},cluster);
  await assert.rejects(assertCluster({getGenesisHash:async()=>clusterGenesis(cluster==='devnet'?'mainnet-beta':'devnet')},cluster),/cluster mismatch/);
 }
 assert.throws(()=>clusterGenesis('testnet'),/Unsupported/);
 assert.notEqual(raydiumPrograms('devnet').LAUNCHPAD_PROGRAM.toBase58(),raydiumPrograms('mainnet-beta').LAUNCHPAD_PROGRAM.toBase58());
});
test('mainnet fundraising requires a reviewed target and devnet retains its default',()=>{
 assert.equal(launchTarget('devnet'),1000000000n);
 assert.equal(launchTarget('mainnet-beta',85000000000n),85000000000n);
 for(const target of [undefined,0n,1000000000n,24000000000n,85000000001n,18446744073709551616n])assert.throws(()=>launchTarget('mainnet-beta',target));
});
test('child mint recovery retains devnet keys and separates mainnet recovery',async()=>{
 const [program,epoch,wallet]=Array.from({length:3},()=>Keypair.generate());
 const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(wallet.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
 const approve=async message=>new Uint8Array(sign(null,message,key));
 const message=childMintRecoveryMessage(program.publicKey,epoch.publicKey,0,wallet.publicKey);
 assert.equal(message,`Stolons private child mint recovery v1\nCluster: devnet\nProgram: ${program.publicKey}\nRound: ${epoch.publicKey}\nProposal: 0\nWallet: ${wallet.publicKey}\nThis recovers the proposed child mint key. Keep this signature private. It authorizes no transaction.`);
 const args=[program.publicKey,epoch.publicKey,0,wallet.publicKey,approve];
 const devnet=await recoverChildMint(...args),again=await recoverChildMint(...args,'devnet'),mainnet=await recoverChildMint(...args,'mainnet-beta');
 assert.ok(devnet.publicKey.equals(again.publicKey));assert.ok(!mainnet.publicKey.equals(devnet.publicKey));
});

test('mainnet RPC verification uses the full canonical hash and rejects the former typo',async()=>{
 assert.equal(clusterGenesis('mainnet-beta'),'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
 await assertCluster({getGenesisHash:async()=>'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'},'mainnet-beta');
 for(const hash of ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2dZ','5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'])await assert.rejects(assertCluster({getGenesisHash:async()=>hash},'mainnet-beta'),/cluster mismatch/);
});
