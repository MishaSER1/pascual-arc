"""
Circle Agent Stack — Marketplace Client
========================================
Маркетплейс платных API для AI-агентов (agents.circle.com).

Протокол x402:
  1. GET /endpoint -> HTTP 402 + требования к оплате
  2. Агент подписывает EIP-3009 transferWithAuthorization (USDC на BASE)
  3. GET /endpoint + X-PAYMENT header -> получаем данные

Сеть:  BASE mainnet (chain 8453)
Токен: USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
"""

import os
import json
import time
import secrets
import base64
import logging
import requests
from web3 import Web3
from eth_account import Account
from dotenv import load_dotenv

load_dotenv(r"d:\Soft\Arc\.env")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

# ── Конфиг ────────────────────────────────────────────────────────────────────
BASE_RPC      = "https://mainnet.base.org"
BASE_CHAIN_ID = 8453
USDC_BASE     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

# ── Proxy (обязательно) ───────────────────────────────────────────────────────
PROXY_URL = os.getenv("HTTP_PROXY")
if not PROXY_URL:
    log.error("CRITICAL: HTTP_PROXY not set — stopping")
    exit(1)
PROXIES = {"http": PROXY_URL, "https": PROXY_URL}

# ── Кошелёк (owner из Arc .env) ───────────────────────────────────────────────
PRIVATE_KEY = os.getenv("ARC_OWNER_KEY", "")
if not PRIVATE_KEY:
    log.error("CRITICAL: ARC_OWNER_KEY not set")
    exit(1)
acct = Account.from_key(PRIVATE_KEY)
WALLET = acct.address

# ── Web3 → BASE ───────────────────────────────────────────────────────────────
w3 = Web3(Web3.HTTPProvider(BASE_RPC, request_kwargs={"proxies": PROXIES}))

USDC_ABI_MIN = [
    {"inputs":[{"name":"account","type":"address"}],
     "name":"balanceOf","outputs":[{"name":"","type":"uint256"}],
     "stateMutability":"view","type":"function"},
    {"inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},
               {"name":"value","type":"uint256"},{"name":"validAfter","type":"uint256"},
               {"name":"validBefore","type":"uint256"},{"name":"nonce","type":"bytes32"},
               {"name":"v","type":"uint8"},{"name":"r","type":"bytes32"},{"name":"s","type":"bytes32"}],
     "name":"transferWithAuthorization","outputs":[],
     "stateMutability":"nonpayable","type":"function"},
]
usdc = w3.eth.contract(address=Web3.to_checksum_address(USDC_BASE), abi=USDC_ABI_MIN)

# ── Каталог сервисов (из маркетплейса agents.circle.com) ─────────────────────
SERVICES = [
    # name               base_url                              category         min$     notes
    ("Binance",          "https://nano.blockrun.ai",           "Crypto Prices", 0.0,     "Free — BTC/ETH цены"),
    ("BlockRun",         "https://nano.blockrun.ai",           "Crypto/AI",     0.0,     "Free tier"),
    ("Polymarket",       "https://clob.polymarket.com",        "Prediction",    0.0,     "Free — рынки"),
    ("Exa Search",       "https://api.exa.ai",                 "Web Search",    0.001,   "от $0.001"),
    ("CoinGecko",        "https://api.aisa.one",               "Crypto",        0.008,   "$0.008 via AIsa"),
    ("Twitter/X",        "https://api.aisa.one",               "Social",        0.0004,  "от $0.0004"),
    ("Google Scholar",   "https://api.aisa.one",               "Research",      0.0024,  "$0.0024"),
    ("Perplexity",       "https://api.aisa.one",               "Web Search",    0.012,   "$0.012"),
    ("QuickNode",        "https://x402.quicknode.com",         "Blockchain",    0.0001,  "от $0.0001"),
    ("Goldsky",          "https://edge.goldsky.com",           "Blockchain",    0.000005,"от $0.000005"),
    ("Alchemy",          "https://x402.alchemy.com",           "Blockchain",    0.001,   "$0.001"),
    ("Messari",          "https://api.messari.io",             "Crypto",        0.0,     "Free tier"),
    ("Tavily",           "https://api.aisa.one",               "Web Search",    0.0096,  "$0.0096"),
    ("YouTube",          "https://api.aisa.one",               "Social",        0.0024,  "$0.0024"),
    ("Serper",           "https://stableenrich.dev",           "Web Search",    0.04,    "от $0.04"),
    ("Reddit",           "https://stableenrich.dev",           "Social",        0.02,    "$0.02"),
    ("Google Maps",      "https://stableenrich.dev",           "Location",      0.02,    "от $0.02"),
    ("AgentMail",        "https://x402.api.agentmail.to",      "Email/Infra",   0.0,     "Free tier"),
    ("EMC2 AI",          "https://emc2ai.io",                  "AI Compute",    0.25,    "от $0.25"),
    ("Parallel",         "https://parallelmpp.dev",            "Web Search",    0.01,    "от $0.01"),
]

# ── x402 Протокол — подпись EIP-3009 ──────────────────────────────────────────
def sign_usdc_transfer(to_address: str, amount_usdc_6dec: int, valid_seconds: int = 300) -> dict:
    """
    Подписывает EIP-3009 transferWithAuthorization для USDC на BASE.
    Возвращает payload для X-PAYMENT header.
    """
    now = int(time.time())
    valid_after  = 0
    valid_before = now + valid_seconds
    nonce = "0x" + secrets.token_hex(32)

    domain = {
        "name": "USD Coin",
        "version": "2",
        "chainId": BASE_CHAIN_ID,
        "verifyingContract": USDC_BASE,
    }
    message = {
        "from":        WALLET,
        "to":          Web3.to_checksum_address(to_address),
        "value":       amount_usdc_6dec,
        "validAfter":  valid_after,
        "validBefore": valid_before,
        "nonce":       bytes.fromhex(nonce[2:]),
    }
    structured = {
        "domain": domain,
        "message": message,
        "primaryType": "TransferWithAuthorization",
        "types": {
            "EIP712Domain": [
                {"name": "name",              "type": "string"},
                {"name": "version",           "type": "string"},
                {"name": "chainId",           "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "TransferWithAuthorization": [
                {"name": "from",        "type": "address"},
                {"name": "to",         "type": "address"},
                {"name": "value",      "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore","type": "uint256"},
                {"name": "nonce",      "type": "bytes32"},
            ],
        },
    }
    signed = acct.sign_typed_data(
        domain_data=domain,
        message_types={"TransferWithAuthorization": structured["types"]["TransferWithAuthorization"]},
        message_data=message,
    )
    payload = {
        "scheme": "exact",
        "network": "base-mainnet",
        "payload": {
            "signature": signed.signature.hex(),
            "authorization": {
                "from":        WALLET,
                "to":          Web3.to_checksum_address(to_address),
                "value":       str(amount_usdc_6dec),
                "validAfter":  str(valid_after),
                "validBefore": str(valid_before),
                "nonce":       nonce,
            },
        },
    }
    return payload

def x402_call(url: str, params: dict = None, method: str = "GET") -> dict:
    """
    Полный x402 flow:
      1. Запрос без оплаты
      2. Если 402 — подписать + повторить с X-PAYMENT
      3. Вернуть данные
    """
    headers = {"User-Agent": "circle-agent/1.0", "Accept": "application/json"}

    # Шаг 1: probe request
    if method == "GET":
        r = requests.get(url, params=params, headers=headers, proxies=PROXIES, timeout=20)
    else:
        r = requests.post(url, json=params, headers=headers, proxies=PROXIES, timeout=20)

    if r.status_code == 200:
        return r.json()

    if r.status_code != 402:
        return {"error": f"HTTP {r.status_code}", "body": r.text[:300]}

    # Шаг 2: парсим требования к оплате
    try:
        pay_req = r.json()
    except Exception:
        return {"error": "Cannot parse 402 body", "body": r.text[:300]}

    log.info(f"x402: payment required — {json.dumps(pay_req, indent=2)[:400]}")

    # Находим вариант оплаты (exact scheme, base-mainnet)
    accepts = pay_req.get("accepts", [])
    chosen = None
    for a in accepts:
        if a.get("scheme") == "exact" and "base" in a.get("network", "").lower():
            chosen = a
            break
    if not chosen:
        return {"error": "No compatible payment scheme", "accepts": accepts}

    pay_to = chosen.get("payTo", chosen.get("pay_to", ""))
    amount_raw = int(chosen.get("maxAmountRequired", chosen.get("amount", "0")))

    log.info(f"  payTo={pay_to}, amount={amount_raw} (6dec = ${amount_raw/1e6:.6f} USDC)")

    if amount_raw > 0:
        # Проверяем баланс
        balance = usdc.functions.balanceOf(WALLET).call()
        if balance < amount_raw:
            return {
                "error": "Insufficient USDC balance on BASE",
                "needed": f"${amount_raw/1e6:.4f}",
                "have":   f"${balance/1e6:.4f}",
                "wallet": WALLET,
                "tip": "Fund wallet at https://coinbase.com or bridge USDC to BASE",
            }

    # Шаг 3: подписываем и повторяем
    payment_payload = sign_usdc_transfer(pay_to, amount_raw)
    x_payment = base64.b64encode(json.dumps(payment_payload).encode()).decode()

    headers["X-PAYMENT"] = x_payment
    if method == "GET":
        r2 = requests.get(url, params=params, headers=headers, proxies=PROXIES, timeout=30)
    else:
        r2 = requests.post(url, json=params, headers=headers, proxies=PROXIES, timeout=30)

    if r2.status_code == 200:
        return r2.json()
    return {"error": f"HTTP {r2.status_code} after payment", "body": r2.text[:300]}


# ── Конкретные вызовы сервисов ─────────────────────────────────────────────────
def get_crypto_price_binance(symbol: str = "BTCUSDT") -> dict:
    """Binance public REST API (бесплатно, без ключа)."""
    url = f"https://api.binance.com/api/v3/ticker/price"
    r = requests.get(url, params={"symbol": symbol}, headers={"User-Agent": "curl/7.68.0"}, proxies=PROXIES, timeout=15)
    if r.status_code == 200:
        return r.json()
    # fallback: через blockrun
    url2 = f"https://nano.blockrun.ai/api/v3/ticker/price"
    r2 = requests.get(url2, params={"symbol": symbol}, headers={"User-Agent": "curl/7.68.0"}, proxies=PROXIES, timeout=15)
    return r2.json() if r2.status_code == 200 else {"error": f"HTTP {r2.status_code}"}

def get_polymarket_markets(limit: int = 5) -> dict:
    """Топ рынки Polymarket (бесплатно)."""
    url = "https://gamma-api.polymarket.com/markets"
    return x402_call(url, params={"limit": limit, "active": "true", "closed": "false"})

def search_web_exa(query: str) -> dict:
    """Поиск через Exa ($0.001 за запрос, нужен USDC на BASE)."""
    url = "https://api.exa.ai/search"
    return x402_call(url, params={"query": query, "numResults": 5}, method="POST")

def get_coingecko_price(coin_id: str = "bitcoin") -> dict:
    """Цена через AIsa/CoinGecko ($0.008)."""
    url = f"https://api.aisa.one/coingecko/v3/simple/price"
    return x402_call(url, params={"ids": coin_id, "vs_currencies": "usd"})

def get_messari_asset(asset: str = "bitcoin") -> dict:
    """Данные Messari (бесплатный tier, без авторизации)."""
    url = f"https://data.messari.io/api/v1/assets/{asset}/metrics"
    r = requests.get(url, headers={"User-Agent": "curl/7.68.0"}, proxies=PROXIES, timeout=15)
    return r.json() if r.status_code == 200 else {"error": f"HTTP {r.status_code}", "body": r.text[:200]}


# ── Главная ───────────────────────────────────────────────────────────────────
def show_marketplace():
    print("\n" + "=" * 62)
    print("  Circle Agent Stack — Marketplace")
    print("  agents.circle.com | BASE chain | USDC payments")
    print("=" * 62)
    print(f"\n  Wallet:  {WALLET}")

    if w3.is_connected():
        try:
            balance_6 = usdc.functions.balanceOf(WALLET).call()
            eth_bal   = w3.eth.get_balance(WALLET)
            print(f"  USDC:    ${balance_6 / 1e6:.4f}")
            print(f"  ETH:     {w3.from_wei(eth_bal, 'ether'):.6f} (for gas)")
        except Exception as e:
            print(f"  Balance: (не удалось получить: {e})")
    else:
        print("  BASE RPC: недоступен")

    print("\n  Доступные сервисы (маркетплейс):")
    print(f"  {'#':>2}  {'Сервис':<18} {'Категория':<16} {'Мин.цена':>9}  Описание")
    print("  " + "-" * 60)
    free = [s for s in SERVICES if s[3] == 0.0]
    paid = [s for s in SERVICES if s[3] > 0.0]
    for i, s in enumerate(free + paid, 1):
        price_str = "FREE" if s[3] == 0.0 else f"${s[3]:.4f}"
        print(f"  {i:>2}  {s[0]:<18} {s[2]:<16} {price_str:>9}  {s[4]}")
    print()

def main():
    show_marketplace()

    print("=" * 62)
    print("  Демо-вызовы (начинаем с бесплатных)")
    print("=" * 62)

    # 1. Binance — BTC цена (FREE)
    print("\n[1] Binance — BTC/USD цена (FREE)")
    result = get_crypto_price_binance("BTCUSDT")
    if "error" not in result:
        print(f"  BTC = ${float(result.get('price', 0)):,.2f}")
    else:
        print(f"  Результат: {result}")

    # 2. Binance — ETH цена (FREE)
    print("\n[2] Binance — ETH/USD цена (FREE)")
    result = get_crypto_price_binance("ETHUSDT")
    if "error" not in result:
        print(f"  ETH = ${float(result.get('price', 0)):,.2f}")
    else:
        print(f"  Результат: {result}")

    # 3. Polymarket — топ рынки (FREE)
    print("\n[3] Polymarket — топ предсказания (FREE)")
    result = get_polymarket_markets(3)
    if isinstance(result, list):
        for m in result[:3]:
            q = m.get("question", m.get("title", "?"))
            print(f"  -> {q[:70]}")
    elif "error" not in result:
        print(f"  {str(result)[:200]}")
    else:
        print(f"  Результат: {result}")

    # 4. Messari (FREE tier)
    print("\n[4] Messari — Bitcoin метрики (FREE tier)")
    result = get_messari_asset("bitcoin")
    if "data" in result:
        metrics = result["data"].get("market_data", {})
        price = metrics.get("price_usd", "?")
        vol   = metrics.get("volume_last_24_hours", "?")
        print(f"  BTC price: ${price:,.2f}" if isinstance(price, float) else f"  {price}")
        print(f"  Volume 24h: ${vol:,.0f}" if isinstance(vol, float) else f"  vol: {vol}")
    else:
        print(f"  Результат: {str(result)[:200]}")

    print("\n" + "=" * 62)
    print("  Для платных сервисов нужен USDC на BASE chain:")
    print(f"  Адрес: {WALLET}")
    print("  Пополнить: https://coinbase.com -> send to Base -> USDC")
    print("=" * 62)

    # Инструкция по пополнению
    if w3.is_connected():
        try:
            balance_6 = usdc.functions.balanceOf(WALLET).call()
            if balance_6 < 1_000_000:  # меньше $1
                print("\n  [!] Баланс USDC < $1. Для платных API нужно пополнить кошелёк.")
                print("  [!] Примерные затраты на 1 день тестнет-активности: $0.05-$0.50")
        except Exception:
            pass

if __name__ == "__main__":
    main()
