import { PublicKey } from "@solana/web3.js";

export const TOKEN_DECIMALS = 6;
export const GENESIS_SUPPLY = 1_000_000_000_000_000n;
export const MARKET_ALLOCATION = 850_000_000_000_000n;
export const REPRODUCTION_RESERVE = 150_000_000_000_000n;
export const CHILD_BURN_ATOMS = 10_000_000_000_000n;
export const MAX_DIRECT_CHILDREN = 15;
export const MAX_PROPOSALS = 32;
export const PROPOSAL_WINDOW_SECONDS = 86_400n;
export const VOTING_WINDOW_SECONDS = 86_400n;
export const CANDIDATE_LAUNCH_WINDOW_SECONDS = 86_400n;
export const CANDIDATE_MIGRATION_WINDOW_SECONDS = 7n * 86_400n;
export const LAMPORTS_PER_PROPOSAL = 10_000_000n;

export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const INSTRUCTIONS_SYSVAR_ID = new PublicKey("Sysvar1nstructions1111111111111111111111111");

export const SEEDS = {
  config: "config",
  family: "family",
  lineage: "lineage",
  epoch: "epoch",
  proposal: "proposal",
  vote: "vote",
  voteAuthority: "vote_authority",
  voteEscrow: "vote_escrow",
  candidate: "candidate",
  proposedMint: "proposed_mint",
  vaultAuthority: "vault_authority",
  reproductionVault: "reproduction",
  reproductionAuthority: "reproduction_authority",
  launchlabPool: "pool",
  cpmmPool: "pool",
  launchlabVesting: "pool_vesting",
  launchlabVaultAuthority: "vault_auth_seed"
} as const;
