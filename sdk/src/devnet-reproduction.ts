import {Connection,PublicKey,SYSVAR_CLOCK_PUBKEY,ComputeBudgetProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {Buffer} from 'buffer';
import {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction} from '@solana/spl-token';
import {decodeLineage} from './client.js';
import {buildInstruction} from './builders.js';
import {deriveConfigPda,deriveLineagePda,deriveEpochPda,deriveProposalPda,deriveCandidatePda,deriveProposedMintPda,deriveVotePda,deriveVoteAuthorityPda,deriveVoteEscrowPda,deriveVaultAuthorityPda,deriveReproductionVaultPda} from './pda.js';
import {DEVNET_GENESIS_HASH,decodeLaunchConfig,validateLaunchDetails} from './launch-validation.js';
import {TOKEN_PROGRAM_ID,SYSTEM_PROGRAM_ID} from './constants.js';
import type {SubmitProposalArgs} from './types.js';
function checked(data:Uint8Array,discriminator:number[],length:number){const b=Buffer.from(data);if(b.length<length||!b.subarray(0,8).equals(Buffer.from(discriminator)))throw Error('Invalid reproduction account.');return b;}
const key=(b:Buffer,offset:number)=>new PublicKey(b.subarray(offset,offset+32));
export function decodeEpoch(data:Uint8Array){const b=checked(data,[93,83,120,89,151,138,152,108],92);const status=['Open','Finalized','NoWinner'][b[90]!];if(!status||b[80]!>32)throw Error('Invalid epoch state.');return {parentMint:key(b,8),epochId:b.readBigUInt64LE(40),proposalStart:b.readBigInt64LE(48),proposalEnd:b.readBigInt64LE(56),voteStart:b.readBigInt64LE(64),voteEnd:b.readBigInt64LE(72),proposalCount:b[80]!,highestSupport:b.readBigUInt64LE(81),winningProposalId:b[89]!,status};}
export function decodeProposal(data:Uint8Array){const b=checked(data,[26,94,189,187,116,136,53,33],113);let offset=113;const text=(max:number)=>{if(offset+4>b.length)throw Error('Truncated proposal text.');const length=b.readUInt32LE(offset);offset+=4;if(length>max||offset+length>b.length)throw Error('Invalid proposal text.');const value=b.subarray(offset,offset+length).toString('utf8');offset+=length;return value;};const name=text(32),symbol=text(10),metadataUri=text(200);if(offset+41>b.length)throw Error('Truncated proposal.');return {epoch:key(b,8),proposer:key(b,40),childMint:key(b,72),proposalId:b[104]!,supportAmount:b.readBigUInt64LE(105),name,symbol,metadataUri,metadataHash:new Uint8Array(b.subarray(offset,offset+32))};}
export function decodeCandidate(data:Uint8Array){const b=checked(data,[86,69,250,96,193,10,222,123],276);const status=['Proposed','Selected','Launched','Qualified','Expired','Settled','Orphan'][b[168]!];if(!status)throw Error('Invalid candidate status.');return {parentMint:key(b,8),childMint:key(b,40),epoch:key(b,72),proposal:key(b,104),proposer:key(b,136),status,launchDeadline:b.readBigInt64LE(177),migrationDeadline:b.readBigInt64LE(193),launchPool:key(b,209),cpmmPool:key(b,241),reserveClaimed:b[273]!==0,settled:b[274]!==0};}
export function decodeVote(data:Uint8Array){const b=checked(data,[104,20,204,252,45,84,37,195],114);return {voter:key(b,8),epoch:key(b,40),proposal:key(b,72),amount:b.readBigUInt64LE(104),withdrawn:b[112]!==0};}
export function roundPhase(epoch:ReturnType<typeof decodeEpoch>,now:bigint){return epoch.status!=='Open'?'closed':now<epoch.proposalEnd?'propose':now<epoch.voteEnd?'vote':'finalize';}
const verifiedConnections=new WeakMap<Connection,Promise<void>>();
async function verifyConnection(connection:Connection){
 let pending=verifiedConnections.get(connection);
 if(!pending){pending=connection.getGenesisHash().then(hash=>{if(hash!==DEVNET_GENESIS_HASH)throw Error('Reproduction is enabled on Solana devnet only.');});verifiedConnections.set(connection,pending);}
 try{await pending;}catch(error){verifiedConnections.delete(connection);throw error;}
}
export async function readReproduction(connection:Connection,program:PublicKey,parentMint:PublicKey,voter?:PublicKey,epochId?:bigint){
 await verifyConnection(connection);
 const [parentAccount,configAccount,clock]=await connection.getMultipleAccountsInfo([deriveLineagePda(program,parentMint),deriveConfigPda(program),SYSVAR_CLOCK_PUBKEY],'confirmed');
 const parent=parentAccount?.owner.equals(program)?decodeLineage(parentAccount.data):null;
 if(!parent||!configAccount?.owner.equals(program)||!clock||clock.data.length<40)throw Error('Reproduction configuration or lineage missing.');
 const bytes=Buffer.from(configAccount.data);const paused=bytes[304]!==0;bytes[304]=0;decodeLaunchConfig(bytes);
 const now=clock.data.readBigInt64LE(32),selectedId=epochId??(parent.nextEpochId>0n?parent.nextEpochId-1n:null);
 if(selectedId!==null&&(selectedId<0n||selectedId>=parent.nextEpochId))throw Error('Round does not exist.');
 const epochKey=selectedId===null?null:deriveEpochPda(program,parentMint,selectedId);
 const epochAccount=epochKey?await connection.getAccountInfo(epochKey,'confirmed'):null;
 const epoch=epochAccount?.owner.equals(program)?decodeEpoch(epochAccount.data):null;
 if(epoch&&(!epoch.parentMint.equals(parentMint)||epoch.epochId!==selectedId))throw Error('Round identity mismatch.');
 if(epochKey&&!epoch)throw Error('Round account unavailable.');
 const addresses=epoch&&epochKey?Array.from({length:epoch.proposalCount},(_,i)=>deriveProposalPda(program,epochKey,i)):[];
 const voteKey=voter&&epochKey?deriveVotePda(program,epochKey,voter):null;
 const candidateKey=parent.activeCandidate.equals(PublicKey.default)?null:deriveCandidatePda(program,parent.activeCandidate);
 const keys=[...addresses,...(voteKey?[voteKey]:[]),...(candidateKey?[candidateKey]:[])];
 const [accounts,vault]=await Promise.all([keys.length?connection.getMultipleAccountsInfo(keys,'confirmed'):Promise.resolve([]),connection.getTokenAccountBalance(deriveReproductionVaultPda(program,parentMint),'confirmed')]);
 const proposals=addresses.map((_,i)=>{const account=accounts[i];if(!account?.owner.equals(program))throw Error('Proposal account unavailable.');const proposal=decodeProposal(account.data);if(!proposal.epoch.equals(epochKey!)||proposal.proposalId!==i)throw Error('Proposal identity mismatch.');return proposal;});
 const voteAccount=voteKey?accounts[addresses.length]:null;
 const candidateAccount=candidateKey?accounts[addresses.length+(voteKey?1:0)]:null;
 const vote=voteAccount?.owner.equals(program)?decodeVote(voteAccount.data):null;
 if(vote&&(!vote.epoch.equals(epochKey!)||!vote.voter.equals(voter!)))throw Error('Vote identity mismatch.');
 const candidate=candidateAccount?.owner.equals(program)?decodeCandidate(candidateAccount.data):null;
 if(!parent.activeCandidate.equals(PublicKey.default)&&(!candidate||!candidate.parentMint.equals(parentMint)||!candidate.childMint.equals(parent.activeCandidate)))throw Error('Candidate identity mismatch.');
 return {parent,epoch,epochKey,proposals,vote,candidate,now,paused,proposalWindow:bytes.readBigUInt64LE(264),votingWindow:bytes.readBigUInt64LE(272),proposalFee:bytes.readBigUInt64LE(296),treasury:key(bytes,40),reserve:vault?BigInt(vault.value.amount):0n};
}
export type ReproductionAction={kind:'open'}|{kind:'open-propose';epoch:PublicKey;args:SubmitProposalArgs}|{kind:'propose';epoch:PublicKey;args:SubmitProposalArgs}|{kind:'vote';epoch:PublicKey;proposalId:number;amount:bigint}|{kind:'finalize';epoch:PublicKey}|{kind:'withdraw';epoch:PublicKey}|{kind:'expire'};
export async function buildReproductionAction(connection:Connection,program:PublicKey,parentMint:PublicKey,payer:PublicKey,action:ReproductionAction){
 // Read the requested historical round for withdrawals, never silently switch rounds.
 let requested:bigint|undefined;
 if('epoch'in action&&action.kind!=='open-propose'){const account=await connection.getAccountInfo(action.epoch,'confirmed');if(!account?.owner.equals(program))throw Error('Round missing.');requested=decodeEpoch(account.data).epochId;if(!deriveEpochPda(program,parentMint,requested).equals(action.epoch))throw Error('Wrong parent round.');}
 const state=await readReproduction(connection,program,parentMint,payer,requested),{parent,epoch,epochKey}=state;
 if(state.paused&&['open','open-propose','propose','vote'].includes(action.kind))throw Error('Protocol is paused.');
 const config=deriveConfigPda(program),parentKey=deriveLineagePda(program,parentMint),base={config,parent:parentKey,parent_mint:parentMint},instructions=[];
 if(action.kind==='open'||action.kind==='open-propose'){
  if(!['RootActive','DescendantActive'].includes(parent.status)||!parent.activeEpoch.equals(PublicKey.default)||!parent.activeCandidate.equals(PublicKey.default)||parent.directChildrenCount>=15||state.reserve<10000000000000n)throw Error('Parent is not eligible for a new round.');
  const address=deriveEpochPda(program,parentMint,parent.nextEpochId);instructions.push(buildInstruction(program,'open_epoch',{...base,payer,vault_authority:deriveVaultAuthorityPda(program,parentMint),reproduction_vault:deriveReproductionVaultPda(program,parentMint),epoch:address,vote_authority:deriveVoteAuthorityPda(program,address),vote_escrow:deriveVoteEscrowPda(program,address),token_program:TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID},parent.nextEpochId));
  if(action.kind==='open-propose'){
   if(!action.epoch.equals(address)||action.args.proposalId!==0)throw Error('New round slot changed. Refresh and retry.');
   validateLaunchDetails(action.args.name,action.args.symbol,action.args.metadataUri);if(action.args.metadataHash.length!==32||action.args.childMint.equals(parentMint)||action.args.childMint.equals(PublicKey.default))throw Error('Invalid proposal.');
   instructions.push(buildInstruction(program,'submit_proposal',{config,parent:parentKey,epoch:address,proposer:payer,proposal:deriveProposalPda(program,address,0),candidate:deriveCandidatePda(program,action.args.childMint),proposed_mint:deriveProposedMintPda(program,action.args.childMint),existing_child_lineage:deriveLineagePda(program,action.args.childMint),treasury:state.treasury,system_program:SYSTEM_PROGRAM_ID},action.args));
  }
 }else if(action.kind==='expire'){
  const candidate=state.candidate;if(!candidate||!['Selected','Launched'].includes(candidate.status)||state.now<=(candidate.status==='Selected'?candidate.launchDeadline:candidate.migrationDeadline))throw Error('Candidate is not past its deadline.');
  instructions.push(buildInstruction(program,'expire_candidate',{...base,caller:payer,candidate:deriveCandidatePda(program,candidate.childMint),pool_state:candidate.launchPool,child_lineage:deriveLineagePda(program,candidate.childMint)}));
 }else{
  if(!epoch||!epochKey)throw Error('Round missing.');const phase=roundPhase(epoch,state.now),escrow={epoch:epochKey,vote_authority:deriveVoteAuthorityPda(program,epochKey),vote_escrow:deriveVoteEscrowPda(program,epochKey)};
  if(action.kind==='propose'){
   if(phase!=='propose'||!parent.activeEpoch.equals(epochKey)||action.args.proposalId!==epoch.proposalCount||epoch.proposalCount>=32)throw Error('Proposal window closed or proposal slot changed. Refresh and retry.');
   validateLaunchDetails(action.args.name,action.args.symbol,action.args.metadataUri);if(action.args.metadataHash.length!==32||action.args.childMint.equals(parentMint)||action.args.childMint.equals(PublicKey.default))throw Error('Invalid proposal.');
   instructions.push(buildInstruction(program,'submit_proposal',{config,parent:parentKey,epoch:epochKey,proposer:payer,proposal:deriveProposalPda(program,epochKey,action.args.proposalId),candidate:deriveCandidatePda(program,action.args.childMint),proposed_mint:deriveProposedMintPda(program,action.args.childMint),existing_child_lineage:deriveLineagePda(program,action.args.childMint),treasury:state.treasury,system_program:SYSTEM_PROGRAM_ID},action.args));
  }else if(action.kind==='vote'){
   if(phase!=='vote'||state.vote||action.amount<=0n||action.amount>18446744073709551615n)throw Error('Voting is unavailable or this wallet already voted.');
   if(!state.proposals.some(proposal=>proposal.proposalId===action.proposalId))throw Error('Proposal missing.');
   const source=getAssociatedTokenAddressSync(parentMint,payer);const balance=await connection.getTokenAccountBalance(source,'confirmed');if(BigInt(balance.value.amount)<action.amount)throw Error('Not enough parent tokens to vote.');
   instructions.push(buildInstruction(program,'cast_vote',{config,voter:payer,...escrow,parent_mint:parentMint,proposal:deriveProposalPda(program,epochKey,action.proposalId),receipt:deriveVotePda(program,epochKey,payer),voter_tokens:source,token_program:TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID},action.amount));
  }else if(action.kind==='finalize'){
   if(phase!=='finalize'||!parent.activeEpoch.equals(epochKey))throw Error('Voting has not ended or round is already finalized.');
   if(epoch.highestSupport===0n)instructions.push(buildInstruction(program,'finalize_empty_epoch',{...base,settler:payer,epoch:epochKey}));
   else{const winner=state.proposals.find(proposal=>proposal.proposalId===epoch.winningProposalId);if(!winner)throw Error('Winning proposal missing.');instructions.push(buildInstruction(program,'finalize_epoch',{...base,settler:payer,epoch:epochKey,proposal:deriveProposalPda(program,epochKey,winner.proposalId),candidate:deriveCandidatePda(program,winner.childMint)}));}
  }else{
   if(phase!=='closed'||!state.vote||state.vote.withdrawn)throw Error('Vote tokens remain locked or were already returned.');
   const destination=getAssociatedTokenAddressSync(parentMint,payer);instructions.push(createAssociatedTokenAccountIdempotentInstruction(payer,destination,payer,parentMint));
   instructions.push(buildInstruction(program,'withdraw_vote',{voter:payer,...escrow,parent_mint:parentMint,receipt:deriveVotePda(program,epochKey,payer),destination,token_program:TOKEN_PROGRAM_ID}));
  }
 }
 const latest=await connection.getLatestBlockhash('confirmed');const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...instructions]}).compileToV0Message());
 if(transaction.serialize().length>1232)throw Error('Reproduction transaction exceeds the network packet limit.');
 return {transaction,latest,quote:{quotedAt:Date.now()},state};
}
