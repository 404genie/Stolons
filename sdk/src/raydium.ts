import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { SEEDS, GENESIS_SUPPLY, REPRODUCTION_RESERVE } from "./constants.js";

const encoder = new TextEncoder();
const discriminator = (name: string) => {
  const table: Record<string, readonly number[]> = {
    initialize_v2: [67, 153, 175, 39, 218, 16, 38, 32]
  };
  const value = table[name];
  if (!value) throw new Error(`no pinned Raydium discriminator for ${name}`);
  return new Uint8Array(value);
};

export function deriveLaunchLabPool(programId: PublicKey, baseMint: PublicKey, quoteMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([encoder.encode(SEEDS.launchlabPool), baseMint.toBytes(), quoteMint.toBytes()], programId)[0];
}

export function deriveCpmmPool(
  cpmmProgramId: PublicKey,
  cpmmConfig: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey
): PublicKey {
  const [token0, token1] = compareKeys(mintA, mintB) < 0 ? [mintA, mintB] : [mintB, mintA];
  return PublicKey.findProgramAddressSync(
    [encoder.encode(SEEDS.cpmmPool), cpmmConfig.toBytes(), token0.toBytes(), token1.toBytes()],
    cpmmProgramId
  )[0];
}

function compareKeys(a: PublicKey, b: PublicKey): number {
  const left = a.toBytes(); const right = b.toBytes();
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}

export interface LaunchProofAccounts {
  platformConfig: PublicKey;
  poolState: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
}

/**
 * Puts Stolons registration directly after Raydium's InitializeV2 call.
 * The program rejects registration when the Raydium call is absent or in a
 * different transaction. The SDK version and account positions are pinned in
 * docs/RAYDIUM.md and must be rechecked before upgrading this package.
 */
export function appendAfterInitializeV2(
  instructions: readonly TransactionInstruction[],
  launchpadProgram: PublicKey,
  proof: LaunchProofAccounts,
  registration: TransactionInstruction
): TransactionInstruction[] {
  const expectedDiscriminator = discriminator("initialize_v2");
  const indexes = instructions.flatMap((instruction, index) => {
    if (!instruction.programId.equals(launchpadProgram)) return [];
    if (!instruction.data.subarray(0, 8).equals(Buffer.from(expectedDiscriminator))) return [];
    return [index];
  });
  if (indexes.length !== 1) throw new Error(`expected one Raydium InitializeV2 instruction, found ${indexes.length}`);
  const index = indexes[0]!;
  const init = instructions[index]!;
  const accountAt = (position: number) => init.keys[position]?.pubkey;
  if (!accountAt(3)?.equals(proof.platformConfig)) throw new Error("InitializeV2 platform config does not match Stolons config");
  if (!accountAt(5)?.equals(proof.poolState)) throw new Error("InitializeV2 pool PDA does not match registration");
  if (!accountAt(6)?.equals(proof.baseMint)) throw new Error("InitializeV2 base mint does not match registration");
  if (!accountAt(7)?.equals(proof.quoteMint)) throw new Error("InitializeV2 quote mint does not match registration");
  return [...instructions.slice(0, index + 1), registration, ...instructions.slice(index + 1)];
}

export function assertStolonsLaunchAllocation(supply: bigint, lockedAmount: bigint, cliffPeriod: bigint, unlockPeriod: bigint): void {
  if (supply !== GENESIS_SUPPLY) throw new Error("Stolons launches require a fixed 1B token supply");
  if (lockedAmount !== REPRODUCTION_RESERVE) throw new Error("Stolons launches require a 150M reproduction reserve");
  if (cliffPeriod !== 0n || unlockPeriod !== 0n) throw new Error("the full reserve must unlock at graduation");
}
