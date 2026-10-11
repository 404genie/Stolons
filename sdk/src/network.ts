import type {Connection} from '@solana/web3.js';
import {DEVNET_PROGRAM_ID,ALL_PROGRAM_ID} from '@raydium-io/raydium-sdk-v2';
import {DEVNET_GENESIS_HASH} from './launch-validation.js';
export type SolanaCluster='devnet'|'mainnet-beta';
export const MAINNET_GENESIS_HASH='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export function clusterGenesis(cluster:SolanaCluster){
 if(cluster==='devnet')return DEVNET_GENESIS_HASH;
 if(cluster==='mainnet-beta')return MAINNET_GENESIS_HASH;
 throw Error('Unsupported Solana cluster.');
}
export function raydiumPrograms(cluster:SolanaCluster){clusterGenesis(cluster);return cluster==='devnet'?DEVNET_PROGRAM_ID:ALL_PROGRAM_ID;}
export async function assertCluster(connection:Connection,cluster:SolanaCluster='devnet'){
 if(await connection.getGenesisHash()!==clusterGenesis(cluster))throw Error(`Solana RPC cluster mismatch: expected ${cluster}.`);
}
export function launchTarget(cluster:SolanaCluster,target?:bigint){
 clusterGenesis(cluster);
 if(cluster==='devnet'&&target===undefined)return 1000000000n;
 if(target===undefined||target<=0n||target>18446744073709551615n||(cluster==='mainnet-beta'&&target<=1000000000n))throw Error('Set an explicit production graduation target above the 1 SOL devnet test target.');
 return target;
}
