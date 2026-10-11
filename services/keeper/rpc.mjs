const retryableReads=new Set(['getGenesisHash','getAccountInfo','getMultipleAccounts','getProgramAccounts','getBalance','getLatestBlockhash','getSignatureStatuses','getTransaction','getBlockHeight','simulateTransaction']);
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
