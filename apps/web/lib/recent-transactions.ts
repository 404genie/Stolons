import {PublicKey,type Connection} from '@solana/web3.js';
export interface RecentTransaction {signature:string;slot:number;blockTime:number|null;failed:boolean;venue:string}
export async function readRecentTransactions(connection:Connection,launchPool:PublicKey,cpmmPool?:PublicKey):Promise<RecentTransaction[]> {
 const sources=[{address:launchPool,venue:'LaunchLab'},...(cpmmPool?[{address:cpmmPool,venue:'CPMM'}]:[])];
 const batches=await Promise.all(sources.map(async source=>(await connection.getSignaturesForAddress(source.address,{limit:15},'confirmed')).map(tx=>({signature:tx.signature,slot:tx.slot,blockTime:tx.blockTime??null,failed:!!tx.err,venue:source.venue}))));
 const unique=new Map<string,RecentTransaction>();for(const tx of batches.flat()){const existing=unique.get(tx.signature);unique.set(tx.signature,existing?{...tx,venue:'LaunchLab + CPMM'}:tx);}
 return [...unique.values()].sort((a,b)=>b.slot-a.slot||a.signature.localeCompare(b.signature)).slice(0,15);
}
