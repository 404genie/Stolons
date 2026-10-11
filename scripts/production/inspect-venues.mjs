// Pre-deployment read-only checks; no private keys or transaction submission.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Connection,PublicKey} from '@solana/web3.js';
import {assertCluster} from '../../sdk/dist/network.js';
import {readRetryFetch} from '../../services/keeper/rpc.mjs';
const {ALL_PROGRAM_ID,LaunchpadConfig,CpmmConfigInfoLayout,Curve}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
async function main(){
 const m=JSON.parse(await readFile(process.argv[2]||'target/mainnet/manifest.json','utf8'));
 if(m.cluster!=='mainnet-beta')throw Error('Manifest cluster mismatch.');
 const rpc=process.env.MAINNET_RPC_URL||'https://api.mainnet-beta.solana.com';
 if(new URL(rpc).protocol!=='https:')throw Error('Use an HTTPS RPC.');
 const connection=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()});
 await assertCluster(connection,'mainnet-beta');
 for(const [field,expected] of [['launchlabProgram',ALL_PROGRAM_ID.LAUNCHPAD_PROGRAM],['cpmmProgram',ALL_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM],['launchlabConfig',ALL_PROGRAM_ID.LAUNCHPAD_CONFIG]])if(m[field]!==expected.toBase58())throw Error(`Noncanonical ${field}.`);
 const keys=['launchlabProgram','cpmmProgram','launchlabConfig','cpmmConfig'].map(field=>new PublicKey(m[field]));
 const a=await connection.getMultipleAccountsInfo(keys,'confirmed');
 const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
 for(const index of [0,1])if(!a[index]?.executable||!a[index].owner.equals(loader))throw Error('Canonical Raydium program unavailable.');
 for(const [index,owner,name]of [[2,keys[0],'GlobalConfig'],[3,keys[1],'AmmConfig']])if(!a[index]?.owner.equals(owner)||!a[index].data.subarray(0,8).equals(createHash('sha256').update('account:'+name).digest().subarray(0,8)))throw Error('Raydium configuration owner/discriminator mismatch.');
 const launch=LaunchpadConfig.decode(a[2].data),cpmm=CpmmConfigInfoLayout.decode(a[3].data);
 if(launch.mintB.toBase58()!=='So11111111111111111111111111111111111111112'||launch.curveType!==0||cpmm.disableCreatePool)throw Error('Unsupported or disabled Raydium configuration.');
 const rates={launchProtocolFeeRate:Number(launch.tradeFeeRate.toString()),cpmmTradeFeeRate:Number(cpmm.tradeFeeRate.toString()),cpmmCreatorFeeRate:Number(cpmm.creatorFeeRate.toString())};
 for(const [field,value]of Object.entries(rates))if(m[field]!==value)throw Error(`Live ${field} is ${value} millionths; manifest expects ${m[field]}. Review economics before changing settings.`);
 const BN=launch.tradeFeeRate.constructor,bn=value=>new BN(String(value));
 Curve.checkParam({supply:bn(1000000000000000n),totalSell:bn(800000000000000n),totalLockedAmount:bn(150000000000000n),totalFundRaising:bn(m.graduationTargetLamports),decimals:6,config:launch,migrateType:'cpmm'});
 const balances={};for(const field of ['upgradeAuthority','keeperWallet'])balances[field]=await connection.getBalance(new PublicKey(m[field]),'confirmed');
 const artifact=await readFile('target/mainnet/stolons.so');
 const minimumProgramDataRentLamports=await connection.getMinimumBalanceForRentExemption(artifact.length+45);
 console.log(JSON.stringify({cluster:m.cluster,programId:m.programId,venueChecksPassed:true,rates,graduationTargetLamports:m.graduationTargetLamports,balancesLamports:balances,artifactBytes:artifact.length,artifactSha256:createHash('sha256').update(artifact).digest('hex'),minimumProgramDataRentLamports,rentNote:'ProgramData rent only; excludes executable account, transaction fees, temporary deploy buffer and initialization costs.',platformConfig:m.platformConfig,lookupTable:m.lookupTable,transactionsSent:0,publicLaunchApproved:false},null,2));
}
main().catch(error=>{console.error('Pre-deployment inspection blocked:',/429/.test(error.message)?'RPC rate limit. Retry later or set MAINNET_RPC_URL privately.':/fetch|https?:|ECONN|ENOTFOUND/.test(error.message)?'RPC unavailable; check the endpoint privately.':error.message);process.exitCode=1;});
