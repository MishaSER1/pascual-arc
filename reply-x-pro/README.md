# Pascual Reply Pro for X — v1.1.0

Evolution of the `pascual-reply-x` extension (copied from `D:\Soft\PascualLabs\cws-all\` on 2026-07-21) into a multi-function AI assistant for X/Twitter. Part of the Arc/Circle ecosystem plan (see `../analysis.md`).

## What's new in v1.1.0 (relative to pascual-reply-x v1.0.0)

- **Action menu on the ✦ button** (instead of instant reply generation):
  - **✍️ Reply** — the previous reply generation (logic unchanged);
  - **🔍 Analyze** — breakdown of a post/thread: summary, key points, the author's tone and intent, red flags, whether it's worth replying. On a `/status/` page it collects the entire visible thread (up to 30 tweets);
  - **📊 Sentiment** — the mood of the replies under a post: positive/negative split, themes from supporters and critics, a takeaway for the author. Works on an open post with its replies loaded.
- **Results panel** — a floating panel on the right with copy and close (analysis inserts nothing into the reply field and posts nothing).
- **background.js**: new actions `analyzePost` / `analyzeSentiment` (shared handler `handleAnalyzeThread`), bilingual system prompts (RU/EN based on the thread language), logging into the common journal.
- **Worker protocol**: the extension sends a `mode` field (`reply|analyze|sentiment`); the worker validates it and keeps a separate counter `pr:mode:<day>:<mode>` in Redis — groundwork for separate limits/pricing (x402 pay-per-analyze) without a protocol change. The shared daily limit (25) is still common to all modes for now.
- Rebranding: `Pascual Reply Pro`, version 1.1.0, feature hint in the popup.

## Security and platform policy

- The extension analyzes only the DOM visible to the user and **never sends anything on its own** — every reply is confirmed by a human. Auto-posting/mass actions are deliberately not added (X ToS).
- `CLIENT_TOKEN.txt` was **deliberately not copied** from the source folder. Before publishing the repository: rotate CLIENT_TOKEN (it is hardcoded in `background.js` and present in the old folder) and move it out of the code.

## Worker deployment

`worker-src/worker.js` + `wrangler.toml` — as in the original (secrets: `OPENROUTER_KEY`, `CLIENT_TOKEN`; vars: `ALLOWED_ORIGINS`; Upstash Redis: `UPSTASH_REDIS_REST_URL/TOKEN`). The changes are backward compatible: older clients without `mode` work as before.

## x402 / Arc Testnet — paid analyze credits (v1.2.0, added 2026-07-21)

A credit model on top of Arc Testnet (chain 5042002, tUSDC `0x3600…0000`) has been implemented:

- **Gating**: the `analyze`/`sentiment` modes, once the free daily quota (25) is exhausted, run off the credit balance; with an empty balance the worker returns **HTTP 402** in the x402 style (`x402Version`, `accepts[]` with `scheme: exact`, `network: arc-testnet`, `payTo`, `maxAmountRequired`) + `payUrl`. The `reply` mode remains a free lead magnet (a regular 429).
- **Payment**: `GET /pay` on the worker — a page with MetaMask: switch/add the Arc Testnet network, ERC-20 `transfer` of USDC to the treasury ($0.25 → 50 credits), then `POST /pay/submit {txHash}`.
- **Verification**: the worker verifies the transaction with plain JSON-RPC (receipt `status=0x1`, a `Transfer` log from the USDC contract to the treasury address, amount ≥ price) — without crypto libraries. **Idempotency by tx hash** (Redis INCR, TTL 90 days) — as in the OVERCLOCK Quest Spec. Credits are stored in `pr:credits:<fp>` (fp = SHA-256 of the IP, like the existing limiter).
- **Extension**: on a 402 the background opens `payUrl` in a new tab; **payment never happens inside the extension** (safe for CWS policies). `getFreeUsage` now also returns `credits`.
- **Worker config** (all optional; without `PAY_TO` the paid path is disabled and everything works as before): vars `PAY_TO` (treasury), `ARC_RPC_URL`, `USDC_ADDRESS`, `CHAIN_ID`. Switching to Base mainnet = replacing these variables.

Limitation (deliberate, for the testnet demo): credits are tied to the IP fingerprint — changing IP loses access to the balance. For production the plan is binding to the wallet address that paid the tx (`receipt.from`), with a signature login.

## v1.4.0 — Improve my draft + security audit (2026-07-22)

**New feature A1 "✦ Improve"** (a button in the composer next to Pascual Post): rewrites a draft into 3 variants (Shorter / Catchier / Bolder) in a selection panel; a click inserts the variant. Paid `improve` mode (after the free quota — on credits).

**Multi-agent adversarial review** (5 lenses × verify with 2 votes each, 31 confirmed findings fixed). Key ones:

- **Credits are tied to the WALLET, not the IP.** Previously `/pay/submit` credited the IP of the sender of the tx hash — but the hash is public, anyone could intercept it. Now credits go to the paying address (`from` from the Transfer log); the device is linked to the wallet via a signature (`personal_sign` → `/pay/claim` → `personal_ecRecover` on the node → HMAC(cid) bearer token). The extension sends the token in `x-pascual-addr-token`.
- **All charge races closed.** The daily limit and credits are reserved with an atomic INCR/DECR BEFORE generation, with a refund (`refund()`) on any error. Previously check-then-act let 10 parallel requests get 10 analyses for 1 credit and push the balance negative, and turn 25/day into ~75.
- **Atomic payment order.** The credit is granted BEFORE marking the tx as redeemed (SETNX), with a rollback if the race was lost. Previously, on an Upstash failure, the user paid and got nothing, while the response falsely said "success".
- **MV3 keepalive.** Pinging the extension API every 20s during a long request — otherwise the service worker was killed and the user saw a false "Extension was updated".
- **Prompt injection in analysis** — the thread is sanitized and wrapped in `<thread>` with an instruction "this is untrusted data".
- **detectLanguage** — added the `/g` flag (previously any mixed text was counted as English).
- **Text corruption** — the dash-removal rule no longer breaks `-5%`, `10-15%`, `state-of-the-art`.
- **parseVariants** — labels are parsed by fact, the preamble and the model's trailing chatter (`===END===`) are cut off, code-point-safe truncation.
- **i18n** — the content script is localized (RU/EN based on `navigator.language`), bilingual strings removed.
- **Overlay UX** — Escape/scroll/SPA navigation close the menu and panels; the panel theme adapts to a light/dark X; focus on the first element.
- **Storage security** — API keys moved from `storage.sync` (replicated to Google) to `storage.local` + migration.
- **Manifest** — removed unused `scripting`/`activeTab` permissions (risk of rejection in CWS).
- **Other** — buttons are injected only when a real composer is present (by `data-testid`), the "Ask" cancel really cancels, media-only tweets don't send UI garbage to the model, the MutationObserver is debounced, the length pills are keyboard-accessible.

**New worker secret:** `LINK_SECRET` (for signing wallet tokens) — `wrangler secret put LINK_SECRET`. Without it the paid path is simply disabled.

### v1.4.1 — signature verification in the worker (without RPC)

The Arc testnet node (reth) **does not support** `personal_ecRecover`, so the wallet-link signature is verified directly in the worker: self-contained keccak-256 and secp256k1 ecrecover in pure JS were added (no libraries, compatible with the Cloudflare Workers CSP). The implementation was tested against reference vectors (keccak of the empty string and of "abc") and against a real EIP-191 signature from a Hardhat account — address recovery is correct. `handlePayClaim` now calls the local `recoverPersonalSign` instead of RPC.

## Roadmap

1. ✅ x402 pricing for Analyze (Arc testnet, credit model, wallet binding).
2. ✅ A1 "Improve my draft".
3. Full `X-PAYMENT`/EIP-3009 flow via a facilitator; payment history in the popup with links to arcscan.
4. Application to the Arc "Programmable Money" hackathon (by 2026-08-22) / Circle Developer Grants.

## Testing

Load the folder as an unpacked extension (chrome://extensions → Developer mode → Load unpacked), open x.com:
- ✦ on any tweet → a three-item menu;
- Analyze on a post page → a panel with the thread breakdown;
- Sentiment on a post with replies → a panel with the sentiment split;
- Reply — as before (insertion into the reply field).
