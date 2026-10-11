import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {Connection,PublicKey} from '@solana/web3.js';
import {deriveConfigPda,deriveReproductionAuthorityPda,decodePlatformConfig,GENESIS_SUPPLY,CURVE_ALLOCATION,REPRODUCTION_RESERVE} from '../../sdk/dist/index.js';
const {ALL_PROGRAM_ID,PlatformConfig,LaunchpadConfig,CpmmConfigInfoLayout,Curve}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
import {MAINNET_GENESIS_HASH as MAINNET_GENESIS} from '../../sdk/dist/network.js';
const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const DEVNET_PROGRAM='4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ';
class PreflightError extends Error {}
const fail=message=>{throw new PreflightError(message)};
export function validateManifest(m){
 if(m.cluster!=='mainnet-beta')fail('Manifest must explicitly select mainnet-beta.');
 for(const field of ['programId','upgradeAuthority','configAuthority','treasury','platformConfig','cpmmConfig','lookupTable','keeperWallet']){
  try{if(!m[field]||new PublicKey(m[field]).equals(PublicKey.default))throw Error();}catch{fail(`Set a nonzero public key for ${field}.`);}
 }
 if(m.programId===DEVNET_PROGRAM)fail('Use a separate mainnet program ID, not the devnet program ID.');
 for(const [field,expected]of [['launchlabProgram',ALL_PROGRAM_ID.LAUNCHPAD_PROGRAM],['cpmmProgram',ALL_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM],['launchlabConfig',ALL_PROGRAM_ID.LAUNCHPAD_CONFIG]])if(m[field]!==expected.toBase58())fail(`Noncanonical mainnet ${field}.`);
 for(const [field,max]of [['proposalWindowSeconds',2592000],['votingWindowSeconds',2592000],['candidateLaunchWindowSeconds',604800],['candidateMigrationWindowSeconds',2592000]])if(!Number.isSafeInteger(m[field])||m[field]<300||m[field]>max)fail(`Set ${field} between 300 and ${max} seconds; do not reuse devnet's 60-second windows.`);
 for(const field of ['proposalFeeLamports','graduationTargetLamports'])if(typeof m[field]!=='string'||!/^\d+$/.test(m[field])||BigInt(m[field])>18446744073709551615n)fail(`Set ${field} as an unsigned integer string.`);
 if(BigInt(m.proposalFeeLamports)>1000000000n||BigInt(m.graduationTargetLamports)<=1000000000n)fail('Production fees must fit protocol limits and graduation must exceed the 1 SOL devnet test target.');
 for(const field of ['platformFeeRate','creatorFeeRate'])if(!Number.isSafeInteger(m[field])||m[field]<=0||m[field]>=1000000)fail(`Set nonzero ${field} in millionths for launchpad and creator revenue.`);
 for(const field of ['launchProtocolFeeRate','cpmmTradeFeeRate','cpmmCreatorFeeRate'])if(!Number.isSafeInteger(m[field])||m[field]<0||m[field]>=1000000)fail(`Set ${field} in millionths.`);
 if(m.launchProtocolFeeRate+m.platformFeeRate+m.creatorFeeRate>=1000000||m.cpmmTradeFeeRate+m.cpmmCreatorFeeRate>=1000000)fail('Combined venue fees must be below 100%.');
 if(m.platformFeeRate+m.creatorFeeRate>=1000000)fail('Combined platform/creator fees must be below 100%.');
 if(new Set([m.keeperWallet,m.upgradeAuthority,m.configAuthority,m.treasury]).size<2||[m.upgradeAuthority,m.configAuthority,m.treasury].includes(m.keeperWallet))fail('Keeper must use a dedicated fee payer, separate from authorities and treasury.');
 return m;
}
export async function inspectMainnet(connection,manifest){
 const m=validateManifest(manifest);
 if(await connection.getGenesisHash()!==MAINNET_GENESIS)fail('RPC genesis is not Solana mainnet-beta. No transaction was sent.');
 const program=new PublicKey(m.programId),config=deriveConfigPda(program),dataKey=PublicKey.findProgramAddressSync([program.toBuffer()],LOADER)[0];
 const keys=[program,dataKey,config,new PublicKey(m.launchlabProgram),new PublicKey(m.cpmmProgram),new PublicKey(m.launchlabConfig),new PublicKey(m.platformConfig),new PublicKey(m.cpmmConfig)];
 const a=await connection.getMultipleAccountsInfo(keys,'confirmed');
 for(const i of [0,3,4])if(!a[i]?.executable||!a[i].owner.equals(LOADER))fail('Configured executable program is unavailable or has the wrong loader.');
 if(a[0].data.length<36||a[0].data.readUInt32LE(0)!==2||!new PublicKey(a[0].data.subarray(4,36)).equals(dataKey))fail('Stolons executable does not point to its canonical ProgramData account.');
 if(!a[1]?.owner.equals(LOADER)||a[1].data.length<45||a[1].data.readUInt32LE(0)!==3||a[1].data[12]!==1||!new PublicKey(a[1].data.subarray(13,45)).equals(new PublicKey(m.upgradeAuthority)))fail('Unexpected mainnet upgrade authority.');
 const c=a[2];if(!c?.owner.equals(program)||c.data.length<307||!c.data.subarray(0,8).equals(Buffer.from([149,8,156,202,160,252,176,217]))||c.data[305]!==2)fail('Mainnet Stolons configuration missing or unsupported.');
 for(const [field,offset]of [['configAuthority',8],['treasury',40],['launchlabProgram',72],['cpmmProgram',104],['launchlabConfig',136],['platformConfig',168],['cpmmConfig',232]])if(!new PublicKey(c.data.subarray(offset,offset+32)).equals(new PublicKey(m[field])))fail(`On-chain ${field} differs from reviewed manifest.`);
 if(new PublicKey(c.data.subarray(200,232)).toBase58()!=='So11111111111111111111111111111111111111112')fail('Quote mint must be wrapped SOL.');
 for(const [field,offset]of [['proposalWindowSeconds',264],['votingWindowSeconds',272],['candidateLaunchWindowSeconds',280],['candidateMigrationWindowSeconds',288],['proposalFeeLamports',296]])if(c.data.readBigUInt64LE(offset)!==BigInt(m[field]))fail(`On-chain ${field} differs from manifest.`);
 if(!a[5]?.owner.equals(keys[3])||!a[6]?.owner.equals(keys[3])||!a[7]?.owner.equals(keys[4]))fail('Raydium configuration owners do not match canonical programs.');
 for(const [index,name]of [[5,'GlobalConfig'],[7,'AmmConfig']])if(!a[index].data.subarray(0,8).equals(createHash('sha256').update('account:'+name).digest().subarray(0,8)))fail('Raydium configuration discriminator mismatch.');
 const launch=LaunchpadConfig.decode(a[5].data),cpmm=CpmmConfigInfoLayout.decode(a[7].data);
 if(launch.mintB.toBase58()!=='So11111111111111111111111111111111111111112'||launch.curveType!==0||cpmm.disableCreatePool)fail('Mainnet curve/CPMM configuration is unsupported or disabled.');
 if(Number(launch.tradeFeeRate.toString())!==m.launchProtocolFeeRate||Number(cpmm.tradeFeeRate.toString())!==m.cpmmTradeFeeRate||Number(cpmm.creatorFeeRate.toString())!==m.cpmmCreatorFeeRate)fail('Raydium fee rates differ from reviewed economics.');
 const BN=launch.tradeFeeRate.constructor,bn=value=>new BN(String(value));
 try{Curve.checkParam({supply:bn(GENESIS_SUPPLY),totalSell:bn(CURVE_ALLOCATION),totalLockedAmount:bn(REPRODUCTION_RESERVE),totalFundRaising:bn(m.graduationTargetLamports),decimals:6,config:launch,migrateType:'cpmm'});}catch{fail('Reviewed graduation target or 70/15/15 allocation violates live Raydium curve constraints.');}
 const p=decodePlatformConfig(a[6].data),full=PlatformConfig.decode(a[6].data);
 if(!new PublicKey(p.feeWallet).equals(new PublicKey(m.treasury))||!new PublicKey(p.cpmmConfig).equals(keys[7])||!new PublicKey(p.vestingWallet).equals(deriveReproductionAuthorityPda(program))||p.vestingScale!==1000000n||p.migrationPlatformScale!==0n||p.migrationCreatorScale!==0n||p.migrationBurnScale!==1000000n)fail('Platform treasury, reproduction vesting or LP burn allocation differs from protocol.');
 if(Number(full.feeRate.toString())!==m.platformFeeRate||Number(full.creatorFeeRate.toString())!==m.creatorFeeRate)fail('On-chain platform/creator fees differ from reviewed economics.');
 // A nonzero override can redirect post-graduation creator revenue away from the launcher.
 if(!full.platformCpCreator.equals(PublicKey.default))fail('Platform CPMM creator override must be zero to preserve launcher creator-fee rights.');
 const table=(await connection.getAddressLookupTable(new PublicKey(m.lookupTable))).value;
 if(!table||!table.isActive())fail('Mainnet lookup table is unavailable or deactivated.');
 const balance=await connection.getBalance(new PublicKey(m.keeperWallet),'confirmed');
 if(balance<50000000)fail('Fund the dedicated keeper with at least 0.05 SOL for fee/rent headroom.');
 return {cluster:m.cluster,programId:m.programId,configurationMatches:true,paused:c.data[304]!==0,keeperLamports:balance,transactionsSent:0,postGraduationRevenueSplitImplemented:true,feeSharingRequiresLiveVerification:true,publicLaunchApproved:false};
}
async function main(){
 const [file,...flags]=process.argv.slice(2);if(!file||flags.some(flag=>flag!=='--offline'))fail('Usage: node scripts/production/preflight.mjs MANIFEST.json [--offline]');
 const m=validateManifest(JSON.parse(await readFile(file,'utf8')));
 if(flags.includes('--offline')){console.log('Manifest checks passed. Live RPC, credentials, client support and security release gates are still required.');return;}
 const rpc=process.env.MAINNET_RPC_URL;try{if(!rpc||new URL(rpc).protocol!=='https:')throw Error();}catch{fail('Set MAINNET_RPC_URL to a dedicated HTTPS mainnet RPC.');}
 if(new URL(rpc).hostname==='api.mainnet-beta.solana.com')fail('Use a dedicated production RPC instead of the shared public endpoint.');
 if(!process.env.BLOB_READ_WRITE_TOKEN)fail('Set the server-only public Blob store credential.');
 const connection=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})});
 console.log(JSON.stringify(await inspectMainnet(connection,m),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error('Mainnet preflight blocked:',error instanceof PreflightError?error.message:'RPC or manifest read failed; check configuration privately.');process.exitCode=1;});
