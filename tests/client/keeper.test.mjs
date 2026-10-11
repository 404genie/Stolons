import test from 'node:test';import assert from 'node:assert/strict';import {Keypair} from '@solana/web3.js';
import {runGraduation,KeeperSubmissionUncertain} from '../../services/keeper/run-graduation.mjs';
function fixture({phase='register',simulateError=null,confirmError=null,sendError=false}={}){
 const payer=Keypair.generate(),mint=Keypair.generate().publicKey,program=Keypair.generate().publicKey,calls=[];let current=phase;
 const read=async()=>({phase:current});const build=async()=>({phase:current,transaction:{sign:()=>calls.push('sign'),serialize:()=>new Uint8Array(1)},latest:{blockhash:'block',lastValidBlockHeight:100}});
 const connection={simulateTransaction:async()=>{calls.push('simulate');return {value:{err:simulateError}}},sendRawTransaction:async()=>{calls.push('send');if(sendError)throw Error('RPC timeout');return current+'-signature'},confirmTransaction:async()=>{calls.push('confirm');if(confirmError)throw Error(confirmError);current=({register:'claim',claim:'activate',activate:'active'})[current];return {value:{err:null}}}};
 return {connection,program,mint,calls,options:{payer,apply:true,log:()=>{},read,build}};
}
test('keeper confirms all three transitions and resumes from claimed reserves after restart',async()=>{
 for(const [phase,count]of [['register',3],['claim',2],['activate',1]]){const f=fixture({phase});const results=await runGraduation(f.connection,f.program,f.mint,f.options);assert.equal(results.length,count);assert.equal(f.calls.filter(value=>value==='send').length,count);assert.equal(f.calls.filter(value=>value==='confirm').length,count);}
});
test('keeper dry-run, trading, migration pending and already-active phases send nothing',async()=>{
 for(const phase of ['trading','migrating','active']){const f=fixture({phase});assert.deepEqual(await runGraduation(f.connection,f.program,f.mint,f.options),[]);assert.deepEqual(f.calls,[]);}
 const f=fixture();assert.deepEqual(await runGraduation(f.connection,f.program,f.mint,{...f.options,apply:false}),['register']);assert.deepEqual(f.calls,[]);
});
test('keeper simulation failure and uncertain submission stop before subsequent activation',async()=>{
 const f=fixture({simulateError:{Custom:1}});await assert.rejects(runGraduation(f.connection,f.program,f.mint,f.options),/Simulation failed/);assert.equal(f.calls.includes('send'),false);
 for(const options of [{sendError:true},{confirmError:'RPC timeout'}]){const f=fixture(options);await assert.rejects(runGraduation(f.connection,f.program,f.mint,f.options),KeeperSubmissionUncertain);assert.equal(f.calls.filter(value=>value==='send').length,1);}
});
