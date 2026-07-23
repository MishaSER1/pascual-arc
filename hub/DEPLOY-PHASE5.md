# Phase 5 deployment — Arc/Circle agent integration

All code changes are ready and verified. Below are the exact commands. Run them in order from `D:\Soft\Arc\hub`.

## What was added in Phase 5

- **ARC AGENT panel** — the real ERC-8004 state of agent #4713 (owner, reputation, metadata), read directly from the Arc testnet network.
- **AGENTIC COMMERCE panel** — real ERC-8183 jobs (6 found by owner), with tx hashes and links to arcscan.
- **AGENT MARKETPLACE panel** — a catalog of 20 x402 services (the real list from `5_circle_agents.py`), 5 free / 15 paid.
- **Deliverable hash** — every X analysis gets a keccak256 hash and is shown as "⛓ ERC-8183 deliverable, ready to be written on-chain".
- **Bridge** — `agent-bridge/bridge.py` (a local FastAPI that links scripts 1–5 with the hub; you run it separately, see its README).

## Deployment (Cloudflare — your account required)

```powershell
cd D:\Soft\Arc\hub

# 1. New column in the DB (job_hash in x_items). Idempotent — if the column exists, you'll get a "duplicate column" error, that's fine.
npx wrangler d1 execute pascual-hub --command "ALTER TABLE x_items ADD COLUMN job_hash TEXT" --remote

# 2. (Optional) set a default agentId for the ARC AGENT panel — 4713 is already hardcoded by default
#    If you want a different one: add ARC_AGENT_ID = "4713" under [vars] in wrangler.toml

# 3. Deploy the worker (it now imports arc.js — wrangler will build the bundle itself)
npx wrangler deploy

# 4. Deploy the site with the new panels
npx wrangler pages deploy public --project-name pascual-hub
```

Then open `https://pascual-hub.pages.dev` (hard reload Ctrl+Shift+R) — you'll see the ARC AGENT / Agentic Commerce / Marketplace panels with live on-chain data for agent 4713.

## Verification after deployment

- The ARC AGENT panel shows `#4713`, owner `0xfb73…a9b9`, and the job count.
- The Agentic Commerce panel — a list of jobs with working `tx ↗` links to arcscan.
- Marketplace — a grid of 20 services with prices.
- In X Cockpit, under each analysis — the line "⛓ ERC-8183 deliverable: 0x…".

## Bridge (optional, separate from Cloudflare)

```powershell
cd D:\Soft\Arc\hub\agent-bridge
pip install fastapi uvicorn web3 eth-account python-dotenv pycryptodome
$env:BRIDGE_TOKEN = "any-long-string"
python bridge.py     # http://127.0.0.1:8799/health
```
`create-job` — a stub (it moves real USDC), which you complete for your own scenario, see `agent-bridge/README.md`.

## Notes

- The Arc endpoints (`/api/arc/*`) read the network on the public RPC + a Blockscout fallback (arcscan). If the RPC starts rate-limiting — you can later connect the Alchemy Arc RPC (the `ARC_RPC_URL` variable in the worker is already supported).
- Nothing that already worked (login, Wallet Radar, Signal Feed, X Cockpit, terminal) changed in behavior — only panels were added.
- No made-up figures: everything is from the network or an honest empty state.
