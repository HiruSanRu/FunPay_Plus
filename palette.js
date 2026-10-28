// Цветовая палитра темы: из двух выбранных цветов считаем все оттенки,
// которые используют content.css, popup, живые обои и иконка уведомлений.
// Подключается в content script, popup и фоновом скрипте; при загрузке DOM не трогает.
var FPP_PALETTE = (() => {
  const PRESETS = {
    violet:   { name: 'Фиалка',  a: '#8b6dff', b: '#4fc3ff' },
    ocean:    { name: 'Океан',   a: '#3d7bff', b: '#1fb5d6' },
    emerald:  { name: 'Изумруд', a: '#1fb07a', b: '#3aa6e0' },
    sunset:   { name: 'Закат',   a: '#ff5e62', b: '#ff9a3c' },
    sakura:   { name: 'Сакура',  a: '#ff5fa2', b: '#a46bff' },
    neon:     { name: 'Неон',    a: '#d43fef', b: '#14b8d4' },
    gold:     { name: 'Золото',  a: '#e3a336', b: '#ffd66b' },
    graphite: { name: 'Графит',  a: '#8c96ab', b: '#c9d1df' }
  };
  const DEF = 'violet';
  const BASE = [11, 11, 18];              // фон тёмной темы #0b0b12: к нему подмешиваем акцент для плашек
  const WHITE = [255, 255, 255], INK = [20, 18, 31];

  const parse = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const rgb = (c) => c.join(', ');
  const mix = (x, y, t) => x.map((v, i) => Math.round(v + (y[i] - v) * t));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = clamp(d / (1 - Math.abs(2 * l - 1)), 0, 1);
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  }
  const shade = (c, dl) => { const [h, s, l] = toHsl(c); return fromHsl(h, s, clamp(l + dl, 0, 1)); };

  // Контраст по WCAG
  const lum = (c) => {
    const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const contrast = (x, y) => { const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
  // Текст на заливке акцентом: белый, пока контраст не ниже 3:1 (как у исходной темы), иначе тёмный
  const ink = (c) => (contrast(WHITE, c) >= 3 ? '#fff' : hex(INK));
  // Слишком тёмный свой цвет осветляем: акцентом пишутся ссылки и рамки на тёмном фоне
  const legible = (c) => {
    const [h, s] = toHsl(c);
    for (let l = toHsl(c)[2]; contrast(c, BASE) < 3 && l < 1; l += 0.02) c = fromHsl(h, s, Math.min(1, l));
    return c;
  };

  const current = (s) => (s?.palette === 'custom' || PRESETS[s?.palette] ? s.palette : DEF);

  // Два базовых цвета: пресет или свои. Неверные свои цвета — пресет по умолчанию
  function colors(s) {
    if (s?.palette === 'custom') {
      const a = parse(s.paletteA), b = parse(s.paletteB);
      if (a && b) return { a: hex(a), b: hex(b) };
    }
    const p = PRESETS[current(s)] || PRESETS[DEF];
    return { a: p.a, b: p.b };
  }

  // Все оттенки. Коэффициенты подобраны так, чтобы фиолетовая палитра повторяла прежние цвета темы
  function compute(s) {
    const c = colors(s), a = legible(parse(c.a)), b = legible(parse(c.b));
    const deep = shade(a, -0.035), soft = mix(a, WHITE, 0.55);
    const s2 = mix(BASE, a, 0.13), s3 = mix(BASE, a, 0.22);
    return {
      a: hex(a), aRgb: rgb(a),
      aDeep: hex(deep), aDeepRgb: rgb(deep),
      a2: hex(b), a2Rgb: rgb(b),
      aMid: hex(mix(deep, b, 0.55)),
      aLight: hex(mix(a, WHITE, 0.35)),
      aSoft: hex(soft), aSoftRgb: rgb(soft),
      aDim: hex(mix(a, BASE, 0.18)),
      s1Rgb: rgb(mix(BASE, a, 0.06)),
      s2: hex(s2), s2Rgb: rgb(s2),
      s3: hex(s3), s3Rgb: rgb(s3),
      s4: hex(mix(BASE, a, 0.36)),
      onA: ink(a),
      onG: ink(mix(deep, b, 0.5))
    };
  }

  // aDeepRgb → --fpp-a-deep-rgb
  const cssName = (k) => '--fpp-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  function apply(el, s) {
    const p = compute(s);
    for (const k in p) el.style.setProperty(cssName(k), p[k]);
    return p;
  }

  // Что записать в storage при выборе образца. «Свои» без сохранённых цветов начинаются с текущих
  function choose(s, id) {
    if (id !== 'custom') return { palette: PRESETS[id] ? id : DEF };
    const { a, b } = colors(s);
    return {
      palette: 'custom',
      paletteA: parse(s?.paletteA) ? hex(parse(s.paletteA)) : a,
      paletteB: parse(s?.paletteB) ? hex(parse(s.paletteB)) : b
    };
  }

  // Случайная пара: яркий оттенок и второй, сдвинутый по кругу на 50–160°
  function random() {
    const h = Math.random() * 360;
    return [hex(fromHsl(h, 0.85, 0.64)), hex(fromHsl(h + 50 + Math.random() * 110, 0.85, 0.62))];
  }

  // Два акцентных цвета с картинки (RGBA из getImageData): самые «цветные» оттенки,
  // разнесённые по кругу хотя бы на 40°. null, если картинка почти серая
  function fromPixels(data) {
    const N = 36, bins = Array.from({ length: N }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const c = [data[i], data[i + 1], data[i + 2]], [h, s, l] = toHsl(c);
      const w = s * (1 - Math.abs(2 * l - 1)); // насыщенность без почти чёрного и почти белого
      if (w < 0.15) continue;
      const bin = bins[Math.floor(h / (360 / N)) % N];
      bin.w += w; bin.r += c[0] * w; bin.g += c[1] * w; bin.b += c[2] * w;
    }
    const total = bins.reduce((n, x) => n + x.w, 0);
    if (total < (data.length / 4) * 0.02) return null;

    // оттенок может разделиться между соседними корзинами, поэтому считаем их вместе
    const near = (i) => [bins[(i + N - 1) % N], bins[i], bins[(i + 1) % N]];
    const score = (i) => near(i).reduce((n, x, k) => n + x.w * (k === 1 ? 1 : 0.5), 0);
    const avg = (i) => {
      const g = near(i), w = g.reduce((n, x) => n + x.w, 0);
      return ['r', 'g', 'b'].map((ch) => g.reduce((n, x) => n + x[ch], 0) / w);
    };
    const dist = (i, j) => Math.min(Math.abs(i - j), N - Math.abs(i - j)) * (360 / N);
    const order = bins.map((_, i) => i).filter((i) => bins[i].w > 0).sort((i, j) => score(j) - score(i));
    const first = order[0];
    const second = order.find((i) => dist(i, first) >= 40 && score(i) >= score(first) * 0.08);

    // на тёмной теме акцент должен быть ярким: поднимаем насыщенность и выравниваем светлоту
    const accent = (c) => { const [h, s, l] = toHsl(c); return hex(fromHsl(h, Math.max(s, 0.65), clamp(l, 0.58, 0.72))); };
    const a = accent(avg(first));
    // однотонная картинка: второй цвет — соседний оттенок
    const b = second === undefined ? hex(fromHsl(toHsl(avg(first))[0] + 45, 0.8, 0.66)) : accent(avg(second));
    return { a, b };
  }

  // Разметка образцов: пресеты и «Свои». Цвета ставит radios() через CSSOM,
  // а не атрибутом style, чтобы не зависеть от CSP страницы
  function swatchesHtml() {
    const one = (id, name) =>
      `<button type="button" class="fpp-pal" role="radio" aria-checked="false" tabindex="-1" data-pal="${id}"` +
      ` title="${name}"><span class="fpp-pal-sw" aria-hidden="true"></span>` +
      `<span class="fpp-pal-name">${name}</span></button>`;
    return Object.entries(PRESETS).map(([id, p]) => one(id, p.name)).join('') + one('custom', 'Свои');
  }

  // Ряд образцов как radiogroup: клик и стрелки выбирают, Tab попадает на выбранный.
  // Возвращает функцию sync(s): отмечает текущий образец и красит «Свои» сохранёнными цветами
  function radios(list, pick) {
    const items = () => [...list.querySelectorAll('[role="radio"]')];
    const paint = (el, a, b) => { el.style.setProperty('--sw-a', a); el.style.setProperty('--sw-b', b); };
    // «Свои» без сохранённых цветов остаются радугой из CSS
    items().forEach((el) => { const p = PRESETS[el.dataset.pal]; if (p) paint(el, p.a, p.b); });
    list.addEventListener('click', (e) => {
      const el = e.target.closest('[role="radio"]');
      if (el && list.contains(el)) pick(el.dataset.pal);
    });
    list.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const all = items(), i = all.indexOf(e.target.closest('[role="radio"]'));
      const next = all[(i + step + all.length) % all.length];
      next.focus();
      pick(next.dataset.pal);
    });
    return (s) => {
      const cur = current(s);
      items().forEach((el) => {
        const on = el.dataset.pal === cur;
        el.setAttribute('aria-checked', String(on));
        el.tabIndex = on ? 0 : -1;
        if (el.dataset.pal === 'custom') {
          const a = parse(s?.paletteA), b = parse(s?.paletteB);
          if (a && b) paint(el, hex(a), hex(b));
        }
      });
    };
  }

  return { PRESETS, DEF, parse, contrast, current, colors, compute, apply, choose, random, fromPixels, swatchesHtml, radios };
})();
