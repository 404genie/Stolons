pub const CONFIG_SEED: &[u8] = b"config";
pub const FAMILY_SEED: &[u8] = b"family";
pub const LINEAGE_SEED: &[u8] = b"lineage";
pub const EPOCH_SEED: &[u8] = b"epoch";
pub const PROPOSAL_SEED: &[u8] = b"proposal";
pub const VOTE_SEED: &[u8] = b"vote";
pub const VOTE_AUTHORITY_SEED: &[u8] = b"vote_authority";
pub const VOTE_ESCROW_SEED: &[u8] = b"vote_escrow";
pub const CANDIDATE_SEED: &[u8] = b"candidate";
pub const PROPOSED_MINT_SEED: &[u8] = b"proposed_mint";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const REPRODUCTION_VAULT_SEED: &[u8] = b"reproduction";
pub const REPRODUCTION_AUTHORITY_SEED: &[u8] = b"reproduction_authority";

pub const TOKEN_DECIMALS: u8 = 6;
pub const GENESIS_SUPPLY: u64 = 1_000_000_000_000_000;
pub const MARKET_ALLOCATION: u64 = 850_000_000_000_000;
pub const REPRODUCTION_RESERVE: u64 = 150_000_000_000_000;
pub const CHILD_BURN_ATOMS: u64 = 10_000_000_000_000;
pub const MAX_DIRECT_CHILDREN: u8 = 15;
pub const MAX_PROPOSALS: u8 = 32;
pub const MAX_NAME_BYTES: usize = 32;
pub const MAX_SYMBOL_BYTES: usize = 10;
pub const MAX_URI_BYTES: usize = 200;
pub const SCALE_DENOMINATOR: u64 = 1_000_000;

pub const LAUNCHLAB_POOL_SEED: &[u8] = b"pool";
pub const CPMM_POOL_SEED: &[u8] = b"pool";
pub const LAUNCHLAB_VESTING_SEED: &[u8] = b"pool_vesting";
pub const LAUNCHLAB_VAULT_AUTHORITY_SEED: &[u8] = b"vault_auth_seed";
// Anchor discriminator + epoch + pool + beneficiary + claimed/share + 8 u64 padding.
pub const LAUNCHLAB_VESTING_RECORD_SPACE: usize = 8 + 8 + 32 + 32 + 8 + 8 + 8 * 8;

// Raydium LaunchLab PoolState layout, pinned to the SDK layout tracked in docs/RAYDIUM.md.
pub const LL_STATUS_OFFSET: usize = 17;
pub const LL_BASE_DECIMALS_OFFSET: usize = 18;
pub const LL_QUOTE_DECIMALS_OFFSET: usize = 19;
pub const LL_MIGRATE_TYPE_OFFSET: usize = 20;
pub const LL_SUPPLY_OFFSET: usize = 21;
pub const LL_TOTAL_SELL_OFFSET: usize = 29;
pub const LL_LOCKED_AMOUNT_OFFSET: usize = 101;
pub const LL_CONFIG_OFFSET: usize = 141;
pub const LL_PLATFORM_OFFSET: usize = 173;
pub const LL_BASE_MINT_OFFSET: usize = 205;
pub const LL_QUOTE_MINT_OFFSET: usize = 237;
pub const LL_BASE_VAULT_OFFSET: usize = 269;
pub const LL_CREATOR_OFFSET: usize = 333;
pub const LL_VESTING_START_TIME_OFFSET: usize = 125;
pub const LL_VESTING_CLIFF_OFFSET: usize = 109;
pub const LL_VESTING_UNLOCK_OFFSET: usize = 117;

// Raydium LaunchLab PlatformConfig and VestingRecord layouts.
pub const PLATFORM_FEE_WALLET_OFFSET: usize = 16;
pub const PLATFORM_MIGRATE_SCALE_OFFSET: usize = 80;
pub const PLATFORM_CREATOR_SCALE_OFFSET: usize = 88;
pub const PLATFORM_BURN_SCALE_OFFSET: usize = 96;
pub const PLATFORM_CPMM_CONFIG_OFFSET: usize = 688;
pub const PLATFORM_VESTING_WALLET_OFFSET: usize = 760;
pub const PLATFORM_VESTING_SCALE_OFFSET: usize = 792;
pub const VESTING_POOL_OFFSET: usize = 16;
pub const VESTING_BENEFICIARY_OFFSET: usize = 48;
pub const VESTING_CLAIMED_AMOUNT_OFFSET: usize = 80;
pub const VESTING_SHARE_AMOUNT_OFFSET: usize = 88;

// Current Raydium CPMM PoolState zero-copy layout (8 byte discriminator included).
pub const CPMM_CONFIG_OFFSET: usize = 8;
pub const CPMM_TOKEN_0_MINT_OFFSET: usize = 168;
pub const CPMM_TOKEN_1_MINT_OFFSET: usize = 200;
pub const CPMM_STATUS_OFFSET: usize = 329;
pub const CPMM_SWAP_DISABLED_BIT: u8 = 1 << 2;

