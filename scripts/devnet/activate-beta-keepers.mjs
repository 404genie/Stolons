// Run in Codespaces after `railway login`. Secrets travel over stdin, never argv.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Keypair} from '@solana/web3.js';
const scope=['--project','759f4497-5109-4b2d-816e-3810fa300dee','--environment','46216523-fd56-42f9-ab77-c5b20d3d6c2a','--service','86bdc013-3f6d-4744-8b0a-bcb65670bd83'];
const credentials=[];
for(const [name,path] of [['KEEPER_KEYPAIR_JSON','keypairs/devnet-fee-keeper.json'],['TREASURY_KEYPAIR_JSON','keypairs/devnet-wallet.json']]){
 const value=await readFile(path,'utf8');const key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(value)));
 if(name==='TREASURY_KEYPAIR_JSON'&&key.publicKey.toBase58()!=='HJD8UegSzgEdFUGb5Kmu68NsH752jB2EeAVPr2zZk6Wp')throw Error('Treasury key does not match the configured wallet.');
 credentials.push([name,value]);if(name==='KEEPER_KEYPAIR_JSON')credentials.push(['KEEPER_WALLET',key.publicKey.toBase58()]);
}
function run(args,input){const result=spawnSync('railway',args,{input,encoding:'utf8',stdio:['pipe','ignore','ignore']});if(result.error||result.status!==0)throw Error('Railway command failed. Install @railway/cli and run railway login; then rerun.');}
run(['variable','set','KEEPER_ENABLED=false','--skip-deploys',...scope]);
for(const [name,value] of credentials)run(['variable','set',name,'--stdin','--skip-deploys',...scope],value);
run(['variable','set','KEEPER_ENABLED=true',...scope]);
console.log('Keeper credentials uploaded and activation requested. Check Railway deployment logs before closing the terminal.');
