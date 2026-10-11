# Devnet validation — 11 October 2026

Program: `4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ`
RPC: `https://api.devnet.solana.com`
Configuration: `EC2ZtAwKS61vsSJUe8Ggy3PuugXM9UVmUVXFSpAB1UwB`

## Completed lifecycle

| Item | Root | Child |
| --- | --- | --- |
| Mint | `3jXAR6xsXFtvGnk7nXX5P98MgrEQuH8Jxn4rovcE15EW` | `6bQBYEUZd9M64ZFSRu93HgDzDpPfoZnuyVwHsvq77q54` |
| CPMM pool | `vjoUkT2yoVUApZTM2kwkpXwQNQ7bviG7TtxiKtqv4gT` | `3seB78mLRe4VBMfC3Y7eK4xPY2epPQpTcFeFySFeiquq` |
| Status | RootActive | DescendantActive |
| Current supply | 990M | 1B |
| Reproduction reserve | 140M | 150M |
| Root mass (atoms) | 990,000,000,000,000 | 10,000,000,000,000 |

Both mint and freeze authorities were revoked at launch. The governance run escrowed and returned 1M root tokens. Child settlement burned 10M parent tokens and conserved family root mass. These figures were verified by post-confirmation RPC reads.

Child settlement signature: `24TgTj9gTZwkbez1d1jCD9HqEU4iNnth6ymdc9re6tKBpK67SCKNAFtz3TZQ3wByPh2QjkYGyVpMGsEExXZb2xTX`.

## Read-only safety checks

`bash scripts/devnet/check-safety.sh` runs 12 live simulations with no transaction submission:

- Positive controls: the root may open another epoch; the active child may open generation two.
- Rejections: duplicate root activation, child settlement, root reserve claim, child reserve claim, vote withdrawal and epoch finalization.
- Rejections: opening while paused, concurrent epochs, finalization before the voting deadline, empty proposal metadata URI.

Each negative check asserts the expected on-chain error code, rather than accepting any failure.

## Frontend

The web app defaults to this deployed Devnet program. Home links open the verified root and child. Token pages display current vault balances, parent/root links and the CPMM explorer link. Reproduction reads proposal/voting durations and pause state from the configuration, blocks an occupied round, and refreshes lineage after opening.

```sh
bash scripts/devnet/web.sh
```

In Codespaces, open forwarded port 3000. The wrapper explicitly sets the Devnet RPC and program ID from the local deployment keypair, overriding stale `.env.local` settings. Inspecting tokens needs no wallet. Opening an epoch is a signed action and starts the configured 60-second proposal and 60-second vote windows; proposal/vote forms are still supplied through scripts.

## Remaining acceptance scenarios

Multi-wallet voting/ties, expired selections and orphan recovery, wrong external accounts at migration, the 15-child cap, and actual multi-generation launch/settlement still need Devnet runs. A successful generation-two epoch simulation does not prove generation-two settlement. Mainnet deployment is outside this validation.
