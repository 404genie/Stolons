# Protocol invariants

## Supply and reserve

1. Every admitted mint is a standard SPL Token mint with six decimals, supply `1_000_000_000_000_000` atoms, and no mint/freeze authority.
2. LaunchLab PoolState must report supply 1B, exactly 150M locked, CPMM migration type, Stolons global/platform config, and no vesting cliff or unlock period. The no-cliff/no-unlock requirement lets the program claim exactly the full reserve as soon as the pool is trading.
3. The vesting record must be the canonical `[pool_vesting, pool, reproduction_authority]` PDA with `claimed_amount = 0` and `token_share_amount = 150M`.
4. No instruction can sign a general transfer out of a reproduction vault. A PDA can only burn parent tokens through `finalize_child`.
5. Donations to a reproduction vault are accepted. Claim verification checks that exactly 150M new atoms arrived, instead of requiring the post-claim balance to equal 150M.

## Governance

6. One active epoch or selected candidate at a time per parent.
7. One proposal per sequential proposal ID, at most 32 proposals per epoch; the proposed mint is globally reserved.
8. A proposed mint must not already have a Stolons lineage.
9. One vote receipt per wallet per epoch. Votes are actual parent tokens held by the epoch escrow PDA.
10. Votes remain locked while the epoch is open; each receipt can be withdrawn once after finalization or no-winner closure.
11. Winner support is positive; highest support wins; ties resolve to the smaller proposal ID. The program does not require quorum.

## Candidate and migration

12. A candidate launch must match the selected mint, parent, proposal, original Raydium transaction creator, launch window, and Stolons LaunchLab settings.
13. A migration requires LaunchLab status `Trade`, the expected CPMM pool PDA, matching token pair/config, and swap-enabled CPMM state.
14. The pool's vesting `start_time` is set by LaunchLab when fundraising ends. With the required zero cliff, that timestamp is used for the seven-day candidate cutoff. A successful timely graduation cannot be orphaned merely because its permissionless registrar submits late.
15. A candidate that did not graduate by its deadline is terminal: an unlaunched selection expires; a launched mint becomes `Orphan`. It can never later become a child.

## Ancestry

16. Before a child is settled, the parent reserve must contain at least 10M atoms and the parent mint supply must exceed 10M atoms.
17. `moved = floor(parent.self_root_mass * 10M / parent_mint.supply_before_burn)`, evaluated with checked `u128` multiplication and division.
18. `moved > 0`; `open_epoch` preflights this so no user can win a candidate that cannot settle.
19. The parent loses exactly `moved`; the child gains exactly `moved`; total family root mass is unchanged.
20. Direct child count cannot exceed 15. A child starts with the protocol's 1B genesis supply before any descendant burn.
21. The family root and generation must match the parent/child lineages; a candidate can settle only once.

## Integer depth limit

Each fresh child starts with 1B supply. Along a one-child chain, mass moves by about 1% each generation: `1e15 → 1e13 → 1e11 → … → 10` atoms. The next floor is zero and the program refuses to open that epoch. The current rule therefore permits seven successive successful ancestry transfers from the root before the next generation becomes unavailable. This is a consequence of fixed 10M burns and atom-denominated mass; it is not a configurable hidden cutoff.

## Non-authoritative data

The indexer, web display, metadata URI/hash, and SDK preview are not authorization sources. The on-chain program re-derives state from accounts and transaction instructions.
