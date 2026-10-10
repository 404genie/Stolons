export const RAYDIUM_LAYOUT = Object.freeze({
  launchPool: {
    status: 17, baseDecimals: 18, quoteDecimals: 19, migrateType: 20, supply: 21, totalSell: 29,
    locked: 101, cliff: 109, unlock: 117, vestingStart: 125, config: 141, platform: 173,
    baseMint: 205, quoteMint: 237, baseVault: 269, creator: 333
  },
  platformConfig: {
    feeWallet: 16, migrationPlatformScale: 80, migrationCreatorScale: 88, migrationBurnScale: 96,
    cpmmConfig: 688, vestingWallet: 760, vestingScale: 792
  },
  vestingRecord: { pool: 16, beneficiary: 48, claimedAmount: 80, shareAmount: 88 }
});

export const RAYDIUM_ACCOUNT_DISCRIMINATORS = Object.freeze({
  poolState: [247, 237, 227, 245, 215, 195, 222, 70],
  platformConfig: [160, 78, 128, 0, 248, 83, 230, 160],
  vestingRecord: [106, 243, 221, 205, 230, 126, 85, 83]
});

export interface LaunchPoolSnapshot {
  status: number;
  baseDecimals: number;
  quoteDecimals: number;
  migrateType: number;
  supply: bigint;
  totalSell: bigint;
  locked: bigint;
  cliff: bigint;
  unlock: bigint;
  vestingStart: bigint;
  config: Uint8Array;
  platform: Uint8Array;
  baseMint: Uint8Array;
  quoteMint: Uint8Array;
  baseVault: Uint8Array;
  creator: Uint8Array;
}

export interface PlatformConfigSnapshot {
  feeWallet: Uint8Array;
  migrationPlatformScale: bigint;
  migrationCreatorScale: bigint;
  migrationBurnScale: bigint;
  cpmmConfig: Uint8Array;
  vestingWallet: Uint8Array;
  vestingScale: bigint;
}

export interface VestingRecordSnapshot {
  pool: Uint8Array;
  beneficiary: Uint8Array;
  claimedAmount: bigint;
  shareAmount: bigint;
}

function checkedBytes(data: Uint8Array, offset: number, size: number): Uint8Array {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > data.length) throw new RangeError("Raydium account data is truncated");
  return data.subarray(offset, offset + size);
}

function checkDiscriminator(data: Uint8Array, expected: readonly number[]): void {
  const actual = checkedBytes(data, 0, 8);
  if (expected.some((byte, index) => actual[index] !== byte)) throw new Error("Raydium account discriminator mismatch");
}

function readU64(data: Uint8Array, offset: number): bigint {
  const value = checkedBytes(data, offset, 8);
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getBigUint64(0, true);
}

function readKey(data: Uint8Array, offset: number): Uint8Array {
  return new Uint8Array(checkedBytes(data, offset, 32));
}

export function decodeLaunchPool(data: Uint8Array): LaunchPoolSnapshot {
  checkDiscriminator(data, RAYDIUM_ACCOUNT_DISCRIMINATORS.poolState);
  const x = RAYDIUM_LAYOUT.launchPool;
  return {
    status: checkedBytes(data, x.status, 1)[0]!, baseDecimals: checkedBytes(data, x.baseDecimals, 1)[0]!,
    quoteDecimals: checkedBytes(data, x.quoteDecimals, 1)[0]!, migrateType: checkedBytes(data, x.migrateType, 1)[0]!,
    supply: readU64(data, x.supply), totalSell: readU64(data, x.totalSell), locked: readU64(data, x.locked),
    cliff: readU64(data, x.cliff), unlock: readU64(data, x.unlock), vestingStart: readU64(data, x.vestingStart),
    config: readKey(data, x.config), platform: readKey(data, x.platform), baseMint: readKey(data, x.baseMint),
    quoteMint: readKey(data, x.quoteMint), baseVault: readKey(data, x.baseVault), creator: readKey(data, x.creator)
  };
}

export function decodePlatformConfig(data: Uint8Array): PlatformConfigSnapshot {
  checkDiscriminator(data, RAYDIUM_ACCOUNT_DISCRIMINATORS.platformConfig);
  const x = RAYDIUM_LAYOUT.platformConfig;
  return {
    feeWallet: readKey(data, x.feeWallet), migrationPlatformScale: readU64(data, x.migrationPlatformScale),
    migrationCreatorScale: readU64(data, x.migrationCreatorScale), migrationBurnScale: readU64(data, x.migrationBurnScale),
    cpmmConfig: readKey(data, x.cpmmConfig), vestingWallet: readKey(data, x.vestingWallet), vestingScale: readU64(data, x.vestingScale)
  };
}

export function decodeVestingRecord(data: Uint8Array): VestingRecordSnapshot {
  checkDiscriminator(data, RAYDIUM_ACCOUNT_DISCRIMINATORS.vestingRecord);
  const x = RAYDIUM_LAYOUT.vestingRecord;
  return { pool: readKey(data, x.pool), beneficiary: readKey(data, x.beneficiary), claimedAmount: readU64(data, x.claimedAmount), shareAmount: readU64(data, x.shareAmount) };
}
