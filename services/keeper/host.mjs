import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair} from '@solana/web3.js';
const kind=process.env.KEEPER_SERVICE_KIND;
if(!['all','graduation','protocol','treasury'].includes(kind))throw Error('Set KEEPER_SERVICE_KIND.');
let state='awaiting-credentials',secrets=null,stopping=false;
const children=[];
const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.statusCode=req.url==='/health'?200:state==='running'?200:503;res.end(JSON.stringify({service:kind,state,transactionsEnabled:process.env.KEEPER_ENABLED==='true'}));});
server.listen(Number(process.env.PORT||3000),'0.0.0.0');
async function stop(code=0){if(stopping)return;stopping=true;state='stopped';for(const child of children)child.kill('SIGTERM');await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))));server.close();if(secrets)await rm(secrets,{recursive:true,force:true});process.exit(code);}
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
if(process.env.KEEPER_ENABLED!=='true')console.log(`${kind}: disabled until credentials and configuration are supplied.`);
else{
 const kinds=kind==='all'?['graduation','protocol','treasury']:[kind];
 secrets=await mkdtemp(join(tmpdir(),'stolons-keeper-'));
 for(const current of kinds){
  const name=current==='treasury'?'TREASURY_KEYPAIR_JSON':'KEEPER_KEYPAIR_JSON';
  if(!process.env[name])throw Error(`Missing ${name}; configure it as a sealed service variable.`);
  const bytes=Uint8Array.from(JSON.parse(process.env[name]));Keypair.fromSecretKey(bytes);
  const path=join(secrets,`${current}.json`);await writeFile(path,JSON.stringify([...bytes]),{mode:0o600});
  const env={...process.env,[current==='treasury'?'TREASURY_KEYPAIR_PATH':'KEEPER_KEYPAIR_PATH']:path};delete env.KEEPER_KEYPAIR_JSON;delete env.TREASURY_KEYPAIR_JSON;
  const args=current==='graduation'?['services/keeper/graduation.mjs','--apply']:current==='protocol'?['services/keeper/fees.mjs','--apply','--watch']:['services/keeper/treasury.mjs','--apply'];
  const child=spawn(process.execPath,args,{env,stdio:'inherit'});children.push(child);
  child.on('error',error=>{console.error(error.message);void stop(1);});
  child.on('exit',code=>{if(!stopping){console.error(`${current} worker stopped; inspect logs before restarting.`);void stop(code||1);}});
 }
 state='running';
}
