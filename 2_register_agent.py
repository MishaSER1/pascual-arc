"""
Шаг 2: Регистрация AI-агента на Arc Testnet (ERC-8004)
Использует web3.py напрямую — без Circle SDK (обход geo-block).

Контракты Arc Testnet:
  IdentityRegistry:   0x8004A818BFB912233c491871b3d84c89A494BD9e
  ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
  ValidationRegistry: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
"""
import os
import sys
import json
import time
from dotenv import load_dotenv, set_key
from web3 import Web3
from eth_account import Account

load_dotenv(r"d:\Soft\Arc\.env")
ENV_PATH = r"d:\Soft\Arc\.env"
STATE_FILE = r"d:\Soft\Arc\agent_state.json"

ARC_RPC             = "https://rpc.testnet.arc.network/"
IDENTITY_REGISTRY   = "0x8004A818BFB912233c491871b3d84c89A494BD9e"
REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713"
VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272"
METADATA_URI        = "ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei"
CHAIN_ID            = 5042002

# ── ABI минимальные ──────────────────────────────────────────────────────────
IDENTITY_ABI = [
    {"inputs": [{"name": "metadataURI", "type": "string"}],
     "name": "register", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"anonymous": False, "inputs": [
        {"indexed": True, "name": "from",    "type": "address"},
        {"indexed": True, "name": "to",      "type": "address"},
        {"indexed": True, "name": "tokenId", "type": "uint256"}],
     "name": "Transfer", "type": "event"},
]

REPUTATION_ABI = [
    {"inputs": [
        {"name": "agentId",      "type": "uint256"},
        {"name": "score",        "type": "int128"},
        {"name": "category",     "type": "uint8"},
        {"name": "tag",          "type": "string"},
        {"name": "comment",      "type": "string"},
        {"name": "extraData1",   "type": "string"},
        {"name": "extraData2",   "type": "string"},
        {"name": "feedbackHash", "type": "bytes32"}],
     "name": "giveFeedback", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]

VALIDATION_ABI = [
    {"inputs": [
        {"name": "validator",    "type": "address"},
        {"name": "agentId",      "type": "uint256"},
        {"name": "requestURI",   "type": "string"},
        {"name": "requestHash",  "type": "bytes32"}],
     "name": "validationRequest", "outputs": [{"name": "", "type": "bytes32"}],
     "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [
        {"name": "requestHash",  "type": "bytes32"},
        {"name": "score",        "type": "uint8"},
        {"name": "comment",      "type": "string"},
        {"name": "evidenceHash", "type": "bytes32"},
        {"name": "tag",          "type": "string"}],
     "name": "validationResponse", "outputs": [],
     "stateMutability": "nonpayable", "type": "function"},
]


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def get_or_create_key(env_var: str, label: str) -> str:
    key = os.getenv(env_var, "").strip()
    if not key:
        acct = Account.create()
        key = acct.key.hex()
        # Дописываем в .env через Python (не PowerShell — не ломает UTF-8)
        with open(ENV_PATH, "a", encoding="utf-8") as f:
            f.write(f"\n# {label}\n{env_var}={key}\n")
        print(f"  Создан {label}: {acct.address}")
    return key


def send_tx(w3: Web3, acct, contract_fn, gas=300_000) -> str:
    nonce = w3.eth.get_transaction_count(acct.address)
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
            if receipt:
                if receipt["status"] == 1:
                    print(f" OK\n  -> https://testnet.arcscan.app/tx/{tx_hash}")
                    return receipt
                else:
                    raise RuntimeError(f"Транзакция [{label}] reverted. Hash: {tx_hash}")
        except Exception as e:
            if "not found" not in str(e).lower() and "receipt" not in str(e).lower():
                raise
        time.sleep(3)
        print(".", end="", flush=True)
    raise TimeoutError(f"Транзакция [{label}] таймаут")


def get_agent_id(w3: Web3, owner_address: str, from_block: int) -> int:
    contract = w3.eth.contract(address=IDENTITY_REGISTRY, abi=IDENTITY_ABI)
    latest = w3.eth.block_number
    events = contract.events.Transfer.create_filter(
        from_block=max(0, from_block - 500),
        to_block=latest,
        argument_filters={"to": w3.to_checksum_address(owner_address)},
    ).get_all_entries()
    if not events:
        raise RuntimeError("Transfer event не найден — регистрация не прошла")
    return events[-1]["args"]["tokenId"]


def main():
    print("=" * 55)
    print("  Arc AI Agent Registration — ERC-8004")
    print("  (web3.py direct, без Circle SDK)")
    print("=" * 55)

    # ── Подключение ─────────────────────────────────────────────────────────
    w3 = Web3(Web3.HTTPProvider(ARC_RPC))
    if not w3.is_connected():
        print("ОШИБКА: Arc RPC недоступен")
        sys.exit(1)
    print(f"  RPC OK | Block: {w3.eth.block_number} | Chain: {w3.eth.chain_id}")

    state = load_state()

    # ── Шаг 1: Кошельки ─────────────────────────────────────────────────────
    print("\n[Шаг 1] Кошельки...")
    owner_key     = get_or_create_key("ARC_OWNER_KEY",     "Owner wallet")
    validator_key = get_or_create_key("ARC_VALIDATOR_KEY", "Validator wallet")

    owner_acct     = Account.from_key(owner_key)
    validator_acct = Account.from_key(validator_key)
    print(f"  Owner:     {owner_acct.address}")
    print(f"  Validator: {validator_acct.address}")

    # ── Шаг 2: Баланс ───────────────────────────────────────────────────────
    bal_owner = w3.eth.get_balance(owner_acct.address)
    bal_wei   = w3.from_wei(bal_owner, "ether")
    print(f"\n[Шаг 2] Баланс owner: {bal_wei} ARC")

    if bal_owner < w3.to_wei(0.001, "ether"):
        print(f"  Нужен газ! Получи нативный токен Arc:")
        print(f"  1) Зайди на https://faucet.arc.network или https://faucet.circle.com (Arc Testnet)")
        print(f"  2) Вставь адрес: {owner_acct.address}")
        input("  Нажми Enter после получения токенов...")
        bal_owner = w3.eth.get_balance(owner_acct.address)
        print(f"  Баланс: {w3.from_wei(bal_owner, 'ether')} ARC")

    # ── Шаг 3: Регистрация агента ───────────────────────────────────────────
    if "agent_id" in state:
        agent_id = state["agent_id"]
        print(f"\n[Шаг 3] Агент уже зарегистрирован. Agent ID: {agent_id}")
    else:
        print(f"\n[Шаг 3] Регистрация в IdentityRegistry...")
        block_before = w3.eth.block_number
        identity = w3.eth.contract(address=IDENTITY_REGISTRY, abi=IDENTITY_ABI)
        tx_hash = send_tx(w3, owner_acct, identity.functions.register(METADATA_URI))
        print(f"  TX: {tx_hash}")
        wait_tx(w3, tx_hash, "register")

        agent_id = get_agent_id(w3, owner_acct.address, block_before)
        state["agent_id"]         = agent_id
        state["owner_address"]    = owner_acct.address
        state["validator_address"] = validator_acct.address
        save_state(state)
        print(f"  Agent ID: {agent_id}")

    # ── Шаг 4: Репутация ────────────────────────────────────────────────────
    print(f"\n[Шаг 4] Репутация (validator -> agent)...")
    tag           = "task_completed_successfully"
    feedback_hash = w3.keccak(text=tag)
    reputation    = w3.eth.contract(address=REPUTATION_REGISTRY, abi=REPUTATION_ABI)

    # Нужен баланс у validator тоже
    bal_val = w3.eth.get_balance(validator_acct.address)
    if bal_val < w3.to_wei(0.001, "ether"):
        print(f"  Нужен газ у validator: {validator_acct.address}")
        input("  Пополни и нажми Enter...")

    tx_hash = send_tx(w3, validator_acct,
                      reputation.functions.giveFeedback(
                          agent_id, 95, 0, tag, "", "", "", feedback_hash))
    print(f"  TX: {tx_hash}")
    wait_tx(w3, tx_hash, "giveFeedback")

    # ── Шаг 5: Верификация ──────────────────────────────────────────────────
    print(f"\n[Шаг 5] Верификация (ValidationRegistry)...")
    validation    = w3.eth.contract(address=VALIDATION_REGISTRY, abi=VALIDATION_ABI)
    request_uri   = "ipfs://bafkreiexamplevalidationrequest"
    request_hash  = w3.keccak(text=f"verification_request_agent_{agent_id}")

    tx_hash = send_tx(w3, owner_acct,
                      validation.functions.validationRequest(
                          validator_acct.address, agent_id, request_uri, request_hash))
    print(f"  TX: {tx_hash}")
    wait_tx(w3, tx_hash, "validationRequest")

    evidence_hash = bytes(32)
    tx_hash = send_tx(w3, validator_acct,
                      validation.functions.validationResponse(
                          request_hash, 100, "", evidence_hash, "kyc_verified"))
    print(f"  TX: {tx_hash}")
    wait_tx(w3, tx_hash, "validationResponse")

    print("\n" + "=" * 55)
    print("  АГЕНТ ЗАРЕГИСТРИРОВАН!")
    print("=" * 55)
    print(f"  Agent ID:   {agent_id}")
    print(f"  Owner:      {owner_acct.address}")
    print(f"  Validator:  {validator_acct.address}")
    print(f"  Explorer:   https://testnet.arcscan.app")
    print(f"\n  Следующий шаг: python 3_create_job.py")
    print("=" * 55)


if __name__ == "__main__":
    main()
