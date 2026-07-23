"""
Pascual Agent Bridge — local FastAPI service that connects the existing Arc
agent scripts (1-5) to the web dashboard.

WHY: the hub Worker reads Arc chain state directly (read-only). But WRITE actions
— registering the agent, creating an ERC-8183 job from an X-analysis, paying via
x402 — require private keys + proxy + faucet, which must stay on the user's
machine. This bridge exposes those local capabilities over localhost so the hub
(or the user) can trigger them without shipping keys anywhere.

SECURITY: runs on 127.0.0.1 only. Never expose to the internet. Keys are read
from the same .env the scripts use. A shared BRIDGE_TOKEN gates every call.

RUN (see README.md):
    pip install fastapi uvicorn web3 eth-account python-dotenv pycryptodome
    python bridge.py            # serves http://127.0.0.1:8799

This is a SCAFFOLD — endpoints that only READ state (agent/job status) are
implemented against the existing state files; WRITE endpoints (create-job) are
stubbed with the exact call into 3_create_job.py left for the user to wire,
because they move real testnet USDC and need the user's confirmation.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

# Project root = two levels up from this file (hub/agent-bridge/ -> d:\Soft\Arc).
# Overridable so the bridge isn't tied to one machine's absolute paths.
ARC_ROOT = Path(os.environ.get("ARC_ROOT", Path(__file__).resolve().parents[2]))
BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")  # set this; blank = refuse writes
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8799"))

AGENT_STATE = ARC_ROOT / "agent_state.json"
JOB_STATE = ARC_ROOT / "job_state.json"


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _job_env(deliverable_hash: str):
    """Environment for running 3_create_job.py: inject the deliverable hash and
    REMOVE proxy vars. The .env HTTP_PROXY/HTTPS_PROXY exist for Circle/x402 on
    Base mainnet, but web3 would route the Arc testnet RPC through them too and
    fail to connect ('Arc RPC недоступен'). Arc RPC needs a DIRECT connection.
    """
    env = dict(os.environ)
    # Set proxy vars to EMPTY (not delete): the script calls load_dotenv(), which
    # would re-read HTTP_PROXY/HTTPS_PROXY from the .env file if the keys are
    # absent — but load_dotenv does NOT overwrite keys that already exist, so an
    # explicit empty string keeps the proxy off. NO_PROXY="*" is a belt-and-braces
    # guard for requests/urllib3 used by web3.
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
        env[k] = ""
    env["NO_PROXY"] = "*"
    env["no_proxy"] = "*"
    env["JOB_DELIVERABLE"] = deliverable_hash
    return env


try:
    from fastapi import FastAPI, Header, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    FastAPI = None  # allows importing this module for its helpers without deps


def _require(token: str):
    if not BRIDGE_TOKEN or token != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="Bad bridge token")


def build_app():
    app = FastAPI(title="Pascual Agent Bridge", version="0.1")
    # Only the local hub dev origin needs access; keep it tight.
    app.add_middleware(
        CORSMiddleware, allow_origins=["http://localhost", "http://127.0.0.1"],
        allow_methods=["GET", "POST"], allow_headers=["*"],
    )

    @app.get("/health")
    def health():
        return {"ok": True, "root": str(ARC_ROOT), "writes_enabled": bool(BRIDGE_TOKEN)}

    @app.get("/agent")
    def agent(x_bridge_token: str = Header(default="")):
        _require(x_bridge_token)
        return {"agent": _read_json(AGENT_STATE), "job": _read_json(JOB_STATE)}

    @app.post("/create-job")
    def create_job(payload: dict, x_bridge_token: str = Header(default="")):
        """Turn an X-analysis deliverable hash into a real ERC-8183 job.

        WIRING (left to the user — moves real testnet USDC):
        1. import the create-job flow from 3_create_job.py, OR shell out:
             subprocess.run(["python", str(ARC_ROOT / "3_create_job.py")], ...)
           passing the deliverable hash via env/args.
        2. The deliverable = payload["job_hash"] (keccak256 of the analysis,
           already computed by the hub at ingest).
        3. Return the resulting job_id + tx hash so the hub can link it.

        Stubbed on purpose: creating a job funds a USDC escrow, so it must be
        an explicit, user-confirmed action, not an automatic web call.
        """
        _require(x_bridge_token)
        job_hash = str(payload.get("job_hash", ""))
        if not job_hash.startswith("0x") or len(job_hash) != 66:
            raise HTTPException(status_code=400, detail="Bad job_hash")

        # Guard: creating a job funds a real USDC escrow. Require an explicit
        # opt-in flag so an accidental call can't spend testnet USDC.
        if not payload.get("confirm"):
            raise HTTPException(status_code=400, detail="Set confirm:true — this funds a USDC escrow")

        # Run the existing 3_create_job.py with our deliverable hash injected via
        # env (the script reads JOB_DELIVERABLE). Full lifecycle: createJob →
        # setBudget → approve → fund → submit(deliverable) → complete.
        script = ARC_ROOT / "3_create_job.py"
        if not script.exists():
            raise HTTPException(status_code=500, detail=f"Script not found: {script}")
        env = _job_env(job_hash)
        try:
            proc = subprocess.run(
                [sys.executable, str(script)],
                cwd=str(ARC_ROOT), env=env,
                capture_output=True, text=True, timeout=900,  # up to 15 min (chain waits)
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Job creation timed out (chain slow)")

        ok = proc.returncode == 0
        # Try to surface the new job_id from job_state.json (the script writes it).
        job_id = None
        js = _read_json(JOB_STATE)
        if js:
            job_id = js.get("job_id")
        return {
            "ok": ok,
            "deliverable": job_hash,
            "job_id": job_id,
            "returncode": proc.returncode,
            # Tail of output for debugging (never the full log — may be long).
            "log_tail": (proc.stdout or "")[-1500:] + (("\nERR:\n" + proc.stderr[-800:]) if proc.stderr else ""),
        }

    return app


# ---- Autonomous loop: poll the hub for un-anchored analyses and create an
# ERC-8183 job for each. Run with:  python bridge.py loop
# Needs HUB_API and HUB_TOKEN (a session token; get it by linking the extension
# or copy from the site's localStorage 'pascual_hub_token').
def run_loop():
    import time
    import urllib.request
    # Opener that ignores env proxies — the hub is reached directly.
    global _direct_opener
    _direct_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    HUB = os.environ.get("HUB_API", "https://pascual-hub-api.pascuallabs.workers.dev").rstrip("/")
    TOKEN = os.environ.get("HUB_TOKEN", "")
    INTERVAL = int(os.environ.get("LOOP_INTERVAL", "120"))
    if not TOKEN:
        raise SystemExit("Set HUB_TOKEN (session token) to run the loop.")
    # Validate token shape: our session token is "0xADDRESS.EXP.HMAC" (3 parts).
    # This catches the common mistake of pasting some other extension's UUID or
    # the literal "<этот токен>" placeholder.
    parts = TOKEN.split(".")
    if not (TOKEN.startswith("0x") and len(parts) == 3 and len(parts[0]) == 42):
        raise SystemExit(
            "HUB_TOKEN не похож на токен хаба (нужен вид 0xАДРЕС.EXP.HMAC).\n"
            "Возьми его на сайте: F12 → Console → localStorage.getItem('pascual_hub_token')\n"
            "Убедись, что ты ЗАЛОГИНЕН кошельком, и вставь значение БЕЗ угловых скобок."
        )
    # Cheap test budget by default in the loop (override JOB_BUDGET to change).
    os.environ.setdefault("JOB_BUDGET", "100000")  # 0.1 tUSDC per job

    def hub(path, method="GET", body=None):
        req = urllib.request.Request(
            HUB + path, method=method,
            data=(json.dumps(body).encode() if body else None),
            headers={
                "Authorization": "Bearer " + TOKEN,
                "Content-Type": "application/json",
                # Cloudflare in front of the Worker blocks default Python-urllib
                # User-Agent (error 1010). A browser-like UA passes.
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PascualBridge/1.0",
            },
        )
        # Bypass the .env HTTP_PROXY/HTTPS_PROXY (those exist to route the Arc
        # scripts around geo-blocks; the hub must be reached DIRECTLY, else the
        # proxy returns 403). A no-proxy opener forces a direct connection.
        with _direct_opener.open(req, timeout=30) as r:
            return json.loads(r.read().decode())

    print(f"[loop] polling {HUB} every {INTERVAL}s. Each pending analysis → one ERC-8183 job (real tUSDC escrow).")
    app_create = None  # reuse the FastAPI handler logic inline instead
    while True:
        try:
            pending = hub("/api/x/pending").get("items", [])
            if not pending:
                print("[loop] нет новых анализов для анкеринга.")
            for item in pending:
                jh = item.get("job_hash", "")
                if not (jh.startswith("0x") and len(jh) == 66):
                    continue
                print(f"[loop] анкерю анализ {item['id']} → deliverable {jh[:12]}…")
                env = _job_env(jh)
                proc = subprocess.run([sys.executable, str(ARC_ROOT / "3_create_job.py")],
                                      cwd=str(ARC_ROOT), env=env, capture_output=True, text=True, timeout=900)
                js = _read_json(JOB_STATE) or {}
                job_id = js.get("job_id")
                if proc.returncode == 0 and job_id:
                    hub("/api/x/anchor", "POST", {"id": item["id"], "job_id": job_id})
                    print(f"[loop] ✓ создано задание #{job_id}, отмечено в хабе.")
                else:
                    # Errors from the script go to stdout (print), so show its tail.
                    tail = ((proc.stdout or "") + (proc.stderr or "")).strip()[-300:]
                    print(f"[loop] ✗ не удалось (код {proc.returncode}). {tail}")
        except Exception as e:
            print(f"[loop] ошибка: {e}")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "loop":
        run_loop()
    elif FastAPI is None:
        raise SystemExit("Install deps first: pip install fastapi uvicorn (see README.md)")
    else:
        uvicorn.run(build_app(), host="127.0.0.1", port=BRIDGE_PORT)
