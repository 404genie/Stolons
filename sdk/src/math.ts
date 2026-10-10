export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;

export interface MutationPreview {
  parentMassAfter: bigint;
  childMass: bigint;
  parentSupplyAfter: bigint;
  familyMassAfter: bigint;
}

export function rootMassTransfer(parentMass: bigint, burnAtoms: bigint, supplyBeforeBurn: bigint): bigint {
  if (parentMass < 0n || parentMass > U128_MAX) throw new RangeError("parent mass is outside u128");
  if (burnAtoms <= 0n || burnAtoms >= supplyBeforeBurn) throw new RangeError("burn must be positive and below current supply");
  if (supplyBeforeBurn <= 0n || supplyBeforeBurn > U64_MAX || burnAtoms > U64_MAX) throw new RangeError("supply/burn is outside u64");
  const numerator = parentMass * burnAtoms;
  if (numerator > U128_MAX) throw new RangeError("ancestry product overflows u128");
  const transferred = numerator / supplyBeforeBurn;
  if (transferred === 0n) throw new RangeError("ancestry transfer rounds down to zero atoms");
  return transferred;
}

export function previewMutation(
  parentMass: bigint,
  childMass: bigint,
  parentSupply: bigint,
  burnAtoms: bigint,
  familyMass: bigint
): MutationPreview {
  if (burnAtoms >= parentSupply) throw new RangeError("burn would consume all parent supply");
  const moved = rootMassTransfer(parentMass, burnAtoms, parentSupply);
  const parentMassAfter = parentMass - moved;
  const childMassAfter = childMass + moved;
  if (parentMassAfter < 0n || childMassAfter > U128_MAX) throw new RangeError("ancestry mass overflow");
  const parentSupplyAfter = parentSupply - burnAtoms;
  if (parentMassAfter + childMassAfter !== parentMass + childMass) throw new Error("local family mass conservation failed");
  return {
    parentMassAfter,
    childMass: childMassAfter,
    parentSupplyAfter,
    familyMassAfter: familyMass
  };
}

export function selectWinner(support: ReadonlyMap<number, bigint>): number | null {
  let winner: number | null = null;
  let highest = 0n;
  for (const [proposalId, votes] of support) {
    if (votes < 0n) throw new RangeError("vote support cannot be negative");
    if (votes > highest || (votes === highest && votes > 0n && (winner === null || proposalId < winner))) {
      highest = votes;
      winner = proposalId;
    }
  }
  return winner;
}
