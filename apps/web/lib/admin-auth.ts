import {createPublicKey,verify} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
export const adminStatsMessage=(wallet:string,origin:string,timestamp:number)=>`Stolons admin stats\nWallet: ${wallet}\nOrigin: ${origin}\nTimestamp: ${timestamp}\nRead-only dashboard access. No transaction or token approval.`;
export function requireAdmin(request:Request,allowed:string|undefined,now=Date.now()){
 const wallet=request.headers.get('x-admin-wallet')||'',origin=request.headers.get('x-admin-origin')||'',timestamp=Number(request.headers.get('x-admin-timestamp')),signature=request.headers.get('x-admin-signature')||'';
 if(!allowed||wallet!==allowed||!Number.isSafeInteger(timestamp)||Math.abs(now-timestamp)>300000||!/^[A-Za-z0-9+/]{86}==$/.test(signature))throw Error('Admin authorization required.');
 const url=new URL(origin);if(url.origin!==origin||url.protocol!=='https:'&& !['localhost','127.0.0.1'].includes(url.hostname))throw Error('Invalid admin origin.');
 const key=new PublicKey(wallet),publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key.toBuffer()]),format:'der',type:'spki'});
 if(!verify(null,Buffer.from(adminStatsMessage(wallet,origin,timestamp)),publicKey,Buffer.from(signature,'base64')))throw Error('Admin authorization required.');
}
