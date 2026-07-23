# Pascual Agent Bridge

A local bridge between the Arc on-chain scripts (1–5 in `d:\Soft\Arc`) and the web dashboard.

## Why

The hub (Cloudflare Worker) reads Arc state **read-only** — this is safe and already works now (the ARC AGENT / Agentic Commerce panels take data directly from the network). But **writing** — registering the agent, creating an ERC-8183 job from an X analysis, paying x402 — requires private keys, a proxy, and a faucet, which must stay on your machine. The bridge exposes these capabilities over localhost without sending keys anywhere.

## What it does

- `GET /health` — whether the bridge is alive and whether writes are enabled.
- `GET /agent` — serves `agent_state.json` + `job_state.json` (for the dashboard/debugging).
- `POST /create-job` — a **stub**: accepts `job_hash` (the keccak256 of the analysis, which the hub already computes at ingest) and is supposed to create a real ERC-8183 job via `3_create_job.py`. Left for you to complete, because it moves real testnet USDC into escrow — such an action should be explicit, not an auto-call from the web.

## Running

```powershell
cd D:\Soft\Arc\hub\agent-bridge
pip install fastapi uvicorn web3 eth-account python-dotenv pycryptodome
$env:BRIDGE_TOKEN = "any-long-string"        # without it, writes are forbidden
python bridge.py                              # http://127.0.0.1:8799
```

Check: open `http://127.0.0.1:8799/health` — you'll see `{"ok":true,...}`.

## Security

- Listens **only on 127.0.0.1** — never expose it to the internet.
- Every call requires the header `x-bridge-token` = your `BRIDGE_TOKEN`.
- Keys are read from the same `.env` as the scripts; they never go outside.
- `create-job` is intentionally a stub — you launch the actual tx (USDC escrow) yourself, confirming deliberately.

## Autonomous loop: analysis → ERC-8183 job (DONE)

The bridge can now **close the loop itself**: it polls the hub for analyses without an on-chain record and creates an ERC-8183 job for each, with a real deliverable hash.

```powershell
cd D:\Soft\Arc\hub\agent-bridge
$env:HUB_TOKEN = "<hub session token>"   # see below for where to get it
python bridge.py loop
```

**Where to get HUB_TOKEN:** log in to pascual-hub.pages.dev with your wallet → F12 → Console → `localStorage.getItem('pascual_hub_token')` → copy the value. (Lives 7 days.)

What loop does (every 120s, configurable via `LOOP_INTERVAL`):
1. `GET /api/x/pending` — takes analyses that have a `job_hash` but no `anchored_job`.
2. For each, runs `3_create_job.py` with `JOB_DELIVERABLE=<hash>` — the full cycle createJob→fund→submit(deliverable)→complete, **real tUSDC** in escrow (5 USDC/job by default).
3. `POST /api/x/anchor` — marks the analysis as recorded (job_id) so as not to create a duplicate.

⚠️ Each job spends test USDC (escrow). Keep a balance on the owner wallet (faucet). Stop the loop (Ctrl+C) when you don't need it.

## One-off manual job creation (without loop)

`POST /create-job` (needs `x-bridge-token`), body: `{"job_hash":"0x…","confirm":true}` → runs `3_create_job.py`, returns `job_id`.

## How this connects to the script

`3_create_job.py` now reads the env variable `JOB_DELIVERABLE` (0x… keccak256 of the analysis). If it's not set — it works as before (a demo hash), the manual run isn't broken.

## Note on dependencies

The root `requirements.txt` is missing `eth-account` and `pycryptodome` (needed by the scripts). The `pip install` command above adds them.
