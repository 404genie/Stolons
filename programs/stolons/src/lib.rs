use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod raydium;
pub mod state;

use instructions::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod stolons {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
        instructions::initialize_config(ctx, args)
    }
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused(ctx, paused)
    }
    pub fn register_root_launch(ctx: Context<RegisterRootLaunch>) -> Result<()> {
        instructions::register_root_launch(ctx)
    }
    pub fn register_root_migration(ctx: Context<RegisterRootMigration>) -> Result<()> {
        instructions::register_root_migration(ctx)
    }
    pub fn claim_root_reproduction_reserve(ctx: Context<ClaimRootReproductionReserve>) -> Result<()> {
        instructions::claim_root_reproduction_reserve(ctx)
    }
    pub fn activate_root(ctx: Context<ActivateRoot>) -> Result<()> {
        instructions::activate_root(ctx)
    }
    pub fn open_epoch(ctx: Context<OpenEpoch>, epoch_id: u64) -> Result<()> {
        instructions::open_epoch(ctx, epoch_id)
    }
    pub fn submit_proposal(ctx: Context<SubmitProposal>, args: SubmitProposalArgs) -> Result<()> {
        instructions::submit_proposal(ctx, args)
    }
    pub fn cast_vote(ctx: Context<CastVote>, amount: u64) -> Result<()> {
        instructions::cast_vote(ctx, amount)
    }
    pub fn finalize_epoch(ctx: Context<FinalizeEpoch>) -> Result<()> {
        instructions::finalize_epoch(ctx)
    }
    pub fn finalize_empty_epoch(ctx: Context<FinalizeEmptyEpoch>) -> Result<()> {
        instructions::finalize_empty_epoch(ctx)
    }
    pub fn withdraw_vote(ctx: Context<WithdrawVote>) -> Result<()> {
        instructions::withdraw_vote(ctx)
    }
    pub fn register_candidate_launch(ctx: Context<RegisterCandidateLaunch>) -> Result<()> {
        instructions::register_candidate_launch(ctx)
    }
    pub fn expire_candidate(ctx: Context<ExpireCandidate>) -> Result<()> {
        instructions::expire_candidate(ctx)
    }
    pub fn register_candidate_migration(ctx: Context<RegisterCandidateMigration>) -> Result<()> {
        instructions::register_candidate_migration(ctx)
    }
    pub fn claim_candidate_reproduction_reserve(ctx: Context<ClaimCandidateReproductionReserve>) -> Result<()> {
        instructions::claim_candidate_reproduction_reserve(ctx)
    }
    pub fn finalize_child(ctx: Context<FinalizeChild>) -> Result<()> {
        instructions::finalize_child(ctx)
    }
}

