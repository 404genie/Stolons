import type { PublicKey } from "@solana/web3.js";

export type U64 = bigint;
export type U128 = bigint;

export enum LineageStatus {
  RootPending = "RootPending",
  RootQualified = "RootQualified",
  RootActive = "RootActive",
  CandidateLaunched = "CandidateLaunched",
  CandidateQualified = "CandidateQualified",
  DescendantActive = "DescendantActive",
  Orphan = "Orphan"
}

export enum EpochStatus {
  Open = "Open",
  Finalized = "Finalized",
  NoWinner = "NoWinner"
}

export enum CandidateStatus {
  Proposed = "Proposed",
  Selected = "Selected",
  Launched = "Launched",
  Qualified = "Qualified",
  Expired = "Expired",
  Settled = "Settled",
  Orphan = "Orphan"
}

export interface LineageAccount {
  mint: PublicKey;
  rootMint: PublicKey;
  parentMint: PublicKey;
  creator: PublicKey;
  generation: number;
  status: LineageStatus;
  genesisSupply: U64;
  selfRootMass: U128;
  directChildrenCount: number;
  activeCandidate: PublicKey;
  activeEpoch: PublicKey;
  launchPool: PublicKey;
  cpmmPool: PublicKey;
  reproductionReserveClaimed: boolean;
  createdAt: bigint;
  activatedAt: bigint;
  nextEpochId: U64;
  bump: number;
}

export interface InitializeConfigArgs {
  treasury: PublicKey;
  launchlabProgram: PublicKey;
  cpmmProgram: PublicKey;
  launchlabConfig: PublicKey;
  platformConfig: PublicKey;
  quoteMint: PublicKey;
  cpmmConfig: PublicKey;
  proposalWindow: U64;
  votingWindow: U64;
  candidateLaunchWindow: U64;
  candidateMigrationWindow: U64;
  proposalFeeLamports: U64;
}

export interface SubmitProposalArgs {
  proposalId: number;
  childMint: PublicKey;
  name: string;
  symbol: string;
  metadataUri: string;
  metadataHash: Uint8Array;
}

export interface ProposedChild {
  childMint: PublicKey;
  name: string;
  symbol: string;
  metadataUri: string;
  metadataHash: Uint8Array;
}
