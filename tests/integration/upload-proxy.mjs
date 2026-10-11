import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, createPrivateKey, sign, webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../', import.meta.url));
const require=createRequire(root+'/package.json');
const {Keypair}=require('@solana/web3.js');
const {metadataUploadMessage}=await import(root+'/sdk/dist/launch-validation.js');
const server=spawn('pnpm',['--filter','@stolons/web','dev','--hostname','127.0.0.1','--port','3017'],{cwd:root,env:{...process.env,NODE_ENV:'development'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
try {
 let ready=false;
 for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:3017/launch');ready=true;break}catch{} await new Promise(r=>setTimeout(r,200));}
 assert.ok(ready,logs);
 const key=Keypair.generate();
 const priv=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),key.secretKey.subarray(0,32)]),format:'der',type:'pkcs8'});
 const draft={name:'Proxy Root',symbol:'PROXY',description:'First line\nSecond line',website:'',twitter:'',telegram:''};
 const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
 const signedOrigin='https://codespace-3000.app.github.dev';
 const timestamp=Date.now(); const wallet=key.publicKey.toBase58();
 const message=new TextEncoder().encode(metadataUploadMessage(draft,createHash('sha256').update(bytes).digest('hex'),wallet,signedOrigin,timestamp));
 const signature=sign(null,message,priv);
 const browserKey=await webcrypto.subtle.importKey('raw',key.publicKey.toBytes(),'Ed25519',false,['verify']);
 assert.ok(await webcrypto.subtle.verify('Ed25519',browserKey,signature,message));
 function form(site=signedOrigin){const f=new FormData();for(const [k,v] of Object.entries(draft))f.set(k,v);f.set('image',new Blob([bytes],{type:'image/png'}),'root.png');f.set('wallet',wallet);f.set('timestamp',String(timestamp));f.set('signature',signature.toString('base64'));f.set('signedOrigin',site);return f;}
 const response=await fetch('http://127.0.0.1:3017/api/metadata',{method:'POST',headers:{Origin:'http://localhost:3000'},body:form()});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.ok(result.metadataUri.startsWith(signedOrigin));
 const metadata=await (await fetch('http://127.0.0.1:3017'+new URL(result.metadataUri).pathname)).json();assert.equal(metadata.description,draft.description);
 const altered=await fetch('http://127.0.0.1:3017/api/metadata',{method:'POST',headers:{Origin:'http://localhost:3000'},body:form('https://attacker.test')});assert.equal(altered.status,400);assert.match((await altered.json()).error,/does not match/);
 console.log('PASS: browser signature verification, rewritten proxy Origin, multiline multipart upload, stored JSON, tampered signed site rejection');
}finally{server.kill('SIGTERM');server.stdout.destroy();server.stderr.destroy();}
