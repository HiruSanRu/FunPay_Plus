/* ===== FunPay Plus: фоновый скрипт ===== */
importScripts('palette.js'); // цвета иконки уведомлений берём из палитры темы
const BASE = 'https://funpay.com';
const AFTER_SUCCESS = 60 * 60e3;        // после поднятия проверяем снова через час, FunPay скажет точное время
const RETRY_ON_ERROR = 30 * 60e3;       // при непонятной ошибке пробуем через 30 минут
const REDISCOVER_EVERY = 3 * 3600e3;    // как часто обновлять список категорий с лотами

/* ---------- Расписание ---------- */
function setup() {
  chrome.alarms.clear('raise'); // старое напоминание из версии 1.0
  chrome.alarms.create('autoraise', { periodInMinutes: 2 });
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.get('autoraise', (a) => { if (!a) setup(); });

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'autoraise') tick(); });
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'sync' && c.autoRaise?.newValue) tick({ rediscover: true });
});

/* ---------- Сообщения от страниц ---------- */
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'translate') {
    translate(msg).then((text) => reply({ ok: true, text }), (e) => reply({ ok: false, error: String(e.message || e) }));
    return true;
  }
  // Проверка ключа Google Cloud из окна расширения перед сохранением
  if (msg?.type === 'translateCheck') {
    translateCloud('Привет', 'ru', 'en', String(msg.key || '').trim())
      .then((text) => reply({ ok: true, text }), (e) => reply({ ok: false, error: String(e.message || e) }));
    return true;
  }
  // golden_key — HttpOnly-cookie, со страницы её не прочитать
  if (msg?.type === 'goldenKey') {
    chrome.cookies.get({ url: 'https://funpay.com', name: 'golden_key' })
      .then((c) => reply({ ok: true, key: c?.value || '' }), (e) => reply({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.type === 'raiseNow' || msg?.type === 'raiseRefresh') {
    tick({ force: msg.type === 'raiseNow', rediscover: true })
      .then((st) => reply({ ok: !st.error, error: st.error }))
      .catch((e) => reply({ ok: false, error: String(e.message || e) }));
    return true;
  }
});

/* ---------- Перевод (RU → EN) через Google Translate ---------- */
// Если задан свой ключ Google Cloud — только официальный Cloud Translation API.
// Без ключа основной способ — translate-pa (через него работает виджет перевода сайтов Google), запасной — старый gtx.
// gtx Google часто закрывает капчей (редирект на google.com/sorry) для IP с «подозрительным трафиком»
const TRANSLATE_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'; // публичный ключ виджета Google Translate

async function translate({ text, from = 'ru', to = 'en' }) {
  const { gcloudKey } = await chrome.storage.local.get({ gcloudKey: '' });
  // С ключом на бесплатные способы не переключаемся: проблему с ключом или оплатой лучше показать сразу
  if (gcloudKey) {
    return translateCloud(text, from, to, gcloudKey).catch((e) => { throw new Error('Google Cloud: ' + e.message); });
  }
  try {
    return await translateWidget(text, from, to);
  } catch (e) {
    try { return await translateGtx(text, from, to); }
    catch (e2) { throw new Error(`${e.message} (запасной способ: ${e2.message})`); }
  }
}

async function fetchTranslateJson(url, init) {
  // Редирект не открываем: на странице капчи нет CORS-заголовков, и fetch упал бы с невнятной ошибкой
  const r = await fetch(url, { ...init, redirect: 'manual' });
  if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) {
    throw new Error('Google временно ограничил запросы с вашего IP (просит капчу)');
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function translateWidget(text, from, to) {
  // Текст уходит как HTML: экранируем спецсимволы, переносы строк передаём через <br>
  const html = text.replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  const d = await fetchTranslateJson('https://translate-pa.googleapis.com/v1/translateHtml', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': TRANSLATE_KEY },
    body: JSON.stringify([[[html], from, to], 'wt_lib'])
  });
  // Ответ: [["перевод"]]; Google добавляет пробел после <br>
  const out = d?.[0]?.[0];
  if (typeof out !== 'string') throw new Error('неожиданный ответ переводчика');
  return unescapeHtml(out.replace(/ ?<br\s*\/?> ?/gi, '\n'));
}

async function translateGtx(text, from, to) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'
    + `&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}`;
  const d = await fetchTranslateJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(text)
  });
  // Ответ: [[["перевод","оригинал",...], ...], ...], склеиваем куски
  return (d[0] || []).map((p) => p[0]).join('');
}

// Официальный Cloud Translation API (Basic, v2). Ключ передаём заголовком, чтобы он не попадал в URL
async function translateCloud(text, from, to, key) {
  if (!key) throw new Error('ключ не задан');
  const r = await fetch('https://translation.googleapis.com/language/translate/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    // format: text — переносы строк сохраняются, ответ приходит без HTML-сущностей
    body: JSON.stringify({ q: text, source: from, target: to, format: 'text' })
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(cloudError(r.status, d));
  const out = d?.data?.translations?.[0]?.translatedText;
  if (typeof out !== 'string') throw new Error('неожиданный ответ API');
  return out;
}

// Частые ошибки Google Cloud переводим на понятный язык, остальные показываем как есть
function cloudError(status, d) {
  const e = d?.error || {};
  const reason = (e.details || []).find((x) => x?.reason)?.reason || e.errors?.[0]?.reason || '';
  const known = {
    API_KEY_INVALID: 'ключ недействителен, проверьте, что скопировали его целиком',
    SERVICE_DISABLED: 'в проекте не включён Cloud Translation API',
    accessNotConfigured: 'в проекте не включён Cloud Translation API',
    BILLING_DISABLED: 'к проекту не подключён платёжный аккаунт',
    API_KEY_SERVICE_BLOCKED: 'в ограничениях ключа не разрешён Cloud Translation API',
    API_KEY_HTTP_REFERRER_BLOCKED: 'ключ ограничен по сайтам (HTTP referrer), для расширения это ограничение нужно снять',
    RATE_LIMIT_EXCEEDED: 'превышена квота запросов',
    rateLimitExceeded: 'превышена квота запросов',
    dailyLimitExceeded: 'превышена дневная квота',
    userRateLimitExceeded: 'превышена квота запросов'
  };
  if (known[reason]) return known[reason];
  if (status === 429) return 'превышена квота запросов';
  return e.message || 'HTTP ' + status;
}

// В service worker нет DOMParser, поэтому HTML-сущности разбираем сами
function unescapeHtml(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return named[e.toLowerCase()] ?? m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/* ---------- Автоподнятие ---------- */
let running = null, queued = null;
function tick(opts = {}) {
  if (!running) return (running = run(opts).finally(() => { running = null; }));
  // Плановая проверка уже идёт: ручную команду («Поднять сейчас») выполняем сразу после неё, а не теряем
  if (!opts.force && !opts.rediscover) return running;
  queued ||= { force: false, rediscover: false };
  queued.force ||= !!opts.force;
  queued.rediscover ||= !!opts.rediscover;
  const next = () => { const o = queued; queued = null; return tick(o); };
  return (queued.wait ||= running.then(next, next));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = async () => (await chrome.storage.local.get({ raise: null })).raise || { games: {}, discovered: 0 };
const save = (st) => chrome.storage.local.set({ raise: st });

async function run({ force = false, rediscover = false } = {}) {
  const { autoRaise } = await chrome.storage.sync.get({ autoRaise: false });
  let st = await load();
  if (!autoRaise && !force && !rediscover) return st;

  try {
    if (rediscover || !st.discovered || Date.now() - st.discovered > REDISCOVER_EVERY) {
      st = await discover(st);
      await save(st);
    }
    st.error = '';
    if (force || autoRaise) {
      for (const g of Object.values(st.games)) {
        if (!force && g.next && g.next > Date.now()) continue;
        await raiseGame(g);
        st.updated = Date.now();
        await save(st);
        await sleep(1500); // не долбим FunPay запросами подряд
      }
    }
  } catch (e) {
    st.error = String(e.message || e);
  }
  await save(st);
  return st;
}

// Находим свои категории: профиль → ссылки /lots/{node}/trade → id игры с кнопки «Поднять»
async function discover(prev) {
  const home = await getText(BASE + '/');
  const app = appData(home);
  if (!app || !app.userId) throw new Error('Вы не вошли в аккаунт FunPay');

  const profile = await getText(`${BASE}/users/${app.userId}/`);
  const nodes = [...new Set([...profile.matchAll(/\/lots\/(\d+)\/trade/g)].map((m) => m[1]))];
  const titles = {};
  for (const m of profile.matchAll(/\/lots\/(\d+)\/?"[^>]*>([^<]+)</g)) titles[m[1]] ||= decode(m[2].trim());

  const games = {};
  for (const node of nodes) {
    const html = await getText(`${BASE}/lots/${node}/trade`);
    const btn = html.match(/<[^>]*js-lot-raise[^>]*>/);
    const game = btn && attr(btn[0], 'data-game');
    if (!game) continue; // в категории нечего поднимать
    const old = prev.games?.[game] || {};
    const g = (games[game] ||= { id: game, nodes: [], names: [], next: old.next, last: old.last, msg: old.msg, ok: old.ok });
    g.nodes.push(node);
    if (titles[node]) g.names.push(titles[node]);
    g.name = g.names.join(' · ') || `Игра ${game}`;
    await sleep(400);
  }
  return { ...prev, games, discovered: Date.now() };
}

async function raiseGame(g) {
  const node = g.nodes[0];
  let res = await post('/lots/raise', new URLSearchParams({ game_id: g.id, node_id: node }));

  if (res.modal) {
    // FunPay спрашивает, какие категории игры поднять: отмечаем все
    const ids = [...String(res.modal).matchAll(/value="(\d+)"/g)].map((m) => m[1]);
    const p = new URLSearchParams({ game_id: g.id, node_id: node });
    (ids.length ? ids : g.nodes).forEach((id) => p.append('node_ids[]', id));
    res = await post('/lots/raise', p);
  }

  const msg = decode(String(res.msg || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const wait = parseWait(msg);
  g.last = Date.now();

  if (!res.error) {
    g.ok = true;
    g.msg = msg || 'Предложения подняты';
    g.next = Date.now() + (wait || AFTER_SUCCESS);
    notify(`Подняты: ${g.name}`);
  } else if (wait) {
    // Ещё рано: FunPay сказал, сколько ждать, ставим таймер точно на это время
    g.ok = 'wait';
    g.msg = msg;
    g.next = Date.now() + wait + 60e3;
  } else {
    g.ok = false;
    g.msg = msg || 'Неизвестная ошибка';
    g.next = Date.now() + RETRY_ON_ERROR;
  }
}

// «Подождите 2 часа», «Подождите 45 минут», «Подождите час.» → миллисекунды
function parseWait(msg) {
  const s = String(msg).toLowerCase();
  if (!/подожд|wait|через/.test(s)) return 0;
  const num = (re) => { const m = s.match(re); return m ? (m[1] ? +m[1] : 1) : 0; };
  const h = num(/(?:(\d+)\s*)?(?:час|hour)/);
  const m = num(/(?:(\d+)\s*)?(?:мин|minute)/);
  const sec = num(/(?:(\d+)\s*)?(?:сек|second)/);
  return (h * 3600 + m * 60 + sec) * 1000;
}

/* ---------- Запросы к FunPay ---------- */
async function getText(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (/\/account\/login/.test(r.url)) throw new Error('Вы не вошли в аккаунт FunPay');
  if (!r.ok) throw new Error(`FunPay недоступен (HTTP ${r.status})`);
  return r.text();
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01'
    },
    body
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`FunPay ответил неожиданно (HTTP ${r.status})`); }
}

function appData(html) {
  const m = html.match(/data-app-data="([^"]*)"/);
  if (!m) return null;
  try { return JSON.parse(decode(m[1])); } catch { return null; }
}
const attr = (tag, name) => (tag.match(new RegExp(name + '="([^"]*)"')) || [])[1];
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/* ---------- Уведомления ---------- */
async function notify(message) {
  const { raiseNotify } = await chrome.storage.sync.get({ raiseNotify: true });
  if (!raiseNotify) return;
  chrome.notifications.create({ type: 'basic', iconUrl: await makeIcon(), title: 'FunPay Plus', message });
}

// Иконка уведомления: рисуем PNG (уведомления Chrome не поддерживают SVG)
async function makeIcon() {
  const pal = FPP_PALETTE.compute(await chrome.storage.sync.get({ palette: FPP_PALETTE.DEF, paletteA: '', paletteB: '' }));
  const c = new OffscreenCanvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, pal.a); g.addColorStop(1, pal.a2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(0, 0, 128, 128, 28); ctx.fill();
  // Стрелка вверх
  ctx.fillStyle = pal.onG;
  ctx.beginPath();
  ctx.moveTo(64, 26); ctx.lineTo(98, 64); ctx.lineTo(76, 64); ctx.lineTo(76, 100);
  ctx.lineTo(52, 100); ctx.lineTo(52, 64); ctx.lineTo(30, 64); ctx.closePath();
  ctx.fill();
  const blob = await c.convertToBlob({ type: 'image/png' });
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}
