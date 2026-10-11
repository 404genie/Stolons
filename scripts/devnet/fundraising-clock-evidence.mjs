import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {decodeLaunchPool} from '../../sdk/dist/raydium-layout.js';
export function clockEvidence(poolAccount,clockAccount,config,mint){
 if(!poolAccount||!clockAccount||!new PublicKey(poolAccount.owner).equals(config.launchpad))throw Error('Post-simulation evidence unavailable.');
 const bytes=Buffer.from(poolAccount.data[0],'base64'),clock=Buffer.from(clockAccount.data[0],'base64'),p=decodeLaunchPool(bytes),timestamp=clock.readBigInt64LE(32);
 if(p.status!==1||p.migrateType!==1||p.baseDecimals!==6||p.quoteDecimals!==9||p.supply!==1000000000000000n||p.vestingStart<=0n||p.vestingStart!==timestamp||p.cliff!==0n||p.unlock!==0n||p.locked!==150000000000000n||p.totalSell!==700000000000000n||p.fundraisingTarget!==1000000000n||!new PublicKey(p.baseMint).equals(mint)||!new PublicKey(p.config).equals(config.launchConfig)||!new PublicKey(p.platform).equals(config.platform)||!new PublicKey(p.quoteMint).equals(config.quote))throw Error('Post-buy status-1 timestamp assertion failed.');
 return {poolStatusAfterSimulatedBuy:p.status,vestingStartTime:p.vestingStart.toString(),clockUnixTimestamp:timestamp.toString(),poolAccountSha256:createHash('sha256').update(bytes).digest('hex'),postSimulationPoolDataBase64:bytes.toString('base64'),postSimulationClockDataBase64:clock.toString('base64')};
}
