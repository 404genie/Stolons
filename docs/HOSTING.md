# Persistent workers

The Railway keeper service runs graduation, protocol CPMM collection, and curve treasury sweeps. Creator payouts remain manual. An empty curve vault is normal when its configured fee rate is zero.

The service starts disabled. In Codespaces, install the Railway CLI, authenticate, and upload the existing devnet keys directly:

```bash
npm install -g @railway/cli
railway login
node scripts/devnet/host-keepers.mjs
```

The upload script reads local key files and passes secrets through stdin. Never commit these files or paste keys into chat. Restrict project access and seal the two JSON variables in Railway. The treasury worker requires the configured treasury signer; the other workers use the dedicated fee keeper.

The service has no automatic restart. If a submitted transaction has uncertain confirmation, inspect its signature before restarting. HTTP health checks show container health; the root endpoint reports whether workers are running.

## Mainnet identities

```bash
node scripts/production/prepare-identities.mjs
```

This generates reusable local program, authority, and keeper identities and fills `target/mainnet/manifest.json` with their public addresses and the chosen treasury. It sends no transactions. Back up the key files securely. Platform and lookup table addresses still require deployment and initialization; follow [MAINNET.md](MAINNET.md) before enabling transactions.
