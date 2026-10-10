# Raydium integration pin

This adapter targets the Raydium LaunchLab / CPMM layout observed with `@raydium-io/raydium-sdk-v2@0.2.64-alpha` and the public Raydium program sources reviewed on 2026-10-10. The dependency is pinned because the LaunchLab SDK is still pre-1.0 and its builders/layout can change.

## LaunchLab PoolState bytes

The program checks the `account:PoolState` discriminator and reads the currently pinned Borsh account layout (offsets include the 8-byte Anchor discriminator):

| Field | Offset | Bytes |
|---|---:|---:|
| status | 17 | 1 |
| base decimals | 18 | 1 |
| quote decimals | 19 | 1 |
| migration type | 20 | 1 |
| supply | 21 | 8 |
| total sell | 29 | 8 |
| locked amount | 101 | 8 |
| vesting cliff | 109 | 8 |
| vesting unlock | 117 | 8 |
| vesting start time | 125 | 8 |
| global config | 141 | 32 |
| platform config | 173 | 32 |
| base mint | 205 | 32 |
| quote mint | 237 | 32 |
| base vault | 269 | 32 |
| creator | 333 | 32 |

Pool status values are Fund `0`, Migrate `1`, Trade `2`; CPMM migration type is `1`. Raydium defines `vesting_schedule.start_time` as fundraising-end block time plus cliff. This protocol requires a zero cliff and zero unlock period, making it an immediate graduation timestamp and allowing the full reserve claim in one call.

The global config, platform config, and LaunchLab program must be canonical for the selected cluster. The Anchor initializer stores those addresses once; deployment scripts and the devnet checklist must verify them against Raydium's published program/config set. Do not use a mainnet config address on devnet or vice versa.

## Transaction proof

`register_root_launch` and `register_candidate_launch` scan the Solana instructions sysvar for an earlier Raydium `global:initialize_v2` in the same transaction. It must carry the same platform config, pool state, base mint, and quote mint in account positions 3, 5, 6, and 7. The program then independently validates the owned PoolState and deterministic pool PDA. The SDK's `appendAfterInitializeV2` performs the same account-position preflight when composing a transaction.

Raydium's SDK returns multiple launch transactions. The launch integration must locate the actual transaction containing InitializeV2, insert the Stolons registration immediately after it, preserve Raydium-generated signers (including the base mint keypair), and send that transaction atomically. Calling Raydium's `execute()` unchanged and registering in a later transaction will be rejected by Stolons.

## Platform config and vesting CPI

The adapter expects:

- platform claim fee wallet = configured treasury;
- migration LP scales: platform 0, creator 0, burn 1,000,000;
- CPMM config = configured CPMM config;
- platform vesting wallet = `reproduction_authority` PDA;
- platform vesting scale = 1,000,000.

After initialization, Stolons CPI-calls `create_platform_vesting_account` with an allocation of exactly 150M atoms. The reproduction authority PDA is topped up from the launch signer to the rent-exempt minimum because Raydium makes the platform vesting wallet pay for its new record. After migration, the reserve claim CPI-calls `claim_vested_token` and validates the record before moving tokens to the mint-scoped vault. Account ordering and signer semantics are based on current Raydium documentation/source. These CPIs, the current `InitializeV2` instruction account indexes, and the raw offsets are **devnet release gates**, not assumptions to carry silently into mainnet. Platform settings are enforced when the protocol config and launch are validated; migration eligibility uses the immutable per-pool fields and CPMM account so later platform config edits cannot block an existing launch.

## CPMM verification

The adapter checks that the account is owned by the configured CPMM program, has the pinned `account:PoolState` discriminator, references the configured CPMM config, contains the expected base/quote mint pair, has swaps enabled, and equals the derived `[pool, config, sorted_mint_0, sorted_mint_1]` PDA. The LaunchLab pool must independently report Trade status and CPMM migration type.

Before changing the Raydium SDK version or program, update this table from primary source, update the parser, add a raw-account fixture test, regenerate transaction proof account indexes, and rerun all devnet lifecycle tests.
