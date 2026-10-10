use anchor_lang::{prelude::*, solana_program::hash::hash};
use crate::{constants::*, errors::StolonsError, state::GlobalConfig};

#[derive(Clone, Copy)]
pub struct LaunchPoolView {
    pub status: u8,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    pub migrate_type: u8,
    pub supply: u64,
    pub total_sell: u64,
    pub locked: u64,
    pub cliff_period: u64,
    pub unlock_period: u64,
    pub vesting_start_time: u64,
    pub config: Pubkey,
    pub platform: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_vault: Pubkey,
    pub creator: Pubkey,
}

fn bytes<'a>(data: &'a [u8], offset: usize, size: usize) -> Result<&'a [u8]> {
    let end = offset.checked_add(size).ok_or(StolonsError::InvalidRaydiumAccount)?;
    data.get(offset..end).ok_or_else(|| error!(StolonsError::InvalidRaydiumAccount))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    Ok(u64::from_le_bytes(bytes(data, offset, 8)?.try_into().map_err(|_| StolonsError::InvalidRaydiumAccount)?))
}

fn read_key(data: &[u8], offset: usize) -> Result<Pubkey> {
    Ok(Pubkey::new_from_array(bytes(data, offset, 32)?.try_into().map_err(|_| StolonsError::InvalidRaydiumAccount)?))
}

fn require_discriminator(data: &[u8], name: &[u8]) -> Result<()> {
    let expected = hash(name).to_bytes();
    require!(bytes(data, 0, 8)? == &expected[..8], StolonsError::InvalidRaydiumAccount);
    Ok(())
}

pub fn read_launch_pool(account: &AccountInfo, config: &GlobalConfig) -> Result<LaunchPoolView> {
    require_keys_eq!(*account.owner, config.launchlab_program, StolonsError::InvalidRaydiumAccount);
    let data = account.try_borrow_data()?;
    require_discriminator(&data, b"account:PoolState")?;
    Ok(LaunchPoolView {
        status: bytes(&data, LL_STATUS_OFFSET, 1)?[0],
        base_decimals: bytes(&data, LL_BASE_DECIMALS_OFFSET, 1)?[0],
        quote_decimals: bytes(&data, LL_QUOTE_DECIMALS_OFFSET, 1)?[0],
        migrate_type: bytes(&data, LL_MIGRATE_TYPE_OFFSET, 1)?[0],
        supply: read_u64(&data, LL_SUPPLY_OFFSET)?,
        total_sell: read_u64(&data, LL_TOTAL_SELL_OFFSET)?,
        locked: read_u64(&data, LL_LOCKED_AMOUNT_OFFSET)?,
        cliff_period: read_u64(&data, LL_VESTING_CLIFF_OFFSET)?,
        unlock_period: read_u64(&data, LL_VESTING_UNLOCK_OFFSET)?,
        vesting_start_time: read_u64(&data, LL_VESTING_START_TIME_OFFSET)?,
        config: read_key(&data, LL_CONFIG_OFFSET)?,
        platform: read_key(&data, LL_PLATFORM_OFFSET)?,
        base_mint: read_key(&data, LL_BASE_MINT_OFFSET)?,
        quote_mint: read_key(&data, LL_QUOTE_MINT_OFFSET)?,
        base_vault: read_key(&data, LL_BASE_VAULT_OFFSET)?,
        creator: read_key(&data, LL_CREATOR_OFFSET)?,
    })
}

pub fn validate_stolons_launch(
    pool_key: Pubkey,
    pool: &LaunchPoolView,
    config: &GlobalConfig,
    mint: Pubkey,
    required_status: u8,
) -> Result<()> {
    require!(pool.status == required_status, StolonsError::InvalidLifecycleState);
    require!(pool.migrate_type == 1, StolonsError::InvalidLaunchPool);
    require!(pool.supply == GENESIS_SUPPLY, StolonsError::InvalidAllocation);
    require!(pool.locked == REPRODUCTION_RESERVE, StolonsError::InvalidAllocation);
    // The reserve must be claimable in full immediately after graduation.
    require!(pool.cliff_period == 0 && pool.unlock_period == 0, StolonsError::InvalidAllocation);
    require!(pool.total_sell > 0 && pool.total_sell <= MARKET_ALLOCATION, StolonsError::InvalidAllocation);
    require!(pool.total_sell.checked_add(pool.locked).ok_or(StolonsError::InvalidAllocation)? <= pool.supply, StolonsError::InvalidAllocation);
    require!(pool.base_decimals == TOKEN_DECIMALS, StolonsError::InvalidMint);
    require_keys_eq!(pool.config, config.launchlab_config, StolonsError::InvalidLaunchPool);
    require_keys_eq!(pool.platform, config.platform_config, StolonsError::InvalidLaunchPool);
    require_keys_eq!(pool.base_mint, mint, StolonsError::InvalidLaunchPool);
    require_keys_eq!(pool.quote_mint, config.quote_mint, StolonsError::InvalidLaunchPool);
    let (expected_pool, _) = Pubkey::find_program_address(
        &[LAUNCHLAB_POOL_SEED, mint.as_ref(), config.quote_mint.as_ref()],
        &config.launchlab_program,
    );
    require_keys_eq!(pool_key, expected_pool, StolonsError::InvalidPda);
    Ok(())
}

pub fn validate_platform_config(account: &AccountInfo, config: &GlobalConfig, authority: Pubkey) -> Result<()> {
    require_keys_eq!(account.key(), config.platform_config, StolonsError::InvalidRaydiumAccount);
    require_keys_eq!(*account.owner, config.launchlab_program, StolonsError::InvalidRaydiumAccount);
    let data = account.try_borrow_data()?;
    require_discriminator(&data, b"account:PlatformConfig")?;
    require_keys_eq!(read_key(&data, PLATFORM_FEE_WALLET_OFFSET)?, config.treasury, StolonsError::InvalidConfiguration);
    require!(read_u64(&data, PLATFORM_MIGRATE_SCALE_OFFSET)? == 0, StolonsError::InvalidConfiguration);
    require!(read_u64(&data, PLATFORM_CREATOR_SCALE_OFFSET)? == 0, StolonsError::InvalidConfiguration);
    require!(read_u64(&data, PLATFORM_BURN_SCALE_OFFSET)? == SCALE_DENOMINATOR, StolonsError::InvalidConfiguration);
    require_keys_eq!(read_key(&data, PLATFORM_CPMM_CONFIG_OFFSET)?, config.cpmm_config, StolonsError::InvalidConfiguration);
    require_keys_eq!(read_key(&data, PLATFORM_VESTING_WALLET_OFFSET)?, authority, StolonsError::InvalidConfiguration);
    require!(read_u64(&data, PLATFORM_VESTING_SCALE_OFFSET)? == SCALE_DENOMINATOR, StolonsError::InvalidConfiguration);
    Ok(())
}

pub fn validate_vesting_record(account: &AccountInfo, config: &GlobalConfig, pool: Pubkey, beneficiary: Pubkey) -> Result<()> {
    require_keys_eq!(*account.owner, config.launchlab_program, StolonsError::InvalidVestingRecord);
    let (expected, _) = Pubkey::find_program_address(
        &[LAUNCHLAB_VESTING_SEED, pool.as_ref(), beneficiary.as_ref()],
        &config.launchlab_program,
    );
    require_keys_eq!(account.key(), expected, StolonsError::InvalidVestingRecord);
    let data = account.try_borrow_data()?;
    require_discriminator(&data, b"account:VestingRecord")?;
    require_keys_eq!(read_key(&data, VESTING_POOL_OFFSET)?, pool, StolonsError::InvalidVestingRecord);
    require_keys_eq!(read_key(&data, VESTING_BENEFICIARY_OFFSET)?, beneficiary, StolonsError::InvalidVestingRecord);
    require!(read_u64(&data, VESTING_CLAIMED_AMOUNT_OFFSET)? == 0, StolonsError::InvalidVestingRecord);
    require!(read_u64(&data, VESTING_SHARE_AMOUNT_OFFSET)? == REPRODUCTION_RESERVE, StolonsError::InvalidVestingRecord);
    Ok(())
}

pub fn verify_initialize_v2_before_current(
    instruction_sysvar: &AccountInfo,
    launchlab_program: Pubkey,
    platform_config: Pubkey,
    pool: Pubkey,
    base_mint: Pubkey,
    quote_mint: Pubkey,
) -> Result<()> {
    use anchor_lang::solana_program::sysvar::instructions::{load_current_index_checked, load_instruction_at_checked};
    let current = load_current_index_checked(instruction_sysvar)? as usize;
    let expected = hash(b"global:initialize_v2").to_bytes();
    for index in 0..current {
        let instruction = load_instruction_at_checked(index, instruction_sysvar)?;
        if instruction.program_id != launchlab_program || instruction.data.get(..8) != Some(&expected[..8]) {
            continue;
        }
        // InitializeV2's pinned account order: platform config 3, pool state 5, base mint 6, quote mint 7.
        if instruction.accounts.len() >= 8
            && instruction.accounts[3].pubkey == platform_config
            && instruction.accounts[5].pubkey == pool
            && instruction.accounts[6].pubkey == base_mint
            && instruction.accounts[7].pubkey == quote_mint
        {
            return Ok(());
        }
    }
    err!(StolonsError::MissingInitializeProof)
}

pub fn verify_cpmm_pool(account: &AccountInfo, config: &GlobalConfig, base_mint: Pubkey, quote_mint: Pubkey) -> Result<()> {
    require_keys_eq!(*account.owner, config.cpmm_program, StolonsError::InvalidCpmmPool);
    let data = account.try_borrow_data()?;
    require_discriminator(&data, b"account:PoolState")?;
    let cpmm_config = read_key(&data, CPMM_CONFIG_OFFSET)?;
    require_keys_eq!(cpmm_config, config.cpmm_config, StolonsError::InvalidCpmmPool);
    let mint_0 = read_key(&data, CPMM_TOKEN_0_MINT_OFFSET)?;
    let mint_1 = read_key(&data, CPMM_TOKEN_1_MINT_OFFSET)?;
    require!((mint_0 == base_mint && mint_1 == quote_mint) || (mint_0 == quote_mint && mint_1 == base_mint), StolonsError::InvalidCpmmPool);
    require!(bytes(&data, CPMM_STATUS_OFFSET, 1)?[0] & CPMM_SWAP_DISABLED_BIT == 0, StolonsError::InvalidCpmmPool);
    let (expected, _) = Pubkey::find_program_address(
        &[CPMM_POOL_SEED, config.cpmm_config.as_ref(), mint_0.as_ref(), mint_1.as_ref()],
        &config.cpmm_program,
    );
    require_keys_eq!(account.key(), expected, StolonsError::InvalidCpmmPool);
    Ok(())
}

pub fn anchor_ix_discriminator(name: &[u8]) -> [u8; 8] {
    let digest = hash(name).to_bytes();
    digest[..8].try_into().expect("fixed discriminator length")
}

