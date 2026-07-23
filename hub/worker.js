// Pascual Hub — backend Worker
//
// Wallet-native command center API. Auth is by wallet signature (no passwords):
//   1) GET  /api/auth/nonce?address=0x..  → { nonce }  (short-lived, in KV)
//   2) POST /api/auth/verify { address, signature }  → { token }  (session HMAC)
//      The signed message embeds the nonce, so a signature can't be replayed.
//   3) Authenticated calls send  Authorization: Bearer <token>.
//
// Storage:
//   - KV  SESS   : auth nonces (60s TTL) + optional session cache
//   - D1  DB     : profiles, wallet watchlists (see schema.sql)
//
// Secrets/vars (wrangler):
//   - SESSION_SECRET : HMAC key for session tokens (wrangler secret put)
//   - ALLOWED_ORIGIN : the site origin for CORS (e.g. https://hub.pages.dev)
//
// All data sources are public/free (on-chain RPC, market APIs). No X scraping.

import { recoverPersonalSign, keccak256 } from "./crypto.js";
import { fetchAgentState, readJobs, ARC } from "./arc.js";

// x402 marketplace catalog — the real services the agent can call for USDC via
// the x402 protocol (extracted from 5_circle_agents.py). This is a real API
// directory, not invented metrics. Payment: EIP-3009 transferWithAuthorization
// on Base mainnet (chain 8453).
const X402_SERVICES = [
  { name: "Binance", category: "Crypto Prices", price: 0, notes: "BTC/ETH prices" },
  { name: "BlockRun", category: "Crypto/AI", price: 0, notes: "Free tier" },
  { name: "Polymarket", category: "Prediction", price: 0, notes: "markets" },
  { name: "Messari", category: "Crypto", price: 0, notes: "Free tier" },
  { name: "AgentMail", category: "Email/Infra", price: 0, notes: "Free tier" },
  { name: "Goldsky", category: "Blockchain", price: 0.000005, notes: "from $0.000005" },
  { name: "QuickNode", category: "Blockchain", price: 0.0001, notes: "from $0.0001" },
  { name: "Twitter/X", category: "Social", price: 0.0004, notes: "from $0.0004" },
  { name: "Exa Search", category: "Web Search", price: 0.001, notes: "from $0.001" },
  { name: "Alchemy", category: "Blockchain", price: 0.001, notes: "$0.001" },
  { name: "Google Scholar", category: "Research", price: 0.0024, notes: "$0.0024" },
  { name: "YouTube", category: "Social", price: 0.0024, notes: "$0.0024" },
  { name: "CoinGecko", category: "Crypto", price: 0.008, notes: "via AIsa" },
  { name: "Tavily", category: "Web Search", price: 0.0096, notes: "$0.0096" },
  { name: "Parallel", category: "Web Search", price: 0.01, notes: "from $0.01" },
  { name: "Perplexity", category: "Web Search", price: 0.012, notes: "$0.012" },
  { name: "Reddit", category: "Social", price: 0.02, notes: "$0.02" },
  { name: "Google Maps", category: "Location", price: 0.02, notes: "from $0.02" },
  { name: "Serper", category: "Web Search", price: 0.04, notes: "from $0.04" },
  { name: "EMC2 AI", category: "AI Compute", price: 0.25, notes: "from $0.25" },
];

// keccak256 hex of a UTF-8 string — the ERC-8183 "deliverable hash" of an
// analysis. Makes each X-analysis a verifiable artifact ready to anchor on-chain.
function deliverableHash(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  return "0x" + [...keccak256(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

function cors(origin, env) {
  const allow = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });
}

// ---- session tokens: "<address>.<exp>.<hmac>" ----
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function issueToken(env, address) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = `${address}.${exp}`;
  const mac = await hmacHex(env.SESSION_SECRET, payload);
  return `${payload}.${mac}`;
}
async function verifyToken(env, token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [address, expStr, mac] = parts;
  if (!/^0x[0-9a-f]{40}$/.test(address)) return null;
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
  const expect = await hmacHex(env.SESSION_SECRET, `${address}.${expStr}`);
  if (mac.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0 ? address : null;
}
async function requireAuth(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return verifyToken(env, token);
}

// A fresh random nonce, ~128 bits.
function randomNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}
// Message the extension's device link signs (binds cid -> wallet).
function extLinkMessage(address, cid) {
  return `Pascual Hub — link extension to ${address}\ncid: ${cid}`;
}
// Standalone page the extension opens to link its device to a wallet. The
// extension passes its cid in the URL hash (#cid=...). MetaMask signs, we POST
// /api/ext/claim; the extension then polls /api/ext/token for its session token.
function extLinkPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Link Pascual Terminal</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;background:#08090c;color:#e8edf2;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{width:400px;max-width:92vw;background:#0e1014;border:1px solid #2a313c;padding:30px}
h1{font-size:16px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px}
.sub{color:#6f7885;font-size:12px;margin-bottom:20px;line-height:1.5}
button{width:100%;padding:13px;border:1px solid #22e07a;background:#22e07a;color:#04120a;font-family:inherit;font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
#s{margin-top:14px;font-size:12px;line-height:1.5;min-height:20px;color:#9aa4b2;word-break:break-word}
.ok{color:#22e07a}.err{color:#ff4d5e}
</style></head><body><div class="card">
<h1>✦ Link extension</h1>
<div class="sub">Link the Pascual Reply Pro extension to this wallet. Your X analyses will appear in the terminal. The signature is free — no transaction.</div>
<button id="b">Connect wallet</button><div id="s"></div>
</div><script>
const S=document.getElementById('s'), set=(m,c)=>{S.textContent=m;S.className=c||''};
function cid(){const m=(location.hash||'').match(/cid=([A-Za-z0-9_-]{8,128})/);return m?m[1]:null;}
function hexMsg(s){return '0x'+Array.from(new TextEncoder().encode(s)).map(b=>b.toString(16).padStart(2,'0')).join('');}
document.getElementById('b').onclick=async()=>{
  const b=document.getElementById('b');
  try{
    const c=cid(); if(!c){set('No device id. Open this page from the extension.','err');return;}
    if(!window.ethereum){set('No wallet found. Install MetaMask.','err');return;}
    b.disabled=true; set('Connecting…');
    const [from]=await ethereum.request({method:'eth_requestAccounts'});
    const addr=from.toLowerCase();
    const msg='Pascual Hub — link extension to '+addr+String.fromCharCode(10)+'cid: '+c;
    set('Sign the message in your wallet…');
    const signature=await ethereum.request({method:'personal_sign',params:[hexMsg(msg),from]});
    set('Verifying…');
    const r=await fetch('/api/ext/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cid:c,address:addr,signature})});
    const d=await r.json();
    if(r.ok&&d.ok){set('✓ Done! Extension linked to '+addr.slice(0,6)+'…'+addr.slice(-4)+'. You can close this tab.','ok');}
    else set(d.error||'Link failed','err');
  }catch(e){set(e&&e.message?e.message:'Cancelled','err');b.disabled=false;}
};
</script></body></html>`;
}
function loginMessage(address, nonce) {
  return `Pascual Hub sign-in\naddress: ${address}\nnonce: ${nonce}`;
}

// ---- on-chain data (free, public) ----
// Supported chains. Alchemy chains use its multichain API (tokens + NFT + history)
// with env.ALCHEMY_KEY; Arc testnet has no Alchemy, so it uses a plain RPC.
const CHAINS = {
  ethereum: { label: "Ethereum", symbol: "ETH", alchemy: "eth-mainnet", explorer: "https://etherscan.io" },
  base:     { label: "Base",     symbol: "ETH", alchemy: "base-mainnet", explorer: "https://basescan.org" },
  polygon:  { label: "Polygon",  symbol: "POL", alchemy: "polygon-mainnet", explorer: "https://polygonscan.com" },
  arc:      { label: "Arc Testnet", symbol: "USDC", rpc: "https://rpc.testnet.arc.network", explorer: "https://testnet.arcscan.app" },
};

function alchemyUrl(env, chainKey) {
  const c = CHAINS[chainKey];
  if (!c || !c.alchemy || !env.ALCHEMY_KEY) return null;
  return `https://${c.alchemy}.g.alchemy.com/v2/${env.ALCHEMY_KEY}`;
}
function chainRpc(env, chainKey) {
  const c = CHAINS[chainKey];
  return alchemyUrl(env, chainKey) || c?.rpc || null;
}
async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "rpc error");
  return d.result;
}
// Format a wei-scale hex/bigint into a fixed string with `decimals` places,
// keeping only `keep` fractional digits. Returns a plain number-string.
function fmtUnits(raw, decimals, keep = 4) {
  let v; try { v = BigInt(raw); } catch (_) { return "0"; }
  const scale = 10n ** BigInt(decimals);
  const whole = v / scale;
  const frac = v % scale;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, keep);
  return keep > 0 ? `${whole}.${fracStr}` : whole.toString();
}

// Full wallet summary for one chain: native balance + ERC-20 token balances
// (with metadata) via Alchemy, or native-only via RPC for Arc.
async function fetchWalletSummary(env, address, chainKey) {
  chainKey = CHAINS[chainKey] ? chainKey : "ethereum";
  const chain = CHAINS[chainKey];
  const out = { address, chain: chainKey, chainLabel: chain.label, symbol: chain.symbol,
    native: null, tokens: [], explorer: chain.explorer, error: null };
  const url = chainRpc(env, chainKey);
  if (!url) { out.error = "No data source for this chain"; return out; }

  try {
    // Native balance (all EVM chains).
    const bal = await rpc(url, "eth_getBalance", [address, "latest"]);
    out.native = fmtUnits(bal, 18, 4);

    // ERC-20 balances — Alchemy only.
    if (alchemyUrl(env, chainKey)) {
      const balances = await rpc(url, "alchemy_getTokenBalances", [address, "erc20"]);
      const nonZero = (balances.tokenBalances || [])
        .filter(t => t.tokenBalance && BigInt(t.tokenBalance) > 0n)
        .slice(0, 25);
      // Fetch metadata per token (name, symbol, decimals).
      for (const t of nonZero) {
        let meta = {};
        try { meta = await rpc(url, "alchemy_getTokenMetadata", [t.contractAddress]); } catch (_) {}
        const dec = typeof meta.decimals === "number" ? meta.decimals : 18;
        out.tokens.push({
          contract: t.contractAddress,
          symbol: meta.symbol || "?",
          name: meta.name || "",
          logo: meta.logo || null,
          balance: fmtUnits(t.tokenBalance, dec, 4),
        });
      }
    }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// ---- Market data (free, CoinGecko public API) ----
// Price + 24h change + a sparkline for the terminal's BTC panel. Cached 60s.
async function fetchMarket(env) {
  // Fresh cache (60s): serve immediately if present.
  if (env.SESS) {
    const c = await env.SESS.get("market:btc");
    if (c) { try { return JSON.parse(c); } catch (_) {} }
  }
  const out = { coins: [], spark: [], error: null, src: null };
  const safeJ = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch (_) { return null; } };
  // Read the long-lived last-good snapshot to fall back on if CoinGecko throttles
  // (429) this fetch — better a few-minutes-old chart than an empty panel.
  const lastGood = env.SESS ? await env.SESS.get("market:last").then(v => { try { return JSON.parse(v); } catch (_) { return null; } }) : null;

  // NOTE: Binance returns HTTP 403 to Cloudflare Worker IPs (geo-restriction on
  // datacenters), so it CANNOT be used server-side. CoinGecko's public API does
  // respond to datacenters and is the reliable source here.

  // --- Prices via CoinGecko simple/price (lightest endpoint; the heavier
  // /coins/markets with 4 ids + params intermittently returns non-array to
  // datacenter IPs). One compact call for all 4 coins. ---
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,usd-coin&vs_currencies=usd&include_24hr_change=true",
      { headers: { "User-Agent": "Mozilla/5.0 PascualHub", "Accept": "application/json" }, cf: { cacheTtl: 60 } }
    );
    const d = await safeJ(r);
    if (d && typeof d === "object") {
      const meta = [
        ["bitcoin", "BTC", "Bitcoin"], ["ethereum", "ETH", "Ethereum"],
        ["solana", "SOL", "Solana"], ["usd-coin", "USDC", "USD Coin"],
      ];
      for (const [id, sym, name] of meta) {
        const e = d[id];
        if (e && e.usd != null) {
          out.coins.push({ id, symbol: sym, name, price: e.usd, change24h: e.usd_24h_change || 0 });
        }
      }
      if (out.coins.length) out.src = "CoinGecko";
    }
  } catch (e) { out.error = "coingecko: " + e.message; }

  // --- Sparkline via CoinGecko OHLC (single array, more datacenter-friendly
  // than market_chart, and gives clean hourly points). ---
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=1",
      { headers: { "User-Agent": "Mozilla/5.0 PascualHub", "Accept": "application/json" }, cf: { cacheTtl: 120 } }
    );
    const d = await safeJ(r);
    // OHLC rows: [timestamp, open, high, low, close]; use close.
    if (Array.isArray(d) && d.length) out.spark = d.map(row => Number(row[4])).filter(n => !Number.isNaN(n));
  } catch (_) {}

  // Fallback sparkline: if OHLC failed, try market_chart prices.
  if (!out.spark.length) {
    try {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1",
        { headers: { "User-Agent": "Mozilla/5.0 PascualHub", "Accept": "application/json" }, cf: { cacheTtl: 120 } }
      );
      const d = await safeJ(r);
      if (d && Array.isArray(d.prices)) out.spark = d.prices.map(p => Number(p[1])).filter(n => !Number.isNaN(n));
    } catch (_) {}
  }

  // If this fetch is incomplete (throttled), prefer the last-good snapshot:
  // full data (4 coins) beats our 1-coin chart-derived fallback.
  const complete = out.coins.length >= 3 && out.spark.length > 0;
  if (!complete && lastGood && (lastGood.coins || []).length >= 3) {
    // Serve last-good, but refresh its short cache so we don't hammer on retry.
    if (env.SESS) await env.SESS.put("market:btc", JSON.stringify(lastGood), { expirationTtl: 60 });
    return { ...lastGood, stale: true };
  }

  // Last resort within THIS fetch: derive BTC price from the sparkline close.
  if (!out.coins.length && out.spark.length) {
    out.coins = [{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", price: out.spark[out.spark.length - 1], change24h: 0 }];
    out.src = "CoinGecko (chart)";
  }

  if (env.SESS && out.coins.length) {
    await env.SESS.put("market:btc", JSON.stringify(out), { expirationTtl: 60 });
    // Update the long-lived snapshot only with COMPLETE data (10 min TTL).
    if (complete) await env.SESS.put("market:last", JSON.stringify(out), { expirationTtl: 600 });
  }
  return out;
}

// ---- Prediction markets (Polymarket CLOB, free public API) ----
// Real free service from the x402 catalog — a genuine "agent data source" that
// works without payment. Returns top active markets as a sentiment barometer.
async function fetchPredictions(env) {
  if (env.SESS) {
    const c = await env.SESS.get("predict:top");
    if (c) { try { return JSON.parse(c); } catch (_) {} }
  }
  const out = { markets: [], source: "Polymarket", error: null };
  try {
    // Gamma API returns currently-active markets ordered by volume; the CLOB
    // /markets endpoint's first page is mostly closed markets.
    const r = await fetch("https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=12&order=volume&ascending=false", {
      headers: { "User-Agent": "PascualHub/1.0", "Accept": "application/json" },
      cf: { cacheTtl: 300 },
    });
    const list = await r.json();
    if (Array.isArray(list)) {
      out.markets = list
        .filter(m => m && m.question)
        .slice(0, 12)
        .map(m => ({
          question: String(m.question || "").slice(0, 160),
          slug: m.slug || "",
          liquidity: m.liquidity ? Math.round(Number(m.liquidity)) : null,
          endDate: m.endDate || "",
        }));
    }
  } catch (e) {
    out.error = e.message;
  }
  if (env.SESS && out.markets.length) await env.SESS.put("predict:top", JSON.stringify(out), { expirationTtl: 300 });
  return out;
}

// ---- Marketplace liveness: probe free services, report up/down ----
// Real availability check (not fabricated status). Cached 5 min. Only the free,
// no-auth endpoints are probed; paid ones are labelled "needs USDC" statically.
async function probeMarketplace(env) {
  if (env.SESS) {
    const c = await env.SESS.get("mkt:status");
    if (c) { try { return JSON.parse(c); } catch (_) {} }
  }
  const probes = {
    "Binance": "https://api.binance.com/api/v3/ping",
    "Messari": "https://api.messari.io/",
    "Polymarket": "https://gamma-api.polymarket.com/markets?limit=1",
    "CoinGecko": "https://api.coingecko.com/api/v3/ping",
  };
  const status = {};
  await Promise.all(Object.entries(probes).map(async ([name, u]) => {
    try {
      const r = await fetch(u, { method: "GET", cf: { cacheTtl: 120 }, signal: AbortSignal.timeout(6000) });
      status[name] = r.ok ? "up" : "down";
    } catch (_) { status[name] = "down"; }
  }));
  if (env.SESS) await env.SESS.put("mkt:status", JSON.stringify(status), { expirationTtl: 300 });
  return status;
}

// ---- Signal Feed: crypto news (free RSS) + AI daily digest ----
// Public RSS feeds from major crypto outlets. No API keys, no scraping of X.
const NEWS_FEEDS = [
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
  { source: "The Block", url: "https://www.theblock.co/rss.xml" },
];

// Minimal RSS/Atom item extraction without an XML library. Pulls <item>/<entry>
// blocks and their title/link/pubDate. Robust enough for well-formed feeds.
function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  for (const b of blocks.slice(0, 12)) {
    const title = decodeXml(pick(b, "title"));
    let link = pick(b, "link");
    if (!link) { // Atom: <link href="..."/>
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? m[1] : "";
    }
    const date = pick(b, "pubDate") || pick(b, "updated") || pick(b, "published") || "";
    if (title && link) items.push({ source, title, link: link.trim(), date });
  }
  return items;
}
function pick(block, tag) {
  const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i");
  const m = block.match(re);
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}
function decodeXml(s) {
  return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "").trim();
}

async function fetchNews(env, ctx) {
  // Cache the merged feed for 10 minutes so we don't hammer the sources.
  const cacheKey = "news:latest";
  if (env.SESS) {
    const cached = await env.SESS.get(cacheKey);
    if (cached) { try { return JSON.parse(cached); } catch (_) {} }
  }
  const results = await Promise.allSettled(
    NEWS_FEEDS.map(f => fetch(f.url, { headers: { "User-Agent": "PascualHub/1.0" }, cf: { cacheTtl: 300 } })
      .then(r => r.text()).then(x => parseFeed(x, f.source)))
  );
  let items = [];
  for (const r of results) if (r.status === "fulfilled") items.push(...r.value);
  // Sort newest first when dates parse; keep source order otherwise.
  items.sort((a, b) => {
    const da = Date.parse(a.date) || 0, db = Date.parse(b.date) || 0;
    return db - da;
  });
  items = items.slice(0, 40);
  const payload = { items, updated: null }; // updated stamped by caller if needed
  if (env.SESS) await env.SESS.put(cacheKey, JSON.stringify(payload), { expirationTtl: 600 });
  return payload;
}

// Fetch the current list of free OpenRouter models (price 0, text ":free"),
// cached 1h in KV. OpenRouter's free set churns — a hardcoded id rots — so we
// pick dynamically and try several, exactly like the extension's proxy does.
const MODEL_PREFER = ["gemma-4-31b", "gemma-4", "nemotron-3-super", "nemotron", "llama", "qwen", "mistral", "deepseek"];
async function freeModels(env) {
  if (env.SESS) {
    const c = await env.SESS.get("or:free");
    if (c) { try { return JSON.parse(c); } catch (_) {} }
  }
  const r = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { "Authorization": `Bearer ${env.OPENROUTER_KEY}` },
  });
  if (!r.ok) return [];
  const data = await r.json();
  const free = [];
  for (const m of data.data || []) {
    const p = m.pricing || {};
    const id = m.id || "";
    // Text-only free models; skip safety/vision/omni endpoints.
    if (parseFloat(p.prompt || "1") === 0 && parseFloat(p.completion || "1") === 0 &&
        id.endsWith(":free") && !/safety|vision|-vl|omni/i.test(id)) {
      free.push(id);
    }
  }
  free.sort((a, b) => {
    const ra = MODEL_PREFER.findIndex(h => a.includes(h));
    const rb = MODEL_PREFER.findIndex(h => b.includes(h));
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
  if (env.SESS && free.length) await env.SESS.put("or:free", JSON.stringify(free), { expirationTtl: 3600 });
  return free;
}

// AI digest of the current headlines via OpenRouter free models. Tries several
// models until one answers (the free set changes constantly). Graceful if unset.
async function aiDigest(env, items, lang) {
  if (!env.OPENROUTER_KEY) {
    return { digest: null, error: "AI digest not configured (OPENROUTER_KEY missing)." };
  }
  const headlines = items.slice(0, 25).map((it, i) => `${i + 1}. [${it.source}] ${it.title}`).join("\n");
  const sys = "You are a crypto analyst. From these headlines write a short daily digest in plain text (no markdown): 3-5 key themes, one or two sentences each, each starting with '• '. End with a line 'Market mood:' in one word. Max 700 chars.";

  let models;
  try { models = await freeModels(env); } catch (e) { return { digest: null, error: "Could not load model list: " + e.message }; }
  if (!models.length) return { digest: null, error: "No free models available right now. Try again later." };

  let lastErr = "unknown";
  for (const model of models.slice(0, 5)) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENROUTER_KEY}`, "X-Title": "Pascual Hub" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: sys }, { role: "user", content: headlines }],
          max_tokens: 500, temperature: 0.7,
        }),
      });
      const text = await resp.text();
      let d = {}; try { d = JSON.parse(text); } catch (_) { d = { error: { message: text.slice(0, 150) } }; }
      if (!resp.ok || d.error) { lastErr = d.error?.message || `HTTP ${resp.status}`; continue; }
      const out = d.choices?.[0]?.message?.content?.trim();
      if (out) return { digest: out, error: null, model };
      lastErr = "empty";
    } catch (e) { lastErr = e.message; }
  }
  return { digest: null, error: "All free models failed. Last error: " + lastErr };
}

// Recent transfers (in + out) for a wallet on an Alchemy chain.
async function fetchWalletActivity(env, address, chainKey) {
  chainKey = CHAINS[chainKey] ? chainKey : "ethereum";
  const url = alchemyUrl(env, chainKey);
  const out = { address, chain: chainKey, transfers: [], error: null };
  if (!url) { out.error = "Activity needs Alchemy (not available for this chain)"; return out; }
  try {
    const base = {
      category: ["external", "erc20", "erc721"],
      withMetadata: true, excludeZeroValue: true, maxCount: "0x14", order: "desc",
    };
    const [sent, recv] = await Promise.all([
      rpc(url, "alchemy_getAssetTransfers", [{ ...base, fromAddress: address }]),
      rpc(url, "alchemy_getAssetTransfers", [{ ...base, toAddress: address }]),
    ]);
    const norm = (t, dir) => ({
      dir, hash: t.hash, from: t.from, to: t.to,
      asset: t.asset || (t.category === "external" ? CHAINS[chainKey].symbol : "?"),
      value: t.value != null ? String(t.value) : null,
      ts: t.metadata?.blockTimestamp || null,
      category: t.category,
    });
    const all = [
      ...(sent.transfers || []).map(t => norm(t, "out")),
      ...(recv.transfers || []).map(t => norm(t, "in")),
    ].filter(t => t.ts).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 25);
    out.transfers = all;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const CORS = cors(url.origin, env);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const send = (body, status) => json(body, status, CORS);
    const path = url.pathname;

    try {
      // ---- auth: request a nonce ----
      if (path === "/api/auth/nonce" && request.method === "GET") {
        const address = (url.searchParams.get("address") || "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return send({ error: "Bad address" }, 400);
        const nonce = randomNonce();
        await env.SESS.put(`nonce:${address}`, nonce, { expirationTtl: 60 });
        return send({ nonce, message: loginMessage(address, nonce) });
      }

      // ---- auth: verify signature, issue session token ----
      if (path === "/api/auth/verify" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const address = String(body.address || "").toLowerCase();
        const signature = String(body.signature || "");
        if (!/^0x[0-9a-f]{40}$/.test(address)) return send({ error: "Bad address" }, 400);
        if (!/^0x[0-9a-f]{130}$/.test(signature)) return send({ error: "Bad signature" }, 400);
        const nonce = await env.SESS.get(`nonce:${address}`);
        if (!nonce) return send({ error: "Nonce expired, request a new one" }, 400);
        const recovered = recoverPersonalSign(loginMessage(address, nonce), signature);
        if (!recovered || recovered.toLowerCase() !== address) {
          return send({ error: "Signature does not match address" }, 401);
        }
        await env.SESS.delete(`nonce:${address}`); // single-use nonce
        // Upsert profile row.
        if (env.DB) {
          await env.DB.prepare(
            "INSERT INTO profiles (address, created_at) VALUES (?, ?) ON CONFLICT(address) DO NOTHING"
          ).bind(address, Date.now()).run();
        }
        const token = await issueToken(env, address);
        return send({ token, address });
      }

      // ---- extension link page (served by the worker; MetaMask signs here) ----
      if (path === "/ext/link" && request.method === "GET") {
        return new Response(extLinkPage(), { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
      }

      // ---- extension link: bind cid -> wallet via signature (public) ----
      // Called by the hub link page (which has the wallet via MetaMask). Stores
      // cid->address so the extension can later exchange its cid for a session
      // token bound to that wallet. Mirrors the credits-link pattern.
      if (path === "/api/ext/claim" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const cid = String(b.cid || "");
        const address = String(b.address || "").toLowerCase();
        const signature = String(b.signature || "");
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(cid)) return send({ error: "Bad cid" }, 400);
        if (!/^0x[0-9a-f]{40}$/.test(address)) return send({ error: "Bad address" }, 400);
        if (!/^0x[0-9a-f]{130}$/.test(signature)) return send({ error: "Bad signature" }, 400);
        const recovered = recoverPersonalSign(extLinkMessage(address, cid), signature);
        if (!recovered || recovered.toLowerCase() !== address) {
          return send({ error: "Signature does not match address" }, 401);
        }
        if (env.DB) {
          await env.DB.prepare(
            "INSERT INTO ext_links (cid, address, linked_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(cid) DO UPDATE SET address = excluded.address, linked_at = excluded.linked_at"
          ).bind(cid, address, Date.now()).run();
        }
        return send({ ok: true, address });
      }
      // ---- extension link: exchange cid for a session token (public) ----
      // The extension polls this; once the wallet is linked (cid present), it
      // returns a normal session token bound to that address.
      if (path === "/api/ext/token" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        const cid = String(b.cid || "");
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(cid)) return send({ error: "Bad cid" }, 400);
        if (!env.DB) return send({ linked: false });
        const row = await env.DB.prepare("SELECT address FROM ext_links WHERE cid = ?").bind(cid).first();
        if (row && /^0x[0-9a-f]{40}$/.test(row.address || "")) {
          const token = await issueToken(env, row.address);
          return send({ linked: true, address: row.address, token });
        }
        return send({ linked: false });
      }

      // ---- everything below requires a valid session ----
      if (path.startsWith("/api/") && path !== "/api/health") {
        const me = await requireAuth(request, env);
        if (path === "/api/me" && request.method === "GET") {
          if (!me) return send({ error: "Unauthorized" }, 401);
          return send({ address: me });
        }
        if (!me) return send({ error: "Unauthorized" }, 401);

        // ---- watchlist: list ----
        if (path === "/api/watchlist" && request.method === "GET") {
          if (!env.DB) return send({ items: [] });
          const rows = await env.DB.prepare(
            "SELECT wallet, label, added_at FROM watchlist WHERE owner = ? ORDER BY added_at DESC"
          ).bind(me).all();
          return send({ items: rows.results || [] });
        }
        // ---- watchlist: add ----
        if (path === "/api/watchlist" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const wallet = String(b.wallet || "").toLowerCase();
          const label = String(b.label || "").slice(0, 64);
          if (!/^0x[0-9a-f]{40}$/.test(wallet)) return send({ error: "Bad wallet" }, 400);
          if (env.DB) {
            await env.DB.prepare(
              "INSERT INTO watchlist (owner, wallet, label, added_at) VALUES (?, ?, ?, ?) " +
              "ON CONFLICT(owner, wallet) DO UPDATE SET label = excluded.label"
            ).bind(me, wallet, label, Date.now()).run();
          }
          return send({ ok: true, wallet, label });
        }
        // ---- watchlist: remove ----
        if (path === "/api/watchlist" && request.method === "DELETE") {
          const wallet = (url.searchParams.get("wallet") || "").toLowerCase();
          if (!/^0x[0-9a-f]{40}$/.test(wallet)) return send({ error: "Bad wallet" }, 400);
          if (env.DB) {
            await env.DB.prepare("DELETE FROM watchlist WHERE owner = ? AND wallet = ?").bind(me, wallet).run();
          }
          return send({ ok: true });
        }
        // ---- available chains (for the UI selector) ----
        if (path === "/api/chains" && request.method === "GET") {
          const list = Object.entries(CHAINS).map(([key, c]) => ({
            key, label: c.label, symbol: c.symbol,
            rich: !!alchemyUrl(env, key), // true = tokens+activity available
          }));
          return send({ chains: list });
        }
        // ---- on-chain summary for one wallet (native + tokens) ----
        if (path === "/api/wallet/summary" && request.method === "GET") {
          const wallet = (url.searchParams.get("wallet") || "").toLowerCase();
          const chain = url.searchParams.get("chain") || "ethereum";
          if (!/^0x[0-9a-f]{40}$/.test(wallet)) return send({ error: "Bad wallet" }, 400);
          return send(await fetchWalletSummary(env, wallet, chain));
        }
        // ---- recent activity (transfers in/out) ----
        if (path === "/api/wallet/activity" && request.method === "GET") {
          const wallet = (url.searchParams.get("wallet") || "").toLowerCase();
          const chain = url.searchParams.get("chain") || "ethereum";
          if (!/^0x[0-9a-f]{40}$/.test(wallet)) return send({ error: "Bad wallet" }, 400);
          return send(await fetchWalletActivity(env, wallet, chain));
        }

        // ---- market data (price + sparkline) for the terminal ----
        if (path === "/api/market" && request.method === "GET") {
          return send(await fetchMarket(env));
        }

        // ---- Arc agent state (ERC-8004) — reads live from Arc testnet ----
        if (path === "/api/arc/agent" && request.method === "GET") {
          const rawId = url.searchParams.get("id") || env.ARC_AGENT_ID || "4713";
          // Numeric agentId only — keeps cache keys clean and BigInt() safe.
          const id = /^\d{1,20}$/.test(rawId) ? rawId : "4713";
          // Cache 60s (chain state changes slowly, RPC is the bottleneck).
          const ck = "arc:agent:" + id;
          if (env.SESS) { const c = await env.SESS.get(ck); if (c) { try { return send(JSON.parse(c)); } catch (_) {} } }
          const st = await fetchAgentState(id, env.ARC_RPC_URL);
          if (env.SESS && st && !st.error) await env.SESS.put(ck, JSON.stringify(st), { expirationTtl: 60 });
          return send(st);
        }
        // ---- Arc jobs (ERC-8183) for an owner address ----
        if (path === "/api/arc/jobs" && request.method === "GET") {
          const owner = (url.searchParams.get("owner") || "").toLowerCase();
          if (!/^0x[0-9a-f]{40}$/.test(owner)) return send({ error: "Bad owner" }, 400);
          return send({ jobs: await readJobs(owner, env.ARC_RPC_URL), agenticCommerce: ARC.agenticCommerce, explorer: ARC.explorer });
        }
        // ---- x402 marketplace catalog (+ live status for free probes) ----
        if (path === "/api/arc/marketplace" && request.method === "GET") {
          const status = await probeMarketplace(env);
          const services = X402_SERVICES.map(s => ({
            ...s,
            // Real availability for services we can probe; others: null (unknown).
            status: status[s.name] || null,
          }));
          return send({
            services,
            protocol: "x402",
            network: "base-mainnet",
            chainId: 8453,
            free: X402_SERVICES.filter(s => s.price === 0).length,
            paid: X402_SERVICES.filter(s => s.price > 0).length,
            note: "Free services are called directly. Paid ones require real USDC on Base.",
          });
        }
        // ---- Prediction markets (real Polymarket data) ----
        if (path === "/api/predictions" && request.method === "GET") {
          return send(await fetchPredictions(env));
        }

        // ---- X Cockpit: ingest an analysis from the extension ----
        if (path === "/api/x/ingest" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const id = String(b.id || "").slice(0, 64) || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
          const kind = ["analyze", "sentiment", "improve"].includes(b.kind) ? b.kind : "analyze";
          const subject = String(b.subject || "").slice(0, 200);
          const result = String(b.result || "").slice(0, 4000);
          const url = String(b.url || "").slice(0, 500);
          if (!result) return send({ error: "Empty result" }, 400);
          // Deliverable hash: turns this analysis into a verifiable ERC-8183
          // artifact. The user can anchor it on-chain via 3_create_job.py (the
          // hash is the job's deliverable), giving a provable service record.
          const jobHash = deliverableHash(result);
          if (env.DB) {
            await env.DB.prepare(
              "INSERT INTO x_items (id, owner, kind, subject, result, url, job_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT(id) DO NOTHING"
            ).bind(id, me, kind, subject, result, url, jobHash, Date.now()).run();
          }
          return send({ ok: true, id, jobHash });
        }
        // ---- X Cockpit: list stored analyses ----
        if (path === "/api/x/items" && request.method === "GET") {
          if (!env.DB) return send({ items: [] });
          const rows = await env.DB.prepare(
            "SELECT id, kind, subject, result, url, job_hash, anchored_job, created_at FROM x_items WHERE owner = ? ORDER BY created_at DESC LIMIT 50"
          ).bind(me).all();
          return send({ items: rows.results || [] });
        }
        // ---- Agent loop: analyses NOT yet anchored on-chain (bridge polls this) ----
        if (path === "/api/x/pending" && request.method === "GET") {
          if (!env.DB) return send({ items: [] });
          const rows = await env.DB.prepare(
            "SELECT id, kind, subject, job_hash, created_at FROM x_items WHERE owner = ? AND anchored_job IS NULL AND job_hash IS NOT NULL ORDER BY created_at ASC LIMIT 20"
          ).bind(me).all();
          return send({ items: rows.results || [] });
        }
        // ---- Agent loop: mark an analysis anchored to an ERC-8183 job ----
        if (path === "/api/x/anchor" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const id = String(b.id || "");
          const jobId = parseInt(b.job_id, 10);
          if (!id || !Number.isFinite(jobId)) return send({ error: "Need id + job_id" }, 400);
          if (env.DB) {
            await env.DB.prepare("UPDATE x_items SET anchored_job = ? WHERE owner = ? AND id = ?")
              .bind(jobId, me, id).run();
          }
          return send({ ok: true, id, job_id: jobId });
        }
        // ---- X Cockpit: delete one item ----
        if (path === "/api/x/items" && request.method === "DELETE") {
          const id = url.searchParams.get("id") || "";
          if (env.DB && id) await env.DB.prepare("DELETE FROM x_items WHERE owner = ? AND id = ?").bind(me, id).run();
          return send({ ok: true });
        }
        // ---- Signal Feed: news headlines (cached 10 min) ----
        if (path === "/api/news" && request.method === "GET") {
          return send(await fetchNews(env, ctx));
        }
        // ---- Signal Feed: AI digest of current headlines ----
        if (path === "/api/news/digest" && request.method === "GET") {
          // Default to English (grant/international audience); Russian only if asked.
          const lang = (url.searchParams.get("lang") || "en").startsWith("ru") ? "ru" : "en";
          // Rate-limit the AI call per user per hour (cheap abuse guard).
          const gate = `digest:${me}:${new Date().toISOString().slice(0, 13)}`;
          const n = env.SESS ? parseInt((await env.SESS.get(gate)) || "0", 10) : 0;
          if (n >= 10) return send({ digest: null, error: "Hourly digest limit reached." }, 429);
          const news = await fetchNews(env, ctx);
          const out = await aiDigest(env, news.items, lang);
          if (env.SESS && out.digest) await env.SESS.put(gate, String(n + 1), { expirationTtl: 3600 });
          return send(out);
        }

        return send({ error: "Not found" }, 404);
      }

      if (path === "/api/health") return send({ ok: true, service: "pascual-hub" });

      return send({ error: "Not found" }, 404);
    } catch (e) {
      return send({ error: "Server error: " + e.message }, 500);
    }
  },
};
