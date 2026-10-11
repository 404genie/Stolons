import {PublicKey} from '@solana/web3.js';
import type {SolanaCluster} from '@stolons/sdk/network';
const selected=process.env.NEXT_PUBLIC_SOLANA_CLUSTER||'devnet';
if(!['devnet','mainnet-beta'].includes(selected))throw Error('Unsupported Solana cluster.');
export const SOLANA_CLUSTER=selected as SolanaCluster;
export const IS_MAINNET=SOLANA_CLUSTER==='mainnet-beta';
export const NETWORK_LABEL='Solana';
export const SOL_LABEL='SOL';
export const EXPLORER_QUERY=IS_MAINNET?'':'?cluster=devnet';
export const RPC_ENDPOINT=process.env.NEXT_PUBLIC_RPC_URL||(IS_MAINNET?'':'https://api.devnet.solana.com');
const devnetProgram='4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ';
export const PROGRAM_ID=process.env.NEXT_PUBLIC_STOLONS_PROGRAM_ID||(IS_MAINNET?'':devnetProgram);
export const LAUNCH_LOOKUP_TABLE=process.env.NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE||(IS_MAINNET?'':'88XLHEm7T4SEhSzMx3vqZjGXmzo2bbeJq4VK2sgJHGwx');
const target=process.env.NEXT_PUBLIC_GRADUATION_TARGET_LAMPORTS;
export const GRADUATION_TARGET_LAMPORTS=target&&/^\d+$/.test(target)?BigInt(target):IS_MAINNET?undefined:1000000000n;
if(IS_MAINNET){
 if(!RPC_ENDPOINT||new URL(RPC_ENDPOINT).protocol!=='https:')throw Error('Mainnet requires an explicit HTTPS RPC.');
 if(!PROGRAM_ID||PROGRAM_ID===devnetProgram||new PublicKey(PROGRAM_ID).equals(PublicKey.default))throw Error('Mainnet requires its own program identity.');
 if(!LAUNCH_LOOKUP_TABLE||new PublicKey(LAUNCH_LOOKUP_TABLE).equals(PublicKey.default))throw Error('Mainnet requires a configured launch lookup table.');
 if(GRADUATION_TARGET_LAMPORTS===undefined||GRADUATION_TARGET_LAMPORTS!==85000000000n||GRADUATION_TARGET_LAMPORTS>18446744073709551615n)throw Error('Mainnet requires its reviewed graduation target.');
}
export const TRANSACTIONS_ENABLED=!IS_MAINNET||process.env.NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS==='true';
export function requireTransactions(){if(!TRANSACTIONS_ENABLED)throw Error('Mainnet launches and trading are not open yet.');}
