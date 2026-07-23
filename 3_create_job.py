"""
Шаг 3: Полный жизненный цикл ERC-8183 задания на Arc Testnet
Использует web3.py напрямую — без Circle SDK (обход geo-block).

Официальный контракт:
  AgenticCommerce: 0x0747EEf0706327138c69792bF28Cd525089e4583
"""
import os
import sys
import json
import time
from dotenv import load_dotenv
from web3 import Web3
from eth_account import Account

load_dotenv(r"d:\Soft\Arc\.env")
ENV_PATH = r"d:\Soft\Arc\.env"
JOB_STATE_FILE = r"d:\Soft\Arc\job_state.json"

AGENTIC_COMMERCE = "0x0747EEf0706327138c69792bF28Cd525089e4583"
USDC_ADDRESS     = "0x3600000000000000000000000000000000000000"
ARC_RPC          = "https://rpc.testnet.arc.network/"
JOB_BUDGET       = int(os.environ.get("JOB_BUDGET", "5000000"))  # 5 USDC default (6 dec); override via env for cheap tests
CHAIN_ID         = 5042002

ERC20_ABI = [
    {"constant": False, "inputs": [
        {"name": "spender", "type": "address"},
        {"name": "amount", "type": "uint256"}],
     "name": "approve", "outputs": [{"name": "", "type": "bool"}],
     "stateMutability": "nonpayable", "type": "function"},
]

AGENTIC_COMMERCE_ABI = [
    {"inputs": [
        {"name": "provider", "type": "address"},
        {"name": "evaluator", "type": "address"},
        {"name": "expectedEndDate", "type": "uint256"},
        {"name": "expectedDeliverable", "type": "string"},
        {"name": "jobToken", "type": "address"}],
     "name": "createJob", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [
        {"name": "jobId", "type": "uint256"},
        {"name": "amount", "type": "uint256"},
        {"name": "extraData", "type": "bytes"}],
     "name": "setBudget", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [
        {"name": "jobId", "type": "uint256"},
        {"name": "extraData", "type": "bytes"}],
     "name": "fund", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [
        {"name": "jobId", "type": "uint256"},
        {"name": "deliverable", "type": "bytes32"},
        {"name": "extraData", "type": "bytes"}],
     "name": "submit", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [
        {"name": "jobId", "type": "uint256"},
        {"name": "reason", "type": "bytes32"},
        {"name": "extraData", "type": "bytes"}],
     "name": "complete", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"anonymous": False, "inputs": [
        {"indexed": True, "name": "jobId", "type": "uint256"},
        {"indexed": True, "name": "client", "type": "address"},
        {"indexed": True, "name": "provider", "type": "address"},
        {"indexed": False, "name": "evaluator", "type": "address"},
        {"indexed": False, "name": "expectedEndDate", "type": "uint256"},
        {"indexed": False, "name": "jobToken", "type": "address"}],
     "name": "JobCreated", "type": "event"},
]

def load_state(filename):
    if os.path.exists(filename):
        with open(filename) as f:
            return json.load(f)
    return {}

def save_state(state, filename):
    with open(filename, "w") as f:
        json.dump(state, f, indent=2)

def send_tx(w3: Web3, acct, contract_fn, gas=500_000) -> str:
    # Use "pending" nonce so a still-unconfirmed previous tx doesn't cause the
    # next tx to reuse the same nonce and hang forever (was the setBudget timeout).
    nonce = w3.eth.get_transaction_count(acct.address, "pending")
    tx = contract_fn.build_transaction({
        "chainId": CHAIN_ID,
        "nonce":   nonce,
        "gas":     gas,
        "gasPrice": w3.eth.gas_price,
    })
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    return tx_hash.hex()

def wait_tx(w3: Web3, tx_hash: str, label: str, timeout=180):
    print(f"  Ожидание [{label}]", end="", flush=True)
    start = time.time()
    while time.time() - start < timeout:
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
        except Exception:
            # "not found yet" — tx still pending. Keep polling (this is the ONLY
            # case we swallow; a real revert surfaces below via status check).
            receipt = None
        if receipt is not None:
            if receipt["status"] == 1:
                print(f" OK\n  -> https://testnet.arcscan.app/tx/{tx_hash}")
                return receipt
            else:
                raise RuntimeError(f"Транзакция [{label}] REVERTED. Hash: {tx_hash} -> https://testnet.arcscan.app/tx/{tx_hash}")
        time.sleep(3)
        print(".", end="", flush=True)
    raise TimeoutError(f"Транзакция [{label}] таймаут")

def get_job_id_from_tx(w3: Web3, tx_receipt) -> int:
    contract = w3.eth.contract(address=AGENTIC_COMMERCE, abi=AGENTIC_COMMERCE_ABI)
    logs = contract.events.JobCreated().process_receipt(tx_receipt)
    if not logs:
        raise RuntimeError("Событие JobCreated не найдено")
    return logs[0]["args"]["jobId"]

def main():
    print("=" * 55)
    print("  Arc ERC-8183 Job Lifecycle")
    print("  (web3.py direct, без Circle SDK)")
    print("=" * 55)

    w3 = Web3(Web3.HTTPProvider(ARC_RPC))
    if not w3.is_connected():
        print("ОШИБКА: Arc RPC недоступен")
        sys.exit(1)

    job_state = load_state(JOB_STATE_FILE)

    client_key = os.getenv("ARC_OWNER_KEY", "")
    provider_key = os.getenv("ARC_VALIDATOR_KEY", "")
    if not client_key or not provider_key:
        print("ОШИБКА: Ключи кошельков не найдены в .env. Запусти сначала 2_register_agent.py")
        sys.exit(1)

    client_acct   = Account.from_key(client_key)
    provider_acct = Account.from_key(provider_key)

    client_address   = client_acct.address
    provider_address = provider_acct.address

    print(f"\n[Шаг 1] Используем локальные кошельки:")
    print(f"  Client   (заказчик):   {client_address}")
    print(f"  Provider (исполнитель): {provider_address}")

    # ── Шаг 4: Создание задания ────────────────────────────────────────────
    commerce = w3.eth.contract(address=AGENTIC_COMMERCE, abi=AGENTIC_COMMERCE_ABI)
    
    # When invoked by the bridge (JOB_DELIVERABLE set), ALWAYS create a fresh job
    # — each analysis is its own job. Only reuse job_state for a bare manual rerun.
    _fresh = bool(os.environ.get("JOB_DELIVERABLE", "").strip())
    if "job_id" in job_state and not _fresh:
        job_id = job_state["job_id"]
        print(f"\n[Шаг 4] Задание уже создано. Job ID: {job_id}")
    else:
        print(f"\n[Шаг 4] Создаём задание (createJob)...")
        block    = w3.eth.get_block("latest")
        expired  = block["timestamp"] + 3600  # +1 час
        
        tx_hash = send_tx(w3, client_acct,
                          commerce.functions.createJob(
                              provider_address,
                              client_address,  # evaluator
                              expired,
                              "AgentWork demo job — Arc Testnet ERC-8183",
                              "0x0000000000000000000000000000000000000000"
                          ))
        print(f"  TX: {tx_hash}")
        receipt = wait_tx(w3, tx_hash, "createJob")
        job_id  = get_job_id_from_tx(w3, receipt)
        job_state["job_id"] = job_id
        save_state(job_state, JOB_STATE_FILE)
        print(f"  Job ID: {job_id}")

    # ── Шаг 5: Установить бюджет ───────────────────────────────────────────
    print(f"\n[Шаг 5] Устанавливаем бюджет {JOB_BUDGET / 1_000_000} USDC...")
    tx_hash = send_tx(w3, provider_acct,
                      commerce.functions.setBudget(job_id, JOB_BUDGET, b""))
    wait_tx(w3, tx_hash, "setBudget")

    # ── Шаг 6: Апрув + Эскроу ─────────────────────────────────────────────
    print(f"\n[Шаг 6] Апрув USDC для контракта...")
    usdc = w3.eth.contract(address=USDC_ADDRESS, abi=ERC20_ABI)
    tx_hash = send_tx(w3, client_acct, usdc.functions.approve(AGENTIC_COMMERCE, JOB_BUDGET))
    wait_tx(w3, tx_hash, "approve USDC")

    print(f"  Пополняем эскроу (fund)...")
    tx_hash = send_tx(w3, client_acct, commerce.functions.fund(job_id, b""))
    wait_tx(w3, tx_hash, "fund escrow")

    # ── Шаг 7: Сабмит результата ───────────────────────────────────────────
    print(f"\n[Шаг 7] Провайдер сабмитит результат...")
    # Deliverable hash: берётся из окружения (JOB_DELIVERABLE = 0x… keccak256
    # реального анализа из X Cockpit, который передаёт мост). Если не задан —
    # прежнее демо-поведение, чтобы ручной запуск не сломался.
    _env_deliv = os.environ.get("JOB_DELIVERABLE", "").strip()
    if _env_deliv.startswith("0x") and len(_env_deliv) == 66:
        deliverable = bytes.fromhex(_env_deliv[2:])
        print(f"  deliverable из анализа: {_env_deliv}")
    else:
        deliverable = w3.keccak(text="agentwork-arc-demo-result-v1")
    tx_hash = send_tx(w3, provider_acct, commerce.functions.submit(job_id, deliverable, b""))
    wait_tx(w3, tx_hash, "submit deliverable")

    # ── Шаг 8: Завершение ─────────────────────────────────────────────────
    print(f"\n[Шаг 8] Evaluator завершает задание (complete)...")
    reason = w3.keccak(text="deliverable-approved-by-evaluator")
    tx_hash = send_tx(w3, client_acct, commerce.functions.complete(job_id, reason, b""))
    wait_tx(w3, tx_hash, "complete job")

    print("\n" + "=" * 55)
    print("  ЗАДАНИЕ ЗАВЕРШЕНО — USDC ВЫПЛАЧЕН!")
    print("=" * 55)
    print(f"  Job ID:   {job_id}")
    print(f"  Client:   {client_address}")
    print(f"  Provider: {provider_address}")
    print(f"  Контракт: https://testnet.arcscan.app/address/{AGENTIC_COMMERCE}")
    print("=" * 55)

if __name__ == "__main__":
    main()
