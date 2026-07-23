# Деплой Фазы 5 — интеграция Arc/Circle-агента

Все изменения кода готовы и проверены. Ниже — точные команды. Выполнять по порядку из `D:\Soft\Arc\hub`.

## Что добавилось в Фазе 5

- **Панель ARC AGENT** — реальное ERC-8004 состояние агента #4713 (owner, репутация, метаданные), читается прямо из сети Arc testnet.
- **Панель AGENTIC COMMERCE** — реальные ERC-8183 задания (найдено 6 по владельцу), с tx-хэшами и ссылками на arcscan.
- **Панель AGENT MARKETPLACE** — каталог 20 x402-сервисов (реальный список из `5_circle_agents.py`), 5 free / 15 paid.
- **Deliverable hash** — каждый X-анализ получает keccak256-хэш и показывается как «⛓ ERC-8183 deliverable, готово к записи в сеть».
- **Мост** — `agent-bridge/bridge.py` (локальный FastAPI, связывает скрипты 1–5 с хабом; запускается тобой отдельно, см. его README).

## Деплой (Cloudflare — нужен твой аккаунт)

```powershell
cd D:\Soft\Arc\hub

# 1. Новая колонка в БД (job_hash в x_items). Идемпотентно — если колонка есть, будет ошибка "duplicate column", это ок.
npx wrangler d1 execute pascual-hub --command "ALTER TABLE x_items ADD COLUMN job_hash TEXT" --remote

# 2. (Опционально) задать agentId по умолчанию для панели ARC AGENT — по умолчанию 4713 уже зашит
#    Если хочешь другой: добавь в wrangler.toml [vars] ARC_AGENT_ID = "4713"

# 3. Задеплоить worker (теперь импортирует arc.js — wrangler сам соберёт бандл)
npx wrangler deploy

# 4. Задеплоить сайт с новыми панелями
npx wrangler pages deploy public --project-name pascual-hub
```

Затем открой `https://pascual-hub.pages.dev` (жёсткая перезагрузка Ctrl+Shift+R) — увидишь панели ARC AGENT / Agentic Commerce / Marketplace с живыми ончейн-данными агента 4713.

## Проверка после деплоя

- Панель ARC AGENT показывает `#4713`, owner `0xfb73…a9b9`, и число заданий.
- Панель Agentic Commerce — список job'ов с рабочими ссылками `tx ↗` на arcscan.
- Marketplace — сетка из 20 сервисов с ценами.
- В X Cockpit под каждым анализом — строка «⛓ ERC-8183 deliverable: 0x…».

## Мост (по желанию, отдельно от Cloudflare)

```powershell
cd D:\Soft\Arc\hub\agent-bridge
pip install fastapi uvicorn web3 eth-account python-dotenv pycryptodome
$env:BRIDGE_TOKEN = "любая-длинная-строка"
python bridge.py     # http://127.0.0.1:8799/health
```
`create-job` — заготовка (движет реальные USDC), достраиваешь под свой сценарий, см. `agent-bridge/README.md`.

## Замечания

- Arc-эндпоинты (`/api/arc/*`) читают сеть на публичном RPC + Blockscout-fallback (arcscan). Если RPC начнёт лимитировать — можно позже подключить Alchemy Arc RPC (переменная `ARC_RPC_URL` в worker'е уже поддерживается).
- Ничего из уже работавшего (вход, Wallet Radar, Signal Feed, X Cockpit, терминал) не менялось в поведении — только добавлены панели.
- Никаких выдуманных цифр: всё из сети или честное пустое состояние.
