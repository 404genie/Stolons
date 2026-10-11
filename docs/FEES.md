# Mainnet addresses and fee rollout

## Addresses that must be supplied

| Address | Purpose | How obtained |
|---|---|---|
| Stolons program ID | Deployed Solana contract identity | Generate and retain a separate mainnet program keypair in your secure deployment environment |
| Upgrade/config authority | Deployment upgrades and initial configuration | Public key of the selected authority; config initially belongs to the initializer/upgrade authority |
| Treasury | Receives 0.10% platform fees and 50% net CPMM creator revenue | Public wallet address supplied by the project owner |
| Keeper | Pays activation/collection transaction fees and account rent | Separate funded payer public key and server-side secret |
| Raydium platform config | Stores fee rates, treasury and reproduction policy | Derived/created by the selected platform admin |
| Launch lookup table | Keeps atomic launch and fee transactions within packet limits | Create/extend for the actual mainnet identities |

Raydium LaunchLab, its SOL global config, CPMM, and the expected CPMM index-zero config already have public mainnet addresses in `production/manifest.example.json`. They must be rechecked against live accounts. Stolons config, reproduction authority and each token's fee authority/distribution account are deterministic PDAs of the final Stolons program ID. Report them without generating keys or sending transactions:

```bash
node scripts/production/addresses.mjs MAINNET_PROGRAM_ID [TOKEN_MINT]
```

The source `declare_id!` is currently a placeholder that the devnet preparation script replaces. It is not a mainnet deployment address. Do not copy devnet identities into production. Preserve the mainnet program keypair locally; send only public addresses for configuration.

## Existing treasury fee versus new sharing

Before graduation the configured Raydium platform fee accrues to the platform fee vault. Configure `platform_fee_wallet` and Stolons `GlobalConfig.treasury` to the same treasury. The new SDK `buildTreasuryCurveFeeClaim` rejects any other signer and claims to that wallet's canonical quote-token ATA. This is an explicit treasury sweep: do not give the treasury signing key to the keeper.

After graduation the fee collector sends half the **net collected** CPMM creator stream to treasury's canonical ATAs. Anyone may trigger it; the keeper pays fees without treasury/creator keys. Wrapped SOL is paid as wrapped SOL. Network costs and account rent are separate from trading fees.

## Build before enablement

```bash
git pull --ff-only
bash scripts/devnet/build.sh
bash scripts/devnet/deploy.sh
```

Those commands build and upgrade devnet only. Do not enable sharing until Rust/SBF/IDL checks pass. For the existing devnet profile, simulate enablement first:

```bash
bash scripts/devnet/enable-fees.sh
# After the successful program build/upgrade and reviewed simulation:
bash scripts/devnet/enable-fees.sh --apply
```

For production use `feeSharingEnableInstruction` from the SDK, signed by the existing config authority, after checking the platform has zero CPMM creator override. The change is one-way for prospective launches; new launches use fee PDAs while old tokens keep their existing creator. SDK mainnet launch and preflight require config version 2.

Create a new v2 token and test curve trading/creator claims, graduation, CPMM accrual/collection, 50/50 payout, treasury claim, empty/repeated collection, direct permissionless Raydium collection followed by payout, wrong destinations, paused config and keeper failure recovery. Devnet's current trading fees are zero; meaningful accrual tests need a fee-enabled Raydium test profile. Do not claim a zero-fee transaction proves fee accrual. A donation test can verify distribution but not the Raydium fee-collection CPI.

## Fee worker

With SDK built and the configured separate keeper public key, run one dry scan:

```bash
node services/keeper/fees.mjs
```

It discovers registered tokens or uses `FEE_KEEPER_MINTS`, skips legacy tokens and empty fee balances, and simulates pending claims. It reads no keypair in dry-run. `--apply` loads only the keeper keypair and submits checked transactions. Configure a scheduler after live validation. The process stops on errors; uncertain submissions require inspecting their signature before restarting. Do not configure blind scheduler retries on ambiguous submission errors. First collection may pay for six recipient ATAs plus a distribution account; maintain payer funding and an extended lookup table.

The worker's two claim transactions are individually atomic. A successful curve payout followed by failed CPMM payout remains a valid curve payout; inspect the second transaction before retrying. The full worker batch is not one atomic transaction.

## Creator claim panel

Connecting the registered creator wallet shows a claim panel on the token page. It rereads pending fees, skips empty streams and submits curve and CPMM collection separately through the checked wallet sender. Both paths pay the registered destinations; CPMM collection also pays treasury. A configured fee keeper can perform the same collection without creator approval. The graduation keeper alone does not collect fees. SOL payouts remain wrapped SOL. The claimant pays transaction fees and any recipient-account rent. Mainnet claims remain behind the public transaction gate.
