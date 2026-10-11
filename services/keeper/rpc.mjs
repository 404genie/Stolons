const retryableReads=new Set(['getGenesisHash','getAccountInfo','getMultipleAccounts','getProgramAccounts','getBlockTime','getBalance','getLatestBlockhash','getSignatureStatuses','getSignaturesForAddress','getTransaction','getBlockHeight','simulateTransaction']);
/** Retry only read-only rate limits, never a transaction submission. */
export function readRetryFetch(fetcher=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 return async(url,options)=>{
  let method;try{method=JSON.parse(options.body).method;}catch{}
  for(let attempt=0;;attempt++){
   const response=await fetcher(url,{...options,signal:AbortSignal.timeout(20000)});
   if(response.status!==429||!retryableReads.has(method)||attempt>=3)return response;
   await response.arrayBuffer();await pause(2000*(attempt+1));
  }
 };
}
/** HTTP confirmation avoids public-RPC websocket subscription rate limits. */
export function useHttpConfirmation(connection,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 connection.confirmTransaction=async strategy=>{
  if(typeof strategy==='string')throw Error('Confirmation requires the signed blockhash expiry.');
  for(;;){
   const result=await connection.getSignatureStatuses([strategy.signature],{searchTransactionHistory:true});
   const status=result.value[0];
   if(status&&(status.err||['confirmed','finalized'].includes(status.confirmationStatus)))return {context:result.context,value:{err:status.err}};
   if(await connection.getBlockHeight('confirmed')>strategy.lastValidBlockHeight)throw Error('Transaction blockhash expired; inspect signature before retrying.');
   await pause(3000);
  }
 };
 return connection;
}
/** Back off on read rate limits; ambiguous signed submissions must stop. */
export async function runScanLoop(scan,{watch=false,interval=60000,stopped=()=>false,log=console.log,isUncertain=()=>false,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 let failures=0;
 async function delay(ms){while(ms>0&&!stopped()){const chunk=Math.min(ms,30000);await pause(chunk);ms-=chunk;}}
 do{
  try{await scan();failures=0;}
  catch(error){
   if(isUncertain(error)||!/(?:\b429\b|Too Many Requests)/i.test(error.message))throw error;
   const cooldown=Math.min(60000*2**failures++,300000);
   log(`Read RPC rate limit; pausing ${cooldown/1000}s before resuming. No uncertain transaction will be retried.`);
   await delay(cooldown);continue;
  }
  if(!watch||stopped())return;
  await delay(interval);
 }while(!stopped());
}
