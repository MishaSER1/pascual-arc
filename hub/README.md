# Pascual Hub — кошелёк-центричный командный центр

Фаза 1: сайт-кабинет с входом по кошельку + Wallet Radar (слежение за кошельками).
Архитектура: см. артефакт-план. Всё на бесплатных тирах Cloudflare + публичных on-chain API.

## Структура

```
hub/
├── public/index.html   ← фронтенд (Cloudflare Pages): вход кошельком, дашборд, Wallet Radar
├── worker.js           ← бэкенд API (Cloudflare Worker): auth, watchlist, on-chain summary
├── crypto.js           ← keccak-256 + secp256k1 ecrecover (общий с расширением, проверен)
├── schema.sql          ← D1: profiles, watchlist
└── wrangler.toml       ← конфиг worker'а (заполнить id KV и D1)
```

## Как работает вход

1. `GET /api/auth/nonce?address=0x…` → сервер выдаёт одноразовый nonce (60с, в KV) и текст сообщения.
2. Кошелёк подписывает сообщение (`personal_sign`, бесплатно, без транзакции).
3. `POST /api/auth/verify {address, signature}` → сервер восстанавливает адрес из подписи (локальный ecrecover, без RPC), сверяет с nonce, удаляет nonce (одноразовый), выдаёт сессионный токен (HMAC, 7 дней).
4. Дальнейшие запросы шлют `Authorization: Bearer <token>`.

Приватный ключ никогда не покидает кошелёк. Nonce одноразовый — подпись нельзя переиспользовать.

## Деплой (нужен ваш аккаунт Cloudflare)

```powershell
cd D:\Soft\Arc\hub

# 1. Создать хранилища
npx wrangler kv namespace create SESS          # → вставить id в wrangler.toml (SESS)
npx wrangler d1 create pascual-hub             # → вставить database_id в wrangler.toml (DB)
npx wrangler d1 execute pascual-hub --file=schema.sql --remote

# 2. Секрет сессий
npx wrangler secret put SESSION_SECRET         # ввести длинную случайную строку

# 3. Задеплоить API
npx wrangler deploy                            # запомнить URL вида https://pascual-hub-api.<...>.workers.dev

# 4. Задеплоить фронтенд на Pages
npx wrangler pages deploy public --project-name pascual-hub
```

После деплоя: открыть сайт Pages, в консоли браузера один раз выполнить
`localStorage.setItem("pascual_hub_api", "https://pascual-hub-api.<...>.workers.dev")`
(или потом впишем поле настроек), затем «Подключить кошелёк».

Также пропишите в `wrangler.toml` → `ALLOWED_ORIGIN` = URL вашего Pages-сайта и передеплойте worker (CORS).

## Что дальше (следующие фазы)

- Фаза 2+: обогатить Wallet Radar (токены, NFT, история tx, карты активности) — заменить `fetchWalletSummary` на Alchemy/Covalent/DeBank free-tier.
- Фаза 3: X Cockpit — расширение Pascual Reply Pro шлёт в кабинет результаты Analyze/Sentiment.
- Фаза 4: Signal Feed (RSS + крипто-API + AI-сводки).
- Фаза 5: кредиты/x402 (переиспользовать из расширения), ERC-8183 jobs, заявка на грант.

## Границы (важно)

- On-chain данные — публичные, легальные, бесплатные.
- X-данные — ТОЛЬКО через расширение (браузер пользователя). Никакого серверного скрапинга X.
- Чужие твиты на сервере не храним — только вычисленный анализ.
