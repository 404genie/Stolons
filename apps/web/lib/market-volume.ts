import { PublicKey, type Connection } from '@solana/web3.js';
const swapDiscriminators = [[143,190,90,218,196,30,51,222],[55,217,98,86,163,74,180,173]];
function decodeBase58(text:string):Uint8Array {
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;
 for(const char of text){const i=alphabet.indexOf(char);if(i<0)throw Error('Invalid instruction');n=n*58n+BigInt(i);}
 const result:number[]=[];while(n){result.unshift(Number(n%256n));n/=256n;}for(const char of text){if(char!=='1')break;result.unshift(0);}return new Uint8Array(result);
}
/** Quote-vault turnover for successful CPMM swaps; null when history is incomplete. */
export async function readHourVolume(connection:Connection,pool:string,program:string,quoteVault:string,now=Math.floor(Date.now()/1000)) {
 const cutoff=now-3600,found:Awaited<ReturnType<Connection['getSignaturesForAddress']>>=[];
 let before:string|undefined,complete=false;
 for(let page=0;page<3;page++){
  const batch=await connection.getSignaturesForAddress(new PublicKey(pool),{limit:100,...(before?{before}:{})},'confirmed');
  for(const entry of batch){if(entry.blockTime===null||entry.blockTime===undefined)return null;if(entry.blockTime>=cutoff&&!entry.err)found.push(entry);}
  if(batch.length<100||batch.some(entry=>entry.blockTime!==null&&entry.blockTime!==undefined&&entry.blockTime<cutoff)){complete=true;break;}
  before=batch.at(-1)?.signature;
 }
 if(!complete||found.length>60)return null;
 let volume=0n;
 for(let offset=0;offset<found.length;offset+=3){
  const transactions=await Promise.all(found.slice(offset,offset+3).map(entry=>connection.getTransaction(entry.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0})));
  for(const tx of transactions){
   if(!tx?.meta)return null;if(tx.meta.err)continue;
   const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
   const instructions=[...tx.transaction.message.compiledInstructions.map(ix=>({programIdIndex:ix.programIdIndex,accounts:Array.from(ix.accountKeyIndexes),data:ix.data})),...(tx.meta.innerInstructions||[]).flatMap(group=>group.instructions.map(ix=>({programIdIndex:ix.programIdIndex,accounts:ix.accounts,data:decodeBase58(ix.data)})))];
   const swaps=instructions.filter(ix=>keys.get(ix.programIdIndex)?.toBase58()===program&&ix.accounts.some(index=>keys.get(index)?.toBase58()===pool)&&swapDiscriminators.some(d=>d.every((byte,index)=>ix.data[index]===byte)));
   if(!swaps.length)continue;
   // Net vault movement cannot resolve multiple swaps in the same transaction.
   if(swaps.length!==1)return null;
   const index=Array.from({length:keys.length},(_,i)=>i).find(i=>keys.get(i)?.toBase58()===quoteVault);
   if(index===undefined)return null;
   const pre=tx.meta.preTokenBalances?.find(balance=>balance.accountIndex===index),post=tx.meta.postTokenBalances?.find(balance=>balance.accountIndex===index);
   if(!pre||!post)return null;
   const delta=BigInt(post.uiTokenAmount.amount)-BigInt(pre.uiTokenAmount.amount);volume+=delta<0n?-delta:delta;
  }
 }
 return Number(volume)/1e9;
}
