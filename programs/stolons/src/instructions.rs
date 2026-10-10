use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
        program::invoke,
        system_instruction,
        sysvar::instructions::ID as INSTRUCTIONS_ID,
    },
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Burn, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    constants::*,
    errors::StolonsError,
    events::*,
    math::{root_mass_transfer, validate_family_move},
    raydium::{
        self, anchor_ix_discriminator, read_launch_pool, validate_platform_config,
        validate_stolons_launch, validate_vesting_record, verify_cpmm_pool,
        verify_initialize_v2_before_current,
    },
    state::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigArgs {
    pub treasury: Pubkey,
    pub launchlab_program: Pubkey,
    pub cpmm_program: Pubkey,
    pub launchlab_config: Pubkey,
    pub platform_config: Pubkey,
    pub quote_mint: Pubkey,
    pub cpmm_config: Pubkey,
    pub proposal_window: u64,
    pub voting_window: u64,
    pub candidate_launch_window: u64,
    pub candidate_migration_window: u64,
    pub proposal_fee_lamports: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SubmitProposalArgs {
    pub proposal_id: u8,
    pub child_mint: Pubkey,
    pub name: String,
    pub symbol: String,
    pub metadata_uri: String,
    pub metadata_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: InitializeConfigArgs)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = authority, space = GlobalConfig::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: validated as the configured Raydium LaunchLab executable.
    pub launchlab_program: UncheckedAccount<'info>,
    /// CHECK: validated as the configured Raydium CPMM executable.
    pub cpmm_program: UncheckedAccount<'info>,
    /// CHECK: pinned to the configured LaunchLab global config address and owner.
    #[account(address = args.launchlab_config)]
    pub launchlab_config: UncheckedAccount<'info>,
    /// CHECK: decoded and validated by the Raydium adapter.
    pub platform_config: UncheckedAccount<'info>,
    #[account(address = args.quote_mint)]
    pub quote_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    require!(args.proposal_window > 0 && args.proposal_window <= 30 * 86_400, StolonsError::InvalidConfiguration);
    require!(args.voting_window > 0 && args.voting_window <= 30 * 86_400, StolonsError::InvalidConfiguration);
    require!(args.candidate_launch_window > 0 && args.candidate_launch_window <= 7 * 86_400, StolonsError::InvalidConfiguration);
    require!(args.candidate_migration_window > 0 && args.candidate_migration_window <= 30 * 86_400, StolonsError::InvalidConfiguration);
    require!(args.proposal_fee_lamports <= 1_000_000_000, StolonsError::InvalidConfiguration);
    require!(args.treasury != Pubkey::default(), StolonsError::InvalidConfiguration);
    require_keys_eq!(ctx.accounts.launchlab_program.key(), args.launchlab_program, StolonsError::InvalidConfiguration);
    require_keys_eq!(ctx.accounts.cpmm_program.key(), args.cpmm_program, StolonsError::InvalidConfiguration);
    require!(ctx.accounts.launchlab_program.executable, StolonsError::InvalidConfiguration);
    require!(ctx.accounts.cpmm_program.executable, StolonsError::InvalidConfiguration);
    require_keys_eq!(*ctx.accounts.launchlab_config.owner, args.launchlab_program, StolonsError::InvalidConfiguration);
    require_keys_eq!(ctx.accounts.platform_config.key(), args.platform_config, StolonsError::InvalidConfiguration);
    require_keys_eq!(ctx.accounts.quote_mint.key(), args.quote_mint, StolonsError::InvalidConfiguration);
    require_keys_eq!(*ctx.accounts.quote_mint.to_account_info().owner, anchor_spl::token::ID, StolonsError::InvalidConfiguration);

    let c = &mut ctx.accounts.config;
    c.authority = ctx.accounts.authority.key();
    c.treasury = args.treasury;
    c.launchlab_program = args.launchlab_program;
    c.cpmm_program = args.cpmm_program;
    c.launchlab_config = args.launchlab_config;
    c.platform_config = args.platform_config;
    c.quote_mint = args.quote_mint;
    c.cpmm_config = args.cpmm_config;
    c.proposal_window = args.proposal_window;
    c.voting_window = args.voting_window;
    c.candidate_launch_window = args.candidate_launch_window;
    c.candidate_migration_window = args.candidate_migration_window;
    c.proposal_fee_lamports = args.proposal_fee_lamports;
    c.paused = false;
    c.version = 1;
    c.bump = ctx.bumps.config;

    validate_platform_config(&ctx.accounts.platform_config.to_account_info(), c, reproduction_authority_address()?.0)?;
    Ok(())
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GlobalConfig>,
    pub authority: Signer<'info>,
}

pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterRootLaunch<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(init, payer = creator, space = Family::SPACE, seeds = [FAMILY_SEED, mint.key().as_ref()], bump)]
    pub family: Account<'info, Family>,
    #[account(init, payer = creator, space = Lineage::SPACE, seeds = [LINEAGE_SEED, mint.key().as_ref()], bump)]
    pub lineage: Account<'info, Lineage>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub mint: Account<'info, Mint>,
    /// CHECK: validated against the pinned LaunchLab PoolState layout.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: validated against the pinned PlatformConfig layout.
    pub platform_config: UncheckedAccount<'info>,
    /// CHECK: created by the Raydium CPI at the canonical PDA.
    #[account(mut)]
    pub vesting_record: UncheckedAccount<'info>,
    /// CHECK: the program-derived vesting beneficiary.
    #[account(mut, seeds = [REPRODUCTION_AUTHORITY_SEED], bump)]
    pub reproduction_authority: UncheckedAccount<'info>,
    /// CHECK: PDA owns only the per-mint reserve token account.
    #[account(seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = creator,
        seeds = [REPRODUCTION_VAULT_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority
    )]
    pub reproduction_vault: Account<'info, TokenAccount>,
    #[account(address = config.quote_mint)]
    pub quote_mint: Account<'info, Mint>,
    /// CHECK: must be the executable address stored in GlobalConfig.
    #[account(address = config.launchlab_program, executable)]
    pub launchlab_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: Solana instructions sysvar, used to bind registration to InitializeV2.
    #[account(address = INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn register_root_launch(ctx: Context<RegisterRootLaunch>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, StolonsError::Paused);
    check_fixed_mint(&ctx.accounts.mint)?;
    require_keys_eq!(ctx.accounts.quote_mint.key(), config.quote_mint, StolonsError::InvalidConfiguration);

    let pool = read_launch_pool(&ctx.accounts.pool_state.to_account_info(), config)?;
    validate_stolons_launch(ctx.accounts.pool_state.key(), &pool, config, ctx.accounts.mint.key(), 0)?;
    require!(pool.quote_decimals == ctx.accounts.quote_mint.decimals, StolonsError::InvalidLaunchPool);
    require_keys_eq!(pool.creator, ctx.accounts.creator.key(), StolonsError::InvalidLaunchPool);
    validate_platform_config(
        &ctx.accounts.platform_config.to_account_info(),
        config,
        ctx.accounts.reproduction_authority.key(),
    )?;
    verify_initialize_v2_before_current(
        &ctx.accounts.instructions.to_account_info(),
        config.launchlab_program,
        config.platform_config,
        ctx.accounts.pool_state.key(),
        ctx.accounts.mint.key(),
        config.quote_mint,
    )?;
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.family.root_mint = ctx.accounts.mint.key();
    ctx.accounts.family.genesis_root_mass = GENESIS_SUPPLY as u128;
    ctx.accounts.family.descendant_count = 0;
    ctx.accounts.family.created_at = now;
    ctx.accounts.family.bump = ctx.bumps.family;

    let lineage = &mut ctx.accounts.lineage;
    lineage.mint = ctx.accounts.mint.key();
    lineage.root_mint = ctx.accounts.mint.key();
    lineage.parent_mint = Pubkey::default();
    lineage.creator = ctx.accounts.creator.key();
    lineage.generation = 0;
    lineage.status = LineageStatus::RootPending;
    lineage.genesis_supply = GENESIS_SUPPLY;
    lineage.self_root_mass = GENESIS_SUPPLY as u128;
    lineage.direct_children_count = 0;
    lineage.active_candidate = Pubkey::default();
    lineage.active_epoch = Pubkey::default();
    lineage.launch_pool = ctx.accounts.pool_state.key();
    lineage.cpmm_pool = Pubkey::default();
    lineage.reproduction_reserve_claimed = false;
    lineage.created_at = now;
    lineage.activated_at = 0;
    lineage.next_epoch_id = 0;
    lineage.bump = ctx.bumps.lineage;

    create_platform_vesting(
        &ctx.accounts.launchlab_program.to_account_info(),
        &ctx.accounts.platform_config.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.vesting_record.to_account_info(),
        &ctx.accounts.reproduction_authority.to_account_info(),
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.bumps.reproduction_authority,
    )?;
    validate_vesting_record(
        &ctx.accounts.vesting_record.to_account_info(),
        config,
        ctx.accounts.pool_state.key(),
        ctx.accounts.reproduction_authority.key(),
    )?;
    emit!(RootRegistered { mint: lineage.mint, creator: lineage.creator, family: ctx.accounts.family.key() });
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterRootMigration<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, mint.key().as_ref()], bump = lineage.bump, has_one = mint)]
    pub lineage: Account<'info, Lineage>,
    pub mint: Account<'info, Mint>,
    /// CHECK: pinned LaunchLab account decoder and owner check.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: pinned CPMM account decoder, mint pair, config, and PDA are checked.
    pub cpmm_pool: UncheckedAccount<'info>,
    /// CHECK: configured LaunchLab executable.
    #[account(address = config.launchlab_program, executable)]
    pub launchlab_program: UncheckedAccount<'info>,
    /// CHECK: configured CPMM executable.
    #[account(address = config.cpmm_program, executable)]
    pub cpmm_program: UncheckedAccount<'info>,
}

pub fn register_root_migration(ctx: Context<RegisterRootMigration>) -> Result<()> {
    require!(ctx.accounts.lineage.status == LineageStatus::RootPending, StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.lineage.launch_pool, ctx.accounts.pool_state.key(), StolonsError::InvalidLaunchPool);
    check_fixed_mint(&ctx.accounts.mint)?;
    let pool = read_launch_pool(&ctx.accounts.pool_state.to_account_info(), &ctx.accounts.config)?;
    validate_stolons_launch(ctx.accounts.pool_state.key(), &pool, &ctx.accounts.config, ctx.accounts.mint.key(), 2)?;
    verify_cpmm_pool(
        &ctx.accounts.cpmm_pool.to_account_info(),
        &ctx.accounts.config,
        ctx.accounts.mint.key(),
        ctx.accounts.config.quote_mint,
    )?;
    ctx.accounts.lineage.cpmm_pool = ctx.accounts.cpmm_pool.key();
    ctx.accounts.lineage.status = LineageStatus::RootQualified;
    emit!(RootMigrated { mint: ctx.accounts.mint.key(), launch_pool: ctx.accounts.pool_state.key(), cpmm_pool: ctx.accounts.cpmm_pool.key() });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimRootReproductionReserve<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, mint.key().as_ref()], bump = lineage.bump, has_one = mint)]
    pub lineage: Account<'info, Lineage>,
    pub mint: Account<'info, Mint>,
    /// CHECK: validated LaunchLab PoolState.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: must equal PoolState.base_vault.
    #[account(mut)]
    pub base_vault: UncheckedAccount<'info>,
    /// CHECK: canonical vesting account.
    #[account(mut)]
    pub vesting_record: UncheckedAccount<'info>,
    /// CHECK: program-derived, immutable vesting beneficiary.
    #[account(mut, seeds = [REPRODUCTION_AUTHORITY_SEED], bump)]
    pub reproduction_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = reproduction_authority
    )]
    pub authority_ata: Account<'info, TokenAccount>,
    /// CHECK: per-mint reserve PDA owner.
    #[account(seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [REPRODUCTION_VAULT_SEED, mint.key().as_ref()], bump, token::mint = mint, token::authority = vault_authority)]
    pub reproduction_vault: Account<'info, TokenAccount>,
    /// CHECK: canonical LaunchLab vault authority PDA.
    pub launchlab_authority: UncheckedAccount<'info>,
    /// CHECK: executable address stored in config.
    #[account(address = config.launchlab_program, executable)]
    pub launchlab_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn claim_root_reproduction_reserve(ctx: Context<ClaimRootReproductionReserve>) -> Result<()> {
    require!(ctx.accounts.lineage.status == LineageStatus::RootQualified, StolonsError::InvalidLifecycleState);
    require!(!ctx.accounts.lineage.reproduction_reserve_claimed, StolonsError::AlreadySettled);
    let pool = read_launch_pool(&ctx.accounts.pool_state.to_account_info(), &ctx.accounts.config)?;
    validate_stolons_launch(ctx.accounts.pool_state.key(), &pool, &ctx.accounts.config, ctx.accounts.mint.key(), 2)?;
    require_keys_eq!(ctx.accounts.base_vault.key(), pool.base_vault, StolonsError::InvalidLaunchPool);
    validate_vesting_record(
        &ctx.accounts.vesting_record.to_account_info(),
        &ctx.accounts.config,
        ctx.accounts.pool_state.key(),
        ctx.accounts.reproduction_authority.key(),
    )?;
    require_keys_eq!(
        ctx.accounts.launchlab_authority.key(),
        Pubkey::find_program_address(&[LAUNCHLAB_VAULT_AUTHORITY_SEED], &ctx.accounts.config.launchlab_program).0,
        StolonsError::InvalidPda
    );
    let before = ctx.accounts.authority_ata.amount;
    let reserve_before = ctx.accounts.reproduction_vault.amount;
    claim_vested(
        &ctx.accounts.launchlab_program.to_account_info(),
        &ctx.accounts.launchlab_authority.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.vesting_record.to_account_info(),
        &ctx.accounts.base_vault.to_account_info(),
        &ctx.accounts.authority_ata.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.reproduction_authority.to_account_info(),
        ctx.bumps.reproduction_authority,
    )?;
    ctx.accounts.authority_ata.reload()?;
    let claimed = ctx.accounts.authority_ata.amount.checked_sub(before).ok_or(StolonsError::ArithmeticError)?;
    require!(claimed == REPRODUCTION_RESERVE, StolonsError::InvalidVestingRecord);
    transfer_reserve(
        &ctx.accounts.token_program,
        &ctx.accounts.authority_ata,
        &ctx.accounts.reproduction_vault,
        &ctx.accounts.reproduction_authority,
        ctx.bumps.reproduction_authority,
        claimed,
    )?;
    ctx.accounts.reproduction_vault.reload()?;
    let reserve_delta = ctx.accounts.reproduction_vault.amount.checked_sub(reserve_before).ok_or(StolonsError::ArithmeticError)?;
    require!(reserve_delta == REPRODUCTION_RESERVE, StolonsError::InvalidVestingRecord);
    ctx.accounts.lineage.reproduction_reserve_claimed = true;
    emit!(ReproductionReserveClaimed { mint: ctx.accounts.mint.key(), amount: claimed });
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateRoot<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, mint.key().as_ref()], bump = lineage.bump, has_one = mint)]
    pub lineage: Account<'info, Lineage>,
    pub mint: Account<'info, Mint>,
}

pub fn activate_root(ctx: Context<ActivateRoot>) -> Result<()> {
    require!(ctx.accounts.lineage.status == LineageStatus::RootQualified, StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.lineage.reproduction_reserve_claimed, StolonsError::InvalidVestingRecord);
    ctx.accounts.lineage.status = LineageStatus::RootActive;
    ctx.accounts.lineage.activated_at = Clock::get()?.unix_timestamp;
    emit!(RootActivated { mint: ctx.accounts.mint.key() });
    Ok(())
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct OpenEpoch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, parent_mint.key().as_ref()], bump = parent.bump, constraint = parent.mint == parent_mint.key())]
    pub parent: Account<'info, Lineage>,
    #[account(address = parent.mint)]
    pub parent_mint: Account<'info, Mint>,
    /// CHECK: the mint-specific PDA controls only the parent reserve.
    #[account(seeds = [VAULT_AUTHORITY_SEED, parent_mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(seeds = [REPRODUCTION_VAULT_SEED, parent_mint.key().as_ref()], bump, token::mint = parent_mint, token::authority = vault_authority)]
    pub reproduction_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = Epoch::SPACE,
        seeds = [EPOCH_SEED, parent_mint.key().as_ref(), epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: PDA signer used only by this epoch's vote escrow.
    #[account(seeds = [VOTE_AUTHORITY_SEED, epoch.key().as_ref()], bump)]
    pub vote_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        seeds = [VOTE_ESCROW_SEED, epoch.key().as_ref()],
        bump,
        token::mint = parent_mint,
        token::authority = vote_authority
    )]
    pub vote_escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn open_epoch(ctx: Context<OpenEpoch>, epoch_id: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, StolonsError::Paused);
    require!(ctx.accounts.parent.status == LineageStatus::RootActive || ctx.accounts.parent.status == LineageStatus::DescendantActive, StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.parent.next_epoch_id == epoch_id, StolonsError::InvalidEpochPhase);
    require!(ctx.accounts.parent.active_epoch == Pubkey::default(), StolonsError::InvalidEpochPhase);
    require!(ctx.accounts.parent.active_candidate == Pubkey::default(), StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.parent.direct_children_count < MAX_DIRECT_CHILDREN, StolonsError::ChildLimitReached);
    require!(ctx.accounts.reproduction_vault.amount >= CHILD_BURN_ATOMS, StolonsError::InsufficientReproductionReserve);
    // Reject a round that could never settle because the ancestry calculation
    // would transfer zero root-mass atoms.
    root_mass_transfer(
        ctx.accounts.parent.self_root_mass,
        CHILD_BURN_ATOMS,
        ctx.accounts.parent_mint.supply,
    )?;
    let now = Clock::get()?.unix_timestamp;
    let proposal_end = now.checked_add(ctx.accounts.config.proposal_window as i64).ok_or(StolonsError::ArithmeticError)?;
    let vote_end = proposal_end.checked_add(ctx.accounts.config.voting_window as i64).ok_or(StolonsError::ArithmeticError)?;
    let epoch = &mut ctx.accounts.epoch;
    epoch.parent_mint = ctx.accounts.parent_mint.key();
    epoch.epoch_id = epoch_id;
    epoch.proposal_start = now;
    epoch.proposal_end = proposal_end;
    epoch.vote_start = proposal_end;
    epoch.vote_end = vote_end;
    epoch.proposal_count = 0;
    epoch.highest_support = 0;
    epoch.winning_proposal_id = u8::MAX;
    epoch.status = EpochStatus::Open;
    epoch.bump = ctx.bumps.epoch;
    ctx.accounts.parent.active_epoch = epoch.key();
    ctx.accounts.parent.next_epoch_id = epoch_id.checked_add(1).ok_or(StolonsError::ArithmeticError)?;
    emit!(EpochOpened {
        parent_mint: ctx.accounts.parent_mint.key(),
        epoch: epoch.key(),
        epoch_id,
        proposal_end,
        vote_end,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: SubmitProposalArgs)]
pub struct SubmitProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, epoch.parent_mint.as_ref()], bump = parent.bump)]
    pub parent: Account<'info, Lineage>,
    #[account(mut, seeds = [EPOCH_SEED, epoch.parent_mint.as_ref(), epoch.epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(
        init,
        payer = proposer,
        space = Proposal::SPACE,
        seeds = [PROPOSAL_SEED, epoch.key().as_ref(), &[args.proposal_id]],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = proposer,
        space = Candidate::SPACE,
        seeds = [CANDIDATE_SEED, args.child_mint.as_ref()],
        bump
    )]
    pub candidate: Account<'info, Candidate>,
    #[account(
        init,
        payer = proposer,
        space = ProposedMint::SPACE,
        seeds = [PROPOSED_MINT_SEED, args.child_mint.as_ref()],
        bump
    )]
    pub proposed_mint: Account<'info, ProposedMint>,
    /// CHECK: a proposed child must not already have a Stolons lineage account.
    #[account(seeds = [LINEAGE_SEED, args.child_mint.as_ref()], bump)]
    pub existing_child_lineage: UncheckedAccount<'info>,
    /// CHECK: fixed fee receiver stored at config initialization.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn submit_proposal(ctx: Context<SubmitProposal>, args: SubmitProposalArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.parent.active_epoch == ctx.accounts.epoch.key(), StolonsError::InvalidEpochPhase);
    require!(ctx.accounts.epoch.status == EpochStatus::Open, StolonsError::InvalidEpochPhase);
    require!(now >= ctx.accounts.epoch.proposal_start && now < ctx.accounts.epoch.proposal_end, StolonsError::InvalidEpochPhase);
    require!(args.proposal_id == ctx.accounts.epoch.proposal_count, StolonsError::InvalidEpochPhase);
    require!(ctx.accounts.epoch.proposal_count < MAX_PROPOSALS, StolonsError::ProposalLimitReached);
    require!(args.name.as_bytes().len() <= MAX_NAME_BYTES, StolonsError::InvalidProposalText);
    require!(args.symbol.as_bytes().len() <= MAX_SYMBOL_BYTES, StolonsError::InvalidProposalText);
    require!(!args.metadata_uri.is_empty() && args.metadata_uri.as_bytes().len() <= MAX_URI_BYTES, StolonsError::InvalidProposalText);
    require!(args.child_mint != Pubkey::default() && args.child_mint != ctx.accounts.parent.mint, StolonsError::InvalidProposalText);
    require_keys_eq!(*ctx.accounts.existing_child_lineage.owner, System::id(), StolonsError::MintAlreadyProposed);
    require!(ctx.accounts.existing_child_lineage.data_is_empty(), StolonsError::MintAlreadyProposed);
    invoke(
        &system_instruction::transfer(
            &ctx.accounts.proposer.key(),
            &ctx.accounts.treasury.key(),
            ctx.accounts.config.proposal_fee_lamports,
        ),
        &[
            ctx.accounts.proposer.to_account_info(),
            ctx.accounts.treasury.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    let proposal = &mut ctx.accounts.proposal;
    proposal.epoch = ctx.accounts.epoch.key();
    proposal.proposer = ctx.accounts.proposer.key();
    proposal.child_mint = args.child_mint;
    proposal.proposal_id = args.proposal_id;
    proposal.support_amount = 0;
    proposal.name = args.name;
    proposal.symbol = args.symbol;
    proposal.metadata_uri = args.metadata_uri;
    proposal.metadata_hash = args.metadata_hash;
    proposal.created_at = now;
    proposal.bump = ctx.bumps.proposal;

    let candidate = &mut ctx.accounts.candidate;
    candidate.parent_mint = ctx.accounts.epoch.parent_mint;
    candidate.child_mint = args.child_mint;
    candidate.epoch = ctx.accounts.epoch.key();
    candidate.proposal = proposal.key();
    candidate.proposer = ctx.accounts.proposer.key();
    candidate.status = CandidateStatus::Proposed;
    candidate.selected_at = 0;
    candidate.launch_deadline = 0;
    candidate.launched_at = 0;
    candidate.migration_deadline = 0;
    candidate.qualified_at = 0;
    candidate.launch_pool = Pubkey::default();
    candidate.cpmm_pool = Pubkey::default();
    candidate.reserve_claimed = false;
    candidate.settled = false;
    candidate.bump = ctx.bumps.candidate;

    ctx.accounts.proposed_mint.child_mint = args.child_mint;
    ctx.accounts.proposed_mint.epoch = ctx.accounts.epoch.key();
    ctx.accounts.proposed_mint.proposal_id = args.proposal_id;
    ctx.accounts.proposed_mint.bump = ctx.bumps.proposed_mint;
    ctx.accounts.epoch.proposal_count = ctx.accounts.epoch.proposal_count.checked_add(1).ok_or(StolonsError::ArithmeticError)?;
    emit!(ProposalSubmitted {
        epoch: ctx.accounts.epoch.key(),
        proposal: proposal.key(),
        child_mint: args.child_mint,
        proposal_id: args.proposal_id,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [EPOCH_SEED, epoch.parent_mint.as_ref(), epoch.epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    pub parent_mint: Account<'info, Mint>,
    #[account(mut, has_one = epoch)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = VoteReceipt::SPACE,
        seeds = [VOTE_SEED, epoch.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, VoteReceipt>,
    /// CHECK: one PDA authority per epoch.
    #[account(seeds = [VOTE_AUTHORITY_SEED, epoch.key().as_ref()], bump)]
    pub vote_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [VOTE_ESCROW_SEED, epoch.key().as_ref()], bump, token::mint = parent_mint, token::authority = vote_authority)]
    pub vote_escrow: Account<'info, TokenAccount>,
    #[account(mut)]
    pub voter_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn cast_vote(ctx: Context<CastVote>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.epoch.status == EpochStatus::Open, StolonsError::InvalidEpochPhase);
    require!(now >= ctx.accounts.epoch.vote_start && now < ctx.accounts.epoch.vote_end, StolonsError::InvalidEpochPhase);
    require_keys_eq!(ctx.accounts.parent_mint.key(), ctx.accounts.epoch.parent_mint, StolonsError::InvalidVoteTokenAccount);
    require!(amount > 0, StolonsError::InvalidVoteTokenAccount);
    require!(ctx.accounts.voter_tokens.owner == ctx.accounts.voter.key(), StolonsError::InvalidVoteTokenAccount);
    require_keys_eq!(ctx.accounts.voter_tokens.mint, ctx.accounts.parent_mint.key(), StolonsError::InvalidVoteTokenAccount);
    require_keys_eq!(ctx.accounts.proposal.epoch, ctx.accounts.epoch.key(), StolonsError::WrongWinner);
    let (expected_proposal, _) = Pubkey::find_program_address(
        &[PROPOSAL_SEED, ctx.accounts.epoch.key().as_ref(), &[ctx.accounts.proposal.proposal_id]],
        ctx.program_id,
    );
    require_keys_eq!(expected_proposal, ctx.accounts.proposal.key(), StolonsError::InvalidPda);
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.voter_tokens.to_account_info(),
                to: ctx.accounts.vote_escrow.to_account_info(),
                authority: ctx.accounts.voter.to_account_info(),
            },
        ),
        amount,
    )?;
    let next_support = ctx.accounts.proposal.support_amount.checked_add(amount).ok_or(StolonsError::ArithmeticError)?;
    ctx.accounts.proposal.support_amount = next_support;
    let epoch = &mut ctx.accounts.epoch;
    if next_support > epoch.highest_support
        || (next_support == epoch.highest_support && ctx.accounts.proposal.proposal_id < epoch.winning_proposal_id)
    {
        epoch.highest_support = next_support;
        epoch.winning_proposal_id = ctx.accounts.proposal.proposal_id;
    }
    let receipt = &mut ctx.accounts.receipt;
    receipt.voter = ctx.accounts.voter.key();
    receipt.epoch = epoch.key();
    receipt.proposal = ctx.accounts.proposal.key();
    receipt.amount = amount;
    receipt.withdrawn = false;
    receipt.bump = ctx.bumps.receipt;
    emit!(VoteCast {
        epoch: epoch.key(),
        voter: ctx.accounts.voter.key(),
        proposal: ctx.accounts.proposal.key(),
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeEpoch<'info> {
    pub settler: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, parent_mint.key().as_ref()], bump = parent.bump, constraint = parent.mint == parent_mint.key())]
    pub parent: Account<'info, Lineage>,
    #[account(address = parent.mint)]
    pub parent_mint: Account<'info, Mint>,
    #[account(mut, seeds = [EPOCH_SEED, epoch.parent_mint.as_ref(), epoch.epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub candidate: Account<'info, Candidate>,
}

pub fn finalize_epoch(ctx: Context<FinalizeEpoch>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.epoch.status == EpochStatus::Open, StolonsError::InvalidEpochPhase);
    require!(now >= ctx.accounts.epoch.vote_end, StolonsError::InvalidEpochPhase);
    require!(ctx.accounts.epoch.highest_support > 0, StolonsError::NoWinningSupport);
    require!(ctx.accounts.parent.active_epoch == ctx.accounts.epoch.key(), StolonsError::InvalidEpochPhase);
    require!(ctx.accounts.parent.active_candidate == Pubkey::default(), StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.proposal.epoch == ctx.accounts.epoch.key(), StolonsError::WrongWinner);
    require!(ctx.accounts.proposal.proposal_id == ctx.accounts.epoch.winning_proposal_id, StolonsError::WrongWinner);
    require!(ctx.accounts.proposal.support_amount == ctx.accounts.epoch.highest_support, StolonsError::WrongWinner);
    require_keys_eq!(ctx.accounts.proposal.key(), Pubkey::find_program_address(
        &[PROPOSAL_SEED, ctx.accounts.epoch.key().as_ref(), &[ctx.accounts.epoch.winning_proposal_id]],
        ctx.program_id,
    ).0, StolonsError::InvalidPda);
    require!(ctx.accounts.candidate.status == CandidateStatus::Proposed, StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.parent_mint, ctx.accounts.parent_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.epoch, ctx.accounts.epoch.key(), StolonsError::WrongWinner);
    require_keys_eq!(ctx.accounts.candidate.proposal, ctx.accounts.proposal.key(), StolonsError::WrongWinner);
    require_keys_eq!(ctx.accounts.candidate.child_mint, ctx.accounts.proposal.child_mint, StolonsError::WrongWinner);
    let (expected_candidate, _) = Pubkey::find_program_address(
        &[CANDIDATE_SEED, ctx.accounts.proposal.child_mint.as_ref()],
        ctx.program_id,
    );
    require_keys_eq!(expected_candidate, ctx.accounts.candidate.key(), StolonsError::InvalidPda);
    let launch_deadline = now.checked_add(ctx.accounts.config.candidate_launch_window as i64).ok_or(StolonsError::ArithmeticError)?;
    ctx.accounts.candidate.status = CandidateStatus::Selected;
    ctx.accounts.candidate.selected_at = now;
    ctx.accounts.candidate.launch_deadline = launch_deadline;
    ctx.accounts.parent.active_candidate = ctx.accounts.proposal.child_mint;
    ctx.accounts.parent.active_epoch = Pubkey::default();
    ctx.accounts.epoch.status = EpochStatus::Finalized;
    emit!(EpochFinalized {
        parent_mint: ctx.accounts.parent_mint.key(),
        epoch_id: ctx.accounts.epoch.epoch_id,
        proposal: ctx.accounts.proposal.key(),
        child_mint: ctx.accounts.proposal.child_mint,
        support: ctx.accounts.proposal.support_amount,
    });
    emit!(CandidateSelected {
        parent_mint: ctx.accounts.parent_mint.key(),
        child_mint: ctx.accounts.proposal.child_mint,
        launch_deadline,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeEmptyEpoch<'info> {
    pub settler: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, parent_mint.key().as_ref()], bump = parent.bump, constraint = parent.mint == parent_mint.key())]
    pub parent: Account<'info, Lineage>,
    #[account(address = parent.mint)]
    pub parent_mint: Account<'info, Mint>,
    #[account(mut, seeds = [EPOCH_SEED, epoch.parent_mint.as_ref(), epoch.epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
}

pub fn finalize_empty_epoch(ctx: Context<FinalizeEmptyEpoch>) -> Result<()> {
    require!(ctx.accounts.epoch.status == EpochStatus::Open, StolonsError::InvalidEpochPhase);
    require!(Clock::get()?.unix_timestamp >= ctx.accounts.epoch.vote_end, StolonsError::InvalidEpochPhase);
    require!(ctx.accounts.epoch.highest_support == 0, StolonsError::NoWinningSupport);
    require!(ctx.accounts.parent.active_epoch == ctx.accounts.epoch.key(), StolonsError::InvalidEpochPhase);
    ctx.accounts.epoch.status = EpochStatus::NoWinner;
    ctx.accounts.parent.active_epoch = Pubkey::default();
    emit!(EpochClosedNoWinner {
        parent_mint: ctx.accounts.parent_mint.key(),
        epoch_id: ctx.accounts.epoch.epoch_id,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawVote<'info> {
    pub voter: Signer<'info>,
    #[account(seeds = [EPOCH_SEED, epoch.parent_mint.as_ref(), epoch.epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(address = epoch.parent_mint)]
    pub parent_mint: Account<'info, Mint>,
    #[account(mut, seeds = [VOTE_SEED, epoch.key().as_ref(), voter.key().as_ref()], bump = receipt.bump, has_one = voter, has_one = epoch)]
    pub receipt: Account<'info, VoteReceipt>,
    /// CHECK: epoch-scoped token authority.
    #[account(seeds = [VOTE_AUTHORITY_SEED, epoch.key().as_ref()], bump)]
    pub vote_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [VOTE_ESCROW_SEED, epoch.key().as_ref()], bump, token::mint = parent_mint, token::authority = vote_authority)]
    pub vote_escrow: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn withdraw_vote(ctx: Context<WithdrawVote>) -> Result<()> {
    require!(ctx.accounts.epoch.status != EpochStatus::Open, StolonsError::VoteStillLocked);
    require!(!ctx.accounts.receipt.withdrawn && ctx.accounts.receipt.amount > 0, StolonsError::AlreadySettled);
    require!(ctx.accounts.destination.owner == ctx.accounts.voter.key(), StolonsError::InvalidVoteTokenAccount);
    require_keys_eq!(ctx.accounts.destination.mint, ctx.accounts.epoch.parent_mint, StolonsError::InvalidVoteTokenAccount);
    require_keys_eq!(ctx.accounts.vote_escrow.mint, ctx.accounts.parent_mint.key(), StolonsError::InvalidVoteTokenAccount);
    let bump = [ctx.bumps.vote_authority];
    let epoch_key = ctx.accounts.epoch.key();
    let seeds: &[&[u8]] = &[VOTE_AUTHORITY_SEED, epoch_key.as_ref(), &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vote_escrow.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vote_authority.to_account_info(),
            },
            &[seeds],
        ),
        ctx.accounts.receipt.amount,
    )?;
    ctx.accounts.receipt.withdrawn = true;
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterCandidateLaunch<'info> {
    #[account(mut)]
    pub launcher: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, seeds = [LINEAGE_SEED, parent_mint.key().as_ref()], bump = parent.bump, constraint = parent.mint == parent_mint.key())]
    pub parent: Box<Account<'info, Lineage>>,
    #[account(address = parent.mint)]
    pub parent_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [CANDIDATE_SEED, child_mint.key().as_ref()], bump = candidate.bump)]
    pub candidate: Box<Account<'info, Candidate>>,
    pub proposal: Box<Account<'info, Proposal>>,
    pub child_mint: Box<Account<'info, Mint>>,
    /// CHECK: Raydium LaunchLab PoolState validated before and after CPI.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: canonical LaunchLab PlatformConfig.
    pub platform_config: UncheckedAccount<'info>,
    /// CHECK: initialized by the platform vesting CPI.
    #[account(mut)]
    pub vesting_record: UncheckedAccount<'info>,
    #[account(init, payer = launcher, space = Lineage::SPACE, seeds = [LINEAGE_SEED, child_mint.key().as_ref()], bump)]
    pub child_lineage: Box<Account<'info, Lineage>>,
    #[account(mut, seeds = [FAMILY_SEED, parent.root_mint.as_ref()], bump = family.bump, has_one = root_mint)]
    pub family: Box<Account<'info, Family>>,
    #[account(address = parent.root_mint)]
    pub root_mint: Box<Account<'info, Mint>>,
    /// CHECK: global platform vesting signer.
    #[account(mut, seeds = [REPRODUCTION_AUTHORITY_SEED], bump)]
    pub reproduction_authority: UncheckedAccount<'info>,
    /// CHECK: per-child reserve owner.
    #[account(seeds = [VAULT_AUTHORITY_SEED, child_mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = launcher,
        seeds = [REPRODUCTION_VAULT_SEED, child_mint.key().as_ref()],
        bump,
        token::mint = child_mint,
        token::authority = vault_authority
    )]
    pub reproduction_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.quote_mint)]
    pub quote_mint: Box<Account<'info, Mint>>,
    /// CHECK: configured LaunchLab executable.
    #[account(address = config.launchlab_program, executable)]
    pub launchlab_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: Solana instructions sysvar.
    #[account(address = INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn register_candidate_launch(ctx: Context<RegisterCandidateLaunch>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.config.paused, StolonsError::Paused);
    require!(ctx.accounts.candidate.status == CandidateStatus::Selected, StolonsError::InvalidLifecycleState);
    require!(now <= ctx.accounts.candidate.launch_deadline, StolonsError::DeadlinePassed);
    require_keys_eq!(ctx.accounts.parent.active_candidate, ctx.accounts.child_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.parent.active_epoch, Pubkey::default(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.parent_mint, ctx.accounts.parent_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.child_mint, ctx.accounts.child_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.proposal.key(), ctx.accounts.candidate.proposal, StolonsError::WrongWinner);
    require_keys_eq!(ctx.accounts.proposal.child_mint, ctx.accounts.child_mint.key(), StolonsError::WrongWinner);
    require_keys_eq!(ctx.accounts.proposal.epoch, ctx.accounts.candidate.epoch, StolonsError::WrongWinner);
    require_keys_eq!(ctx.accounts.proposal.proposer, ctx.accounts.candidate.proposer, StolonsError::WrongWinner);
    check_fixed_mint(&ctx.accounts.child_mint)?;

    let pool = read_launch_pool(&ctx.accounts.pool_state.to_account_info(), &ctx.accounts.config)?;
    validate_stolons_launch(ctx.accounts.pool_state.key(), &pool, &ctx.accounts.config, ctx.accounts.child_mint.key(), 0)?;
    require!(pool.quote_decimals == ctx.accounts.quote_mint.decimals, StolonsError::InvalidLaunchPool);
    require_keys_eq!(pool.creator, ctx.accounts.launcher.key(), StolonsError::InvalidLaunchPool);
    validate_platform_config(
        &ctx.accounts.platform_config.to_account_info(),
        &ctx.accounts.config,
        ctx.accounts.reproduction_authority.key(),
    )?;
    verify_initialize_v2_before_current(
        &ctx.accounts.instructions.to_account_info(),
        ctx.accounts.config.launchlab_program,
        ctx.accounts.config.platform_config,
        ctx.accounts.pool_state.key(),
        ctx.accounts.child_mint.key(),
        ctx.accounts.config.quote_mint,
    )?;
    create_platform_vesting(
        &ctx.accounts.launchlab_program.to_account_info(),
        &ctx.accounts.platform_config.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.vesting_record.to_account_info(),
        &ctx.accounts.reproduction_authority.to_account_info(),
        &ctx.accounts.launcher.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.bumps.reproduction_authority,
    )?;
    validate_vesting_record(
        &ctx.accounts.vesting_record.to_account_info(),
        &ctx.accounts.config,
        ctx.accounts.pool_state.key(),
        ctx.accounts.reproduction_authority.key(),
    )?;

    let migration_deadline = now.checked_add(ctx.accounts.config.candidate_migration_window as i64).ok_or(StolonsError::ArithmeticError)?;
    let child = &mut ctx.accounts.child_lineage;
    child.mint = ctx.accounts.child_mint.key();
    child.root_mint = ctx.accounts.parent.root_mint;
    child.parent_mint = ctx.accounts.parent_mint.key();
    child.creator = ctx.accounts.launcher.key();
    child.generation = ctx.accounts.parent.generation.checked_add(1).ok_or(StolonsError::ArithmeticError)?;
    child.status = LineageStatus::CandidateLaunched;
    child.genesis_supply = GENESIS_SUPPLY;
    child.self_root_mass = 0;
    child.direct_children_count = 0;
    child.active_candidate = Pubkey::default();
    child.active_epoch = Pubkey::default();
    child.launch_pool = ctx.accounts.pool_state.key();
    child.cpmm_pool = Pubkey::default();
    child.reproduction_reserve_claimed = false;
    child.created_at = now;
    child.activated_at = 0;
    child.next_epoch_id = 0;
    child.bump = ctx.bumps.child_lineage;

    ctx.accounts.candidate.status = CandidateStatus::Launched;
    ctx.accounts.candidate.launched_at = now;
    ctx.accounts.candidate.migration_deadline = migration_deadline;
    ctx.accounts.candidate.launch_pool = ctx.accounts.pool_state.key();
    emit!(CandidateLaunched {
        parent_mint: ctx.accounts.parent_mint.key(),
        child_mint: ctx.accounts.child_mint.key(),
        creator: ctx.accounts.launcher.key(),
        launch_pool: ctx.accounts.pool_state.key(),
        migration_deadline,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExpireCandidate<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, parent_mint.key().as_ref()], bump = parent.bump, constraint = parent.mint == parent_mint.key())]
    pub parent: Account<'info, Lineage>,
    #[account(address = parent.mint)]
    pub parent_mint: Account<'info, Mint>,
    #[account(mut, seeds = [CANDIDATE_SEED, candidate.child_mint.as_ref()], bump = candidate.bump)]
    pub candidate: Account<'info, Candidate>,
    /// CHECK: when the candidate launched, this must be the recorded LaunchLab PoolState.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: pass the child lineage PDA if a launch occurred; a system account for a selected-but-unlaunched candidate.
    #[account(mut)]
    pub child_lineage: UncheckedAccount<'info>,
}

pub fn expire_candidate(ctx: Context<ExpireCandidate>) -> Result<()> {
    require!(ctx.accounts.parent.active_candidate == ctx.accounts.candidate.child_mint, StolonsError::InvalidLifecycleState);
    match ctx.accounts.candidate.status {
        CandidateStatus::Selected => {
            require!(Clock::get()?.unix_timestamp > ctx.accounts.candidate.launch_deadline, StolonsError::DeadlinePassed);
            ctx.accounts.candidate.status = CandidateStatus::Expired;
            emit!(CandidateExpired { parent_mint: ctx.accounts.parent_mint.key(), child_mint: ctx.accounts.candidate.child_mint, orphaned_after_launch: false });
        }
        CandidateStatus::Launched => {
            require!(Clock::get()?.unix_timestamp > ctx.accounts.candidate.migration_deadline, StolonsError::DeadlinePassed);
            require_keys_eq!(ctx.accounts.candidate.launch_pool, ctx.accounts.pool_state.key(), StolonsError::InvalidLaunchPool);
            let pool = read_launch_pool(&ctx.accounts.pool_state.to_account_info(), &ctx.accounts.config)?;
            require!(pool.status <= 2, StolonsError::InvalidLifecycleState);
            validate_stolons_launch(
                ctx.accounts.pool_state.key(),
                &pool,
                &ctx.accounts.config,
                ctx.accounts.candidate.child_mint,
                pool.status,
            )?;
            // A migration completed within the window stays eligible even when
            // its permissionless recorder is called after that window.
            require!(
                !(pool.status == 2
                    && pool.vesting_start_time > 0
                    && pool.vesting_start_time <= ctx.accounts.candidate.migration_deadline.max(0) as u64),
                StolonsError::DeadlinePassed
            );
            let (expected, _) = Pubkey::find_program_address(
                &[LINEAGE_SEED, ctx.accounts.candidate.child_mint.as_ref()],
                ctx.program_id,
            );
            require_keys_eq!(ctx.accounts.child_lineage.key(), expected, StolonsError::InvalidPda);
            require_keys_eq!(*ctx.accounts.child_lineage.owner, *ctx.program_id, StolonsError::InvalidLifecycleState);
            let mut data = ctx.accounts.child_lineage.try_borrow_mut_data()?;
            let mut input: &[u8] = &data[..];
            let mut lineage: Lineage = Lineage::try_deserialize(&mut input)?;
            require!(lineage.status == LineageStatus::CandidateLaunched, StolonsError::InvalidLifecycleState);
            require_keys_eq!(lineage.mint, ctx.accounts.candidate.child_mint, StolonsError::InvalidLifecycleState);
            require_keys_eq!(lineage.parent_mint, ctx.accounts.parent_mint.key(), StolonsError::InvalidLifecycleState);
            lineage.status = LineageStatus::Orphan;
            let mut output: &mut [u8] = &mut data[..];
            lineage.try_serialize(&mut output)?;
            ctx.accounts.candidate.status = CandidateStatus::Orphan;
            emit!(CandidateExpired { parent_mint: ctx.accounts.parent_mint.key(), child_mint: ctx.accounts.candidate.child_mint, orphaned_after_launch: true });
        }
        _ => return err!(StolonsError::InvalidLifecycleState),
    }
    ctx.accounts.parent.active_candidate = Pubkey::default();
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterCandidateMigration<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [LINEAGE_SEED, parent_mint.key().as_ref()], bump = parent.bump, constraint = parent.mint == parent_mint.key())]
    pub parent: Account<'info, Lineage>,
    #[account(address = parent.mint)]
    pub parent_mint: Account<'info, Mint>,
    #[account(mut, seeds = [CANDIDATE_SEED, child_mint.key().as_ref()], bump = candidate.bump)]
    pub candidate: Account<'info, Candidate>,
    #[account(mut, seeds = [LINEAGE_SEED, child_mint.key().as_ref()], bump = child_lineage.bump, constraint = child_lineage.mint == child_mint.key())]
    pub child_lineage: Account<'info, Lineage>,
    #[account(address = candidate.child_mint)]
    pub child_mint: Account<'info, Mint>,
    /// CHECK: pinned LaunchLab pool layout.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: canonical CPMM pool state.
    pub cpmm_pool: UncheckedAccount<'info>,
    /// CHECK: configured LaunchLab executable.
    #[account(address = config.launchlab_program, executable)]
    pub launchlab_program: UncheckedAccount<'info>,
    /// CHECK: configured CPMM executable.
    #[account(address = config.cpmm_program, executable)]
    pub cpmm_program: UncheckedAccount<'info>,
}

pub fn register_candidate_migration(ctx: Context<RegisterCandidateMigration>) -> Result<()> {
    require!(ctx.accounts.candidate.status == CandidateStatus::Launched, StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.parent_mint, ctx.accounts.parent_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.child_mint, ctx.accounts.child_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.parent.active_candidate, ctx.accounts.child_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.launch_pool, ctx.accounts.pool_state.key(), StolonsError::InvalidLaunchPool);
    require_keys_eq!(ctx.accounts.child_lineage.launch_pool, ctx.accounts.pool_state.key(), StolonsError::InvalidLaunchPool);
    let pool = read_launch_pool(&ctx.accounts.pool_state.to_account_info(), &ctx.accounts.config)?;
    validate_stolons_launch(ctx.accounts.pool_state.key(), &pool, &ctx.accounts.config, ctx.accounts.child_mint.key(), 2)?;
    require!(pool.vesting_start_time > 0, StolonsError::InvalidLaunchPool);
    require!(
        pool.vesting_start_time <= ctx.accounts.candidate.migration_deadline.max(0) as u64,
        StolonsError::DeadlinePassed
    );
    verify_cpmm_pool(
        &ctx.accounts.cpmm_pool.to_account_info(),
        &ctx.accounts.config,
        ctx.accounts.child_mint.key(),
        ctx.accounts.config.quote_mint,
    )?;
    ctx.accounts.candidate.status = CandidateStatus::Qualified;
    ctx.accounts.candidate.cpmm_pool = ctx.accounts.cpmm_pool.key();
    ctx.accounts.candidate.qualified_at = Clock::get()?.unix_timestamp;
    ctx.accounts.child_lineage.status = LineageStatus::CandidateQualified;
    ctx.accounts.child_lineage.cpmm_pool = ctx.accounts.cpmm_pool.key();
    emit!(CandidateMigrated {
        parent_mint: ctx.accounts.parent_mint.key(),
        child_mint: ctx.accounts.child_mint.key(),
        launch_pool: ctx.accounts.pool_state.key(),
        cpmm_pool: ctx.accounts.cpmm_pool.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimCandidateReproductionReserve<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [CANDIDATE_SEED, mint.key().as_ref()], bump = candidate.bump)]
    pub candidate: Account<'info, Candidate>,
    #[account(mut, seeds = [LINEAGE_SEED, mint.key().as_ref()], bump = lineage.bump, has_one = mint)]
    pub lineage: Account<'info, Lineage>,
    pub mint: Account<'info, Mint>,
    /// CHECK: validated LaunchLab PoolState.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: must be LaunchLab's base vault.
    #[account(mut)]
    pub base_vault: UncheckedAccount<'info>,
    /// CHECK: LaunchLab vesting record.
    #[account(mut)]
    pub vesting_record: UncheckedAccount<'info>,
    /// CHECK: global program-owned reserve beneficiary.
    #[account(mut, seeds = [REPRODUCTION_AUTHORITY_SEED], bump)]
    pub reproduction_authority: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = reproduction_authority)]
    pub authority_ata: Account<'info, TokenAccount>,
    /// CHECK: per-mint reserve owner.
    #[account(seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [REPRODUCTION_VAULT_SEED, mint.key().as_ref()], bump, token::mint = mint, token::authority = vault_authority)]
    pub reproduction_vault: Account<'info, TokenAccount>,
    /// CHECK: canonical LaunchLab transfer authority.
    pub launchlab_authority: UncheckedAccount<'info>,
    /// CHECK: executable program.
    #[account(address = config.launchlab_program, executable)]
    pub launchlab_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn claim_candidate_reproduction_reserve(ctx: Context<ClaimCandidateReproductionReserve>) -> Result<()> {
    require!(ctx.accounts.candidate.status == CandidateStatus::Qualified, StolonsError::InvalidLifecycleState);
    require!(!ctx.accounts.candidate.reserve_claimed, StolonsError::AlreadySettled);
    require_keys_eq!(ctx.accounts.candidate.child_mint, ctx.accounts.mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.parent_mint, ctx.accounts.lineage.parent_mint, StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.lineage.status == LineageStatus::CandidateQualified, StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.launch_pool, ctx.accounts.pool_state.key(), StolonsError::InvalidLaunchPool);
    let pool = read_launch_pool(&ctx.accounts.pool_state.to_account_info(), &ctx.accounts.config)?;
    validate_stolons_launch(ctx.accounts.pool_state.key(), &pool, &ctx.accounts.config, ctx.accounts.mint.key(), 2)?;
    require_keys_eq!(ctx.accounts.base_vault.key(), pool.base_vault, StolonsError::InvalidLaunchPool);
    validate_vesting_record(
        &ctx.accounts.vesting_record.to_account_info(),
        &ctx.accounts.config,
        ctx.accounts.pool_state.key(),
        ctx.accounts.reproduction_authority.key(),
    )?;
    require_keys_eq!(
        ctx.accounts.launchlab_authority.key(),
        Pubkey::find_program_address(&[LAUNCHLAB_VAULT_AUTHORITY_SEED], &ctx.accounts.config.launchlab_program).0,
        StolonsError::InvalidPda
    );
    let before = ctx.accounts.authority_ata.amount;
    let reserve_before = ctx.accounts.reproduction_vault.amount;
    claim_vested(
        &ctx.accounts.launchlab_program.to_account_info(),
        &ctx.accounts.launchlab_authority.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.vesting_record.to_account_info(),
        &ctx.accounts.base_vault.to_account_info(),
        &ctx.accounts.authority_ata.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.reproduction_authority.to_account_info(),
        ctx.bumps.reproduction_authority,
    )?;
    ctx.accounts.authority_ata.reload()?;
    let claimed = ctx.accounts.authority_ata.amount.checked_sub(before).ok_or(StolonsError::ArithmeticError)?;
    require!(claimed == REPRODUCTION_RESERVE, StolonsError::InvalidVestingRecord);
    transfer_reserve(
        &ctx.accounts.token_program,
        &ctx.accounts.authority_ata,
        &ctx.accounts.reproduction_vault,
        &ctx.accounts.reproduction_authority,
        ctx.bumps.reproduction_authority,
        claimed,
    )?;
    ctx.accounts.reproduction_vault.reload()?;
    let reserve_delta = ctx.accounts.reproduction_vault.amount.checked_sub(reserve_before).ok_or(StolonsError::ArithmeticError)?;
    require!(reserve_delta == REPRODUCTION_RESERVE, StolonsError::InvalidVestingRecord);
    ctx.accounts.candidate.reserve_claimed = true;
    ctx.accounts.lineage.reproduction_reserve_claimed = true;
    emit!(ReproductionReserveClaimed { mint: ctx.accounts.mint.key(), amount: claimed });
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeChild<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, seeds = [FAMILY_SEED, parent.root_mint.as_ref()], bump = family.bump, has_one = root_mint)]
    pub family: Box<Account<'info, Family>>,
    #[account(address = parent.root_mint)]
    pub root_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [LINEAGE_SEED, parent_mint.key().as_ref()], bump = parent.bump, constraint = parent.mint == parent_mint.key())]
    pub parent: Box<Account<'info, Lineage>>,
    #[account(mut, address = parent.mint)]
    pub parent_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [CANDIDATE_SEED, child_mint.key().as_ref()], bump = candidate.bump)]
    pub candidate: Box<Account<'info, Candidate>>,
    #[account(mut, seeds = [LINEAGE_SEED, child_mint.key().as_ref()], bump = child.bump, constraint = child.mint == child_mint.key())]
    pub child: Box<Account<'info, Lineage>>,
    #[account(address = child.mint)]
    pub child_mint: Box<Account<'info, Mint>>,
    /// CHECK: PDA can sign only for the fixed reserve account.
    #[account(seeds = [VAULT_AUTHORITY_SEED, parent_mint.key().as_ref()], bump)]
    pub parent_vault_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [REPRODUCTION_VAULT_SEED, parent_mint.key().as_ref()], bump, token::mint = parent_mint, token::authority = parent_vault_authority)]
    pub parent_reproduction_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: child reserve authority used only for validation.
    #[account(seeds = [VAULT_AUTHORITY_SEED, child_mint.key().as_ref()], bump)]
    pub child_vault_authority: UncheckedAccount<'info>,
    #[account(seeds = [REPRODUCTION_VAULT_SEED, child_mint.key().as_ref()], bump, token::mint = child_mint, token::authority = child_vault_authority)]
    pub child_reproduction_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn finalize_child(ctx: Context<FinalizeChild>) -> Result<()> {
    require!(ctx.accounts.candidate.status == CandidateStatus::Qualified, StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.candidate.reserve_claimed, StolonsError::InvalidVestingRecord);
    require!(!ctx.accounts.candidate.settled, StolonsError::AlreadySettled);
    require_keys_eq!(ctx.accounts.candidate.parent_mint, ctx.accounts.parent_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.candidate.child_mint, ctx.accounts.child_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.parent.active_candidate, ctx.accounts.child_mint.key(), StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.parent.active_epoch, Pubkey::default(), StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.parent.status == LineageStatus::RootActive || ctx.accounts.parent.status == LineageStatus::DescendantActive, StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.parent.direct_children_count < MAX_DIRECT_CHILDREN, StolonsError::ChildLimitReached);
    require!(ctx.accounts.parent_reproduction_vault.amount >= CHILD_BURN_ATOMS, StolonsError::InsufficientReproductionReserve);
    require!(ctx.accounts.child_reproduction_vault.amount >= REPRODUCTION_RESERVE, StolonsError::InvalidVestingRecord);
    require!(ctx.accounts.parent_mint.supply > CHILD_BURN_ATOMS, StolonsError::InsufficientReproductionReserve);
    require!(ctx.accounts.child.status == LineageStatus::CandidateQualified, StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.child.reproduction_reserve_claimed, StolonsError::InvalidVestingRecord);
    require!(ctx.accounts.child.self_root_mass == 0, StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.child.root_mint, ctx.accounts.parent.root_mint, StolonsError::InvalidLifecycleState);
    require_keys_eq!(ctx.accounts.child.parent_mint, ctx.accounts.parent_mint.key(), StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.child.generation == ctx.accounts.parent.generation.checked_add(1).ok_or(StolonsError::ArithmeticError)?, StolonsError::InvalidLifecycleState);
    require!(ctx.accounts.family.genesis_root_mass == GENESIS_SUPPLY as u128, StolonsError::InvalidLifecycleState);

    let moved = root_mass_transfer(
        ctx.accounts.parent.self_root_mass,
        CHILD_BURN_ATOMS,
        ctx.accounts.parent_mint.supply,
    )?;
    let (parent_mass, child_mass) = validate_family_move(ctx.accounts.parent.self_root_mass, 0, moved)?;
    let bump = [ctx.bumps.parent_vault_authority];
    let parent_mint_key = ctx.accounts.parent_mint.key();
    let seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, parent_mint_key.as_ref(), &bump];
    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.parent_mint.to_account_info(),
                from: ctx.accounts.parent_reproduction_vault.to_account_info(),
                authority: ctx.accounts.parent_vault_authority.to_account_info(),
            },
            &[seeds],
        ),
        CHILD_BURN_ATOMS,
    )?;
    ctx.accounts.parent_mint.reload()?;
    ctx.accounts.parent_reproduction_vault.reload()?;
    ctx.accounts.parent.self_root_mass = parent_mass;
    ctx.accounts.parent.direct_children_count = ctx.accounts.parent.direct_children_count.checked_add(1).ok_or(StolonsError::ArithmeticError)?;
    ctx.accounts.parent.active_candidate = Pubkey::default();
    ctx.accounts.child.self_root_mass = child_mass;
    ctx.accounts.child.status = LineageStatus::DescendantActive;
    ctx.accounts.child.activated_at = Clock::get()?.unix_timestamp;
    ctx.accounts.candidate.status = CandidateStatus::Settled;
    ctx.accounts.candidate.settled = true;
    ctx.accounts.family.descendant_count = ctx.accounts.family.descendant_count.checked_add(1).ok_or(StolonsError::ArithmeticError)?;
    emit!(ChildActivated {
        parent_mint: ctx.accounts.parent_mint.key(),
        child_mint: ctx.accounts.child_mint.key(),
        generation: ctx.accounts.child.generation,
        root_mass: moved,
    });
    emit!(ParentSupplyMutated {
        parent_mint: ctx.accounts.parent_mint.key(),
        child_mint: ctx.accounts.child_mint.key(),
        parent_tokens_burned: CHILD_BURN_ATOMS,
        root_mass_transferred: moved,
        parent_supply_after: ctx.accounts.parent_mint.supply,
        generation: ctx.accounts.child.generation,
    });
    Ok(())
}

fn create_platform_vesting<'info>(
    launchlab_program: &AccountInfo<'info>,
    platform_config: &AccountInfo<'info>,
    pool_state: &AccountInfo<'info>,
    vesting_record: &AccountInfo<'info>,
    beneficiary: &AccountInfo<'info>,
    rent_payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    bump: u8,
) -> Result<()> {
    require_keys_eq!(*beneficiary.owner, System::id(), StolonsError::InvalidPda);
    require!(beneficiary.data_is_empty(), StolonsError::InvalidPda);

    // Raydium makes the signed platform vesting wallet pay for the new record.
    // Top up only the rent-exempt shortfall; the launch signer funds that PDA.
    let rent_minimum = Rent::get()?.minimum_balance(LAUNCHLAB_VESTING_RECORD_SPACE);
    let shortfall = rent_minimum.saturating_sub(beneficiary.lamports());
    if shortfall > 0 {
        invoke(
            &system_instruction::transfer(rent_payer.key, beneficiary.key, shortfall),
            &[rent_payer.clone(), beneficiary.clone(), system_program.clone()],
        )?;
    }

    // CreatePlatformVestingAccount takes the allocation amount as a Borsh u64.
    let mut data = anchor_ix_discriminator(b"global:create_platform_vesting_account").to_vec();
    data.extend_from_slice(&REPRODUCTION_RESERVE.to_le_bytes());
    let ix = Instruction {
        program_id: *launchlab_program.key,
        accounts: vec![
            AccountMeta::new(*beneficiary.key, true),
            AccountMeta::new(*beneficiary.key, false),
            AccountMeta::new_readonly(*platform_config.key, false),
            AccountMeta::new(*pool_state.key, false),
            AccountMeta::new(*vesting_record.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data,
    };
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[REPRODUCTION_AUTHORITY_SEED, &bump_seed];
    invoke_signed(
        &ix,
        &[
            beneficiary.clone(),
            beneficiary.clone(),
            platform_config.clone(),
            pool_state.clone(),
            vesting_record.clone(),
            system_program.clone(),
            launchlab_program.clone(),
        ],
        &[seeds],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn claim_vested<'info>(
    launchlab_program: &AccountInfo<'info>,
    launchlab_authority: &AccountInfo<'info>,
    pool_state: &AccountInfo<'info>,
    vesting_record: &AccountInfo<'info>,
    base_vault: &AccountInfo<'info>,
    user_base_token: &AccountInfo<'info>,
    base_mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    beneficiary: &AccountInfo<'info>,
    bump: u8,
) -> Result<()> {
    let authority = Pubkey::find_program_address(&[LAUNCHLAB_VAULT_AUTHORITY_SEED], launchlab_program.key).0;
    require_keys_eq!(authority, *launchlab_authority.key, StolonsError::InvalidPda);
    let data = anchor_ix_discriminator(b"global:claim_vested_token").to_vec();
    let ix = Instruction {
        program_id: *launchlab_program.key,
        accounts: vec![
            AccountMeta::new(*beneficiary.key, true),
            AccountMeta::new_readonly(*launchlab_authority.key, false),
            AccountMeta::new(*pool_state.key, false),
            AccountMeta::new(*vesting_record.key, false),
            AccountMeta::new(*base_vault.key, false),
            AccountMeta::new(*user_base_token.key, false),
            AccountMeta::new_readonly(*base_mint.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
            AccountMeta::new_readonly(*associated_token_program.key, false),
        ],
        data,
    };
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[REPRODUCTION_AUTHORITY_SEED, &bump_seed];
    invoke_signed(
        &ix,
        &[
            beneficiary.clone(),
            launchlab_authority.clone(),
            pool_state.clone(),
            vesting_record.clone(),
            base_vault.clone(),
            user_base_token.clone(),
            base_mint.clone(),
            token_program.clone(),
            system_program.clone(),
            associated_token_program.clone(),
            launchlab_program.clone(),
        ],
        &[seeds],
    )?;
    Ok(())
}

fn transfer_reserve<'info>(
    token_program: &Program<'info, Token>,
    source: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    authority: &UncheckedAccount<'info>,
    bump: u8,
    amount: u64,
) -> Result<()> {
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[REPRODUCTION_AUTHORITY_SEED, &bump_seed];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: source.to_account_info(),
                to: destination.to_account_info(),
                authority: authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

fn check_fixed_mint(mint: &Account<Mint>) -> Result<()> {
    require!(mint.decimals == TOKEN_DECIMALS, StolonsError::InvalidMint);
    require!(mint.supply == GENESIS_SUPPLY, StolonsError::InvalidMint);
    require!(mint.mint_authority.is_none(), StolonsError::InvalidMint);
    require!(mint.freeze_authority.is_none(), StolonsError::InvalidMint);
    Ok(())
}

fn reproduction_authority_address() -> Result<(Pubkey, u8)> {
    Ok(Pubkey::find_program_address(&[REPRODUCTION_AUTHORITY_SEED], &crate::ID))
}

