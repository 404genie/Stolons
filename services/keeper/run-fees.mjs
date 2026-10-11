import {PublicKey} from '@solana/web3.js';
import {assertCluster,deriveConfigPda,deriveFeeAuthorityPda,decodeLaunchPool,StolonsClient} from '../../sdk/dist/index.js';
import {buildSharedCpmmFeeCollection,readPendingFees} from '../../sdk/dist/fees.js';
import {sendDevnetTrade,TradeSubmittedError} from '../../sdk/dist/devnet-trade.js';
export async function runFeeCollection(connection,program,mint,{cluster,payer,table,apply=false,payerPublicKey,log=console.log}){
 await assertCluster(connection,cluster);
 const [config,lineage]=await Promise.all([connection.getAccountInfo(deriveConfigPda(program),'confirmed'),new StolonsClient(connection,program).getLineage(mint)]);
 if(!config?.owner.equals(program)||config.data[305]!==2||!lineage)return {status:'legacy-or-missing',transactions:[]};
 const payerKey=payer?.publicKey??payerPublicKey;
 if(!payerKey)throw Error('Provide the funded keeper public key for simulation.');
 if([new PublicKey(config.data.subarray(8,40)),new PublicKey(config.data.subarray(40,72))].some(key=>key.equals(payerKey)))throw Error('Fee keeper must remain separate from authority and treasury.');
 if(apply&&!payer)throw Error('Apply requires the keeper signer.');
 const launch=await connection.getAccountInfo(lineage.launchPool,'confirmed');
 if(!launch||!new PublicKey(decodeLaunchPool(launch.data).creator).equals(deriveFeeAuthorityPda(program,mint)))return {status:'legacy',transactions:[]};
 const input={programId:program,mint,payer:payerKey,cluster,...(table?{lookupTable:table}:{})},transactions=[];
 const pending=await readPendingFees(connection,input);
 if(pending.cpmm===0n)return {status:'empty',transactions};
 // Protocol collection pays treasury and escrows the creator share.
 for(const [kind,builder] of (lineage.cpmmPool.equals(PublicKey.default)?[]:[['cpmm',buildSharedCpmmFeeCollection]])){
  if(pending[kind]===0n)continue;
  const prepared=await builder(connection,input);
  const simulation=await connection.simulateTransaction(prepared.transaction,{sigVerify:false,commitment:'confirmed'});
  if(simulation.value.err)throw Error(`Fee ${kind} simulation failed; no transaction submitted.`);
  if(apply){try{transactions.push(await sendDevnetTrade(connection,prepared,async tx=>{tx.sign([payer]);return tx;}));}catch(error){if(error instanceof TradeSubmittedError)throw error;throw error;}}
  log(JSON.stringify({mint:mint.toBase58(),kind,apply,signature:transactions.at(-1)??null}));
 }
 return {status:apply?'collected':'simulated',transactions};
}
