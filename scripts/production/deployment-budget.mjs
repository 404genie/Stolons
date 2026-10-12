// Read-only funding estimate for the reviewed artifact. No keys or transactions.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {PlatformConfig}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
import {Connection,PublicKey} from '@solana/web3.js';
import {assertCluster} from '../../sdk/dist/network.js';
import {readRetryFetch} from '../../services/keeper/rpc.mjs';
import {verifyReleaseEvidence} from './release-evidence.mjs';
async function main(){
 const folder='target/mainnet/';
 const m=JSON.parse(await readFile(folder+'manifest.json','utf8'));
 if(m.cluster!=='mainnet-beta')throw Error('Manifest is not mainnet.');
 const binary=await readFile(folder+'stolons.so'),idl=await readFile(folder+'stolons.json');
 const sha256=b=>createHash('sha256').update(b).digest('hex');
 const reviewed=JSON.parse(await readFile(new URL('../../docs/validation/mainnet-audit-build-2026-10-11.json',import.meta.url),'utf8'));
 const clock=JSON.parse(await readFile(new URL('../../docs/validation/fundraising-clock-2026-10-12.json',import.meta.url),'utf8'));
 const runtimeEvidence=JSON.parse(await readFile(new URL('../../docs/validation/expiry-bond-runtime-2026-10-12.json',import.meta.url),'utf8'));
 const evidence=verifyReleaseEvidence({sourceCommit:(await readFile(folder+'source-commit.txt','utf8')).trim(),programId:m.programId,artifactBytes:binary.length,sha256:{program:sha256(binary),idl:sha256(idl)}},reviewed,clock,runtimeEvidence);
 if(JSON.parse(idl).address!==m.programId)throw Error('IDL program identity mismatch.');
 if(m.upgradeAuthority!==m.configAuthority||m.keeperWallet===m.upgradeAuthority)throw Error('Unexpected authority/keeper configuration.');
 const rpc=process.env.MAINNET_RPC_URL||'https://api.mainnet-beta.solana.com';
 if(new URL(rpc).protocol!=='https:')throw Error('Use HTTPS mainnet RPC.');
 const connection=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:readRetryFetch()});
 await assertCluster(connection,'mainnet-beta');
 const keys=[m.programId,m.upgradeAuthority,m.keeperWallet].map(k=>new PublicKey(k));
 const accounts=await connection.getMultipleAccountsInfo(keys,'confirmed');
 const sizes={program:36,programData:binary.length+45,temporaryBuffer:binary.length+37,platformConfig:PlatformConfig.span,protocolConfig:307,lookupTableFullCapacity:56+256*32};
 const rents={};for(const [name,size]of Object.entries(sizes))rents[name]=await connection.getMinimumBalanceForRentExemption(size,'confirmed');
 const feeAndSetupAllowance=20000000; // Deployment/setup transaction fee allowance, not a fee quote.
 // Agave v2.3.0 funds its buffer at ProgramData rent, then the loader
 // drains the buffer to the payer before funding ProgramData. Do not double count.
 const setupRent=rents.platformConfig+rents.protocolConfig+rents.lookupTableFullCapacity;
 const conservativeAuthorityBudget=rents.programData+rents.program+setupRent+feeAndSetupAllowance;
 console.log(JSON.stringify({cluster:m.cluster,programId:m.programId,programAccountExists:!!accounts[0],programExecutable:accounts[0]?.executable||false,authority:m.upgradeAuthority,keeper:m.keeperWallet,balancesLamports:{authority:accounts[1]?.lamports||0,keeper:accounts[2]?.lamports||0},rentExemptionLamports:rents,setupAccountRentLamports:setupRent,lookupTableCapacityBudgeted:256,planningAllowanceLamports:feeAndSetupAllowance,conservativeAuthorityBudgetLamports:conservativeAuthorityBudget,authorityShortfallLamports:Math.max(0,conservativeAuthorityBudget-(accounts[1]?.lamports||0)),keeperStarterBudgetLamports:100000000,combinedPlanningBudgetLamports:conservativeAuthorityBudget+100000000,proposedFundingLamports:{authority:4200000000,keeper:100000000},fitsProposedFunding:conservativeAuthorityBudget<=4200000000,note:'Agave v2.3.0 initial deployment reuses the ProgramData-sized buffer deposit; it is not a second full rent deposit. Budget includes one ProgramData rent, program account rent, SDK platform layout rent, protocol config rent, a maximum-capacity lookup table and 0.02 SOL transaction allowance. Excess priority fees, additional accounts, and real-token smoke trades are excluded; this is not a hard fee cap or trading budget. Existing deployments require a separate upgrade review.',releaseEvidence:evidence,transactionsSent:0,publicLaunchApproved:false},null,2));
}
main().catch(error=>{console.error('Deployment budget blocked:',String(error.message).replace(/https?:\/\/[^\s]+/g,'[RPC URL redacted]'));process.exitCode=1;});
