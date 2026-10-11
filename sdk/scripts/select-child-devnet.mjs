import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Connection,PublicKey,Keypair,TransactionMessage,VersionedTransaction,ComputeBudgetProgram,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,getAccount} from '@solana/spl-token';
import {StolonsClient,buildInstruction,deriveConfigPda,deriveLineagePda,deriveCandidatePda,deriveProposedMintPda,deriveEpochPda,deriveProposalPda,deriveVotePda,deriveVoteAuthorityPda,deriveVoteEscrowPda,deriveVaultAuthorityPda,deriveReproductionVaultPda,TOKEN_PROGRAM_ID,SYSTEM_PROGRAM_ID} from '../dist/index.js';
const [walletText,programText,parentText,childText,mode='']=process.argv.slice(2);
if(!walletText||!programText||!parentText||!childText||!['','--apply'].includes(mode))throw Error('Use bash scripts/devnet/select-child.sh [--apply]');
const root=new URL('../../',import.meta.url),connection=new Connection('https://api.devnet.solana.com','confirmed');
const wallet=new PublicKey(walletText),program=new PublicKey(programText),parentMint=new PublicKey(parentText),childMint=new PublicKey(childText),client=new StolonsClient(connection,program);
const must=(ok,message)=>{if(!ok)throw Error(message)};
async function account(key){const a=await connection.getAccountInfo(key);if(a)must(a.owner.equals(program),'Stolons account owner mismatch');return a}
const config=deriveConfigPda(program),parent=deriveLineagePda(program,parentMint),candidate=deriveCandidatePda(program,childMint);
const configAccount=await account(config);must(configAccount,'Config missing');must(configAccount.data[304]===0,'Protocol paused');
const treasury=new PublicKey(configAccount.data.subarray(40,72));
const parentState=await client.getLineage(parentMint);must(parentState?.status==='RootActive'&&parentState.creator.equals(wallet),'Expected own active root');
const candidateAccount=await account(candidate);
const epoch=candidateAccount?new PublicKey(candidateAccount.data.subarray(72,104)):parentState.activeEpoch.equals(PublicKey.default)?deriveEpochPda(program,parentMint,parentState.nextEpochId):parentState.activeEpoch;
const proposal=deriveProposalPda(program,epoch,0),receipt=deriveVotePda(program,epoch,wallet),voteAuthority=deriveVoteAuthorityPda(program,epoch),voteEscrow=deriveVoteEscrowPda(program,epoch),voterTokens=getAssociatedTokenAddressSync(parentMint,wallet);
const metadata=await readFile(new URL('child.json',root));
const proposalArgs={proposalId:0,childMint,name:'Stolons Child',symbol:'STCHILD',metadataUri:'https://raw.githubusercontent.com/404genie/Stolons/devnet/codespaces/child.json',metadataHash:createHash('sha256').update(metadata).digest()};
async function run(label,instructions){
 const latest=await connection.getLatestBlockhash();
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...instructions]}).compileToLegacyMessage());
 must(tx.serialize().length<=1232,`${label} exceeds packet size`);
 const sim=await connection.simulateTransaction(tx,{sigVerify:false,commitment:'confirmed'});console.log((sim.value.logs??[]).join('\n'));must(!sim.value.err,`${label} simulation failed: ${JSON.stringify(sim.value.err)}`);console.log(`${label} simulation passed`);
 if(mode!=='--apply')return false;
 const idl=JSON.parse(await readFile(new URL('target/idl/stolons.json',root),'utf8'));must(idl.address===programText,'IDL mismatch');
 const signer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('keypairs/devnet-wallet.json',root),'utf8'))));must(signer.publicKey.equals(wallet),'Wallet mismatch');tx.sign([signer]);
 const signature=await connection.sendRawTransaction(tx.serialize(),{preflightCommitment:'confirmed'});const result=await connection.confirmTransaction({signature,...latest},'confirmed');must(!result.value.err,`${label} failed: ${JSON.stringify(result.value.err)}`);console.log(`${label}: ${signature}`);return true;
}
async function chainTime(){const clock=await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);return Number(clock.data.readBigInt64LE(32))}
async function waitUntil(time,label){let remaining=time-await chainTime();if(remaining>0&&mode!=='--apply'){console.log(`${label} starts in ${remaining}s; rerun with --apply.`);return false}while(remaining>0){console.log(`${label}: waiting ${remaining}s`);await new Promise(resolve=>setTimeout(resolve,Math.min(remaining+1,15)*1000));remaining=time-await chainTime()}return true}
let epochAccount=await account(epoch);
const instructions=[];
if(!epochAccount){must(parentState.activeEpoch.equals(PublicKey.default)&&parentState.activeCandidate.equals(PublicKey.default),'Parent already has active work');instructions.push(buildInstruction(program,'open_epoch',{payer:wallet,config,parent,parent_mint:parentMint,vault_authority:deriveVaultAuthorityPda(program,parentMint),reproduction_vault:deriveReproductionVaultPda(program,parentMint),epoch,vote_authority:voteAuthority,vote_escrow:voteEscrow,token_program:TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID},parentState.nextEpochId))}
const existingProposal=await account(proposal);
if(!existingProposal){if(epochAccount)must(epochAccount.data[80]===0&&await chainTime()<Number(epochAccount.data.readBigInt64LE(56)),'Proposal window closed or proposal zero taken');instructions.push(buildInstruction(program,'submit_proposal',{proposer:wallet,config,parent,epoch,proposal,candidate,proposed_mint:deriveProposedMintPda(program,childMint),existing_child_lineage:deriveLineagePda(program,childMint),treasury,system_program:SYSTEM_PROGRAM_ID},proposalArgs))}
else must(new PublicKey(existingProposal.data.subarray(72,104)).equals(childMint)&&new PublicKey(existingProposal.data.subarray(40,72)).equals(wallet),'Existing proposal mismatch');
console.log(JSON.stringify({parent:parentText,child:childText,epoch:epoch.toBase58(),proposal:proposal.toBase58(),voteTokens:1000000},null,2));
if(instructions.length&&!await run('Open epoch and submit child proposal',instructions)){console.log('No transaction sent. Run with --apply.');process.exit(0)}
epochAccount=await account(epoch);must(epochAccount,'Epoch missing');
if(epochAccount.data[90]===0){
 if(!await waitUntil(Number(epochAccount.data.readBigInt64LE(64)),'Voting'))process.exit(0);
 if(!await account(receipt)){
  must(await chainTime()<Number(epochAccount.data.readBigInt64LE(72)),'Voting window missed; this epoch needs separate recovery');
  const tokens=await getAccount(connection,voterTokens);must(tokens.amount>=1000000000000n,'Need 1M parent tokens to vote');
  if(!await run('Vote with 1M parent tokens',[buildInstruction(program,'cast_vote',{voter:wallet,config,epoch,parent_mint:parentMint,proposal,receipt,vote_authority:voteAuthority,vote_escrow:voteEscrow,voter_tokens:voterTokens,token_program:TOKEN_PROGRAM_ID,system_program:SYSTEM_PROGRAM_ID},1000000000000n)]))process.exit(0);
 }
 if(!await waitUntil(Number(epochAccount.data.readBigInt64LE(72)),'Finalization'))process.exit(0);
 epochAccount=await account(epoch);must(epochAccount.data[89]===0&&epochAccount.data.readBigUInt64LE(81)>0n,'Test proposal is not winner');
 if(!await run('Finalize winning child',[buildInstruction(program,'finalize_epoch',{settler:wallet,config,parent,parent_mint:parentMint,epoch,proposal,candidate})]))process.exit(0);
}
const vote=await account(receipt);
if(vote&&!vote.data[112])if(!await run('Return escrowed vote tokens',[buildInstruction(program,'withdraw_vote',{voter:wallet,epoch,parent_mint:parentMint,receipt,vote_authority:voteAuthority,vote_escrow:voteEscrow,destination:voterTokens,token_program:TOKEN_PROGRAM_ID})]))process.exit(0);
const selected=await account(candidate),finalParent=await client.getLineage(parentMint);must(selected&&selected.data[168]===1&&finalParent.activeCandidate.equals(childMint),'Candidate selection invariant failed');
const finalVote=await account(receipt);must(finalVote?.data[112]===1,'Vote tokens not returned');
await mkdir(new URL('target/devnet/',root),{recursive:true});await writeFile(new URL('target/devnet/child-selection.json',root),JSON.stringify({parent:parentText,child:childText,epoch:epoch.toBase58(),proposal:proposal.toBase58(),candidate:candidate.toBase58()},null,2)+'\n');
console.log(`Verified Selected child ${childText}; vote tokens returned. Launch deadline: ${new Date(Number(selected.data.readBigInt64LE(177))*1000).toISOString()}`);
