// content_script.js — Pascual Reply AI content script (Pascual Labs)

const DEBOUNCE_MS = 600;
let lastClickTs = 0;

/************  Localization (mirror popup: navigator.language) ************/
const LOCALE = (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
const STR = {
  extractFail:   { en: 'Failed to extract tweet text', ru: 'Не удалось получить текст твита' },
  nothingAnalyze:{ en: 'Nothing to analyze', ru: 'Нечего анализировать' },
  openWithReplies:{ en: 'Open a post with replies (scroll to load them)', ru: 'Откройте пост с ответами (прокрутите, чтобы подгрузить)' },
  analysisFail:  { en: 'Analysis failed', ru: 'Ошибка анализа' },
  genFail:       { en: 'Generation failed', ru: 'Ошибка генерации' },
  emptyResp:     { en: 'Empty response', ru: 'Пустой ответ' },
  replyReady:    { en: 'Reply generated', ru: 'Ответ готов' },
  postReady:     { en: 'Post generated', ru: 'Пост готов' },
  textboxMissing:{ en: 'Response textbox not found', ru: 'Поле ответа не найдено' },
  postboxMissing:{ en: 'Post textbox not found', ru: 'Поле твита не найдено' },
  needProfile:   { en: 'Open a profile page or a post', ru: 'Открой страницу профиля или пост' },
  generating:    { en: 'generating…', ru: 'генерация…' },
  writeDraft:    { en: 'Write a draft first', ru: 'Сначала напишите черновик твита' },
  chooseVariant: { en: 'Improve draft — choose a variant', ru: 'Improve draft — выберите вариант' },
  variantInserted:{ en: 'Variant inserted', ru: 'Вариант вставлен' },
  clickToUse:    { en: 'click to use', ru: 'нажмите чтобы вставить' },
  copied:        { en: 'Copied', ru: 'Скопировано' },
  copy:          { en: 'Copy', ru: 'Копировать' },
  close:         { en: 'Close', ru: 'Закрыть' },
  chars:         { en: 'chars', ru: 'симв.' },
  creditLeft:    { en: (n) => `−1 credit · ${n} left`, ru: (n) => `−1 кредит · осталось ${n}` },
  lenPrompt:     { en: 'Choose tweet length:', ru: 'Выберите длину твита:' }
};
function t(key, arg) {
  const v = STR[key]?.[LOCALE] ?? STR[key]?.en ?? key;
  return typeof v === 'function' ? v(arg) : v;
}

// Send a message to the background service worker, surviving the common
// "Extension context invalidated" case (happens when the extension is
// updated/reloaded while this X tab stayed open). Returns the response, or
// throws a clear, user-actionable error asking to refresh the page.
function safeSendMessage(payload) {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.id) {
      reject(new Error('Extension was updated. Please refresh this page. / Расширение обновилось — обновите страницу.'));
      return;
    }
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        const err = chrome.runtime?.lastError;
        if (err) {
          reject(new Error('Extension was updated. Please refresh this page. / Расширение обновилось — обновите страницу.'));
          return;
        }
        resolve(res);
      });
    } catch (_) {
      reject(new Error('Extension was updated. Please refresh this page. / Расширение обновилось — обновите страницу.'));
    }
  });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(sel, timeout = 5000, root = document) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const el = root.querySelector(sel);
    if (el) return el;
    await wait(120);
  }
  return null;
}

let toastTimer = null;
function toast(msg, isError = false) {
  try {
    let box = document.getElementById('pascual-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pascual-toast';
      document.body.appendChild(box);
    }
    box.style.cssText = `
      position: fixed; z-index: 2147483647; left: 50%; bottom: 24px; transform: translateX(-50%);
      max-width: min(520px, 90vw); text-align: center; line-height: 1.45;
      background: ${isError
        ? 'linear-gradient(135deg, rgba(190,40,60,.97) 0%, rgba(120,20,40,.97) 100%)'
        : 'linear-gradient(135deg, rgba(139,92,246,.95) 0%, rgba(233,69,96,.95) 100%)'};
      color:#fff; padding:11px 18px; border-radius:12px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size:13px; font-weight: 600; box-shadow:0 8px 24px rgba(0,0,0,.35);
      transition: opacity 0.3s ease;`;
    box.textContent = msg;
    box.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    // Errors carry actionable text (limits, payment) — keep them up longer.
    toastTimer = setTimeout(() => box && (box.style.opacity = '0'), isError ? 6000 : 2200);
  } catch {}
}
function toastErr(msg) { toast(msg, true); }

function nowOk() {
  const t = Date.now();
  if (t - lastClickTs < DEBOUNCE_MS) return false;
  lastClickTs = t;
  return true;
}

/************  Pascual Reply Button  ************/
const REPLY_BTN_CLASS = 'pascual-reply-btn';
const injectedParents = new WeakSet();

function createPascualReplyButton() {
  const b = document.createElement('button');
  b.className = REPLY_BTN_CLASS;
  b.textContent = '✦';
  b.title = 'Pascual Reply';
  b.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: 6px;
    border: none;
    border-radius: 50%;
    font-weight: 700;
    font-size: 11px;
    color: #fff;
    background: linear-gradient(135deg, #8b5cf6 0%, #e94560 100%);
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(139,92,246,.4);
    transform: scale(.7);
    opacity: 0;
    transition: all .2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    position: relative;
    z-index: 1000;
    flex-shrink: 0;
  `;
  requestAnimationFrame(() => { 
    b.style.transform = 'scale(1)'; 
    b.style.opacity = '1'; 
  });
  b.onmouseenter = () => {
    b.style.transform = 'scale(1.2)';
    b.style.filter = 'brightness(1.15)';
    b.style.boxShadow = '0 4px 10px rgba(139,92,246,.6)';
  };
  b.onmouseleave = () => {
    b.style.transform = 'scale(1)';
    b.style.filter = 'brightness(1.0)';
    b.style.boxShadow = '0 2px 6px rgba(139,92,246,.4)';
  };
  return b;
}

function findArticle(node) {
  while (node && node !== document.body) {
    if (node.getAttribute && (node.getAttribute('role') === 'article' || node.tagName.toLowerCase() === 'article')) return node;
    node = node.parentNode;
  }
  return null;
}

function extractTweetText(article) {
  // Prefer the real tweet-text nodes. For a media-only tweet neither exists, so
  // return '' rather than falling back to article.innerText — that fallback
  // leaked UI chrome (name, @handle, "· 4h", like/view counts) as "tweet text".
  const el = article?.querySelector('[data-testid="tweetText"]') || article?.querySelector('div[lang]');
  return (el ? el.innerText : '').trim();
}

function extractTweetImages(article) {
  const imgs = [...article.querySelectorAll('img')]
    .map(i => i.src || '')
    .filter(src => /twimg\.com\/media|pbs\.twimg\.com\/media/.test(src));
  return [...new Set(imgs)];
}

async function openReplyDialogFor(article) {
  const replyIcon = article.querySelector('[data-testid="reply"], [aria-label="Reply"]');
  replyIcon?.click();
  const dlg = await waitFor('div[role="dialog"]', 2500);
  return dlg || document;
}

/************  💡 Реальная вставка текста без дублирования ************/
async function insertTweetLikeHuman(el, text) {
  insertTextInto(el, text);
}

/************  Основная вставка ************/
function insertTextInto(el, text) {
  if (!el) return;
  
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.focus();
    // Выделяем весь текст, чтобы заменить его полностью
    document.execCommand('selectAll', false, null);
    
    // Имитируем событие вставки (paste) для корректной работы с Lexical (Twitter) без дублирования
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      el.dispatchEvent(pasteEvent);
    } catch (e) {
      console.error(`[Pascual Reply] Failed to dispatch paste event, falling back to execCommand:`, e);
      document.execCommand('insertText', false, text);
    }
  }
}

/************  Thread / replies extraction (for Analyze & Sentiment) ************/
function extractArticleAuthor(article) {
  const link = article?.querySelector('div[data-testid="User-Name"] a[href^="/"]');
  if (!link) return '';
  const href = link.getAttribute('href') || '';
  const m = href.match(/^\/([^\/]+)/);
  return m ? '@' + m[1] : '';
}

// On a /status/ page, collect every visible tweet in the thread (main post +
// loaded replies). Elsewhere, fall back to just the clicked tweet.
function extractThreadContext(article) {
  const items = [];
  if (window.location.pathname.includes('/status/')) {
    for (const a of document.querySelectorAll('article[role="article"]')) {
      const text = extractTweetText(a);
      if (!text) continue;
      items.push({ author: extractArticleAuthor(a), text: text.slice(0, 600) });
      if (items.length >= 30) break;
    }
  }
  if (!items.length) {
    const text = extractTweetText(article);
    if (text) items.push({ author: extractArticleAuthor(article), text: text.slice(0, 600) });
  }
  return items;
}

/************  Overlay lifecycle: close on Escape / scroll / SPA navigation ************/
// All floating UI (action menu, result panel, variant chooser) registers here so
// it can't get orphaned over unrelated tweets after the user scrolls or X does a
// client-side route change.
const OVERLAY_IDS = ['pascual-action-menu', 'pascual-result-panel'];
function closeAllOverlays() {
  OVERLAY_IDS.forEach(id => document.getElementById(id)?.remove());
}
let overlayListenersBound = false;
function ensureOverlayListeners() {
  if (overlayListenersBound) return;
  overlayListenersBound = true;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllOverlays(); }, true);
  window.addEventListener('scroll', () => {
    // Menu is anchored to a tweet's button; scrolling detaches it. Panels hold
    // static text, so keep them — only the menu closes on scroll.
    document.getElementById('pascual-action-menu')?.remove();
  }, true);
}

// Detect X's theme so panels/menus match light or dark mode instead of forcing
// a dark palette onto a light timeline.
function xIsDark() {
  try {
    const bg = getComputedStyle(document.body).backgroundColor || '';
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b] = m[1].split(',').map(n => parseFloat(n));
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
    }
  } catch (_) {}
  return true;
}
function panelColors() {
  return xIsDark()
    ? { bg: '#16121f', fg: '#f2f0f7', sub: '#9b93ad', line: 'rgba(139,92,246,.45)', card: 'rgba(255,255,255,.05)' }
    : { bg: '#ffffff', fg: '#241d33', sub: '#6f6683', line: 'rgba(124,79,224,.4)', card: 'rgba(124,79,224,.06)' };
}

/************  Result panel (for Analyze & Sentiment output) ************/
const PANEL_ID = 'pascual-result-panel';

function showResultPanel(title, text) {
  ensureOverlayListeners();
  document.getElementById(PANEL_ID)?.remove();
  const c = panelColors();
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;
  panel.style.cssText = `
    position: fixed; z-index: 2147483647; top: 70px; right: 16px;
    width: 380px; max-width: calc(100vw - 32px); max-height: 70vh;
    display: flex; flex-direction: column;
    background: ${c.bg}; color: ${c.fg}; border: 1px solid ${c.line};
    border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.45);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px;`;

  const head = document.createElement('div');
  head.style.cssText = `
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 14px; border-bottom: 1px solid ${c.line};
    background: linear-gradient(135deg, rgba(139,92,246,.25) 0%, rgba(233,69,96,.25) 100%);
    border-radius: 14px 14px 0 0; font-weight: 700; color: ${c.fg};`;
  const titleEl = document.createElement('span');
  titleEl.textContent = '✦ ' + title;
  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'display:flex; gap:6px;';
  const mkBtn = (label, titleAttr) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = titleAttr;
    b.style.cssText = `
      border: none; border-radius: 8px; padding: 3px 9px; cursor: pointer;
      background: rgba(139,92,246,.28); color: ${c.fg}; font-size: 12px; font-weight: 600;`;
    return b;
  };
  const copyBtn = mkBtn('⧉', t('copy'));
  copyBtn.onclick = () => {
    navigator.clipboard?.writeText(text).then(() => toast(t('copied')));
  };
  const closeBtn = mkBtn('✕', t('close'));
  closeBtn.onclick = () => panel.remove();
  btnWrap.append(copyBtn, closeBtn);
  head.append(titleEl, btnWrap);

  const body = document.createElement('div');
  body.style.cssText = `padding: 12px 14px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5; color: ${c.fg};`;
  body.textContent = text;

  panel.append(head, body);
  document.body.appendChild(panel);
  closeBtn.focus();
}

/************  Actions ************/
function creditToast(resp) {
  if (resp && typeof resp.credits === 'number') toast(t('creditLeft', resp.credits));
}

async function doReply(article) {
  const tweetText = extractTweetText(article);
  if (!tweetText) { toast(t('extractFail')); return; }

  // Ask for length BEFORE opening the reply dialog, so Cancel aborts cleanly
  // without opening a dialog or spending quota.
  const length = await chooseLength();
  if (length == null) return; // user cancelled

  const root = await openReplyDialogFor(article);
  const images = extractTweetImages(article);

  const resp = await safeSendMessage({ action: 'generateReply', text: tweetText, images, length });
  if (!resp || resp.error) throw new Error(resp?.error || t('genFail'));

  const input = await waitFor('div[data-testid="tweetTextarea_0"], div[role="textbox"], textarea, input[type="text"]', 2500, root);
  if (!input) throw new Error(t('textboxMissing'));

  insertTextInto(input, resp.reply || '');
  toast(t('replyReady'));
}

async function doAnalyze(article) {
  const thread = extractThreadContext(article);
  if (!thread.length) { toast(t('nothingAnalyze')); return; }
  const resp = await safeSendMessage({ action: 'analyzePost', thread });
  if (!resp || resp.error) throw new Error(resp?.error || t('analysisFail'));
  showResultPanel('Analysis', resp.analysis || '');
  creditToast(resp);
}

async function doSentiment(article) {
  const thread = extractThreadContext(article);
  if (thread.length < 2) { toast(t('openWithReplies')); return; }
  const resp = await safeSendMessage({ action: 'analyzeSentiment', thread });
  if (!resp || resp.error) throw new Error(resp?.error || t('analysisFail'));
  showResultPanel('Sentiment', resp.analysis || '');
  creditToast(resp);
}

/************  Action menu on the ✦ button ************/
const MENU_ID = 'pascual-action-menu';

const ACTIONS = [
  { key: 'reply',     label: '✍️ Reply',     run: doReply },
  { key: 'analyze',   label: '🔍 Analyze',   run: doAnalyze },
  { key: 'sentiment', label: '📊 Sentiment', run: doSentiment },
];

function closeActionMenu() { document.getElementById(MENU_ID)?.remove(); }

function showActionMenu(btn, article) {
  ensureOverlayListeners();
  closeActionMenu();
  const c = panelColors();
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.setAttribute('role', 'menu');
  const r = btn.getBoundingClientRect();
  menu.style.cssText = `
    position: fixed; z-index: 2147483647;
    top: ${Math.round(r.bottom + 6)}px; left: ${Math.round(Math.min(r.left, window.innerWidth - 180))}px;
    display: flex; flex-direction: column; min-width: 160px; padding: 6px;
    background: ${c.bg}; border: 1px solid ${c.line}; border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,.45);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;`;

  let first = null;
  for (const action of ACTIONS) {
    const item = document.createElement('button');
    item.textContent = action.label;
    item.setAttribute('role', 'menuitem');
    item.style.cssText = `
      border: none; background: transparent; color: ${c.fg}; text-align: left;
      padding: 8px 10px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;`;
    item.onmouseenter = () => item.style.background = 'rgba(139,92,246,.25)';
    item.onmouseleave = () => item.style.background = 'transparent';
    item.onclick = async (ev) => {
      ev.stopPropagation();
      closeActionMenu();
      if (!article.isConnected) { toastErr(t('extractFail')); return; }
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '…';
      try {
        await action.run(article);
      } catch (e) {
        toastErr('Pascual Reply: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    };
    if (!first) first = item;
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  first?.focus();
  // Close on any outside click (next tick so this click doesn't self-close).
  setTimeout(() => {
    document.addEventListener('click', closeActionMenu, { once: true });
  }, 0);
}

/************  Pascual Reply wiring ************/
function wireReplyButton(btn, article) {
  if (btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    if (!nowOk()) return;
    showActionMenu(btn, article);
  });
}

function injectReplyButtons() {
  const replyBtns = document.querySelectorAll('[data-testid="reply"], [aria-label="Reply"]');
  replyBtns.forEach(rb => {
    const parent = rb.parentElement;
    if (!parent || injectedParents.has(parent)) return;
    if (parent.querySelector('.' + REPLY_BTN_CLASS)) { 
      injectedParents.add(parent); 
      return;
    }
    const article = findArticle(rb);
    if (!article) return;
    const btn = createPascualReplyButton();
    wireReplyButton(btn, article);
    
    const isDetailedView = article.closest('[data-testid="tweetDetail"]') || 
                          article.closest('[role="dialog"]') ||
                          window.location.pathname.includes('/status/');
    
    btn.style.marginLeft = isDetailedView ? '8px' : '6px';
    btn.style.alignSelf = 'center';
    btn.style.verticalAlign = 'middle';
    // Append inside an inline-flex wrapper instead of forcing X's action-bar to
    // flex/flex-wrap (which changed the height/alignment of every tweet's
    // like/repost row and could wrap our button onto a second line).
    const holder = document.createElement('span');
    holder.style.cssText = 'display:inline-flex; align-items:center;';
    holder.appendChild(btn);
    parent.appendChild(holder);
    injectedParents.add(parent);
  });
}

/************  Pascual Post Button  ************/
const GTWEET_ID = 'pascual-post-btn';

function createPascualPostButton() {
  const b = document.createElement('button');
  b.id = GTWEET_ID;
  b.textContent = 'Pascual Post';
  // No width/margin here — layout is owned by the flex container in
  // injectGTweetButton so the two buttons sit on one clean row.
  b.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 auto;
    padding: 10px 16px;
    border: none;
    border-radius: 9999px;
    background: linear-gradient(135deg, #8b5cf6 0%, #e94560 100%);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(139,92,246,.3);
    transition: all .2s;
  `;
  b.onmouseenter = () => {
    b.style.filter = 'brightness(1.1)';
    b.style.transform = 'translateY(-1px)';
    b.style.boxShadow = '0 6px 16px rgba(139,92,246,.45)';
  };
  b.onmouseleave = () => {
    b.style.filter = 'brightness(1.0)';
    b.style.transform = 'translateY(0)';
    b.style.boxShadow = '0 4px 12px rgba(139,92,246,.3)';
  };
  return b;
}

// Find the X composer's toolbar (icons row + Post/Reply button). We anchor to
// it by data-testid — never a loose text match — so we don't attach to the
// left-nav "Post" link or "Show N posts" pills on profile/search pages.
// Returns the toolbar element itself; injection places our row AFTER it.
function findPublishContainer() {
  if (!document.querySelector('div[data-testid="tweetTextarea_0"]')) return null;
  const submit = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
  return submit?.closest('[data-testid="toolBar"]') ||
         document.querySelector('[data-testid="toolBar"]') || null;
}

async function ensureComposerOpen() {
  let box = document.querySelector('div[data-testid="tweetTextarea_0"] [contenteditable="true"]') ||
            document.querySelector('[contenteditable="true"]');
  if (box) return box;
  
  const newTweetBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]') || 
                     document.querySelector('[data-testid="FloatingActionButton"]') ||
                     document.querySelector('a[href="/compose/post"]') ||
                     [...document.querySelectorAll('div[role="button"], a[role="link"], button')]
                       .find(n => {
                         const text = n.textContent?.trim() || '';
                         return /^(Опубликовать|Опубликовать пост|Post|Tweet|Твитнуть)$/i.test(text) && 
                                !n.closest('[role="dialog"]');
                       });
                       
  if (newTweetBtn) {
    newTweetBtn.click();
    const dlg = await waitFor('div[role="dialog"]', 3000);
    if (dlg) {
      box = dlg.querySelector('div[data-testid="tweetTextarea_0"] [contenteditable="true"]') || 
            dlg.querySelector('[contenteditable="true"]');
      if (box) return box;
    }
  }
  
  return await waitFor('div[data-testid="tweetTextarea_0"] [contenteditable="true"], [contenteditable="true"]', 2000);
}

function isPostDetailPage() {
  return window.location.pathname.includes('/status/') || 
         !!document.querySelector('[data-testid="tweetDetail"]') ||
         !!document.querySelector('article[role="article"]')?.closest('[role="dialog"]');
}

function extractPostData() {
  const article = document.querySelector('[data-testid="tweetDetail"] article[role="article"]') ||
                  document.querySelector('article[role="article"]');
  if (!article) return null;
  
  const text = extractTweetText(article);
  if (!text) return null;
  
  const userNameContainer = article.querySelector('div[data-testid="User-Name"]') ||
                            article.querySelector('div[data-testid="UserName"]') ||
                            article.querySelector('div[data-testid="User-Names"]');
  
  let authorName = "";
  let authorHandle = "";
  
  if (userNameContainer) {
    const links = [...userNameContainer.querySelectorAll('a[href^="/"]')];
    if (links.length > 0) {
      const handleLink = links.find(a => a.textContent?.trim().startsWith('@')) || links[1] || links[0];
      if (handleLink) {
        authorHandle = handleLink.textContent.trim();
        if (!authorHandle.startsWith('@')) {
          const href = handleLink.getAttribute('href');
          if (href) {
            const match = href.match(/^\/([^\/]+)/);
            if (match && match[1]) authorHandle = '@' + match[1];
          }
        }
      }
      const nameLink = links.find(a => a !== handleLink) || links[0];
      if (nameLink) {
        authorName = nameLink.textContent.trim();
      }
    }
  }
  
  // Fallbacks if container parsing failed
  if (!authorName) {
    authorName = article.querySelector('div[data-testid="User-Name"] span')?.textContent?.trim() ||
                 article.querySelector('div[data-testid="UserName"] span')?.textContent?.trim() ||
                 article.querySelector('div[data-testid="User-Names"] span')?.textContent?.trim() || '';
  }
  if (!authorHandle) {
    authorHandle = article.querySelector('div[data-testid="User-Name"] a[href^="/"]')?.textContent?.trim() ||
                   article.querySelector('div[data-testid="UserName"] a[href^="/"]')?.textContent?.trim() ||
                   article.querySelector('div[data-testid="User-Names"] a[href^="/"]')?.textContent?.trim() || '';
  }
  
  if (authorHandle && !authorHandle.startsWith('@')) {
    authorHandle = '@' + authorHandle.replace('@', '');
  }
  
  return {
    text,
    authorName: authorName || '',
    authorHandle: authorHandle || '',
    images: extractTweetImages(article)
  };
}

function extractProfileData() {
  if (isPostDetailPage()) {
    const postData = extractPostData();
    if (postData) return null; 
  }
  
  const userNameHeader = document.querySelector('div[data-testid="UserName"]');
  let name = "";
  if (userNameHeader) {
    const nameEl = userNameHeader.querySelector('span');
    if (nameEl) name = nameEl.textContent.trim();
  }
  if (!name) {
    name = document.querySelector('h2[dir] span')?.textContent?.trim() ||
           document.title.replace(/ \(@.*$/, '').trim();
  }

  let handle = "";
  if (userNameHeader) {
    const elements = [...userNameHeader.querySelectorAll('*')];
    const handleEl = elements.find(el => el.textContent?.trim().startsWith('@'));
    if (handleEl) {
      handle = handleEl.textContent.trim().slice(1); // remove '@'
    }
  }
  
  if (!handle) {
    const profileHeader = document.querySelector('[data-testid="UserProfileHeader_Items"]');
    if (profileHeader) {
      const elements = [...profileHeader.querySelectorAll('*')];
      const handleEl = elements.find(el => el.textContent?.trim().startsWith('@'));
      if (handleEl) {
        handle = handleEl.textContent.trim().slice(1);
      }
    }
  }
  
  if (!handle) {
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    if (seg && !/home|explore|notifications|messages|i|search/i.test(seg)) handle = seg;
  }


  const bio = document.querySelector('div[data-testid="UserDescription"]')?.innerText?.trim() || '';
  const tweets = [...document.querySelectorAll('article[role="article"] div[lang]')].slice(0, 2).map(x => x.innerText.trim());
  
  if (!name || !handle) return null;
  return { name, handle: '@' + handle, bio, tweets };
}

function wireGTweet(btn) {
  if (btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', async () => {
    if (!nowOk()) return;
    btn.disabled = true; 
    const old = btn.textContent; 
    btn.textContent = t('generating');
    try {
      const isPostDetail = isPostDetailPage();
      
      if (isPostDetail) {
        const postData = extractPostData();
        if (postData) {
          const length = await chooseLength();
          if (length == null) return;
          const resp = await safeSendMessage({ action: 'generateTweetFromPost', postData, length });
          if (!resp || resp.error) throw new Error(resp?.error || t('genFail'));
          const box = await ensureComposerOpen();
          if (!box) throw new Error(t('postboxMissing'));
          await insertTweetLikeHuman(box, resp.tweet);
          toast(t('postReady'));
          return;
        }
      }

      const profile = extractProfileData();
      if (!profile) throw new Error(t('needProfile'));
      const length = await chooseLength();
      if (length == null) return;
      const resp = await safeSendMessage({ action: 'generateTweet', profile, length });
      if (!resp || resp.error) throw new Error(resp?.error || t('genFail'));
      const box = await ensureComposerOpen();
      if (!box) throw new Error(t('postboxMissing'));
      await insertTweetLikeHuman(box, resp.tweet);
      toast(t('postReady'));
    } catch (e) {
      toastErr('Pascual Post: ' + e.message);
    } finally {
      btn.disabled = false; 
      btn.textContent = old;
    }
  });
}

/************  Improve my draft  ************/
const IMPROVE_ID = 'pascual-improve-btn';

// The active composer: prefer the one inside an open dialog, else the inline one.
function findComposer() {
  const dlg = document.querySelector('div[role="dialog"]');
  const scope = dlg || document;
  return scope.querySelector('div[data-testid="tweetTextarea_0"] [contenteditable="true"]') ||
         scope.querySelector('div[data-testid="tweetTextarea_0"]') ||
         scope.querySelector('[contenteditable="true"][role="textbox"]');
}

function createImproveButton() {
  const b = document.createElement('button');
  b.id = IMPROVE_ID;
  b.textContent = '✦ Improve';
  b.title = LOCALE === 'ru' ? 'Улучшить черновик' : 'Improve my draft';
  b.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 14px;
    border: 1px solid rgba(139,92,246,.55);
    border-radius: 9999px;
    background: rgba(139,92,246,.14);
    color: #8b5cf6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: all .2s;
  `;
  b.onmouseenter = () => { b.style.background = 'rgba(139,92,246,.28)'; };
  b.onmouseleave = () => { b.style.background = 'rgba(139,92,246,.14)'; };
  return b;
}

// Chooser panel: three rewrite variants, click one to insert it into the composer.
function showVariantChooser(variants) {
  ensureOverlayListeners();
  document.getElementById(PANEL_ID)?.remove();
  const c = panelColors();
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.tabIndex = -1;
  panel.style.cssText = `
    position: fixed; z-index: 2147483647; top: 70px; right: 16px;
    width: 400px; max-width: calc(100vw - 32px); max-height: 74vh;
    display: flex; flex-direction: column;
    background: ${c.bg}; color: ${c.fg}; border: 1px solid ${c.line};
    border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.45);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px;`;

  const head = document.createElement('div');
  head.style.cssText = `
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 14px; border-bottom: 1px solid ${c.line};
    background: linear-gradient(135deg, rgba(139,92,246,.25) 0%, rgba(233,69,96,.25) 100%);
    border-radius: 14px 14px 0 0; font-weight: 700; color: ${c.fg};`;
  const titleEl = document.createElement('span');
  titleEl.textContent = '✦ ' + t('chooseVariant');
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = t('close');
  closeBtn.style.cssText = `
    border: none; border-radius: 8px; padding: 3px 9px; cursor: pointer;
    background: rgba(139,92,246,.28); color: ${c.fg}; font-size: 12px; font-weight: 600;`;
  closeBtn.onclick = () => panel.remove();
  head.append(titleEl, closeBtn);

  const body = document.createElement('div');
  body.style.cssText = 'padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;';

  let firstCard = null;
  for (const v of variants) {
    const card = document.createElement('button');
    card.style.cssText = `
      display: block; width: 100%; text-align: left; cursor: pointer;
      background: ${c.card}; color: ${c.fg};
      border: 1px solid rgba(139,92,246,.3); border-radius: 10px;
      padding: 10px 12px; font-size: 13px; line-height: 1.45;
      font-family: inherit; transition: all .15s;`;
    card.onmouseenter = () => { card.style.background = 'rgba(139,92,246,.18)'; card.style.borderColor = 'rgba(139,92,246,.6)'; };
    card.onmouseleave = () => { card.style.background = c.card; card.style.borderColor = 'rgba(139,92,246,.3)'; };

    const chip = document.createElement('div');
    chip.textContent = v.label;
    chip.style.cssText = `
      display: inline-block; margin-bottom: 6px; padding: 2px 9px; border-radius: 999px;
      background: linear-gradient(135deg, #8b5cf6 0%, #e94560 100%);
      color: #fff; font-size: 11px; font-weight: 700;`;
    const textEl = document.createElement('div');
    textEl.textContent = v.text;
    textEl.style.whiteSpace = 'pre-wrap';
    const hint = document.createElement('div');
    hint.textContent = `${Array.from(v.text).length} ${t('chars')} · ${t('clickToUse')}`;
    hint.style.cssText = `margin-top: 6px; font-size: 11px; color: ${c.sub};`;

    card.append(chip, textEl, hint);
    card.onclick = async () => {
      panel.remove();
      const box = await ensureComposerOpen();
      if (!box) { toastErr(t('postboxMissing')); return; }
      insertTextInto(box, v.text);
      toast(t('variantInserted'));
    };
    if (!firstCard) firstCard = card;
    body.appendChild(card);
  }

  panel.append(head, body);
  document.body.appendChild(panel);
  firstCard?.focus();
}

function wireImproveButton(btn) {
  if (btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', async () => {
    if (!nowOk()) return;
    const composer = findComposer();
    const draft = (composer?.innerText || composer?.value || '').trim();
    if (!draft || draft.length < 3) {
      toastErr(t('writeDraft'));
      return;
    }
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '…';
    try {
      const resp = await safeSendMessage({ action: 'improveDraft', draft });
      if (!resp || resp.error) throw new Error(resp?.error || t('genFail'));
      if (!Array.isArray(resp.variants) || !resp.variants.length) throw new Error(t('emptyResp'));
      showVariantChooser(resp.variants);
      creditToast(resp);
    } catch (e) {
      toastErr('Pascual Improve: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });
}

const GROW_ROW_ID = 'pascual-actions-row';
function injectGTweetButton() {
  if (document.getElementById(GROW_ROW_ID)) return;
  const toolbar = findPublishContainer();
  if (!toolbar || !toolbar.parentElement) return;

  const btn = createPascualPostButton();
  wireGTweet(btn);

  const improveBtn = createImproveButton();
  wireImproveButton(improveBtn);
  improveBtn.style.flex = '0 0 auto';

  // Own full-width row placed directly BELOW the toolbar — not inside it, so it
  // can't fight the toolbar's flex layout (that was the misaligned-bar bug).
  const row = document.createElement('div');
  row.id = GROW_ROW_ID;
  row.style.cssText = 'display:flex; align-items:stretch; gap:8px; width:100%; padding:8px 8px 4px; box-sizing:border-box;';
  row.append(btn, improveBtn);
  toolbar.parentElement.insertAdjacentElement('afterend', row);
}

// Returns the chosen length, or null if the user cancelled the "Ask" prompt
// (callers must abort on null — do NOT silently proceed at a default, which
// would spend quota on a reply the user tried to cancel).
async function chooseLength() {
  return new Promise(resolve => {
    // chrome.storage can be undefined here if the extension was reloaded/updated
    // while this page stayed open (the content script's extension context gets
    // invalidated). Guard against it and fall back to the default length.
    if (!chrome?.storage?.sync) {
      resolve(190);
      return;
    }
    try {
      chrome.storage.sync.get(["default_tweet_length"], items => {
        if (chrome.runtime?.lastError) { resolve(190); return; }
        const val = (items && items.default_tweet_length) || "190";
        if (val === "ask") {
          const v = prompt(t('lenPrompt') + '\n1) 100  2) 190  3) 450', '2');
          if (v === null) return resolve(null); // Cancel → abort
          if (v === '1') return resolve(100);
          if (v === '3') return resolve(450);
          return resolve(190);
        }
        resolve(parseInt(val, 10) || 190);
      });
    } catch (_) {
      resolve(190);
    }
  });
}

/************  OBSERVER  ************/
// Debounce: X mutates the DOM constantly; running the injection scans on every
// batch was wasteful. Coalesce into one trailing pass per animation frame.
let scanScheduled = false;
function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    injectReplyButtons();
    injectGTweetButton();
  });
}

// Close overlays on SPA route changes (X uses pushState; no full navigation).
let lastPath = location.pathname;
function checkNav() {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    closeAllOverlays();
  }
}

const obs = new MutationObserver(() => {
  checkNav();
  scheduleScan();
});
obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
injectReplyButtons();
injectGTweetButton();