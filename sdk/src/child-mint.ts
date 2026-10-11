import {Keypair,PublicKey} from '@solana/web3.js';
export function childMintRecoveryMessage(program:PublicKey,epoch:PublicKey,proposalId:number,wallet:PublicKey){
 if(!Number.isInteger(proposalId)||proposalId<0||proposalId>=32)throw Error('Invalid proposal slot.');
 return `Stolons private child mint recovery v1\nCluster: devnet\nProgram: ${program.toBase58()}\nRound: ${epoch.toBase58()}\nProposal: ${proposalId}\nWallet: ${wallet.toBase58()}\nThis recovers the proposed child mint key. Keep this signature private. It authorizes no transaction.`;
}
/** Signature stays in the browser; never publish or send it to an API. */
export async function recoverChildMint(program:PublicKey,epoch:PublicKey,proposalId:number,wallet:PublicKey,signMessage:(message:Uint8Array)=>Promise<Uint8Array>){
 const message=new TextEncoder().encode(childMintRecoveryMessage(program,epoch,proposalId,wallet));
 const signature=await signMessage(message);
 const key=await crypto.subtle.importKey('raw',new Uint8Array(wallet.toBytes()),'Ed25519',false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',key,new Uint8Array(signature),message))throw Error('Wallet recovery approval did not match the connected account.');
 const seed=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(signature)));
 return Keypair.fromSeed(seed);
}
