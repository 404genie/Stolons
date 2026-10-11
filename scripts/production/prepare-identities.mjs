// Generates local mainnet identities only. No RPC, SOL transfer or deployment.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Keypair,PublicKey} from '@solana/web3.js';
const treasury=new PublicKey('FRVw3s9Wz4pKzRuUwEj9FZYa39vLbAfXzUqiDYAK2K87');
await mkdir('keypairs',{recursive:true});await mkdir('target/mainnet',{recursive:true});
async function key(name){const path=`keypairs/${name}.json`;try{return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path,'utf8'))));}catch(e){if(e.code!=='ENOENT')throw e;const k=Keypair.generate();await writeFile(path,JSON.stringify([...k.secretKey]),{mode:0o600,flag:'wx'});return k;}}
const program=await key('stolons-mainnet-program'),authority=await key('stolons-mainnet-authority'),keeper=await key('stolons-mainnet-keeper');
const path='target/mainnet/manifest.json';let manifest;try{manifest=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;manifest=JSON.parse(await readFile('production/manifest.example.json','utf8'));}
for(const [field,value]of Object.entries({programId:program.publicKey.toBase58(),upgradeAuthority:authority.publicKey.toBase58(),configAuthority:authority.publicKey.toBase58(),keeperWallet:keeper.publicKey.toBase58(),treasury:treasury.toBase58()})){if(manifest[field]&&manifest[field]!==value)throw Error(`Existing manifest ${field} differs; preserve identities and resolve before continuing.`);manifest[field]=value;}
await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({programId:manifest.programId,upgradeAuthority:manifest.upgradeAuthority,configAuthority:manifest.configAuthority,keeperWallet:manifest.keeperWallet,treasury:manifest.treasury,manifest:path,transactionsSent:0},null,2));
