"""
Обход Akamai WAF: получаем публичный ключ через curl.exe,
затем шифруем и регистрируем через curl.exe тоже.
"""
import os, base64, json, subprocess, sys
from dotenv import load_dotenv
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Hash import SHA256

load_dotenv(r"d:\Soft\Arc\.env")

api_key    = os.getenv("CIRCLE_API_KEY", "").strip()
entity_sec = os.getenv("CIRCLE_ENTITY_SECRET", "").strip()

print(f"API Key : {api_key[:25]}...")
print(f"Secret  : {entity_sec[:16]}...")
print()

# ШАГ 1: Получить публичный ключ через curl.exe
print("Шаг 1: Получаем публичный ключ (через curl.exe)...")

result = subprocess.run([
    "curl.exe", "-s",
    "-H", f"Authorization: Bearer {api_key}",
    "-H", "Content-Type: application/json",
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "https://api.circle.com/v1/w3s/config/entity/publicKey"
], capture_output=True, text=True)

print(f"  HTTP ответ: {result.stdout[:200]}")

try:
    data = json.loads(result.stdout)
    public_key_pem = data["data"]["publicKey"]
    print(f"  Публичный ключ получен!")
except Exception as e:
    print(f"  Ошибка парсинга: {e}")
    print(f"  Ответ: {result.stdout[:500]}")
    sys.exit(1)

# ШАГ 2: Шифруем Entity Secret
print("\nШаг 2: Шифруем Entity Secret...")
entity_bytes = bytes.fromhex(entity_sec)
pub_key = RSA.importKey(public_key_pem)
cipher  = PKCS1_OAEP.new(key=pub_key, hashAlgo=SHA256)
ciphertext = base64.b64encode(cipher.encrypt(entity_bytes)).decode()
print(f"  Ciphertext ({len(ciphertext)} символов): {ciphertext[:40]}...")

# ШАГ 3: Регистрируем через curl.exe
print("\nШаг 3: Регистрируем в Circle...")

body = json.dumps({"entitySecretCiphertext": ciphertext})

result2 = subprocess.run([
    "curl.exe", "-s", "-X", "POST",
    "-H", f"Authorization: Bearer {api_key}",
    "-H", "Content-Type: application/json",
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "-d", body,
    "https://api.circle.com/v1/w3s/config/entity/entitySecret"
], capture_output=True, text=True)

print(f"  Ответ: {result2.stdout}")

try:
    resp = json.loads(result2.stdout)
    if "data" in resp and "recoveryFile" in resp.get("data", {}):
        recovery = resp["data"]["recoveryFile"]
        with open(r"d:\Soft\Arc\recovery_file.dat", "w") as f:
            f.write(recovery)
        print("\n=== ГОТОВО ===")
        print("Recovery файл сохранён: d:\\Soft\\Arc\\recovery_file.dat")
        print("ВАЖНО: Сохрани его в безопасном месте!")
    elif "409" in result2.stdout or "already" in result2.stdout.lower():
        print("\n=== Entity Secret уже зарегистрирован — всё OK! ===")
    else:
        print(f"\n  Статус: {resp}")
except Exception as e:
    print(f"  Ошибка: {e}")
    print(f"  Ответ: {result2.stdout}")
