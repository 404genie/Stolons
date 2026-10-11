import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PublicKey,Keypair,SYSVAR_CLOCK_PUBKEY,SYSVAR_RENT_PUBKEY,AddressLookupTableAccount} from '@solana/web3.js';
import {createRequire} from 'node:module';
const {DEVNET_PROGRAM_ID,getPdaLaunchpadPoolId,getPdaLaunchpadVaultId,getPdaMetadataKey,getPdaLaunchpadAuth,getPdaVestId}=createRequire(new URL('../../sdk/package.json',import.meta.url))('@raydium-io/raydium-sdk-v2');
import * as sdk from '../../sdk/dist/index.js';
import {DEVNET_GENESIS_HASH} from '../../sdk/dist/launch-validation.js';
const f=JSON.parse(await readFile(new URL('../fixtures/cpmm-devnet.json',import.meta.url)));
const discriminator=name=>createHash('sha256').update('account:'+name).digest().subarray(0,8);
export function fixture({now=100n,epochStatus=0,proposalCount=1,highest=0n,winner=255,hasVote=false,withdrawn=false,selected=false,expired=false,paused=false}={}){
 const program=new PublicKey(f.programId),mint=new PublicKey(f.mint),owner=new PublicKey(f.owner),child=Keypair.generate(),epoch=sdk.deriveEpochPda(program,mint,0n);
 const accounts=new Map(Object.entries(f.accounts).map(([k,a])=>[k,a?{owner:new PublicKey(a.owner),data:Buffer.from(a.data,'base64')}:null]));
 const put=(key,data)=>accounts.set(key.toBase58(),{owner:program,data});
 const lineage=accounts.get(sdk.deriveLineagePda(program,mint).toBase58()).data;lineage[137]=2;lineage.writeBigUInt64LE(1n,308);lineage.set((selected||epochStatus!==0?PublicKey.default:epoch).toBytes(),195);lineage.set((selected?child.publicKey:PublicKey.default).toBytes(),163);
 const config=accounts.get(sdk.deriveConfigPda(program).toBase58()).data;config[304]=paused?1:0;
 const clock=Buffer.alloc(40);clock.writeBigInt64LE(now,32);put(SYSVAR_CLOCK_PUBKEY,clock);
 const e=Buffer.alloc(92);e.set(discriminator('Epoch'));e.set(mint.toBytes(),8);e.writeBigUInt64LE(0n,40);for(const [offset,value]of [[48,50n],[56,150n],[64,150n],[72,200n]])e.writeBigInt64LE(value,offset);e[80]=proposalCount;e.writeBigUInt64LE(highest,81);e[89]=winner;e[90]=epochStatus;put(epoch,e);
 const proposalKeys=[];
 for(let i=0;i<proposalCount;i++){
  const address=sdk.deriveProposalPda(program,epoch,i);proposalKeys.push(address);
  const texts=[`Child${i}`,`CH${i}`,'https://example.com/child.json'];const strings=texts.map(text=>{const b=Buffer.alloc(4+Buffer.byteLength(text));b.writeUInt32LE(Buffer.byteLength(text));b.write(text,4);return b;});
  const header=Buffer.alloc(113);header.set(discriminator('Proposal'));header.set(epoch.toBytes(),8);header.set(owner.toBytes(),40);header.set(child.publicKey.toBytes(),72);header[104]=i;header.writeBigUInt64LE(highest,105);put(address,Buffer.concat([header,...strings,Buffer.alloc(41)]));
 }
 if(hasVote){const v=Buffer.alloc(114);v.set(discriminator('VoteReceipt'));v.set(owner.toBytes(),8);v.set(epoch.toBytes(),40);v.set(proposalKeys[0].toBytes(),72);v.writeBigUInt64LE(1000000n,104);v[112]=withdrawn?1:0;put(sdk.deriveVotePda(program,epoch,owner),v);}
 if(selected){const c=Buffer.alloc(276);c.set(discriminator('Candidate'));c.set(mint.toBytes(),8);c.set(child.publicKey.toBytes(),40);c.set(epoch.toBytes(),72);c.set(proposalKeys[0].toBytes(),104);c.set(owner.toBytes(),136);c[168]=1;c.writeBigInt64LE(expired?90n:1000n,177);put(sdk.deriveCandidatePda(program,child.publicKey),c);}
 const launchpad=DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM,quote=new PublicKey('So11111111111111111111111111111111111111112'),pool=getPdaLaunchpadPoolId(launchpad,child.publicKey,quote).publicKey,reproduction=sdk.deriveReproductionAuthorityPda(program);
 const addresses=[...accounts.keys()].map(k=>new PublicKey(k));addresses.push(child.publicKey,mint,program,SYSVAR_RENT_PUBKEY,sdk.TOKEN_PROGRAM_ID,sdk.ASSOCIATED_TOKEN_PROGRAM_ID,sdk.SYSTEM_PROGRAM_ID,sdk.INSTRUCTIONS_SYSVAR_ID,sdk.deriveFamilyPda(program,mint),sdk.deriveLineagePda(program,child.publicKey),sdk.deriveCandidatePda(program,child.publicKey),sdk.deriveVaultAuthorityPda(program,child.publicKey),sdk.deriveReproductionVaultPda(program,child.publicKey),reproduction,pool,getPdaLaunchpadAuth(launchpad).publicKey,getPdaLaunchpadVaultId(launchpad,pool,child.publicKey).publicKey,getPdaLaunchpadVaultId(launchpad,pool,quote).publicKey,getPdaMetadataKey(child.publicKey).publicKey,getPdaVestId(launchpad,pool,reproduction).publicKey);
 const table=new AddressLookupTableAccount({key:Keypair.generate().publicKey,state:{deactivationSlot:18446744073709551615n,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,authority:owner,addresses:[...new Map(addresses.map(k=>[k.toBase58(),k])).values()]}});
 const connection={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getAccountInfo:async key=>accounts.get(key.toBase58())??null,getMultipleAccountsInfo:async keys=>keys.map(key=>accounts.get(key.toBase58())??null),getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),getTokenAccountBalance:async()=>({value:{amount:'150000000000000'}}),getAddressLookupTable:async()=>({value:table})};
 return {connection,accounts,program,mint,owner,child,epoch,table,proposalKeys};
}
