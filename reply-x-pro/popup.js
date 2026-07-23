// popup.js — Pascual Reply Settings (Pascual Labs)

const PROVIDER_MODELS = {
  openai: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini", price: "$0.15 / 1M tokens (Recommended)" },
    { id: "gpt-4o", name: "GPT-4o", price: "$2.50 / 1M tokens" }
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek Chat (V3)", price: "$0.14 / 1M tokens (Ultra Cheap!)" }
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", price: "$0.59 / 1M tokens" },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", price: "$0.05 / 1M tokens" }
  ],
  anthropic: [
    { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", price: "$3.00 / 1M tokens (Premium)" },
    { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", price: "$0.25 / 1M tokens" }
  ],
  openrouter: [
    { id: "google/gemma-2-9b-it:free", name: "Gemma 2 9B (Free)", price: "$0.00 (Free model)" },
    { id: "meta-llama/llama-3-8b-instruct:free", name: "Llama 3 8B (Free)", price: "$0.00 (Free model)" },
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3", price: "$0.14 / 1M tokens" },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", price: "$3.00 / 1M tokens" }
  ]
};

const I18N = {
  ru: {
    apiMode: "Режим API",
    modeFree: "Pascual Free",
    modeCustom: "Свой API Ключ",
    freeUsage: "Статус бесплатного режима",
    limitToday: "Лимит на сегодня (25 ответов):",
    freeDesc: "Использует встроенный OpenRouter-ключ с автопереключением между бесплатными моделями (Llama 3, Gemma 2, Qwen и др.).",
    credits: "Кредиты анализа:",
    btnBuyCredits: "Купить кредиты анализа (USDC)",
    terminalSync: "Синхрон с терминалом:",
    btnLinkHub: "Привязать кошелёк к терминалу",
    hubDesc: "Привяжите один раз — ваши анализы X автоматически появятся в терминале Pascual.",
    provider: "Провайдер",
    apiKey: "API Ключ",
    keyHintText: "Получите ваш API-ключ в личном кабинете провайдера.",
    model: "Модель",
    replyTone: "Стиль ответов",
    defaultLength: "Длина поста по умолчанию",
    ask: "Спрашивать",
    btnReset: "Очистить",
    btnSave: "Сохранить",
    totalLogs: "Сгенерировано постов:",
    btnDownloadLog: "Скачать JSON Лог",
    btnClearLog: "Очистить базу логов",
    saved: "Сохранено!",
    cleared: "Очищено!",
    confirmClearLog: "Вы уверены, что хотите очистить всю историю логов?",
    logEmpty: "Лог пуст",
    logCleared: "Лог очищен"
  },
  en: {
    apiMode: "API Mode",
    modeFree: "Pascual Free",
    modeCustom: "My Own API",
    freeUsage: "Free Usage Status",
    limitToday: "Daily limit (25 replies):",
    freeDesc: "Uses preconfigured OpenRouter key with automatic fallback across free models (Llama 3, Gemma 2, Qwen, etc.).",
    credits: "Analyze credits:",
    btnBuyCredits: "Buy analyze credits (USDC)",
    terminalSync: "Sync to Terminal:",
    btnLinkHub: "Link wallet to Terminal",
    hubDesc: "Link once — your X analyses auto-appear in the Pascual Terminal dashboard.",
    provider: "Provider",
    apiKey: "API Key",
    keyHintText: "Get your API key from the provider dashboard.",
    model: "Model",
    replyTone: "Reply Tone",
    defaultLength: "Default Post Length",
    ask: "Ask",
    btnReset: "Clear Key",
    btnSave: "Save",
    totalLogs: "Logged posts:",
    btnDownloadLog: "Download JSON Logs",
    btnClearLog: "Clear Log Database",
    saved: "Saved!",
    cleared: "Cleared!",
    confirmClearLog: "Are you sure you want to clear all logs?",
    logEmpty: "Log is empty",
    logCleared: "Log cleared"
  }
};

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const themeToggle = document.getElementById("themeToggle");
  const modeFree = document.getElementById("modeFree");
  const modeCustom = document.getElementById("modeCustom");
  const freeInfoPanel = document.getElementById("freeInfoPanel");
  const customApiPanel = document.getElementById("customApiPanel");
  const providerSelect = document.getElementById("provider");
  const apiKeyInput = document.getElementById("apiKey");
  const modelSelect = document.getElementById("model");
  const priceHint = document.getElementById("priceHint");
  const toneSelect = document.getElementById("tone");
  const lengthPills = document.querySelectorAll("#lengthSelector .pill");
  const saveBtn = document.getElementById("save");
  const clearBtn = document.getElementById("clear");
  const downloadLogBtn = document.getElementById("downloadLog");
  const clearLogBtn = document.getElementById("clearLog");
  const logInfo = document.getElementById("logInfo");
  const freeCount = document.getElementById("freeCount");

  let currentLang = "en";
  let activeLength = "190";
  let activeApiMode = "free"; // 'free' or 'custom'

  // Detect Language
  const sysLang = navigator.language || navigator.userLanguage;
  if (sysLang && sysLang.toLowerCase().startsWith("ru")) {
    currentLang = "ru";
  }

  // Apply I18N
  function applyI18n() {
    const langData = I18N[currentLang];
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      if (langData[key]) {
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          el.placeholder = langData[key];
        } else {
          el.textContent = langData[key];
        }
      }
    });
  }
  applyI18n();

  const KEY_NAMES = ["openai_api_key", "key_openai", "key_deepseek", "key_groq", "key_anthropic", "key_openrouter"];

  // Load configuration. Non-secret prefs live in sync; API keys in local (they
  // are secrets and must not replicate across the user's devices via Google sync).
  chrome.storage.sync.get([
    "api_mode", "openai_model", "reply_tone", "default_tweet_length", "provider", "theme"
  ], (items) => {
   chrome.storage.local.get(KEY_NAMES, (localItems) => {
    // Theme
    if (items.theme === "light") {
      document.documentElement.classList.add("theme-light");
    }

    // API Mode
    activeApiMode = items.api_mode || "free";
    setApiMode(activeApiMode);

    // Length
    activeLength = items.default_tweet_length || "190";
    setLengthActivePill(activeLength);

    // Tone
    toneSelect.value = items.reply_tone || "friendly";

    // Provider & Keys
    providerSelect.value = items.provider || "openai";

    // Load individual keys (from local)
    const keysMap = {
      openai: localItems.key_openai || localItems.openai_api_key || "",
      deepseek: localItems.key_deepseek || "",
      groq: localItems.key_groq || "",
      anthropic: localItems.key_anthropic || "",
      openrouter: localItems.key_openrouter || ""
    };

    // Set models list
    updateModelsList(providerSelect.value, items.openai_model);

    // Fill Key input
    apiKeyInput.value = keysMap[providerSelect.value];

    // Listen to provider changes to update models and keys
    providerSelect.addEventListener("change", () => {
      const prov = providerSelect.value;
      updateModelsList(prov);

      // Load key for this provider (from local)
      chrome.storage.local.get([`key_${prov}`, "openai_api_key"], (items2) => {
        let keyVal = items2[`key_${prov}`] || "";
        if (prov === "openai" && !keyVal) {
          keyVal = items2.openai_api_key || "";
        }
        apiKeyInput.value = keyVal;
      });
    });
   });
  });

  // Load logs count & Free usage count
  function updateCounters() {
    chrome.storage.local.get(["tweet_logs", "free_usage_date", "free_usage_count"], (items) => {
      const logs = items.tweet_logs || [];
      logInfo.textContent = logs.length;

      // Free usage limit counter — show the local value first, then replace with
      // the authoritative server-side count (survives reinstall, keyed by IP).
      const today = new Date().toISOString().split("T")[0];
      const localCount = items.free_usage_date === today ? (items.free_usage_count || 0) : 0;
      freeCount.textContent = `${localCount} / 25`;
      chrome.runtime.sendMessage({ action: "getFreeUsage" }, (u) => {
        if (chrome.runtime.lastError) return;
        if (u && typeof u.used === "number") {
          freeCount.textContent = `${u.used} / ${u.limit || 25}`;
        }
        // Only overwrite the "—" placeholder when the balance is actually known.
        // A null/undefined balance means "no wallet linked" or "store offline" —
        // showing 0 there would tell a paid user their credits vanished.
        const creditCount = document.getElementById("creditCount");
        if (creditCount && u && typeof u.credits === "number") {
          creditCount.textContent = String(u.credits);
        }
      });
    });
  }
  updateCounters();

  // Handle API Mode Switch
  function setApiMode(mode) {
    activeApiMode = mode;
    if (mode === "free") {
      modeFree.classList.add("active");
      modeCustom.classList.remove("active");
      freeInfoPanel.classList.remove("hidden");
      customApiPanel.classList.add("hidden");
    } else {
      modeFree.classList.remove("active");
      modeCustom.classList.add("active");
      freeInfoPanel.classList.add("hidden");
      customApiPanel.classList.remove("hidden");
    }
  }

  modeFree.addEventListener("click", () => setApiMode("free"));
  modeCustom.addEventListener("click", () => setApiMode("custom"));

  // Handle Model Lists
  function updateModelsList(provider, selectedModel = "") {
    modelSelect.innerHTML = "";
    const models = PROVIDER_MODELS[provider] || [];
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
    if (selectedModel && models.some(m => m.id === selectedModel)) {
      modelSelect.value = selectedModel;
    }
    updatePriceHint();
  }

  function updatePriceHint() {
    const prov = providerSelect.value;
    const modelId = modelSelect.value;
    const models = PROVIDER_MODELS[prov] || [];
    const found = models.find(m => m.id === modelId);
    priceHint.textContent = found ? found.price : "";
  }
  modelSelect.addEventListener("change", updatePriceHint);

  // Handle Length Pills
  function setLengthActivePill(val) {
    activeLength = val;
    lengthPills.forEach(p => {
      const on = p.getAttribute("data-val") === val;
      p.classList.toggle("active", on);
      p.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  lengthPills.forEach((p, idx) => {
    p.addEventListener("click", () => setLengthActivePill(p.getAttribute("data-val")));
    // Arrow-key navigation within the radiogroup.
    p.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = lengthPills[(idx + dir + lengthPills.length) % lengthPills.length];
      setLengthActivePill(next.getAttribute("data-val"));
      next.focus();
    });
  });

  // Handle Theme Toggle
  themeToggle.addEventListener("click", () => {
    const isLight = document.documentElement.classList.toggle("theme-light");
    chrome.storage.sync.set({ theme: isLight ? "light" : "dark" });
  });

  // Save Settings
  saveBtn.addEventListener("click", () => {
    const mode = activeApiMode;
    const tone = toneSelect.value;
    const length = activeLength;
    const provider = providerSelect.value;
    const model = modelSelect.value;
    const key = apiKeyInput.value.trim();

    // Non-secret prefs → sync. Secret API keys → local.
    const prefsObj = {
      api_mode: mode,
      reply_tone: tone,
      default_tweet_length: length,
      provider: provider,
      openai_model: model
    };
    const keyObj = {};
    if (mode === "custom") {
      keyObj[`key_${provider}`] = key;
      if (provider === "openai") keyObj["openai_api_key"] = key; // legacy alias
    }

    const done = () => {
      const originalText = saveBtn.textContent;
      saveBtn.textContent = I18N[currentLang].saved;
      saveBtn.classList.add("btn-primary");
      setTimeout(() => { saveBtn.textContent = originalText; }, 1200);
    };
    chrome.storage.sync.set(prefsObj, () => {
      if (Object.keys(keyObj).length) chrome.storage.local.set(keyObj, done);
      else done();
    });
  });

  // Clear Key
  clearBtn.addEventListener("click", () => {
    const prov = providerSelect.value;
    apiKeyInput.value = "";

    const removeKeys = [`key_${prov}`];
    if (prov === "openai") {
      removeKeys.push("openai_api_key");
    }

    chrome.storage.local.remove(removeKeys, () => {
      const originalText = clearBtn.textContent;
      clearBtn.textContent = I18N[currentLang].cleared;
      setTimeout(() => {
        clearBtn.textContent = originalText;
      }, 1200);
    });
  });

  // Buy analyze credits — routes through the background so the pay page links to
  // THIS install's device id and the token is captured automatically.
  const buyCreditsBtn = document.getElementById("buyCredits");
  if (buyCreditsBtn) {
    buyCreditsBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "openPayPage" }, () => void chrome.runtime.lastError);
    });
  }

  // Pascual Terminal link — show status, toggle link/unlink.
  const hubStatusEl = document.getElementById("hubStatus");
  const hubLinkBtn = document.getElementById("hubLinkBtn");
  const hubLinkLabel = document.getElementById("hubLinkLabel");
  function refreshHubStatus() {
    chrome.runtime.sendMessage({ action: "hubStatus" }, (r) => {
      if (chrome.runtime.lastError) return;
      const linked = r && r.linked;
      if (hubStatusEl) { hubStatusEl.textContent = linked ? "✓ подключено" : "не подключено"; hubStatusEl.style.color = linked ? "var(--accent-2)" : "var(--muted)"; }
      if (hubLinkLabel) hubLinkLabel.textContent = linked ? "Отвязать от терминала" : (currentLang === "ru" ? "Привязать кошелёк к терминалу" : "Link wallet to Terminal");
    });
  }
  if (hubLinkBtn) {
    hubLinkBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "hubStatus" }, (r) => {
        if (chrome.runtime.lastError) return;
        if (r && r.linked) {
          chrome.runtime.sendMessage({ action: "unlinkHub" }, () => { refreshHubStatus(); });
        } else {
          chrome.runtime.sendMessage({ action: "linkHub" }, () => void chrome.runtime.lastError);
          // Re-check a few times while the user links in the opened tab.
          let n = 0; const iv = setInterval(() => { refreshHubStatus(); if (++n > 20) clearInterval(iv); }, 3000);
        }
      });
    });
  }
  refreshHubStatus();

  // Download Logs
  downloadLogBtn.addEventListener("click", () => {
    chrome.storage.local.get(["tweet_logs"], (items) => {
      const logs = items.tweet_logs || [];
      if (logs.length === 0) {
        alert(I18N[currentLang].logEmpty);
        return;
      }

      const logData = {
        exportDate: new Date().toISOString(),
        totalEntries: logs.length,
        logs: logs
      };

      const jsonStr = JSON.stringify(logData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pascual-reply-log-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  });

  // Clear Logs Database
  clearLogBtn.addEventListener("click", () => {
    if (confirm(I18N[currentLang].confirmClearLog)) {
      chrome.storage.local.set({ tweet_logs: [] }, () => {
        alert(I18N[currentLang].logCleared);
        updateCounters();
      });
    }
  });
});