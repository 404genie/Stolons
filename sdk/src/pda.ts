import { PublicKey } from "@solana/web3.js";
import { SEEDS } from "./constants.js";

const seed = (value: string) => new TextEncoder().encode(value);

export function u64Seed(value: bigint): Uint8Array {
  if (value < 0n || value > (1n << 64n) - 1n) throw new RangeError("epoch id is outside u64");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

export interface StolonsPdas {
  config: PublicKey;
  family: PublicKey;
  lineage: PublicKey;
  reproductionAuthority: PublicKey;
  reproductionVault: PublicKey;
  vaultAuthority: PublicKey;
  candidate: PublicKey;
  proposedMint: PublicKey;
  epoch: PublicKey;
  vote: PublicKey;
  voteAuthority: PublicKey;
  voteEscrow: PublicKey;
  proposal: PublicKey;
}

export const findPda = (programId: PublicKey, ...seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export function deriveConfigPda(programId: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.config));
}

export function deriveFamilyPda(programId: PublicKey, rootMint: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.family), rootMint.toBytes());
}

export function deriveLineagePda(programId: PublicKey, mint: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.lineage), mint.toBytes());
}

export function deriveReproductionAuthorityPda(programId: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.reproductionAuthority));
}

export function deriveVaultAuthorityPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.vaultAuthority), mint.toBytes());
}

export function deriveReproductionVaultPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.reproductionVault), mint.toBytes());
}

export function deriveCandidatePda(programId: PublicKey, childMint: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.candidate), childMint.toBytes());
}

export function deriveProposedMintPda(programId: PublicKey, childMint: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.proposedMint), childMint.toBytes());
}

export function deriveEpochPda(programId: PublicKey, parentMint: PublicKey, epochId: bigint): PublicKey {
  return findPda(programId, seed(SEEDS.epoch), parentMint.toBytes(), u64Seed(epochId));
}

export function deriveVotePda(programId: PublicKey, epoch: PublicKey, voter: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.vote), epoch.toBytes(), voter.toBytes());
}

export function deriveVoteAuthorityPda(programId: PublicKey, epoch: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.voteAuthority), epoch.toBytes());
}

export function deriveVoteEscrowPda(programId: PublicKey, epoch: PublicKey): PublicKey {
  return findPda(programId, seed(SEEDS.voteEscrow), epoch.toBytes());
}

export function deriveProposalPda(programId: PublicKey, epoch: PublicKey, proposalId: number): PublicKey {
  if (!Number.isInteger(proposalId) || proposalId < 0 || proposalId > 255) throw new RangeError("proposal id is outside u8");
  return findPda(programId, seed(SEEDS.proposal), epoch.toBytes(), new Uint8Array([proposalId]));
}

export function deriveTokenAccounts(programId: PublicKey, mint: PublicKey): Pick<StolonsPdas, "lineage" | "reproductionVault" | "vaultAuthority"> {
  return {
    lineage: deriveLineagePda(programId, mint),
    reproductionVault: deriveReproductionVaultPda(programId, mint),
    vaultAuthority: deriveVaultAuthorityPda(programId, mint)
  };
}
