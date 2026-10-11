import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Keypair,PublicKey} from '@solana/web3.js';
import {validateManifest,inspectMainnet} from '../../scripts/production/preflight.mjs';
const template=JSON.parse(await readFile(new URL('../../production/manifest.example.json',import.meta.url)));
function manifest(){return {...template,...Object.fromEntries(['programId','upgradeAuthority','configAuthority','treasury','platformConfig','cpmmConfig','lookupTable','keeperWallet'].map(field=>[field,Keypair.generate().publicKey.toBase58()])),proposalFeeLamports:'10000000',graduationTargetLamports:'85000000000',platformFeeRate:5000,creatorFeeRate:5000};}
test('production manifest requires explicit addresses, nonzero revenue and longer launch windows',()=>{
 assert.throws(()=>validateManifest(template),/programId/);
 assert.equal(validateManifest(manifest()).cluster,'mainnet-beta');
 for(const override of [{cluster:'devnet'},{programId:'4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ'},{treasury:PublicKey.default.toBase58()},{proposalWindowSeconds:60},{votingWindowSeconds:60},{graduationTargetLamports:'1000000000'},{platformFeeRate:0},{creatorFeeRate:0},{proposalFeeLamports:'1000000001'},{launchlabProgram:Keypair.generate().publicKey.toBase58()}])assert.throws(()=>validateManifest({...manifest(),...override}));
 const m=manifest();assert.throws(()=>validateManifest({...m,keeperWallet:m.upgradeAuthority}),/dedicated/);
});
test('production inspection refuses devnet before reading deployment accounts',async()=>{
 let reads=0;const connection={getGenesisHash:async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',getMultipleAccountsInfo:async()=>{reads++;return [];}};
 await assert.rejects(inspectMainnet(connection,manifest()),/not Solana mainnet-beta/);
 assert.equal(reads,0);
});

test('read-only mainnet inspection checks deployment, config, fees and keeper without submitting',async()=>{
 const {fixture}=await import('../helpers/reproduction-fixture.mjs');
 const {deriveConfigPda,deriveReproductionAuthorityPda}=await import('../../sdk/dist/index.js');
 const f=fixture(),m=manifest(),program=new PublicKey(m.programId),loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
 const config=Buffer.from(f.accounts.get(deriveConfigPda(f.program).toBase58()).data);
 const oldKey=offset=>new PublicKey(config.subarray(offset,offset+32)).toBase58();
 const launch=Buffer.from(f.accounts.get(oldKey(136)).data),platform=Buffer.from(f.accounts.get(oldKey(168)).data),cpmm=Buffer.from(f.accounts.get(oldKey(232)).data);
 for(const [field,offset]of [['configAuthority',8],['treasury',40],['launchlabProgram',72],['cpmmProgram',104],['launchlabConfig',136],['platformConfig',168],['cpmmConfig',232]])config.set(new PublicKey(m[field]).toBytes(),offset);
 for(const [field,offset]of [['proposalWindowSeconds',264],['votingWindowSeconds',272],['candidateLaunchWindowSeconds',280],['candidateMigrationWindowSeconds',288],['proposalFeeLamports',296]])config.writeBigUInt64LE(BigInt(m[field]),offset);
 platform.set(new PublicKey(m.treasury).toBytes(),16);platform.set(new PublicKey(m.cpmmConfig).toBytes(),688);platform.set(deriveReproductionAuthorityPda(program).toBytes(),760);platform.writeBigUInt64LE(BigInt(m.platformFeeRate),104);platform.writeBigUInt64LE(BigInt(m.creatorFeeRate),720);platform.fill(0,800,832);
 const dataKey=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
 const executable=Buffer.alloc(36);executable.writeUInt32LE(2);executable.set(dataKey.toBytes(),4);
 const data=Buffer.alloc(45);data.writeUInt32LE(3);data[12]=1;data.set(new PublicKey(m.upgradeAuthority).toBytes(),13);
 const account=(owner,bytes,executable=false)=>({owner:new PublicKey(owner),data:bytes,executable});
 let reads=0;
 const accounts=[account(loader,executable,true),account(loader,data),account(program,config),account(loader,Buffer.alloc(36),true),account(loader,Buffer.alloc(36),true),account(m.launchlabProgram,launch),account(m.launchlabProgram,platform),account(m.cpmmProgram,cpmm)];
 const connection={getGenesisHash:async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2dZ',getMultipleAccountsInfo:async()=>{reads++;return accounts;},getAddressLookupTable:async()=>({value:{isActive:()=>true}}),getBalance:async()=>100000000};
 const report=await inspectMainnet(connection,m);assert.equal(report.transactionsSent,0);assert.equal(report.publicLaunchApproved,false);assert.equal(reads,1);
 platform.writeBigUInt64LE(0n,104);await assert.rejects(inspectMainnet(connection,m),/fees differ/);
});
