# Pascual — Agentic Economy on Arc / Circle

A working product for the **Arc (Circle L1)** ecosystem: a browser extension + a web terminal + an on-chain agent, closed into a single agentic-economy loop.

> **In one line:** a user analyzes X posts through an AI extension → each analysis automatically becomes a **verifiable on-chain service** (an ERC-8183 job) performed by a registered agent (ERC-8004), paid in USDC (x402).

## What this proves

Most submissions show an idea. This shows **live agent activity on-chain**:
- Agent **#4713** is registered in ERC-8004 (Identity Registry) on Arc testnet.
- **10+ real ERC-8183 jobs** created automatically from the user's work.
- Payment per analysis via **USDC credits over x402** (EIP-3009).
- Everything is visible in the interface (terminal dashboard), with no fabricated data.

## Architecture

```
Extension (Chrome MV3)  ──analysis──►  Hub (Cloudflare Worker + Pages)  ──queue──►  Bridge (PC, private key)
   AI X analysis                         terminal + X Cockpit                        signs transactions
                                              ▲                                            │ createJob
                                              │ reads ERC-8004/8183 state                  ▼
                                              └────────────────────────────────  Arc testnet (ERC-8183 job)
```

The bridge signs transactions locally (that's where the agent's private key lives — it must never go to the cloud). The hub and extension run in the cloud, publicly accessible.

## Components

| Folder | What it is |
|---|---|
| `reply-x-pro/` | Chrome extension (AI replies, analysis, sentiment, USDC x402 payments) + its Cloudflare Worker |
| `hub/` | Web terminal (Cloudflare Pages) + API Worker: wallet sign-in, Wallet Radar, Signal Feed, ARC AGENT / Agentic Commerce / Marketplace panels |
| `hub/arc.js` | Read-only Arc contract reader (ERC-8004/8183) in pure JS, no libraries |
| `hub/agent-bridge/` | Python↔Arc bridge: closes the analysis→job loop (`bridge.py loop`) |
| `1_..5_*.py` | On-chain scripts: entity secret, ERC-8004 registration, ERC-8183 job lifecycle, x402 client for the agents.circle.com marketplace |

## Arc / Circle technologies

- **ERC-8004** — agent identity (IdentityRegistry `0x8004A818…BD9e`), reputation, validation.
- **ERC-8183** — job lifecycle (AgenticCommerce `0x0747EEf0…4583`), USDC escrow.
- **x402** — pay-per-request in USDC (EIP-3009 `transferWithAuthorization`), agents.circle.com marketplace.
- **USDC** — gas and settlement (Arc testnet chain 5042002).

## Running it

Secrets are never committed (see `.gitignore`). Copy `.env.example` → `.env` and fill in your own keys.
The on-chain scripts use absolute paths `d:\Soft\Arc\…` — replace them with your own if you clone elsewhere.

- **Extension:** `chrome://extensions` → Load unpacked → `reply-x-pro/`
- **Hub:** `cd hub` → see `hub/DEPLOY-PHASE5.md` (wrangler deploy + pages deploy)
- **Bridge (loop):** `cd hub/agent-bridge` → `python bridge.py loop` (see its README)
- **On-chain scripts:** `pip install -r requirements.txt`, then `python 1_..3_*.py` in order

## Security

- Private keys, tokens, proxies live only in `.env` (never enters git).
- The bridge runs locally; the key never leaves your machine.
- The extension only analyzes the DOM the user already sees; it never posts on its own.

## Status

Demo stage: the technical loop works end-to-end, jobs are real on Arc testnet.
Next: agent 24/7 (bridge on a VPS), multi-user mode (Circle Programmable Wallets).

## Links

- Arc docs: https://docs.arc.network
- Circle console: https://console.circle.com
- Arc explorer: https://testnet.arcscan.app
