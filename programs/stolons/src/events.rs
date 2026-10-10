use anchor_lang::prelude::*;

#[event]
pub struct RootRegistered { pub mint: Pubkey, pub creator: Pubkey, pub family: Pubkey }
#[event]
pub struct RootMigrated { pub mint: Pubkey, pub launch_pool: Pubkey, pub cpmm_pool: Pubkey }
#[event]
pub struct RootActivated { pub mint: Pubkey }
#[event]
pub struct EpochOpened { pub parent_mint: Pubkey, pub epoch: Pubkey, pub epoch_id: u64, pub proposal_end: i64, pub vote_end: i64 }
#[event]
pub struct EpochClosedNoWinner { pub parent_mint: Pubkey, pub epoch_id: u64 }
#[event]
pub struct ProposalSubmitted { pub epoch: Pubkey, pub proposal: Pubkey, pub child_mint: Pubkey, pub proposal_id: u8 }
#[event]
pub struct VoteCast { pub epoch: Pubkey, pub voter: Pubkey, pub proposal: Pubkey, pub amount: u64 }
#[event]
pub struct EpochFinalized { pub parent_mint: Pubkey, pub epoch_id: u64, pub proposal: Pubkey, pub child_mint: Pubkey, pub support: u64 }
#[event]
pub struct CandidateSelected { pub parent_mint: Pubkey, pub child_mint: Pubkey, pub launch_deadline: i64 }
#[event]
pub struct CandidateLaunched { pub parent_mint: Pubkey, pub child_mint: Pubkey, pub creator: Pubkey, pub launch_pool: Pubkey, pub migration_deadline: i64 }
#[event]
pub struct CandidateExpired { pub parent_mint: Pubkey, pub child_mint: Pubkey, pub orphaned_after_launch: bool }
#[event]
pub struct CandidateMigrated { pub parent_mint: Pubkey, pub child_mint: Pubkey, pub launch_pool: Pubkey, pub cpmm_pool: Pubkey }
#[event]
pub struct ReproductionReserveClaimed { pub mint: Pubkey, pub amount: u64 }
#[event]
pub struct ChildActivated { pub parent_mint: Pubkey, pub child_mint: Pubkey, pub generation: u8, pub root_mass: u128 }
#[event]
pub struct ParentSupplyMutated { pub parent_mint: Pubkey, pub child_mint: Pubkey, pub parent_tokens_burned: u64, pub root_mass_transferred: u128, pub parent_supply_after: u64, pub generation: u8 }

