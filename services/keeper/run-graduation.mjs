import {readGraduation,buildGraduationStep} from '../../sdk/dist/devnet-graduation.js';
export class KeeperSubmissionUncertain extends Error {constructor(signature,cause){super(`Graduation submission/confirmation uncertain${signature?` (${signature})`:''}: ${cause.message}`);this.signature=signature;}}
/** Rereads each confirmed step; safe to resume from on-chain state after restart. */
export async function runGraduation(connection,program,mint,{payer,table,cluster='devnet',apply=false,log=console.log,read=readGraduation,build=buildGraduationStep}={}){
 const result=[];
 for(let step=0;step<3;step++){
  const state=await read(connection,program,mint,cluster);
  if(!['register','claim','activate'].includes(state.phase))return result;
  log(mint.toBase58(),state.phase,apply?'apply':'dry-run');if(!apply)return [state.phase];
  if(!payer)throw Error('Keeper fee payer is missing.');
  const prepared=await build(connection,program,mint,payer.publicKey,table,cluster);prepared.transaction.sign([payer]);
  const simulation=await connection.simulateTransaction(prepared.transaction,{sigVerify:true});if(simulation.value.err)throw Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  let signature;
  try{
   signature=await connection.sendRawTransaction(prepared.transaction.serialize(),{skipPreflight:false,maxRetries:3});log('submitted',signature);
   const confirmed=await connection.confirmTransaction({...prepared.latest,signature},'confirmed');if(confirmed.value.err)throw Error(JSON.stringify(confirmed.value.err));
  }catch(cause){throw new KeeperSubmissionUncertain(signature,cause);}
  result.push({phase:prepared.phase,signature});
 }
 const final=await read(connection,program,mint,cluster);
 if(final.phase!=='active')throw Error('Keeper steps confirmed but activation is not yet visible.');
 return result;
}
