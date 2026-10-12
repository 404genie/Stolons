// Offline release report. Reads artifacts and public manifest only, never keys.
import {verifyReleaseEvidence} from './release-evidence.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {PublicKey} from '@solana/web3.js';
import {deriveConfigPda,deriveReproductionAuthorityPda} from '../../sdk/dist/index.js';
const {ALL_PROGRAM_ID,getPdaPlatformId}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
const folder='target/mainnet/';
const manifest=JSON.parse(await readFile(folder+'manifest.json','utf8'));
if(manifest.cluster!=='mainnet-beta'||manifest.launchlabProgram!==ALL_PROGRAM_ID.LAUNCHPAD_PROGRAM.toBase58())throw Error('Mainnet manifest mismatch.');
const program=new PublicKey(manifest.programId),authority=new PublicKey(manifest.configAuthority);
const platform=getPdaPlatformId(ALL_PROGRAM_ID.LAUNCHPAD_PROGRAM,authority).publicKey.toBase58();
if(manifest.platformConfig&&manifest.platformConfig!==platform)throw Error('Platform differs from authority-derived address; review it before changing settings.');
const binary=await readFile(folder+'stolons.so'),idlBytes=await readFile(folder+'stolons.json');
if(JSON.parse(idlBytes).address!==program.toBase58())throw Error('Artifact IDL identity mismatch.');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceCommit=(await readFile(folder+'source-commit.txt','utf8')).trim();
if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('Invalid build source commit.');
const report={cluster:manifest.cluster,sourceCommit,programId:program.toBase58(),upgradeAuthority:manifest.upgradeAuthority,configAuthority:manifest.configAuthority,treasury:manifest.treasury,keeperWallet:manifest.keeperWallet,derivedAddresses:{platformConfig:platform,config:deriveConfigPda(program).toBase58(),reproductionAuthority:deriveReproductionAuthorityPda(program).toBase58()},artifactBytes:binary.length,sha256:{program:sha256(binary),idl:sha256(idlBytes)},allocation:{curveTokens:700000000,migrationTokens:150000000,reproductionReserveTokens:150000000},lookupTable:manifest.lookupTable,transactionsSent:0,deploymentVerified:false,publicLaunchApproved:false};
const auditedBuild=JSON.parse(await readFile(new URL('../../docs/validation/mainnet-audit-build-2026-10-11.json',import.meta.url),'utf8'));
const clockEvidence=JSON.parse(await readFile(new URL('../../docs/validation/fundraising-clock-2026-10-12.json',import.meta.url),'utf8'));
const runtimeEvidence=JSON.parse(await readFile(new URL('../../docs/validation/expiry-bond-runtime-2026-10-12.json',import.meta.url),'utf8'));
report.releaseEvidence=verifyReleaseEvidence(report,auditedBuild,clockEvidence,runtimeEvidence);
// Keep the source manifest intact until initialization produces verified accounts.
await writeFile(folder+'release-review.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
