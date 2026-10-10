use anchor_lang::prelude::*;

#[error_code]
pub enum StolonsError {
    #[msg("The configured protocol is paused for this action")]
    Paused,
    #[msg("Invalid or unsupported configuration value")]
    InvalidConfiguration,
    #[msg("The Raydium account has the wrong owner, discriminator, or layout")]
    InvalidRaydiumAccount,
    #[msg("The LaunchLab pool does not match the selected mint and protocol configuration")]
    InvalidLaunchPool,
    #[msg("The CPMM pool is not the canonical migrated pool for this launch")]
    InvalidCpmmPool,
    #[msg("The launch is not in the required state")]
    InvalidLifecycleState,
    #[msg("The token mint must be standard SPL Token with fixed supply and no authorities")]
    InvalidMint,
    #[msg("The Raydium InitializeV2 instruction must precede registration in this transaction")]
    MissingInitializeProof,
    #[msg("The reproduction vesting record is missing or has the wrong beneficiary or amount")]
    InvalidVestingRecord,
    #[msg("The launch allocation does not equal the required 85/15 supply split")]
    InvalidAllocation,
    #[msg("The proposal or voting phase is not open")]
    InvalidEpochPhase,
    #[msg("This wallet already voted in this epoch")]
    AlreadyVoted,
    #[msg("The proposal limit has been reached")]
    ProposalLimitReached,
    #[msg("A winner requires positive token support")]
    NoWinningSupport,
    #[msg("The supplied proposal is not the recorded winner")]
    WrongWinner,
    #[msg("Candidate deadline has passed")]
    DeadlinePassed,
    #[msg("The reproduction reserve does not cover this mutation")]
    InsufficientReproductionReserve,
    #[msg("Arithmetic overflow or underflow")]
    ArithmeticError,
    #[msg("The calculated ancestry transfer is zero atoms")]
    ZeroMassTransfer,
    #[msg("A token has reached its direct-child limit")]
    ChildLimitReached,
    #[msg("The requested settlement has already happened")]
    AlreadySettled,
    #[msg("Voting tokens are not yet available to withdraw")]
    VoteStillLocked,
    #[msg("The proposal text exceeds its on-chain size limit")]
    InvalidProposalText,
    #[msg("The proposed mint is already reserved")]
    MintAlreadyProposed,
    #[msg("The source token account does not belong to the voter or expected mint")]
    InvalidVoteTokenAccount,
    #[msg("The account does not match its expected program-derived address")]
    InvalidPda,
}

