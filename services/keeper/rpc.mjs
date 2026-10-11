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
