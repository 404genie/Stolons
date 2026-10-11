import {PublicKey} from '@solana/web3.js';
import {deriveConfigPda,deriveReproductionAuthorityPda,deriveFeeAuthorityPda,deriveFeeDistributionPda} from '../../sdk/dist/index.js';
const [programText,mintText]=process.argv.slice(2);
if(!programText)throw Error('Usage: node scripts/production/addresses.mjs MAINNET_PROGRAM_ID [TOKEN_MINT]');
const program=new PublicKey(programText);
if(program.equals(PublicKey.default)||['4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ','Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS'].includes(programText))throw Error('Use the separately generated mainnet program public key.');
const report={programId:program.toBase58(),config:deriveConfigPda(program).toBase58(),reproductionAuthority:deriveReproductionAuthorityPda(program).toBase58(),transactionsSent:0};
if(mintText){const mint=new PublicKey(mintText);report.tokenMint=mint.toBase58();report.feeAuthority=deriveFeeAuthorityPda(program,mint).toBase58();report.feeDistribution=deriveFeeDistributionPda(program,mint).toBase58();}
console.log(JSON.stringify(report,null,2));
