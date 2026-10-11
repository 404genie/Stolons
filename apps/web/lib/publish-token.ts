import {PublicKey} from '@solana/web3.js';
import {MAX_IMAGE_BYTES,normalizeTokenDraft,metadataUploadMessage,type TokenDraft} from '@stolons/sdk/launch-validation';
export async function publishTokenDetails(draft:TokenDraft,image:File,wallet:PublicKey,signMessage:(bytes:Uint8Array)=>Promise<Uint8Array>){
 const normalized=normalizeTokenDraft(draft);
 if(image.size>MAX_IMAGE_BYTES||!['image/png','image/jpeg','image/webp'].includes(image.type))throw Error('Choose a PNG, JPG, or WebP image up to 3 MB.');
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',await image.arrayBuffer()));
 const imageHash=Array.from(hash,byte=>byte.toString(16).padStart(2,'0')).join(''),timestamp=Date.now(),signedOrigin=window.location.origin;
 const message=new TextEncoder().encode(metadataUploadMessage(normalized,imageHash,wallet.toBase58(),signedOrigin,timestamp)),signature=await signMessage(message);
 const key=await crypto.subtle.importKey('raw',new Uint8Array(wallet.toBytes()),'Ed25519',false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',key,new Uint8Array(signature),message))throw Error('Token details approval did not match the connected wallet.');
 const form=new FormData();for(const [key,value]of Object.entries(normalized))form.set(key,value);
 form.set('image',image);form.set('wallet',wallet.toBase58());form.set('timestamp',String(timestamp));form.set('signedOrigin',signedOrigin);form.set('signature',btoa(String.fromCharCode(...signature)));
 const response=await fetch('/api/metadata',{method:'POST',body:form,signal:AbortSignal.timeout(30000)}),uploaded=await response.json();
 if(!response.ok||!uploaded.metadataUri)throw Error(uploaded.error||'Could not save child token details.');
 return {draft:normalized,metadataUri:uploaded.metadataUri as string};
}
