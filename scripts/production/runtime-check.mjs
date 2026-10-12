// Executes reviewed SBF on an isolated localhost validator with synthetic fixtures.
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,TransactionInstruction,sendAndConfirmTransaction,ComputeBudgetProgram} from '@solana/web3.js';
const folder=resolve('target/mainnet'),binary=await readFile(folder+'/stolons.so');
const reviewed=JSON.parse(await readFile(new URL('../../docs/validation/mainnet-audit-build-2026-10-11.json',import.meta.url),'utf8'));
assert.equal(createHash('sha256').update(binary).digest('hex'),reviewed.sha256.program,'Reviewed binary required');
const program=new PublicKey(reviewed.programId),payer=Keypair.generate(),zero=PublicKey.default;
const launchpad=new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj'),token=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const root=await mkdtemp(resolve('target/runtime-check-'));const args=['--reset','--ledger',root+'/ledger','--bind-address','127.0.0.1','--rpc-port','18899','--faucet-port','18900','--dynamic-port-range','18901-18920','--upgradeable-program',program.toBase58(),folder+'/stolons.so','none'];
const hash=s=>createHash('sha256').update(s).digest().subarray(0,8);
const key=()=>Keypair.generate().publicKey;
const u=(n,size=8)=>{const b=Buffer.alloc(size);if(size===1)b[0]=Number(n);else if(size===4)b.writeUInt32LE(Number(n));else if(size===16){b.writeBigUInt64LE(BigInt(n)&((1n<<64n)-1n));b.writeBigUInt64LE(BigInt(n)>>64n,8);}else b.writeBigInt64LE(BigInt(n));return b;};
const str=s=>Buffer.concat([u(Buffer.byteLength(s),4),Buffer.from(s)]);
const pk=k=>k.toBuffer();const pda=(seed,...parts)=>PublicKey.findProgramAddressSync([Buffer.from(seed),...parts],program);
const pack=(name,...parts)=>Buffer.concat([hash('account:'+name),...parts]);
async function account(address,data,owner=program,lamports=100000000){const file=root+'/'+address+'.json';await writeFile(file,JSON.stringify({pubkey:address.toBase58(),account:{lamports,data:[data.toString('base64'),'base64'],owner:owner.toBase58(),executable:false,rentEpoch:0}}));args.push('--account',address.toBase58(),file);}
await account(payer.publicKey,Buffer.alloc(0),SystemProgram.programId,10000000000);
const treasury=key(),proposer=key(),launchConfig=key(),platform=key(),quote=key();
for(const k of [treasury,proposer])await account(k,Buffer.alloc(0),SystemProgram.programId,1000000);
const [config,configBump]=pda('config');
await account(config,pack('GlobalConfig',...[payer.publicKey,treasury,launchpad,key(),launchConfig,platform,quote,key()].map(pk),...Array(5).fill(u(86400)),u(0,1),u(3,1),u(configBump,1)));
function lineage(mint,parent,child,bump,status=2){return pack('Lineage',...[mint,mint,parent,proposer].map(pk),u(0,1),u(status,1),u(1000000000000000n),u(1000000000000000n,16),u(0,1),pk(child),pk(zero),pk(zero),pk(zero),u(0,1),u(0),u(0),u(0),u(bump,1));}
function candidate(parent,child,epoch,proposal,pool,bump,status,bond=50000000){return pack('Candidate',...[parent,child,epoch,proposal,proposer].map(pk),u(status,1),u(0),u(1),u(0),u(1),u(0),pk(pool),pk(zero),u(0,1),u(0,1),u(bump,1),u(bond),u(0,1));}
const cases=[];
for(const [label,poolStatus,start,expected,target]of [['on-time pending migration',1,1,'DeadlinePassed',85000000000n],['on-time migrated',2,1,'DeadlinePassed',85000000000n],['late pending migration',1,2,null,85000000000n],['unfinished curve',0,0,null,85000000000n],['wrong fundraising target',1,1,'InvalidAllocation',24000000000n]]){
 const parentMint=key(),childMint=key(),[parent,bp]=pda('lineage',pk(parentMint)),[child,bc]=pda('lineage',pk(childMint)),[cand,bcan]=pda('candidate',pk(childMint));
 const pool=PublicKey.findProgramAddressSync([Buffer.from('pool'),pk(childMint),pk(quote)],launchpad)[0];
 await account(parent,lineage(parentMint,zero,childMint,bp));await account(child,lineage(childMint,parentMint,zero,bc,3));await account(cand,candidate(parentMint,childMint,zero,zero,pool,bcan,2));
 const mint=Buffer.alloc(82);mint.writeBigUInt64LE(1000000000000000n,36);mint[44]=6;mint[45]=1;await account(parentMint,mint,token);
 const poolData=Buffer.alloc(429);hash('account:PoolState').copy(poolData);poolData[17]=poolStatus;poolData[18]=6;poolData[19]=9;poolData[20]=1;
 for(const [offset,value]of [[21,1000000000000000n],[29,700000000000000n],[69,target],[101,150000000000000n],[125,BigInt(start)]])poolData.writeBigUInt64LE(value,offset);
 for(const [offset,value]of [[141,launchConfig],[173,platform],[205,childMint],[237,quote]])pk(value).copy(poolData,offset);
 await account(pool,poolData,launchpad);
 const keys=[payer.publicKey,config,parent,parentMint,cand,pool,child].map((pubkey,i)=>({pubkey,isSigner:i===0,isWritable:[2,4,6].includes(i)}));
 cases.push({label,expected,instruction:new TransactionInstruction({programId:program,keys,data:hash('global:expire_candidate')}),check:async c=>{assert.equal((await c.getAccountInfo(cand)).data[168],6);assert.equal((await c.getAccountInfo(child)).data[137],6);}});
}
for(const [label,status,winner,expected,redirect]of [['loser refund',0,false,null,false],['successful winner refund',5,true,null,false],['expired winner forfeiture',4,true,null,false],['orphan winner forfeiture',6,true,null,false],['active winner stays locked',2,true,'InvalidLifecycleState',false],['redirected proposer rejected',0,false,'ConstraintAddress',true]]){
 const parent=key(),child=key(),[epoch,be]=pda('epoch',pk(parent),u(0)),[proposal,bp]=pda('proposal',pk(epoch),u(0,1)),[cand,bc]=pda('candidate',pk(child));
 await account(epoch,pack('Epoch',pk(parent),u(0),u(0),u(0),u(0),u(0),u(1,1),u(1000),u(winner?0:1,1),u(1,1),u(be,1),u(1),u(1)));
 await account(proposal,pack('Proposal',pk(epoch),pk(proposer),pk(child),u(0,1),u(0),str('A'),str('A'),str('https://example.test/a'),Buffer.alloc(32),u(0),u(bp,1)));
 await account(cand,candidate(parent,child,epoch,proposal,zero,bc,status));
 const recipient=redirect?treasury:proposer;
 const keys=[payer.publicKey,config,epoch,proposal,cand,recipient,treasury].map((pubkey,i)=>({pubkey,isSigner:i===0,isWritable:i>=4}));
 cases.push({label,expected,bond:true,recipient:(!winner||status===5)?proposer:treasury,candidate:cand,instruction:new TransactionInstruction({programId:program,keys,data:hash('global:settle_proposal_bond')})});
}
const log=await import('node:fs').then(fs=>fs.openSync(root+'/validator.log','w'));
const childProcess=spawn('solana-test-validator',args,{stdio:['ignore',log,log]});let spawnError;childProcess.on('error',error=>{spawnError=error;});
const connection=new Connection('http://127.0.0.1:18899','confirmed');
let nonce=0;
const send=instruction=>sendAndConfirmTransaction(connection,new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:200000+(++nonce)}),instruction),[payer],{commitment:'confirmed'});
const report={status:'running',binarySha256:reviewed.sha256.program,programId:program.toBase58(),endpoint:'localhost only',cases:[],mainnetTransactionsSent:0,limitation:'Synthetic genesis fixtures exercise Stolons expiry and bond instructions. They do not execute Raydium mainnet buy logic or the entire governance lifecycle.'};
try{
 let ready=false;for(let i=0;i<60;i++){if(spawnError)throw spawnError;if(childProcess.exitCode!==null)throw Error('Validator exited; inspect '+root+'/validator.log');try{await connection.getLatestBlockhash();ready=true;break;}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Local validator did not become ready.');
 const executable=await connection.getAccountInfo(program);assert(executable?.executable,'Reviewed program must be loaded on localhost');
 const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');assert(executable.owner.equals(loader),'Expected upgradeable loader');
 const programDataKey=new PublicKey(executable.data.subarray(4,36));const programData=await connection.getAccountInfo(programDataKey);assert(programData?.owner.equals(loader),'ProgramData must be loader-owned');
 assert.equal(createHash('sha256').update(programData.data.subarray(45,45+binary.length)).digest('hex'),reviewed.sha256.program,'Local loaded program bytes must match reviewed artifact');
 for(let i=0;i<20&&await connection.getSlot('confirmed')<=1;i++)await new Promise(r=>setTimeout(r,250));
 for(const test of cases){
  const before=test.bond?await connection.getBalance(test.recipient):null;
  const sourceBefore=test.bond?await connection.getBalance(test.candidate):null;
  let error=null;try{await send(test.instruction);}catch(e){error=e;}
  if(test.expected){assert(error,'Expected rejection: '+test.label);const logs=error.logs||await error.getLogs?.(connection)||[];assert(logs.join('\n').includes(test.expected),test.label+': wrong rejection '+error.message);}
  else{if(error)throw error;if(test.check)await test.check(connection);if(test.bond){assert.equal((await connection.getBalance(test.recipient))-before,50000000);assert.equal(sourceBefore-(await connection.getBalance(test.candidate)),50000000);const data=(await connection.getAccountInfo(test.candidate)).data;assert.equal(data[284],1);const rent=await connection.getMinimumBalanceForRentExemption(285);assert((await connection.getBalance(test.candidate))>=rent);let repeated;try{await send(test.instruction);}catch(e){repeated=e;}assert(repeated,'Repeated bond settlement must reject');const logs=repeated.logs||await repeated.getLogs?.(connection)||[];assert(logs.join('\n').includes('InvalidLifecycleState'),'Repeat must fail because bond was settled');}}
  report.cases.push({label:test.label,status:'passed',expectedRejection:test.expected});console.log('PASS',test.label);
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{childProcess.kill('SIGTERM');await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,reportPath:root+'/report.json'},null,2));}
