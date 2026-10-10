import test from "node:test";
import assert from "node:assert/strict";
import { rootMassTransfer, previewMutation, selectWinner, U128_MAX } from "../../sdk/src/math.ts";

const GENESIS_SUPPLY = 1_000_000_000_000_000n;
const BURN = 10_000_000_000_000n;

test("first child receives exactly one percent of root mass", () => {
  assert.equal(rootMassTransfer(GENESIS_SUPPLY, BURN, GENESIS_SUPPLY), BURN);
});

test("each mutation moves equal mass out of parent and into child", () => {
  const before = 42_987_654_321n;
  const moved = rootMassTransfer(before, BURN, GENESIS_SUPPLY);
  const result = previewMutation(before, 0n, GENESIS_SUPPLY, BURN, GENESIS_SUPPLY);
  assert.equal(result.parentMassAfter + result.childMass, before);
  assert.equal(result.childMass, moved);
  assert.equal(result.parentSupplyAfter, GENESIS_SUPPLY - BURN);
});

test("mass remains conserved across 15 siblings with a declining parent supply", () => {
  let supply = GENESIS_SUPPLY;
  let parentMass = GENESIS_SUPPLY;
  let descendantMass = 0n;
  for (let child = 0; child < 15; child += 1) {
    const moved = rootMassTransfer(parentMass, BURN, supply);
    parentMass -= moved;
    descendantMass += moved;
    supply -= BURN;
    assert.equal(parentMass + descendantMass, GENESIS_SUPPLY);
  }
});

test("recursive lineages stop before a zero-mass child can be created", () => {
  let parentMass = GENESIS_SUPPLY;
  const allLineages = [parentMass];
  let generation = 0;
  while (true) {
    let moved;
    try { moved = rootMassTransfer(parentMass, BURN, GENESIS_SUPPLY); }
    catch { break; }
    allLineages[allLineages.length - 1] -= moved;
    allLineages.push(moved);
    parentMass = moved;
    generation += 1;
    assert.equal(allLineages.reduce((sum, item) => sum + item, 0n), GENESIS_SUPPLY);
  }
  assert.equal(generation, 7);
  assert.equal(parentMass, 10n);
  assert.throws(() => rootMassTransfer(parentMass, BURN, GENESIS_SUPPLY), /zero/);
});

test("u128 multiplication is checked before division", () => {
  assert.throws(() => rootMassTransfer(U128_MAX, GENESIS_SUPPLY - 1n, GENESIS_SUPPLY), /overflows/);
});

test("winner selection ignores zero support and resolves ties by earlier proposal", () => {
  assert.equal(selectWinner(new Map([[0, 0n], [1, 0n]])), null);
  assert.equal(selectWinner(new Map([[4, 100n], [2, 100n], [1, 50n]])), 2);
  assert.equal(selectWinner(new Map([[3, 12n], [1, 18n]])), 1);
});

test("deterministic fuzz keeps local ancestry mass conserved", () => {
  let seed = 0x5eedn;
  const next = () => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return seed;
  };
  for (let i = 0; i < 5_000; i += 1) {
    const supply = (next() % (GENESIS_SUPPLY - 1n)) + 2n;
    const burn = (next() % (supply - 1n)) + 1n;
    const mass = next() % (GENESIS_SUPPLY + 1n);
    const moved = mass * burn / supply;
    if (moved === 0n) continue;
    const before = mass + 37n;
    const result = previewMutation(mass, 37n, supply, burn, before);
    assert.equal(result.parentMassAfter + result.childMass, before);
    assert.equal(result.familyMassAfter, before);
  }
});
