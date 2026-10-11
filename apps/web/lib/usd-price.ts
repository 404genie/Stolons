// Display pricing only; never used to build or settle a swap.
let cached:{value:number;publishedAt:number}|null=null;
let feedId:string|null=null;
export function parseSolUsd(value:any,id:string,now=Math.floor(Date.now()/1000)) {
 const entry=value?.parsed?.find((entry:any)=>entry.id===id);
 const price=entry?.price,raw=Number(price?.price),expo=Number(price?.expo),publishedAt=Number(price?.publish_time),confidence=Number(price?.conf);
 if(!Number.isInteger(expo)||expo < -18||expo>0||!Number.isFinite(raw)||raw<=0||!Number.isFinite(confidence)||confidence<0||confidence/raw>0.02||!Number.isInteger(publishedAt)||now-publishedAt>120||publishedAt>now+10)throw Error('SOL/USD price is stale or invalid.');
 const dollars=raw*10**expo;if(!Number.isFinite(dollars)||dollars<=0)throw Error('Invalid SOL/USD price.');
 return {value:dollars,publishedAt};
}
export async function readSolUsd() {
 if(cached&&Date.now()/1000-cached.publishedAt<30)return cached;
 const base='https://hermes.pyth.network';
 if(!feedId){
  const response=await fetch(`${base}/v2/price_feeds?query=SOL%2FUSD&asset_type=crypto`,{signal:AbortSignal.timeout(5000),cache:'no-store'});
  if(!response.ok)throw Error('Price feed unavailable.');const feeds=await response.json();
  const feed=feeds.find((feed:any)=>feed.attributes?.symbol==='Crypto.SOL/USD');
  if(!feed||!/^[a-f0-9]{64}$/i.test(feed.id))throw Error('SOL/USD feed missing.');feedId=feed.id;
 }
 const response=await fetch(`${base}/v2/updates/price/latest?ids[]=${feedId}&parsed=true`,{signal:AbortSignal.timeout(5000),cache:'no-store'});
 if(!response.ok)throw Error('Price feed unavailable.');cached=parseSolUsd(await response.json(),feedId!);return cached;
}
export function usdMarketValues(stats:{marketCapSol:number;liquiditySol:number},volume:number|null,price:number|null){
 return {marketCapUsd:price===null?null:stats.marketCapSol*price,liquidityUsd:price===null?null:stats.liquiditySol*price,volume1hUsd:price===null||volume===null?null:volume*price};
}
