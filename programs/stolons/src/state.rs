use anchor_lang::prelude::*;

#[account]
pub struct GlobalConfig {
    pub authority: Pubkey,
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
    pub paused: bool,
    pub version: u8,
    pub bump: u8,
}
impl GlobalConfig { pub const SPACE: usize = 8 + 8 * 32 + 5 * 8 + 3; }

#[account]
pub struct Family {
    pub root_mint: Pubkey,
    pub genesis_root_mass: u128,
    pub descendant_count: u64,
    pub created_at: i64,
    pub bump: u8,
}
impl Family { pub const SPACE: usize = 8 + 32 + 16 + 8 + 8 + 1; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum LineageStatus { RootPending, RootQualified, RootActive, CandidateLaunched, CandidateQualified, DescendantActive, Orphan }

#[account]
pub struct Lineage {
    pub mint: Pubkey,
    pub root_mint: Pubkey,
    pub parent_mint: Pubkey,
    pub creator: Pubkey,
    pub generation: u8,
    pub status: LineageStatus,
    pub genesis_supply: u64,
    pub self_root_mass: u128,
    pub direct_children_count: u8,
    pub active_candidate: Pubkey,
    pub active_epoch: Pubkey,
    pub launch_pool: Pubkey,
    pub cpmm_pool: Pubkey,
    pub reproduction_reserve_claimed: bool,
    pub created_at: i64,
    pub activated_at: i64,
    pub next_epoch_id: u64,
    pub bump: u8,
}
impl Lineage { pub const SPACE: usize = 8 + 8 * 32 + 1 + 1 + 8 + 16 + 1 + 1 + 8 + 8 + 8 + 1; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EpochStatus { Open, Finalized, NoWinner }

#[account]
pub struct Epoch {
    pub parent_mint: Pubkey,
    pub epoch_id: u64,
    pub proposal_start: i64,
    pub proposal_end: i64,
    pub vote_start: i64,
    pub vote_end: i64,
    pub proposal_count: u8,
    pub highest_support: u64,
    pub winning_proposal_id: u8,
    pub status: EpochStatus,
    pub bump: u8,
}
impl Epoch { pub const SPACE: usize = 8 + 32 + 8 + 8 * 4 + 1 + 8 + 1 + 1 + 1; }

#[account]
pub struct Proposal {
    pub epoch: Pubkey,
    pub proposer: Pubkey,
    pub child_mint: Pubkey,
    pub proposal_id: u8,
    pub support_amount: u64,
    pub name: String,
    pub symbol: String,
    pub metadata_uri: String,
    pub metadata_hash: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}
impl Proposal { pub const SPACE: usize = 8 + 32 * 3 + 1 + 8 + 4 + 32 + 4 + 10 + 4 + 200 + 32 + 8 + 1; }

#[account]
pub struct ProposedMint {
    pub child_mint: Pubkey,
    pub epoch: Pubkey,
    pub proposal_id: u8,
    pub bump: u8,
}
impl ProposedMint { pub const SPACE: usize = 8 + 32 + 32 + 1 + 1; }

#[account]
pub struct VoteReceipt {
    pub voter: Pubkey,
    pub epoch: Pubkey,
    pub proposal: Pubkey,
    pub amount: u64,
    pub withdrawn: bool,
    pub bump: u8,
}
impl VoteReceipt { pub const SPACE: usize = 8 + 32 * 3 + 8 + 1 + 1; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CandidateStatus { Proposed, Selected, Launched, Qualified, Expired, Settled, Orphan }

#[account]
pub struct Candidate {
    pub parent_mint: Pubkey,
    pub child_mint: Pubkey,
    pub epoch: Pubkey,
    pub proposal: Pubkey,
    pub proposer: Pubkey,
    pub status: CandidateStatus,
    pub selected_at: i64,
    pub launch_deadline: i64,
    pub launched_at: i64,
    pub migration_deadline: i64,
    pub qualified_at: i64,
    pub launch_pool: Pubkey,
    pub cpmm_pool: Pubkey,
    pub reserve_claimed: bool,
    pub settled: bool,
    pub bump: u8,
}
impl Candidate { pub const SPACE: usize = 8 + 7 * 32 + 1 + 8 * 5 + 1 + 1 + 1; }

