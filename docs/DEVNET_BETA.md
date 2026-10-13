# Public devnet beta

The beta uses the existing program `4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ` and launch lookup table `88XLHEm7T4SEhSzMx3vqZjGXmzo2bbeJq4VK2sgJHGwx`. No contract deployment, address regeneration or mainnet transaction is part of this rollout. The existing version-2 governance remains live; audited version-3 quorum, bond and deadline-extension rules are not advertised as active.

The frontend has a test-SOL notice and `/start` instructions. Metadata is wallet-signed, content-addressed and stored on the Railway volume. Vercel forwards uploads and admin stats to the Railway API. No signing keys belong in either frontend.

`/admin` requires a signed, expiring read-only message from the configured `ADMIN_WALLET_PUBLIC_KEY`. The intended treasury wallet `FRVw3s9Wz4pKzRuUwEj9FZYa39vLbAfXzUqiDYAK2K87` is the configured admin identity; changing this public setting does not change any on-chain authority. The dashboard reports unique signed-upload participants recorded by this backend, wallets found in current on-chain accounts, tokens, roots, offspring, qualification states, orphaned tokens, reproduction rounds and vote receipts. These are not anonymous visitors, historical wallet totals or guaranteed sign-ups.

Railway project: `759f4497-5109-4b2d-816e-3810fa300dee`, devnet environment `46216523-fd56-42f9-ab77-c5b20d3d6c2a`. Vercel project: `stolons-devnet`. All deployable changes are merged to main before deployment. Mainnet remains disabled.

## Activate automatic devnet graduation and protocol collection

The keeper service starts disabled because signing credentials cannot be recovered from the old project. In Codespaces, run `node scripts/devnet/activate-beta-keepers.mjs` after authenticating the Railway CLI. It uploads your existing devnet keeper and devnet treasury key files via stdin directly to the new service, then requests activation. No new wallet is generated. Never paste those files into chat or commit them. The service uses `NEVER` automatic restart so ambiguous submissions require inspection.
