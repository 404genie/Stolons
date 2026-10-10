import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  decodeLaunchPool, decodePlatformConfig, decodeVestingRecord,
  RAYDIUM_ACCOUNT_DISCRIMINATORS, RAYDIUM_LAYOUT
} from "../../sdk/src/raydium-layout.ts";

function fixture(size, discriminator) {
  const data = new Uint8Array(size);
  data.set(discriminator, 0);
  return data;
}

function putU64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, BigInt(value), true);
}

function putKey(data, offset, byte) { data.fill(byte, offset, offset + 32); }

test("Raydium account discriminator constants match Anchor account names", () => {
  for (const [name, rustName] of [["poolState", "PoolState"], ["platformConfig", "PlatformConfig"], ["vestingRecord", "VestingRecord"]]) {
    const expected = [...createHash("sha256").update(`account:${rustName}`).digest().subarray(0, 8)];
    assert.deepEqual(RAYDIUM_ACCOUNT_DISCRIMINATORS[name], expected);
  }
});

test("SDK Raydium offsets stay aligned with the on-chain adapter constants", async () => {
  const source = await readFile(new URL("../../programs/stolons/src/constants.rs", import.meta.url), "utf8");
  const offsets = {
    launchPool: {
      status: "LL_STATUS_OFFSET", baseDecimals: "LL_BASE_DECIMALS_OFFSET", quoteDecimals: "LL_QUOTE_DECIMALS_OFFSET",
      migrateType: "LL_MIGRATE_TYPE_OFFSET", supply: "LL_SUPPLY_OFFSET", totalSell: "LL_TOTAL_SELL_OFFSET",
      locked: "LL_LOCKED_AMOUNT_OFFSET", cliff: "LL_VESTING_CLIFF_OFFSET", unlock: "LL_VESTING_UNLOCK_OFFSET",
      vestingStart: "LL_VESTING_START_TIME_OFFSET", config: "LL_CONFIG_OFFSET", platform: "LL_PLATFORM_OFFSET",
      baseMint: "LL_BASE_MINT_OFFSET", quoteMint: "LL_QUOTE_MINT_OFFSET", baseVault: "LL_BASE_VAULT_OFFSET", creator: "LL_CREATOR_OFFSET"
    },
    platformConfig: {
      feeWallet: "PLATFORM_FEE_WALLET_OFFSET", migrationPlatformScale: "PLATFORM_MIGRATE_SCALE_OFFSET",
      migrationCreatorScale: "PLATFORM_CREATOR_SCALE_OFFSET", migrationBurnScale: "PLATFORM_BURN_SCALE_OFFSET",
      cpmmConfig: "PLATFORM_CPMM_CONFIG_OFFSET", vestingWallet: "PLATFORM_VESTING_WALLET_OFFSET", vestingScale: "PLATFORM_VESTING_SCALE_OFFSET"
    },
    vestingRecord: {
      pool: "VESTING_POOL_OFFSET", beneficiary: "VESTING_BENEFICIARY_OFFSET",
      claimedAmount: "VESTING_CLAIMED_AMOUNT_OFFSET", shareAmount: "VESTING_SHARE_AMOUNT_OFFSET"
    }
  };
  for (const [group, names] of Object.entries(offsets)) {
    for (const [field, constant] of Object.entries(names)) {
      const match = source.match(new RegExp(`pub const ${constant}: usize = (\\d+);`));
      assert.ok(match, `Rust offset ${constant} exists`);
      assert.equal(RAYDIUM_LAYOUT[group][field], Number(match[1]), `${group}.${field}`);
    }
  }
});

test("LaunchLab pool decoder reads the pinned field positions", () => {
  const data = fixture(365, RAYDIUM_ACCOUNT_DISCRIMINATORS.poolState);
  const x = RAYDIUM_LAYOUT.launchPool;
  data[x.status] = 2; data[x.baseDecimals] = 6; data[x.quoteDecimals] = 9; data[x.migrateType] = 1;
  for (const [field, value] of [["supply", 1_000_000_000_000_000n], ["totalSell", 850_000_000_000_000n], ["locked", 150_000_000_000_000n], ["cliff", 0n], ["unlock", 0n], ["vestingStart", 1_800_000_000n]]) {
    putU64(data, x[field], value);
  }
  for (const [field, byte] of [["config", 1], ["platform", 2], ["baseMint", 3], ["quoteMint", 4], ["baseVault", 5], ["creator", 6]]) putKey(data, x[field], byte);
  const pool = decodeLaunchPool(data);
  assert.equal(pool.status, 2);
  assert.equal(pool.supply, 1_000_000_000_000_000n);
  assert.equal(pool.locked, 150_000_000_000_000n);
  assert.equal(pool.vestingStart, 1_800_000_000n);
  assert.equal(pool.baseVault[0], 5);
  assert.equal(pool.creator[0], 6);
});

test("PlatformConfig and VestingRecord decoders read fields validated by the program", () => {
  const platform = fixture(800, RAYDIUM_ACCOUNT_DISCRIMINATORS.platformConfig);
  const p = RAYDIUM_LAYOUT.platformConfig;
  putKey(platform, p.feeWallet, 10); putU64(platform, p.migrationPlatformScale, 0); putU64(platform, p.migrationCreatorScale, 0);
  putU64(platform, p.migrationBurnScale, 1_000_000); putKey(platform, p.cpmmConfig, 11); putKey(platform, p.vestingWallet, 12);
  putU64(platform, p.vestingScale, 1_000_000);
  const decodedPlatform = decodePlatformConfig(platform);
  assert.equal(decodedPlatform.feeWallet[0], 10);
  assert.equal(decodedPlatform.migrationBurnScale, 1_000_000n);
  assert.equal(decodedPlatform.vestingWallet[0], 12);

  const vesting = fixture(96, RAYDIUM_ACCOUNT_DISCRIMINATORS.vestingRecord);
  const v = RAYDIUM_LAYOUT.vestingRecord;
  putKey(vesting, v.pool, 20); putKey(vesting, v.beneficiary, 21); putU64(vesting, v.claimedAmount, 0);
  putU64(vesting, v.shareAmount, 150_000_000_000_000n);
  const decodedVesting = decodeVestingRecord(vesting);
  assert.equal(decodedVesting.pool[0], 20);
  assert.equal(decodedVesting.beneficiary[0], 21);
  assert.equal(decodedVesting.claimedAmount, 0n);
  assert.equal(decodedVesting.shareAmount, 150_000_000_000_000n);
});

test("Raydium layout decoders reject bad discriminators and truncation", () => {
  assert.throws(() => decodeLaunchPool(new Uint8Array(365)), /discriminator mismatch/);
  assert.throws(() => decodeLaunchPool(fixture(364, RAYDIUM_ACCOUNT_DISCRIMINATORS.poolState)), /truncated/);
  assert.throws(() => decodePlatformConfig(fixture(799, RAYDIUM_ACCOUNT_DISCRIMINATORS.platformConfig)), /truncated/);
  assert.throws(() => decodeVestingRecord(fixture(95, RAYDIUM_ACCOUNT_DISCRIMINATORS.vestingRecord)), /truncated/);
});
