import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {Keypair} from '@solana/web3.js';import {createHash,createPrivateKey,sign} from 'node:crypto';
import {metadataUploadMessage,normalizeTokenDraft} from '../../sdk/dist/launch-validation.js';
import {POST} from '../../apps/web/app/api/metadata/route.ts';
import {readLocalTokenAsset,verifiedParticipantCount,localUploadsEnabled} from '../../apps/web/lib/token-storage.ts';
import {GET} from '../../apps/web/app/api/assets/[id]/route.ts';
test('production devnet signed uploads persist public assets and count unique verified participants',async()=>{
 const keys=['NODE_ENV','NEXT_PUBLIC_SOLANA_CLUSTER','DEVNET_PERSISTENT_UPLOADS','TOKEN_UPLOADS_DIRECTORY','TOKEN_ASSET_BASE_URL','BLOB_READ_WRITE_TOKEN','VERCEL','UPLOAD_BACKEND_URL'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const folder=await mkdtemp(path.join(tmpdir(),'stolons-beta-test-'));
 try{
  for(const k of keys)delete process.env[k];Object.assign(process.env,{NODE_ENV:'production',NEXT_PUBLIC_SOLANA_CLUSTER:'devnet',DEVNET_PERSISTENT_UPLOADS:'true',TOKEN_UPLOADS_DIRECTORY:folder,TOKEN_ASSET_BASE_URL:'https://backend.example.com'});
  const wallet=Keypair.generate(),origin='https://frontend.example.com';const draft=normalizeTokenDraft({name:'Beta Test',symbol:'BETA',description:'test',website:'',twitter:'',telegram:''});
  const image=Buffer.from('89504e470d0a1a0a','hex'),hash=createHash('sha256').update(image).digest('hex');const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(wallet.secretKey.slice(0,32))]),format:'der',type:'pkcs8'});
  async function upload(bad=false){const timestamp=Date.now(),signature=bad?Buffer.alloc(64):sign(null,Buffer.from(metadataUploadMessage(draft,hash,wallet.publicKey.toBase58(),origin,timestamp)),privateKey);const form=new FormData();for(const [k,v]of Object.entries(draft))form.set(k,v);form.set('image',new File([image],'test.png',{type:'image/png'}));form.set('wallet',wallet.publicKey.toBase58());form.set('signedOrigin',origin);form.set('timestamp',String(timestamp));form.set('signature',signature.toString('base64'));return POST(new Request(origin+'/api/metadata',{method:'POST',headers:{origin},body:form}));}
  assert.equal((await upload(true)).status,400);assert.equal(await verifiedParticipantCount(),0);
  const response=await upload();assert.equal(response.status,200);const stored=await response.json();assert.match(stored.metadataUri,/^https:\/\/backend.example.com\/api\/assets\/[a-f0-9]{64}\.json$/);
  const id=stored.metadataUri.split('/').pop();const data=await readLocalTokenAsset(id);assert.equal(JSON.parse(data.toString()).name,draft.name);assert.equal(await verifiedParticipantCount(),1);
  assert.equal((await upload()).status,200);assert.equal(await verifiedParticipantCount(),1);
  const asset=await GET(new Request(stored.metadataUri),{params:Promise.resolve({id})});assert.equal(asset.status,200);assert.equal(asset.headers.get('access-control-allow-origin'),'*');
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER='mainnet-beta';assert.equal(localUploadsEnabled(),false);assert.equal(await readLocalTokenAsset(id),null);
 }finally{for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}await rm(folder,{recursive:true,force:true});}
});
