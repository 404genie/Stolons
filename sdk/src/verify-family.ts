import {Connection,PublicKey} from '@solana/web3.js';
import {decodeLineage} from './client.js';
import {deriveFamilyPda,deriveReproductionVaultPda} from './pda.js';
import {DEVNET_GENESIS_HASH} from './launch-validation.js';
import {TOKEN_PROGRAM_ID} from './constants.js';
/** Read-only settlement audit. Allows additional holder burns but requires exact reserve consumption. */
export async function verifyDevnetFamily(connection:Connection,program:PublicKey,root:PublicKey){
 if(await connection.getGenesisHash()!==DEVNET_GENESIS_HASH)throw Error('Family verification is enabled on devnet only.');
 const accounts=await connection.getProgramAccounts(program,{commitment:'confirmed',filters:[{dataSize:317}]});
 const lineages=accounts.map(({account})=>decodeLineage(account.data)).filter(entry=>entry.rootMint.equals(root));
 const rootEntry=lineages.find(entry=>entry.mint.equals(root));if(!rootEntry)throw Error('Root lineage missing.');
 const active=lineages.filter(entry=>['RootActive','DescendantActive'].includes(entry.status));
 const family=await connection.getAccountInfo(deriveFamilyPda(program,root),'confirmed');if(!family?.owner.equals(program)||family.data.length<73||!new PublicKey(family.data.subarray(8,40)).equals(root))throw Error('Family account missing or invalid.');
 const genesis=family.data.readBigUInt64LE(40)|(family.data.readBigUInt64LE(48)<<64n);
 if(lineages.reduce((sum,entry)=>sum+entry.selfRootMass,0n)!==genesis)throw Error('Family ancestry mass conservation failed.');
 if(BigInt(active.filter(entry=>entry.generation>0).length)!==family.data.readBigUInt64LE(56))throw Error('Successful descendant count mismatch.');
 const results=[];
 for(const entry of active){
  const [mint,vault]=await connection.getMultipleAccountsInfo([entry.mint,deriveReproductionVaultPda(program,entry.mint)],'confirmed');
  if(!mint?.owner.equals(TOKEN_PROGRAM_ID)||mint.data.length<82||!vault?.owner.equals(TOKEN_PROGRAM_ID)||vault.data.length<165||!new PublicKey(vault.data.subarray(0,32)).equals(entry.mint))throw Error('Family token accounts unavailable.');
  const supply=mint.data.readBigUInt64LE(36),reserve=vault.data.readBigUInt64LE(64),burn=BigInt(entry.directChildrenCount)*10000000000000n;
  if(entry.directChildrenCount>15||!entry.reproductionReserveClaimed||reserve!==150000000000000n-burn||supply>entry.genesisSupply-burn||mint.data.readUInt32LE(0)!==0||mint.data.readUInt32LE(46)!==0)throw Error('Parent burn, reserve, or revoked authority invariant failed.');
  results.push({mint:entry.mint.toBase58(),generation:entry.generation,successfulChildren:entry.directChildrenCount,supply:supply.toString(),reserve:reserve.toString(),requiredParentBurn:burn.toString()});
 }
 return {root:root.toBase58(),genesisRootMass:genesis.toString(),activeTokens:active.length,lineages:lineages.length,tokens:results};
}
