import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateManifest} from './preflight.mjs';

/** Public frontend configuration only. This does not enable transactions. */
export function productionEnvironment(manifest,rpc){
 const m=validateManifest(manifest);
 let url;try{url=new URL(rpc);}catch{throw Error('Provide a dedicated HTTPS browser RPC.');}
 if(url.protocol!=='https:'||url.username||url.password||url.hostname==='api.mainnet-beta.solana.com'||/[\r\n]/.test(rpc))throw Error('Provide a dedicated HTTPS browser RPC without embedded login credentials.');
 const values={NEXT_PUBLIC_SOLANA_CLUSTER:'mainnet-beta',NEXT_PUBLIC_RPC_URL:rpc,NEXT_PUBLIC_STOLONS_PROGRAM_ID:m.programId,NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE:m.lookupTable,NEXT_PUBLIC_GRADUATION_TARGET_LAMPORTS:m.graduationTargetLamports,NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS:'false'};
 return '# Generated public settings. Scope the browser RPC by origin.\n'+Object.entries(values).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n';
}
async function main(){
 const [manifestFile,outputFile]=process.argv.slice(2);
 if(!manifestFile||!outputFile)throw Error('Usage: node scripts/production/prepare-environment.mjs MANIFEST.json OUTPUT.env');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
 const content=productionEnvironment(manifest,process.env.MAINNET_BROWSER_RPC_URL);
 await writeFile(outputFile,content,{flag:'wx',mode:0o600});
 console.log('Public frontend settings prepared with mainnet transactions disabled. No transactions submitted.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.code==='EEXIST'?'Output already exists; choose a new review file.':error.message);process.exitCode=1;});
