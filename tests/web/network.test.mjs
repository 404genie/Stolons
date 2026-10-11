import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Keypair} from '@solana/web3.js';
function inspect(values={}){
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('NEXT_PUBLIC_'))delete env[key];
 const code="import('./apps/web/lib/network.ts').then(m=>{console.log(JSON.stringify({cluster:m.SOLANA_CLUSTER,enabled:m.TRANSACTIONS_ENABLED,target:String(m.GRADUATION_TARGET_LAMPORTS),query:m.EXPLORER_QUERY}));try{m.requireTransactions()}catch{console.log('blocked')}})";
 return spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:new URL('../../',import.meta.url),env:{...env,...values},encoding:'utf8'});
}
test('web defaults to devnet and rejects incomplete production settings',()=>{
 const defaultResult=inspect();assert.equal(defaultResult.status,0);assert.equal(JSON.parse(defaultResult.stdout).cluster,'devnet');
 assert.notEqual(inspect({NEXT_PUBLIC_SOLANA_CLUSTER:'mainnet-beta'}).status,0);
 assert.notEqual(inspect({NEXT_PUBLIC_SOLANA_CLUSTER:'testnet'}).status,0);
});
test('configured mainnet remains closed until explicitly enabled',()=>{
 const values={NEXT_PUBLIC_SOLANA_CLUSTER:'mainnet-beta',NEXT_PUBLIC_RPC_URL:'https://rpc.example.com',NEXT_PUBLIC_STOLONS_PROGRAM_ID:Keypair.generate().publicKey.toBase58(),NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE:Keypair.generate().publicKey.toBase58(),NEXT_PUBLIC_GRADUATION_TARGET_LAMPORTS:'85000000000'};
 const closed=inspect(values);assert.equal(closed.status,0);assert.match(closed.stdout,/blocked/);assert.equal(JSON.parse(closed.stdout.split('\n')[0]).enabled,false);
 const open=inspect({...values,NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS:'true'});assert.equal(open.status,0);assert.equal(JSON.parse(open.stdout).enabled,true);
 assert.notEqual(inspect({...values,NEXT_PUBLIC_GRADUATION_TARGET_LAMPORTS:'1000000000'}).status,0);
 assert.notEqual(inspect({...values,NEXT_PUBLIC_STOLONS_PROGRAM_ID:'4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ'}).status,0);
});
