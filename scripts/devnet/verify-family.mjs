import {Connection,PublicKey} from '@solana/web3.js';
import {verifyDevnetFamily} from '../../sdk/dist/verify-family.js';
const [rootText,childText]=process.argv.slice(2);if(!rootText)throw Error('Usage: node scripts/devnet/verify-family.mjs ROOT_MINT');
const connection=new Connection(process.env.NEXT_PUBLIC_RPC_URL||'https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})});
const program=new PublicKey(process.env.NEXT_PUBLIC_STOLONS_PROGRAM_ID||'4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ');
const result=await verifyDevnetFamily(connection,program,new PublicKey(rootText));
if(childText&&!result.tokens.some(token=>token.mint===new PublicKey(childText).toBase58()&&token.generation>0))throw Error('Expected child has not settled and activated yet.');
console.log(JSON.stringify(result,null,2));console.log('Family settlement invariants verified. No transaction sent.');
