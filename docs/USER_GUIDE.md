# Stolons

Stolons lets you launch Solana tokens that can form a family of descendant tokens. Each token trades independently through Raydium; Stolons records ancestry and manages the family's reproduction reserve.

## Launch a token

Connect your Solana wallet, choose **Create token**, and enter the name, ticker, description, image and optional social links. Preview the launch, review the estimated cost, then approve it in your wallet. Keep enough SOL for transaction fees and account rent.

Each token starts with one billion tokens: 700 million for curve trading, 150 million for migrated liquidity, and 150 million in the reproduction reserve. Mint and freeze authorities are revoked. The displayed graduation target comes from the site's configured launch profile.

## Trade and graduate

Buy and sell from a token's page. Review the amount and minimum received before signing. Once the bonding curve completes, Raydium migrates liquidity into its CPMM pool. The backend registers the migrated pool and activates the reproduction reserve automatically. No additional wallet approval is required for activation.

## Create descendants

An active token can open a reproduction round. Propose a child with its token details, then holders vote by temporarily locking parent tokens. The selected proposer launches the winning child using the same wallet that submitted it. Follow the on-page proposal, voting and launch deadlines.

A successfully graduated child burns 10 million tokens from its parent's reserve, activates its own 150 million reserve, and can later reproduce. A parent supports at most 15 successful direct children. Voting itself does not burn tokens; withdraw your locked voting tokens after the round is finalized.

## Creator fees

Connect the registered creator wallet and open your token page. The **Creator fees** panel shows whether fees are available. Click **Claim creator fees**, review the wallet transaction and approve it. You pay transaction fees and any required recipient token-account rent.

Before graduation, configured creator fees belong entirely to the creator. After graduation, net CPMM creator-fee receipts are split equally between the creator and Stolons. Protocol collection pays treasury and holds the creator share in token-specific escrow until the creator claims it. Protocol workers cannot release creator escrow.

SOL-denominated fee payouts arrive as wrapped SOL (wSOL), an SPL token representing SOL. Curve and pool claims may require separate transactions. An empty or repeated claim cannot pay the same fees twice.

## Protocol fees

The production fee profile specifies 0.10% platform and 0.10% creator curve fees, in addition to Raydium fees. Post-graduation revenue uses the configured CPMM creator-fee stream; Stolons receives half its net collected amount. Raydium may apply its own collection-time protocol share. Network fees and account rent are separate.

Protocol fees are collected by backend workers. Creators claim their own fees manually.

## Check a transaction

Use the transaction link to inspect its status in Solana Explorer. If confirmation is uncertain, check that transaction before signing another action. A temporary RPC error does not by itself prove the transaction failed.

## Links

- [Stolons source](https://github.com/404genie/Stolons)
- [Fee mechanics and validation](FEES.md)
- [Economics](ECONOMICS.md)

New mainnet rounds require winning support of at least 0.1% of parent supply. Proposals include a 0.05 SOL bond, separate from the fee and account rent. Losing proposals and successfully graduated winners can settle their bond from the round page; failed winners forfeit it. Late leader changes extend voting by five minutes, capped at one hour. Votes remain locked until the round is finalized.
