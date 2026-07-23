# Pascual Hub — wallet-centric command center

Phase 1: a dashboard site with wallet login + Wallet Radar (tracking wallets).
Architecture: see the artifact plan. Everything on Cloudflare free tiers + public on-chain APIs.

## Structure

```
hub/
├── public/index.html   ← frontend (Cloudflare Pages): wallet login, dashboard, Wallet Radar
├── worker.js           ← backend API (Cloudflare Worker): auth, watchlist, on-chain summary
├── crypto.js           ← keccak-256 + secp256k1 ecrecover (shared with the extension, verified)
├── schema.sql          ← D1: profiles, watchlist
└── wrangler.toml       ← worker config (fill in the KV and D1 ids)
```

## How login works

1. `GET /api/auth/nonce?address=0x…` → the server issues a one-time nonce (60s, in KV) and the message text.
2. The wallet signs the message (`personal_sign`, free, no transaction).
3. `POST /api/auth/verify {address, signature}` → the server recovers the address from the signature (local ecrecover, no RPC), checks it against the nonce, deletes the nonce (one-time), issues a session token (HMAC, 7 days).
4. Subsequent requests send `Authorization: Bearer <token>`.

The private key never leaves the wallet. The nonce is one-time — the signature cannot be reused.

## Deployment (your Cloudflare account required)

```powershell
cd D:\Soft\Arc\hub

# 1. Create the stores
npx wrangler kv namespace create SESS          # → paste the id into wrangler.toml (SESS)
npx wrangler d1 create pascual-hub             # → paste the database_id into wrangler.toml (DB)
npx wrangler d1 execute pascual-hub --file=schema.sql --remote

# 2. Session secret
npx wrangler secret put SESSION_SECRET         # enter a long random string

# 3. Deploy the API
npx wrangler deploy                            # note the URL like https://pascual-hub-api.<...>.workers.dev

# 4. Deploy the frontend to Pages
npx wrangler pages deploy public --project-name pascual-hub
```

After deployment: open the Pages site, in the browser console run once
`localStorage.setItem("pascual_hub_api", "https://pascual-hub-api.<...>.workers.dev")`
(or we'll add a settings field later), then "Connect wallet".

Also set in `wrangler.toml` → `ALLOWED_ORIGIN` = the URL of your Pages site and redeploy the worker (CORS).

## What's next (upcoming phases)

- Phase 2+: enrich Wallet Radar (tokens, NFTs, tx history, activity maps) — replace `fetchWalletSummary` with Alchemy/Covalent/DeBank free tier.
- Phase 3: X Cockpit — the Pascual Reply Pro extension sends Analyze/Sentiment results to the dashboard.
- Phase 4: Signal Feed (RSS + crypto APIs + AI summaries).
- Phase 5: credits/x402 (reuse from the extension), ERC-8183 jobs, grant application.

## Boundaries (important)

- On-chain data — public, legal, free.
- X data — ONLY through the extension (the user's browser). No server-side scraping of X.
- We don't store other people's tweets on the server — only the computed analysis.
