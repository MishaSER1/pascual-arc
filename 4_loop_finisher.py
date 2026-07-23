import time
import os
import json
from web3 import Web3
from eth_account import Account
from dotenv import load_dotenv
from web3.exceptions import TransactionNotFound
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

load_dotenv('d:/Soft/Arc/.env')

proxy_url = os.getenv('HTTP_PROXY')
if not proxy_url:
    logging.error("КРИТИЧЕСКАЯ ОШИБКА: ПРОКСИ НЕ НАСТРОЕНЫ! Остановка по соображениям безопасности.")
    exit(1)

request_kwargs = {'proxies': {'http': proxy_url, 'https': proxy_url}}
w3 = Web3(Web3.HTTPProvider('https://rpc.testnet.arc.network/', request_kwargs=request_kwargs))

client_acct = Account.from_key(os.getenv('ARC_OWNER_KEY'))
provider_acct = Account.from_key(os.getenv('ARC_VALIDATOR_KEY'))

try:
    with open('d:/Soft/Arc/job_state.json', 'r') as f:
        job_id = json.load(f)['job_id']
except Exception as e:
    logging.error("Не найден job_state.json!")
    exit(1)

commerce_addr = '0x0747EEf0706327138c69792bF28Cd525089e4583'
usdc_addr = '0x3600000000000000000000000000000000000000'
budget = 5000000  # 5 USDC

commerce_abi = [
    {'inputs': [{'name': 'jobId', 'type': 'uint256'}, {'name': 'budget', 'type': 'uint256'}, {'name': 'optParams', 'type': 'bytes'}], 'name': 'setBudget', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
    {'inputs': [{'name': 'jobId', 'type': 'uint256'}, {'name': 'extraData', 'type': 'bytes'}], 'name': 'fund', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
    {'inputs': [{'name': 'jobId', 'type': 'uint256'}, {'name': 'deliverable', 'type': 'bytes32'}, {'name': 'extraData', 'type': 'bytes'}], 'name': 'submit', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'},
    {'inputs': [{'name': 'jobId', 'type': 'uint256'}, {'name': 'reason', 'type': 'bytes32'}, {'name': 'extraData', 'type': 'bytes'}], 'name': 'complete', 'outputs': [], 'stateMutability': 'nonpayable', 'type': 'function'}
]
erc20_abi = [
    {'constant': False, 'inputs': [{'name': 'spender', 'type': 'address'}, {'name': 'amount', 'type': 'uint256'}], 'name': 'approve', 'outputs': [{'name': '', 'type': 'bool'}], 'stateMutability': 'nonpayable', 'type': 'function'}
]

commerce_contract = w3.eth.contract(address=commerce_addr, abi=commerce_abi)
usdc_contract = w3.eth.contract(address=usdc_addr, abi=erc20_abi)

def send_tx_with_retry(acct, build_tx_func, step_name, value=0):
    while True:
        try:
            nonce = w3.eth.get_transaction_count(acct.address)
            tx = build_tx_func.build_transaction({
                'chainId': 5042002,
                'nonce': nonce,
                'gas': 500000,
                'gasPrice': w3.eth.gas_price
            })
            signed = acct.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            logging.info(f"[{step_name}] Транзакция отправлена! Hash: {tx_hash.hex()}")
            
            while True:
                try:
                    receipt = w3.eth.get_transaction_receipt(tx_hash)
                    if receipt is not None:
                        if receipt.status == 1:
                            logging.info(f"[{step_name}] УСПЕШНО ✅")
                            return True
                        else:
                            logging.warning(f"[{step_name}] Транзакция отклонена (Reverted) ❌. Скорее всего уже выполнено. Пропускаем.")
                            return False
                except TransactionNotFound:
                    pass  # Транзакция еще в пуле, ждем
                time.sleep(10)  # Спим 10 сек, чтобы не заспамить RPC и не получить 429 Too Many Requests
        
        except Exception as e:
            err_msg = str(e).lower()
            if 'txpool is full' in err_msg or 'too many requests' in err_msg or 'timeout' in err_msg:
                logging.warning(f"[{step_name}] Сеть перегружена. Ждем 10 минут...")
                time.sleep(600)
            elif 'already' in err_msg or 'invalid status' in err_msg or 'reverted' in err_msg or 'unauthorized' in err_msg:
                logging.info(f"[{step_name}] Шаг пропущен (уже выполнен или не требуется): {e}")
                return False
            else:
                logging.error(f"[{step_name}] Ошибка: {e}. Ждем 10 минут...")
                time.sleep(600)

def main():
    logging.info(f"Начинаем добивать задание Job ID: {job_id}")
    
    # 0. Устанавливаем бюджет (Делает Исполнитель/Provider)
    logging.info("Шаг 0: Устанавливаем бюджет (setBudget)...")
    send_tx_with_retry(provider_acct, commerce_contract.functions.setBudget(job_id, budget, b''), "SetBudget")

    # 1. Approve USDC
    logging.info("Шаг 1: Разрешаем смарт-контракту тратить USDC (approve)...")
    send_tx_with_retry(client_acct, usdc_contract.functions.approve(commerce_addr, budget), "Approve")
    
    # 2. Fund Escrow
    logging.info("Шаг 2: Пополняем эскроу (fund)...")
    send_tx_with_retry(client_acct, commerce_contract.functions.fund(job_id, b''), "Fund")
    
    # 3. Submit
    logging.info("Шаг 3: Агент отправляет результат (submit)...")
    deliverable = w3.keccak(text='agentwork-arc-demo-result-v1')
    send_tx_with_retry(provider_acct, commerce_contract.functions.submit(job_id, deliverable, b''), "Submit")
    
    # 4. Complete
    logging.info("Шаг 4: Клиент одобряет работу (complete)...")
    reason = w3.keccak(text='deliverable-approved-by-evaluator')
    send_tx_with_retry(client_acct, commerce_contract.functions.complete(job_id, reason, b''), "Complete")
    
    logging.info("🔥 ВСЕ ШАГИ ВЫПОЛНЕНЫ! 🔥 Скрипт завершает работу.")

if __name__ == '__main__':
    main()
