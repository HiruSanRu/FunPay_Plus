(() => {
  const DEFAULTS = {
    dark: true,
    wallpaper: 'aurora',   // none | aurora | stars | particles | matrix | waves
    wallOpacity: 0.9,
    sound: 'site',         // site | off | chime | pop | bell | coin | soft | custom
    soundVolume: 0.8,
    autoRaise: false,
    raiseNotify: true,
    mascot: true,          // кошечка в левом нижнем углу
    mascotSound: false,    // персонаж не издаёт звуки
    l2dModel: 'hiyori',    // какую Live2D-модель показывать (см. L2D_MODELS)
    mascotScale: 1,        // масштаб персонажа, 0.5…2.5
    mascotSide: 'left',    // от какого края отсчитывать отступ: left | right
    mascotX: 6,            // отступ от края по горизонтали, px
    mascotY: 0,            // отступ от низа экрана, px
    blurNames: false,      // замыливать ники покупателей (для стримов и скриншотов)
    blurStrength: 5,       // сила размытия, px
    blurHover: true,       // показывать ник при наведении мыши
    translateMode: 'button', // перевод лота на английский: button — по кнопке, auto — при сохранении
    realPrices: true,      // реальная цена (без комиссии) под ценами в таблице раздела
    sectionFee: true,      // комиссия раздела рядом с заголовком на странице своих предложений
    emojiPanel: true,      // панель эмодзи в чате
    palette: 'violet',     // цветовая палитра: id из FPP_PALETTE.PRESETS или custom
    paletteA: '',          // свои цвета палитры (#rrggbb): основной и второй
    paletteB: '',
    templates: [
      'Здравствуйте! Сейчас выдам заказ 🙂',
      'Спасибо за покупку! Буду рад отзыву ⭐',
      'Подождите пару минут, пожалуйста.',
      'Заказ выполнен, проверьте и подтвердите, пожалуйста.'
    ]
  };
  let S = { ...DEFAULTS };
  const root = document.documentElement;
  let PAL = FPP_PALETTE.compute(S); // цвета текущей палитры: их читают живые обои на каждом кадре
  syncMuteFlag(); // во фрейме чата mute-site.js должен видеть флаг сразу, не дожидаясь storage

  chrome.storage.sync.get(DEFAULTS, (v) => {
    S = v;
    applyTheme();
    onReady(() => { startWallpaper(); initSellerTools(); });
  });

  chrome.storage.onChanged.addListener((c, area) => {
    // В local лежат заметки, черновик, кэш комиссии и свой звук: из них нужны только эти два ключа
    if (area === 'local') {
      if (c.raise) renderRaise();
      if (c.blacklist) { S.blacklist = c.blacklist.newValue || {}; renderBlacklist(); markBlacklisted(); }
      return;
    }
    if (area !== 'sync') return;
    for (const k in c) S[k] = c[k].newValue;
    applyTheme();
    if (c.wallpaper) startWallpaper();
    else if (c.wallOpacity) {
      // яркость меняем у готовых обоев, не пересоздавая сцену
      const w = document.getElementById('fpp-wallpaper');
      if (w) w.style.opacity = S.wallOpacity;
    }
    if (c.templates) injectTemplates(true);
    if (c.mascot) addMascot();
    if (c.l2dModel) { removeMascot(); l2dFailed = false; addMascot(); }
    if (c.mascotScale || c.mascotSide || c.mascotX || c.mascotY) applyMascotPlacement();
    if (c.blurNames || c.blurStrength || c.blurHover) applyNameBlur();
    if (c.realPrices) {
      document.querySelectorAll('.fpp-net').forEach((el) => el.remove());
      document.querySelectorAll('.fpp-net-done').forEach((el) => el.classList.remove('fpp-net-done'));
      addNetPrices();
    }
    if (c.sectionFee) { document.querySelector('.fpp-fee')?.remove(); addSectionFee(); }
    if (c.translateMode) addTranslateButton();
    if (c.emojiPanel) { document.querySelectorAll('.fpp-emoji').forEach((el) => el.remove()); addEmojiPanel(); }
    if (c.palette || c.paletteA || c.paletteB) document.getElementById('fpp-dash')?._syncPalette?.();
  });

  function onReady(fn) {
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn();
  }

  function applyTheme() {
    root.classList.toggle('fpp-dark', !!S.dark);
    root.classList.toggle('fpp-wall', S.wallpaper !== 'none');
    PAL = FPP_PALETTE.apply(root, S);
    applyNameBlur();
    syncMuteFlag();
  }

  // Замыливание ников: один класс на <html>, поэтому подгружаемые сообщения
  // и диалоги скрываются сами, без обхода DOM
  function applyNameBlur() {
    const on = !!S.blurNames;
    root.classList.toggle('fpp-blur-names', on);
    root.classList.toggle('fpp-blur-hover', on && S.blurHover !== false);
    const px = Math.min(20, Math.max(1, +S.blurStrength || 5));
    root.style.setProperty('--fpp-blur', px + 'px');
    markSelfNames();
  }

  /* ---------- Свой аккаунт ----------
     Замыливать нужно только покупателей, поэтому ник и id того, кто поставил
     расширение, берём из шапки сайта и помечаем классом fpp-me. */
  const ME = { id: '', name: '' };

  // id берём из data-app-data: FunPay кладёт его в <body> на каждой странице,
  // это надёжнее шапки, которая дорисовывается позже
  function appDataId() {
    const raw = document.body?.dataset?.appData;
    if (!raw) return '';
    try { return String(JSON.parse(raw).userId || ''); } catch (e) { return ''; }
  }

  function detectMe() {
    const id = appDataId() ||
      (document.querySelector('.user-link-dropdown, .navbar-right a[href*="/users/"]')
        ?.getAttribute('href') || '').match(/\/users\/(\d+)/)?.[1] || '';
    // ник: своя ссылка в выпадающем меню шапки, иначе .user-link-name
    const link = (id && document.querySelector(`.navbar a[href*="/users/${id}/"]`)) ||
      document.querySelector('.user-link-dropdown');
    const name = (
      document.querySelector('.user-link-name')?.textContent ||
      link?.querySelector('.media-user-name')?.textContent ||
      link?.textContent.split('\n')[0] || ''
    ).trim();
    if (id && id !== ME.id) { ME.id = id; chrome.storage.local.set({ meId: id }); }
    if (name && name !== ME.name) {
      ME.name = name;
      chrome.storage.local.set({ meName: name });
      document.getElementById('fpp-dash')?._syncMe?.();
    }
  }

  function isMe(el) {
    if (!el) return false;
    // ссылка может быть самим элементом, его родителем или лежать внутри
    const href = el.getAttribute?.('href') ||
      el.closest?.('a[href*="/users/"]')?.getAttribute('href') ||
      el.querySelector?.('a[href*="/users/"]')?.getAttribute('href') || '';
    const hid = href.match(/\/users\/(\d+)/)?.[1];
    if (ME.id && hid) return hid === ME.id;
    const t = (el.textContent || '').trim();
    return !!(ME.name && t && t.toLowerCase() === ME.name.toLowerCase());
  }

  const SELF_SEL = '.media-user-name, .chat-msg-author, .chat-msg-author-label,' +
    ' .chat-msg-author-link, .tc-user, a[href*="/users/"]';

  // CSS не умеет смотреть на текст, поэтому свои ники отмечаем из JS
  function markSelfNames() {
    if (!S.blurNames) return;
    document.querySelectorAll(SELF_SEL).forEach((el) => el.classList.toggle('fpp-me', isMe(el)));
    // свои сообщения в чате: снимаем блюр со всего блока, включая аватарку
    document.querySelectorAll('.chat-msg-item').forEach((el) => {
      const a = el.querySelector('.chat-msg-author, .chat-msg-author-label, .media-user-name');
      el.classList.toggle('fpp-me', isMe(a));
    });
  }

  /* =================== ЖИВЫЕ ОБОИ =================== */
  let raf = 0, wallAbort = null;

  // Свои обои (картинка / gif / видео) хранятся в IndexedDB на funpay.com — без лимита storage
  function wallDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('fpp-wall', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('f');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function wallFile(blob) {
    const db = await wallDb();
    return new Promise((res, rej) => {
      const tx = db.transaction('f', blob === undefined ? 'readonly' : 'readwrite'), st = tx.objectStore('f');
      const q = blob === undefined ? st.get('wall') : st.put(blob, 'wall');
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  }
  let wallUrl = '';
  // Палитра под свои обои: уменьшаем картинку (или кадр видео) и ищем в ней акцентные цвета
  async function wallColors() {
    const blob = await wallFile();
    if (!blob) throw new Error('нет файла обоев');
    const N = 64, c = new OffscreenCanvas(N, N), ctx = c.getContext('2d', { willReadFrequently: true });
    if (blob.type.startsWith('video/')) {
      const url = URL.createObjectURL(blob);
      try {
        const v = Object.assign(document.createElement('video'), { muted: true, preload: 'auto', src: url });
        const once = (ev) => new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('видео не загрузилось')), 8000);
          v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
          v.addEventListener('error', () => { clearTimeout(t); rej(v.error); }, { once: true });
        });
        await once('loadeddata');
        // первый кадр часто тёмный — берём кадр чуть дальше
        if (v.duration > 1) { v.currentTime = Math.min(2, v.duration / 3); await once('seeked'); }
        ctx.drawImage(v, 0, 0, N, N);
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      try {
        const bmp = await createImageBitmap(blob);
        ctx.drawImage(bmp, 0, 0, N, N);
        bmp.close();
      } catch (err) {
        // createImageBitmap не декодирует часть форматов (например, SVG) — пробуем через <img>
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          ctx.drawImage(img, 0, 0, N, N);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    }
    return FPP_PALETTE.fromPixels(ctx.getImageData(0, 0, N, N).data);
  }

  async function startCustomWall() {
    const blob = await wallFile().catch(() => null);
    if (!blob || S.wallpaper !== 'custom') return;
    if (wallUrl) URL.revokeObjectURL(wallUrl);
    wallUrl = URL.createObjectURL(blob);
    const isVideo = blob.type.startsWith('video/');
    const el = document.createElement(isVideo ? 'video' : 'img');
    if (isVideo) Object.assign(el, { muted: true, loop: true, autoplay: true, playsInline: true });
    el.src = wallUrl; el.alt = '';
    el.id = 'fpp-wallpaper'; el.className = 'fpp-wall-media';
    el.style.opacity = S.wallOpacity;
    document.getElementById('fpp-wallpaper')?.remove();
    document.body.prepend(el);
  }
  function startWallpaper() {
    cancelAnimationFrame(raf);
    // обработчики прошлой сцены снимаем, иначе они копятся и держат её в памяти
    wallAbort?.abort();
    wallAbort = null;
    document.getElementById('fpp-wallpaper')?.remove();
    if (wallUrl) { URL.revokeObjectURL(wallUrl); wallUrl = ''; }
    if (S.wallpaper === 'none' || window.top !== window) return; // в панели чата обои не нужны
    if (S.wallpaper === 'custom') { startCustomWall(); return; }

    const c = document.createElement('canvas');
    c.id = 'fpp-wallpaper';
    c.style.opacity = S.wallOpacity;
    document.body.prepend(c);
    const ctx = c.getContext('2d');
    const on = { signal: (wallAbort = new AbortController()).signal, passive: true };
    let W, H;
    const resize = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
    resize();
    addEventListener('resize', resize, on);

    const mouse = { x: -999, y: -999 };
    addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, on);

    addEventListener('mouseout', (e) => { if (!e.relatedTarget) mouse.x = mouse.y = -999; }, on);

    const scenes = { aurora, stars, particles, grid, matrix, waves, sakura, fireflies };
    const draw = (scenes[S.wallpaper] || aurora)();
    let t = 0;
    const loop = () => {
      // экономим ресурсы, когда вкладка скрыта
      if (!document.hidden) { t += 1; draw(t); }
      raf = requestAnimationFrame(loop);
    };
    loop();

    function sakura() {
      const P = Array.from({ length: 70 }, () => ({
        x: Math.random() * W, y: Math.random() * H, r: Math.random() * 5 + 4,
        vy: Math.random() * 0.6 + 0.4, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.04
      }));
      return (t) => {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#120a1c'); g.addColorStop(1, '#2a1030');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        P.forEach((p) => {
          p.y += p.vy; p.x += Math.sin(t / 60 + p.a) * 0.6; p.a += p.va;
          // лепестки разлетаются от курсора
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < 90) { p.x += dx / d * 2; p.y += dy / d * 2; }
          if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W; }
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
          ctx.fillStyle = 'rgba(255,170,210,.75)';
          ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r / 2, 0, 0, 7); ctx.fill();
          ctx.restore();
        });
      };
    }

    function fireflies() {
      const F = Array.from({ length: 60 }, () => ({
        x: Math.random() * W, y: Math.random() * H, a: Math.random() * 6, s: Math.random() * 0.5 + 0.2, p: Math.random() * 6
      }));
      return (t) => {
        ctx.fillStyle = '#040a0a'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        F.forEach((f) => {
          f.a += (Math.random() - 0.5) * 0.2;
          f.x = (f.x + Math.cos(f.a) * f.s + W) % W; f.y = (f.y + Math.sin(f.a) * f.s + H) % H;
          const glow = 0.4 + 0.6 * Math.abs(Math.sin(t / 50 + f.p)), r = 18 * glow;
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
          g.addColorStop(0, `rgba(200,255,120,${glow})`); g.addColorStop(1, 'transparent');
          ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
        });
        ctx.globalCompositeOperation = 'source-over';
      };
    }

    function aurora() {
      // два пятна берут цвета палитры (ключ PAL), розовое и бирюзовое остаются как в сиянии
      const blobs = [
        ['aDeep', 0.0], ['a2', 2.1], ['#ff4fd8', 4.2], ['#3dffb0', 1.3]
      ];
      return (t) => {
        ctx.fillStyle = '#07070d'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        blobs.forEach(([col, p], i) => {
          const x = W / 2 + Math.cos(t / 400 + p) * W * 0.35;
          const y = H / 2 + Math.sin(t / 520 + p * 1.3) * H * 0.35;
          const r = Math.max(W, H) * (0.35 + 0.05 * Math.sin(t / 200 + i));
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, (PAL[col] || col) + '55'); g.addColorStop(1, 'transparent');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        });
        ctx.globalCompositeOperation = 'source-over';
      };
    }

    function stars() {
      const s = Array.from({ length: 260 }, () => ({
        x: Math.random() * W, y: Math.random() * H, z: Math.random() * 1.5 + 0.3, p: Math.random() * 6
      }));
      return (t) => {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#05050c'); g.addColorStop(1, '#151030');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        s.forEach((st) => {
          st.x -= st.z * 0.15; if (st.x < 0) st.x = W;
          const a = 0.5 + 0.5 * Math.sin(t / 30 + st.p);
          ctx.fillStyle = `rgba(220,215,255,${a})`;
          ctx.beginPath(); ctx.arc(st.x, st.y, st.z, 0, 7); ctx.fill();
        });
        if (t % 240 === 0) shooting.push({ x: Math.random() * W, y: Math.random() * H / 2, l: 0 });
        shooting.forEach((m, i) => {
          m.l += 1; const len = 80;
          ctx.strokeStyle = `rgba(255,255,255,${1 - m.l / 60})`;
          ctx.beginPath(); ctx.moveTo(m.x + m.l * 8, m.y + m.l * 4);
          ctx.lineTo(m.x + m.l * 8 - len, m.y + m.l * 4 - len / 2); ctx.stroke();
          if (m.l > 60) shooting.splice(i, 1);
        });
      };
    }
    var shooting = [];

    function particles() {
      const n = Math.min(110, Math.floor(W * H / 14000));
      const ps = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5
      }));
      return () => {
        ctx.fillStyle = '#0a0a14'; ctx.fillRect(0, 0, W, H);
        ps.forEach((p) => {
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > W) p.vx *= -1;
          if (p.y < 0 || p.y > H) p.vy *= -1;
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < 120) { p.x += dx / d; p.y += dy / d; }
        });
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const a = ps[i], b = ps[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 130) {
            ctx.strokeStyle = `rgba(${PAL.aRgb},${1 - d / 130})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        ctx.fillStyle = PAL.aLight;
        ps.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); });
      };
    }

    function matrix() {
      const fs = 16, chars = 'FUNPAY01アイウエオカキクケコ$₽€';
      let cols = Math.ceil(W / fs), drops = Array(cols).fill(0).map(() => Math.random() * -50);
      return (t) => {
        if (t % 2) return;
        if (Math.ceil(W / fs) !== cols) { cols = Math.ceil(W / fs); drops = Array(cols).fill(0); }
        ctx.fillStyle = 'rgba(5,5,10,0.12)'; ctx.fillRect(0, 0, W, H);
        ctx.font = fs + 'px monospace';
        drops.forEach((y, i) => {
          ctx.fillStyle = Math.random() > .97 ? '#fff' : PAL.a;
          ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * fs, y * fs);
          drops[i] = y * fs > H && Math.random() > .975 ? 0 : y + 1;
        });
      };
    }

    // Сетка, которая прогибается и светится вокруг курсора
    function grid() {
      const gap = 44, R = 220;
      // Отталкиваем узел от курсора: чем ближе, тем сильнее
      const warp = (x, y) => {
        const dx = x - mouse.x, dy = y - mouse.y, d = Math.hypot(dx, dy);
        if (d >= R || d === 0) return [x, y, 0];
        const k = 1 - d / R, f = k * k * 28;
        return [x + (dx / d) * f, y + (dy / d) * f, k];
      };
      const line = (pts) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      };
      return (t) => {
        ctx.fillStyle = '#07070f'; ctx.fillRect(0, 0, W, H);
        const near = mouse.x > -500;
        if (near) {
          const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, R * 1.4);
          g.addColorStop(0, `rgba(${PAL.aRgb},0.18)`); g.addColorStop(1, 'transparent');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        const step = gap / 4, shift = (t * 0.25) % gap; // сетка медленно плывёт
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${PAL.aRgb},0.16)`;
        for (let y = -gap + shift; y <= H + gap; y += gap) {
          const pts = [];
          for (let x = -gap; x <= W + gap; x += step) pts.push(warp(x, y));
          line(pts);
        }
        ctx.strokeStyle = `rgba(${PAL.a2Rgb},0.12)`;
        for (let x = -gap + shift; x <= W + gap; x += gap) {
          const pts = [];
          for (let y = -gap; y <= H + gap; y += step) pts.push(warp(x, y));
          line(pts);
        }
        // Узлы рядом с курсором светятся
        if (near) {
          for (let y = -gap + shift; y <= H + gap; y += gap) {
            for (let x = -gap + shift; x <= W + gap; x += gap) {
              const [px, py, k] = warp(x, y);
              if (!k) continue;
              ctx.fillStyle = `rgba(${PAL.aSoftRgb},${k})`;
              ctx.beginPath(); ctx.arc(px, py, 1.5 + k * 2, 0, 7); ctx.fill();
            }
          }
        }
      };
    }

    function waves() {
      return (t) => {
        ctx.fillStyle = '#08080f'; ctx.fillRect(0, 0, W, H);
        const cols = [PAL.aDeep, PAL.a2, '#ff4fd8'];
        cols.forEach((col, k) => {
          ctx.beginPath();
          for (let x = 0; x <= W; x += 8) {
            const y = H * (0.55 + k * 0.1) + Math.sin(x / 180 + t / 60 + k) * 40 + Math.sin(x / 70 + t / 35) * 12;
            x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
          ctx.fillStyle = col + '30'; ctx.fill();
        });
      };
    }
  }

  /* =================== ИНСТРУМЕНТЫ ПРОДАВЦА =================== */
  function toast(msg) {
    let el = document.getElementById('fpp-toast');
    if (!el) { el = document.createElement('div'); el.id = 'fpp-toast'; document.body.append(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 1600);
  }

  function initSellerTools() {
    buildPanel();
    buildChatDock();
    initGravityEgg();
    renderSalesStats();
    injectTemplates();
    addOrderCopyButtons();
    addBuyerNotes();
    highlightUnread();
    addTranslateButton();
    addCharCounters();
    addSbpPrice();
    addOfferToggles();
    addOfferCopy();
    addMassToggle();
    hookAutoTranslate();
    addNetPrices();
    addSectionFee();
    addLotsExportImport();
    addEmojiPanel();
    addNavButton();
    addMascot();
    route();
    addEventListener('hashchange', route);
    detectMe();
    markOrderStatus();
    chrome.storage.local.get({ blacklist: {}, meName: '', meId: '' }, (v) => {
      S.blacklist = v.blacklist;
      // ник из прошлой сессии: нужен, пока шапка сайта ещё не отрисована
      if (v.meName && !ME.name) ME.name = v.meName;
      if (v.meId && !ME.id) ME.id = v.meId;
      markBlacklisted(); addBuyerNotes(); renderBlacklist(); markSelfNames();
    });
    // Пока открыта страница Plus, обновляем «следующее поднятие через …»
    setInterval(() => { if (document.getElementById('fpp-dash')) renderRaise(); }, 30000);
    // FunPay подгружает чаты динамически — следим за DOM
    new MutationObserver(debounce(() => {
      injectTemplates(); addOrderCopyButtons(); addBuyerNotes(); highlightUnread();
      addTranslateButton(); addCharCounters(); addSbpPrice(); addNavButton(); markBlacklisted();
      detectMe(); markSelfNames(); markOrderStatus(); renderSalesStats(); addOfferToggles(); addOfferCopy(); addMassToggle();
      addNetPrices(); addSectionFee(); addLotsExportImport(); addEmojiPanel();
    }, 400)).observe(document.body, { childList: true, subtree: true });
  }

  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* ---------- Свой звук уведомлений ---------- */
  let lastUnread = -1;
  function syncMuteFlag() {
    // В чате боковой панели звуки FunPay глушим всегда: уведомление играет основная вкладка
    root.dataset.fppMute = window.top !== window || (S.sound && S.sound !== 'site') ? '1' : '0';
  }
  // Непрочитанные: список диалогов есть только на /chat/, поэтому смотрим и счётчик в шапке
  function unreadCount() {
    const list = document.querySelectorAll('.contact-item.unread').length;
    let badge = 0;
    document.querySelectorAll('.menu-item-chat .badge, .badge-chat, a[href*="/chat/"] .badge').forEach((b) => {
      badge = Math.max(badge, parseInt(b.textContent, 10) || 0);
    });
    return Math.max(list, badge);
  }
  function notifySound(count) {
    // Счётчик растёт и на странице, и в чате боковой панели: звучит только основная вкладка
    if (window.top !== window) return;
    // Звук только при росте числа непрочитанных, не при первой загрузке
    const grew = lastUnread >= 0 && count > lastUnread;
    lastUnread = count;
    if (!grew || !S.sound || S.sound === 'off') return;
    if (S.sound === 'site') {
      // Звук FunPay часто блокируется браузером (автовоспроизведение) или не играет вне чата.
      // mute-site.js отмечает удачный play(); если его не было, играем запасной сигнал
      const t0 = Date.now();
      setTimeout(() => {
        if (+(root.dataset.fppSitePlayed || 0) < t0 - 1500) FPP_SOUNDS.play('chime', S.soundVolume);
      }, 1500);
      return;
    }
    {
      if (S.sound === 'custom') {
        chrome.storage.local.get({ customSound: '' }, (v) => FPP_SOUNDS.play('custom', S.soundVolume, v.customSound));
      } else {
        FPP_SOUNDS.play(S.sound, S.soundVolume);
      }
    }
  }
  // Браузер может снова «усыпить» звук, поэтому размораживаем при каждом действии
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => FPP_SOUNDS.unlock(), { capture: true, passive: true });
  // FunPay обновляет счётчик и без изменений DOM чата; проверяем ещё и по таймеру
  setInterval(() => { if (document.body) highlightUnread(); }, 3000);

  /* ---------- Автоперевод лота RU → EN ---------- */
  function translate(text) {
    return new Promise((res, rej) => chrome.runtime.sendMessage(
      { type: 'translate', text, from: 'ru', to: 'en' },
      (r) => (r?.ok ? res(r.text) : rej(new Error(r?.error || 'нет ответа')))
    ));
  }

  // Пары полей: name="fields[summary][ru]" → name="fields[summary][en]"
  function translatePairs(form) {
    return [...form.querySelectorAll('input[name$="[ru]"], textarea[name$="[ru]"]')]
      .map((ru) => [ru, form.querySelector(`[name="${CSS.escape(ru.name.replace(/\[ru\]$/, '[en]'))}"]`)])
      .filter(([ru, en]) => en && ru.value.trim());
  }

  async function fillTranslation(pairs) {
    for (const [ru, en] of pairs) {
      en.value = await translate(ru.value);
      // запоминаем, что поле заполнили мы: при следующем сохранении его можно перевести заново
      en.dataset.fppAuto = en.value;
      ru.dataset.fppSrc = ru.value;
      en.dispatchEvent(new Event('input', { bubbles: true }));
      en.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function addTranslateButton() {
    const form = document.querySelector('form.form-offer-editor');
    if (!form) return;
    const hint = form.querySelector('.fpp-translate-mode');
    if (hint) { hint.hidden = S.translateMode !== 'auto'; return; }
    const tabs = form.querySelector('.lot-fields-multilingual .nav-tabs');
    if (!tabs) return;

    const btn = Object.assign(document.createElement('button'), {
      type: 'button', className: 'fpp-btn fpp-translate', textContent: '🌐 Перевести на английский'
    });
    btn.title = 'Заполнить английские поля переводом русских';
    const mode = Object.assign(document.createElement('span'), {
      className: 'fpp-translate-mode', textContent: 'Автоперевод при сохранении включён'
    });
    mode.hidden = S.translateMode !== 'auto';
    tabs.after(btn, mode);

    btn.onclick = async () => {
      const pairs = translatePairs(form);
      if (!pairs.length) { toast('Нет заполненных русских полей'); return; }

      const filled = pairs.filter(([, en]) => en.value.trim());
      if (filled.length && !confirm('Английские поля уже заполнены. Перезаписать переводом?')) return;

      btn.disabled = true; btn.textContent = '⏳ Перевожу…';
      try {
        await fillTranslation(pairs);
        toast('Готово, проверьте перевод перед сохранением');
      } catch (e) {
        toast('Не удалось перевести: ' + e.message);
      } finally {
        btn.disabled = false; btn.textContent = '🌐 Перевести на английский';
      }
    };
  }

  /* ---------- Автоперевод при сохранении лота ---------- */
  // Перехватываем сохранение раньше обработчиков FunPay (capture на window), переводим и сохраняем заново.
  // Переводим только пустые английские поля и те, что раньше заполнили сами, а русский текст с тех пор поменялся:
  // ручной перевод не трогаем
  function hookAutoTranslate() {
    if (hookAutoTranslate.done) return;
    hookAutoTranslate.done = true;
    let pass = false;

    const intercept = (e, form, resubmit) => {
      if (pass || S.translateMode !== 'auto' || !form) return;
      const pairs = translatePairs(form).filter(([ru, en]) => !en.value.trim() ||
        (en.value === en.dataset.fppAuto && ru.value !== ru.dataset.fppSrc));
      if (!pairs.length) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (form._fppBusy) return;
      form._fppBusy = true;
      toast('🌐 Перевожу на английский…');
      fillTranslation(pairs)
        .then(() => true)
        .catch((err) => confirm(`Не удалось перевести (${err.message}). Сохранить без перевода?`))
        .then((go) => {
          form._fppBusy = false;
          if (!go) return;
          pass = true;
          try { resubmit(); } finally { pass = false; }
        });
    };

    addEventListener('click', (e) => {
      const btn = e.target.closest?.('form.form-offer-editor button[type="submit"], form.form-offer-editor .js-btn-save');
      if (btn) intercept(e, btn.closest('form'), () => btn.click());
    }, true);
    addEventListener('submit', (e) => {
      const form = e.target.closest?.('form.form-offer-editor');
      if (form) intercept(e, form, () => form.requestSubmit());
    }, true);
  }

  /* ---------- Комиссия FunPay по разделу ---------- */
  // FunPay считает цену для покупателя запросом /lots/calc. Спрашиваем цену для 1000
  // и получаем коэффициент: покупатель платит price × k, продавец получает price.
  // Берём самый дешёвый способ оплаты: по нему FunPay показывает цену в таблице раздела
  const feeCache = new Map();
  const FEE_TTL = 12 * 3600e3;

  function sectionKey(path = location.pathname) {
    const m = path.match(/^\/(lots|chips)\/(\d+)/);
    return m ? { kind: m[1], id: m[2], key: m[1] + ':' + m[2] } : null;
  }

  function sectionFee(sec) {
    if (!feeCache.has(sec.key)) feeCache.set(sec.key, (async () => {
      const store = 'fee:' + sec.key;
      const cached = (await chrome.storage.local.get({ [store]: null }))[store];
      if (cached && Date.now() - cached.t < FEE_TTL && cached.k >= 1 && cached.k < 3) return cached.k;
      const base = 1000;
      const body = new URLSearchParams({ [sec.kind === 'chips' ? 'chipId' : 'nodeId']: sec.id, price: base });
      const r = await fetch('/lots/calc', {
        method: 'POST', credentials: 'include', body,
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
      });
      const j = await r.json();
      // Способы оплаты приходят в разных валютах (₽, $, €). Цена 1000 ₽ в долларах ≈ 12,
      // поэтому оставляем только способы в валюте самой цены: коэффициент от 1 до 3
      const ratios = (j.methods || [])
        .map((m) => parseFloat(String(m.price).replace(/\s/g, '').replace(',', '.')) / base)
        .filter((r) => r >= 1 && r < 3);
      if (!ratios.length) throw new Error(j.msg || 'нет данных');
      const k = Math.min(...ratios);
      chrome.storage.local.set({ [store]: { k, t: Date.now() } });
      return k;
    })().catch((e) => { feeCache.delete(sec.key); throw e; }));
    return feeCache.get(sec.key);
  }

  const fmtMoney = (v) => v.toLocaleString('ru-RU', { maximumFractionDigits: v < 10 ? 3 : 2 });

  // Реальные цены: под ценой каждого лота — сколько получит продавец
  function addNetPrices() {
    if (!S.realPrices) return;
    const sec = sectionKey();
    if (!sec || /\/trade\/?$/.test(location.pathname)) return;
    const cells = [...document.querySelectorAll('a.tc-item .tc-price:not(.fpp-net-done)')];
    if (!cells.length) return;
    cells.forEach((c) => c.classList.add('fpp-net-done'));
    sectionFee(sec).then((k) => cells.forEach((c) => {
      const raw = c.dataset.s || c.textContent;
      const price = parseFloat(String(raw).replace(/[^\d.,]/g, '').replace(',', '.'));
      if (!(price > 0)) return;
      const unit = c.querySelector('.unit')?.textContent.trim() || '';
      const net = Object.assign(document.createElement('div'), {
        className: 'fpp-net', textContent: `≈ ${fmtMoney(price / k)} ${unit}`.trim(),
        title: `Получит продавец: без комиссии FunPay и платёжной системы (~${((k - 1) * 100).toFixed(1)}%)`
      });
      c.append(net);
    }), () => cells.forEach((c) => c.classList.remove('fpp-net-done')));
  }

  // Процент комиссии рядом с заголовком на странице своих предложений (/lots/{id}/trade)
  function addSectionFee() {
    if (!S.sectionFee || !/^\/(lots|chips)\/\d+\/trade/.test(location.pathname)) return;
    const head = document.querySelector('.page-content h1, h1.page-header, h1');
    if (!head || head.querySelector('.fpp-fee')) return;
    const badge = Object.assign(document.createElement('span'), { className: 'fpp-fee', textContent: 'комиссия…' });
    head.append(badge);
    sectionFee(sectionKey()).then((k) => {
      badge.textContent = `Комиссия ${((k - 1) * 100).toFixed(1).replace(/\.0$/, '')}%`;
      badge.title = 'Сколько FunPay и платёжная система добавляют к вашей цене (самый дешёвый способ оплаты)';
    }, (e) => { badge.textContent = 'комиссия: ?'; badge.title = 'Не удалось узнать: ' + e.message; });
  }

  /* ---------- Ровная цена для покупателей СБП ---------- */
  // Читаем цену СБП из таблицы «Цена для покупателей», которую пересчитывает FunPay
  function readSbp() {
    const table = document.querySelector('.js-calc-table');
    if (!table) return NaN;
    const row = [...table.querySelectorAll('tr, li, .row, div')]
      .find((el) => /СБП|SBP/i.test(el.textContent) && el.children.length <= 4 && /\d/.test(el.textContent));
    if (!row) return NaN;
    const nums = row.textContent.replace(/\s/g, '').match(/\d+(?:[.,]\d+)?/g);
    return nums ? parseFloat(nums[nums.length - 1].replace(',', '.')) : NaN;
  }

  // Ждём, пока FunPay пересчитает таблицу (значение СБП изменится), максимум ~2 с
  function waitSbpChange(prev) {
    return new Promise((res) => {
      let n = 0;
      const tick = () => {
        const v = readSbp();
        if ((v !== prev && !isNaN(v)) || n++ > 20) return res(v);
        setTimeout(tick, 100);
      };
      setTimeout(tick, 150);
    });
  }

  function setPrice(input, value) {
    input.value = value.toFixed(3).replace(/\.?0+$/, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  function addSbpPrice() {
    const price = document.querySelector('form.form-offer-editor input[name="price"]');
    if (!price || document.querySelector('.fpp-sbp')) return;

    const box = document.createElement('div');
    box.className = 'fpp-sbp form-group has-feedback w-200px';
    box.innerHTML = `
      <label class="control-label" for="fpp-sbp-target">Ровная цена для покупателей (СБП)</label>
      <div class="fpp-sbp-field">
        <input id="fpp-sbp-target" class="form-control" type="text" inputmode="decimal" autocomplete="off" placeholder="Например, 600">
        <span class="form-control-feedback">₽</span>
      </div>
      <div class="fpp-sbp-hint" aria-live="polite"></div>`;
    price.closest('.form-group').after(box);

    const target = box.querySelector('input'), hint = box.querySelector('.fpp-sbp-hint');
    const cur = readSbp();
    if (!isNaN(cur)) target.placeholder = `Сейчас ${cur} ₽`;
    target.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

    // Автоподбор: ждём паузу в наборе, потом подгоняем цену
    let timer, busy = false, again = false;
    target.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 700); });

    const run = async () => {
      if (busy) { again = true; return; }
      const want = parseFloat(target.value.replace(',', '.'));
      if (!(want > 0)) { hint.textContent = ''; return; }
      let p = parseFloat(price.value.replace(',', '.')), sbp = readSbp();
      if (!(p > 0) || isNaN(sbp)) { hint.textContent = 'Не нашёл цену СБП в таблице: сначала укажите любую цену'; return; }

      busy = true; hint.textContent = 'Подбираю…';
      try {
        // 1) Первое приближение по текущему соотношению; 2) доводим по факту пересчёта FunPay
        for (let i = 0; i < 8; i++) {
          const ratio = sbp / p;
          let next = Math.round((want / ratio) * 1000) / 1000;
          if (next === p) next = Math.round((p + (sbp < want ? 0.001 : -0.001)) * 1000) / 1000;
          setPrice(price, next);
          p = next;
          sbp = await waitSbpChange(sbp);
          if (Math.abs(sbp - want) < 0.005) break;
        }
        hint.textContent = Math.abs(sbp - want) < 0.005
          ? `Готово: СБП ${sbp} ₽, ваша цена ${price.value} ₽. Не забудьте сохранить.`
          : `Точно ${want} ₽ не выходит, ближайшее: СБП ${sbp} ₽ (цена ${price.value} ₽)`;
      } finally {
        busy = false;
        if (again) { again = false; run(); }
      }
    };
  }

  /* ---------- Счётчик символов в полях лота ---------- */
  function addCharCounters() {
    document.querySelectorAll('form.form-offer-editor input[name$="]"][type="text"], form.form-offer-editor textarea').forEach((el) => {
      if (el.dataset.fppCount) return;
      el.dataset.fppCount = 1;
      const c = document.createElement('div');
      c.className = 'fpp-count';
      const upd = () => {
        const max = +el.getAttribute('maxlength') || 0;
        c.textContent = max ? `${el.value.length} / ${max}` : `${el.value.length} симв.`;
        c.classList.toggle('fpp-count-warn', max && el.value.length > max * 0.9);
      };
      el.addEventListener('input', upd); upd();
      el.after(c);
    });
  }

  /* ---------- Горячие клавиши: Alt+1…9 вставляют шаблон в чат ---------- */
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return;
    const ta = e.target.closest?.('.chat-form textarea, textarea[name="content"]');
    const txt = ta && (S.templates || [])[m[1] - 1];
    if (!txt) return;
    e.preventDefault();
    ta.value = (ta.value ? ta.value + ' ' : '') + fillTplVars(txt);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* =================== КОШЕЧКА-МАСКОТ =================== */
  // Портрет по пояс в стиле Live2D: голова и зрачки следят за курсором (см. addMascot)
  const NEKO_SVG = `
    <svg class="fpp-neko-svg" viewBox="0 0 200 230" aria-hidden="true">
      <defs>
        <linearGradient id="fppNekoHair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1c1630"/><stop offset=".62" stop-color="#2d2250"/>
          <stop offset="1" stop-color="#ff7fbf"/>
        </linearGradient>
        <linearGradient id="fppNekoTail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#ff8cc6"/><stop offset=".7" stop-color="#ffc2e0"/>
          <stop offset="1" stop-color="#fff"/>
        </linearGradient>
        <linearGradient id="fppNekoHoodie" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3a2d6e"/><stop offset="1" stop-color="#241c45"/>
        </linearGradient>
        <radialGradient id="fppNekoIris" cx=".5" cy=".35" r=".7">
          <stop offset="0" stop-color="#bfe8ff"/><stop offset=".55" stop-color="#5aa8ff"/>
          <stop offset="1" stop-color="#3346c8"/>
        </radialGradient>
      </defs>

      <!-- Хвост -->
      <g class="fpp-neko-tailw"><g class="fpp-neko-tail">
        <path d="M128 208 C 176 202, 202 166, 190 126 C 184 104, 164 98, 158 114
                 C 172 134, 166 172, 122 188 Z" fill="url(#fppNekoTail)"/>
        <path d="M190 126 C 184 104, 164 98, 158 114 C 168 118, 180 120, 190 126 Z" fill="#fff"/>
      </g></g>

      <!-- Волосы сзади -->
      <g class="fpp-neko-hairw"><g class="fpp-neko-hairback">
        <path d="M54 82 C 40 140, 44 196, 58 228 L 142 228 C 156 196, 160 140, 146 82 Z" fill="url(#fppNekoHair)"/>
      </g></g>

      <!-- Тело в худи -->
      <g class="fpp-neko-body">
        <path d="M90 146 h20 v26 h-20 z" fill="#f7dfe4"/>
        <path d="M42 230 C 42 192, 64 168, 100 168 C 136 168, 158 192, 158 230 Z" fill="url(#fppNekoHoodie)"/>
        <path d="M66 172 C 80 188, 120 188, 134 172 C 122 180, 78 180, 66 172 Z" fill="#4a3a8a"/>
        <g stroke="#ff8cc6" stroke-width="2.4" stroke-linecap="round">
          <path d="M89 181 L 86 206"/><path d="M111 181 L 114 206"/>
        </g>
        <circle cx="86" cy="208" r="3" fill="#ff8cc6"/><circle cx="114" cy="208" r="3" fill="#ff8cc6"/>
        <g fill="#ff8cc6" opacity=".85">
          <ellipse cx="100" cy="219" rx="6" ry="5"/>
          <circle cx="92" cy="211" r="2.3"/><circle cx="97" cy="208" r="2.3"/>
          <circle cx="103" cy="208" r="2.3"/><circle cx="108" cy="211" r="2.3"/>
        </g>
      </g>

      <!-- Голова: внешняя группа поворачивается за курсором, внутренняя слегка покачивается сама -->
      <g class="fpp-neko-look">
        <g class="fpp-neko-head">
          <g class="fpp-neko-ear-l">
            <path d="M52 72 L46 16 L90 50 Z" fill="#1c1630"/>
            <path d="M58 64 L56 30 L82 52 Z" fill="#fff"/>
            <path d="M60 58 L59 38 L74 51 Z" fill="#ffd3e8"/>
          </g>
          <g class="fpp-neko-ear-r">
            <path d="M148 72 L154 16 L110 50 Z" fill="#1c1630"/>
            <path d="M142 64 L144 30 L118 52 Z" fill="#fff"/>
            <path d="M140 58 L141 38 L126 51 Z" fill="#ffd3e8"/>
          </g>

          <ellipse cx="100" cy="102" rx="44" ry="46" fill="#ffeef0"/>

          <path d="M56 82 C 46 122, 50 152, 62 172 C 66 152, 64 122, 72 96 Z" fill="url(#fppNekoHair)"/>
          <path d="M144 82 C 154 122, 150 152, 138 172 C 134 152, 136 122, 128 96 Z" fill="url(#fppNekoHair)"/>

          <g class="fpp-neko-eyes">
            <ellipse cx="80" cy="108" rx="11" ry="13" fill="#1b1636"/>
            <ellipse cx="120" cy="108" rx="11" ry="13" fill="#1b1636"/>
            <g class="fpp-neko-pupil">
              <ellipse cx="80" cy="110" rx="8.5" ry="10.5" fill="url(#fppNekoIris)"/>
              <ellipse cx="80" cy="112" rx="3.6" ry="5" fill="#1b1f6e"/>
              <circle cx="76.5" cy="104.5" r="3.4" fill="#fff"/><circle cx="83.5" cy="115" r="1.5" fill="#fff"/>
            </g>
            <g class="fpp-neko-pupil">
              <ellipse cx="120" cy="110" rx="8.5" ry="10.5" fill="url(#fppNekoIris)"/>
              <ellipse cx="120" cy="112" rx="3.6" ry="5" fill="#1b1f6e"/>
              <circle cx="116.5" cy="104.5" r="3.4" fill="#fff"/><circle cx="123.5" cy="115" r="1.5" fill="#fff"/>
            </g>
            <path d="M68 97 Q80 92 92 97" stroke="#1b1636" stroke-width="2.4" fill="none" stroke-linecap="round"/>
            <path d="M108 97 Q120 92 132 97" stroke="#1b1636" stroke-width="2.4" fill="none" stroke-linecap="round"/>
          </g>
          <g class="fpp-neko-happy" stroke="#1b1636" stroke-width="3" fill="none" stroke-linecap="round">
            <path d="M70 110 Q80 99 90 110"/><path d="M110 110 Q120 99 130 110"/>
          </g>

          <ellipse cx="68" cy="126" rx="7" ry="3.4" fill="#ff8fb8" opacity=".55"/>
          <ellipse cx="132" cy="126" rx="7" ry="3.4" fill="#ff8fb8" opacity=".55"/>
          <path class="fpp-neko-mouth" d="M94 128 Q97 132 100 128 Q103 132 106 128" stroke="#7a3a4a"
            stroke-width="1.8" fill="none" stroke-linecap="round"/>
          <g class="fpp-neko-open">
            <path d="M94.5 127.5 Q100 139 105.5 127.5 Z" fill="#d9536f"/>
            <path d="M101.5 127.8 l1.6 3.4 l1.6 -3.4 z" fill="#fff"/>
          </g>

          <g class="fpp-neko-bangs">
          <path d="M54 94 C 50 50, 80 38, 100 40 C 120 38, 150 50, 146 94 C 140 80, 132 72, 124 68
                   C 122 82, 112 86, 106 72 C 102 84, 92 86, 88 70 C 80 76, 66 82, 54 94 Z" fill="url(#fppNekoHair)"/>
          <path d="M122 70 C 128 78, 136 86, 142 96 C 135 89, 129 83, 123 78 Z" fill="#ff7fbf"/>
          <path d="M68 78 C 64 84, 60 90, 58 96 C 62 92, 66 88, 71 84 Z" fill="#ff7fbf"/>
          <g transform="rotate(-20 72 62)" stroke="#ff8cc6" stroke-width="3" stroke-linecap="round">
            <path d="M66 62 h12"/><path d="M68 57 v10"/><path d="M76 57 v10"/>
          </g>
          </g>
        </g>
      </g>
    </svg>`;

  const NEKO_PHRASES = [
    'Ня!', 'Ня-я-я~ ♡', 'Мяу! Продажи будут!', 'Мур-мур~', 'Ты лучший продавец ♡',
    'Не забудь поднять лоты, ня!', 'Погладь ещё~', 'Нья~ отзывы только 5★', 'Мяу? (≧◡≦)'
  ];
  const L2D_PHRASES = [
    'Привет ♡', 'Продажи будут!', 'Ты лучший продавец ♡', 'Не забудь поднять лоты!',
    'Только 5★ отзывы~', 'Удачного дня!', 'Я слежу за чатами ♡'
  ];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // Официальные сэмплы Live2D (Free Material License). crop: какую долю высоты модели показывать
  const L2D_MODELS = {
    hiyori: { name: 'Хиёри', file: 'Hiyori', crop: 0.53 },
    haru:   { name: 'Хару (с голосом)', file: 'Haru', crop: 0.53 },
    mao:    { name: 'Мао', file: 'Mao', crop: 0.6 },
    natori: { name: 'Натори', file: 'Natori', crop: 0.55 },
    ren:    { name: 'Рен', file: 'Ren', crop: 0.58 },
    rice:   { name: 'Райс', file: 'Rice', crop: 0.65 },
    mark:   { name: 'Марк', file: 'Mark', crop: 0.65 },
    wanko:  { name: 'Ванко (собачка)', file: 'Wanko', crop: 1 },
    // Huohua (火花) — сторонняя модель из «для расширения», имена файлов переведены в ASCII
    huohua: { name: 'Хуохуа', file: 'Huohua', crop: 0.55 }
  };

  // Озвучка каждого персонажа: загружаем voice.json при смене модели (у Хуохуа его нет).
  // Список прошлой модели сразу сбрасываем, а ответ для уже сменённой модели не применяем
  let voiceIndex = {}, voiceModel = '', voiceAudio = null;
  async function loadVoices(modelName) {
    voiceIndex = {}; voiceModel = modelName;
    try {
      const url = chrome.runtime.getURL(`live2d/${modelName.toLowerCase()}/voice/voice.json`);
      const v = await fetch(url).then(r => r.json());
      if (voiceModel === modelName) voiceIndex = v;
    } catch (e) {}
  }

  // Озвученная фраза из voice.json; false, если такой нет. Новая фраза обрывает предыдущую,
  // чтобы голоса не накладывались и конец старой не закрыл рот посреди новой
  function playVoice(modelName, key, onEnd) {
    const file = voiceIndex[key];
    if (!file) return false;
    voiceAudio?.pause();
    const audio = voiceAudio = new Audio(chrome.runtime.getURL(`live2d/${modelName.toLowerCase()}/voice/${file}`));
    audio.volume = Math.min(1, S.soundVolume);
    const end = () => { if (voiceAudio === audio) { voiceAudio = null; onEnd(); } };
    audio.onended = audio.onerror = end;
    // до первого клика по странице браузер может не дать играть звук: тогда сразу закрываем рот
    audio.play().catch(end);
    return true;
  }

  /* --- Масштаб и положение персонажа --- */
  const MASCOT_SCALE = { min: 0.5, max: 2.5 };
  const mascotScale = () =>
    Math.min(MASCOT_SCALE.max, Math.max(MASCOT_SCALE.min, +S.mascotScale || 1));

  // Персонаж не должен уезжать за экран: оставляем видимой полоску в 48 px
  function clampMascot(el, x, y) {
    const r = el.getBoundingClientRect();
    const w = r.width || 170, h = r.height || 240;
    return {
      x: Math.round(Math.max(48 - w, Math.min(innerWidth - 48, x))),
      y: Math.round(Math.max(48 - h, Math.min(innerHeight - 48, y)))
    };
  }

  function applyMascotPlacement(el) {
    el = el || document.getElementById('fpp-neko');
    if (!el) return;
    el.classList.toggle('fpp-neko-right', S.mascotSide === 'right');
    el.style.setProperty('--fpp-neko-scale', mascotScale());
    el._fitRes?.();
    // позицию приводим к границам экрана уже с новым масштабом
    const p = clampMascot(el, Math.round(+S.mascotX || 0), Math.round(+S.mascotY || 0));
    el.style.setProperty('--fpp-neko-x', p.x + 'px');
    el.style.setProperty('--fpp-neko-y', p.y + 'px');
  }

  // Перетаскивание мышью: персонаж остаётся там, где его отпустили
  function initMascotDrag(el) {
    const btn = el.querySelector('.fpp-neko-btn');
    let id = null, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || id !== null) return;
      id = e.pointerId;
      sx = e.clientX; sy = e.clientY; moved = false;
      ox = Math.round(+S.mascotX || 0); oy = Math.round(+S.mascotY || 0);
      try { btn.setPointerCapture(id); } catch (err) {}
    });

    btn.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      // короткое дрожание руки при клике перетаскиванием не считаем
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      el.classList.add('fpp-neko-drag');
      // справа отступ растёт в обратную сторону, снизу — вверх
      const p = clampMascot(el, ox + (S.mascotSide === 'right' ? -dx : dx), oy - dy);
      S.mascotX = p.x; S.mascotY = p.y;
      applyMascotPlacement(el);
    });

    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      el.classList.remove('fpp-neko-drag');
      if (!moved) return;
      chrome.storage.sync.set({ mascotX: S.mascotX, mascotY: S.mascotY });
      document.getElementById('fpp-dash')?._syncPlacement?.();
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);

    // Колёсико над персонажем меняет масштаб
    const saveScale = debounce(() => {
      chrome.storage.sync.set({ mascotScale: S.mascotScale });
      document.getElementById('fpp-dash')?._syncPlacement?.();
    }, 300);
    btn.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.1 : -0.1;
      const next = Math.round((mascotScale() + step) * 10) / 10;
      S.mascotScale = Math.min(MASCOT_SCALE.max, Math.max(MASCOT_SCALE.min, next));
      applyMascotPlacement(el);
      saveScale();
    }, { passive: false });

    // после перетаскивания персонажа не гладим
    btn.addEventListener('click', (e) => {
      if (!moved) return;
      moved = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  }

  addEventListener('resize', debounce(() => applyMascotPlacement(), 200), { passive: true });

  function removeMascot() {
    const el = document.getElementById('fpp-neko');
    if (!el) return;
    el._abort?.abort();
    try { el._app?.destroy(true, { children: true }); } catch (e) {}
    el.remove();
  }

  // Настоящая Live2D-модель. Если библиотек нет или модель не загрузилась, остаётся SVG-кошечка
  let l2dFailed = false;
  function initLive2D(el) {
    const PIXI = globalThis.PIXI;
    if (l2dFailed || !PIXI?.live2d?.Live2DModel || !globalThis.Live2DCubismCore) return false;
    const btn = el.querySelector('.fpp-neko-btn'), bubble = el.querySelector('.fpp-neko-bubble');
    el.classList.add('fpp-l2d');
    btn.innerHTML = '';
    const W = 280, H = 380;
    // CSS-масштаб растягивает готовую картинку, поэтому внутреннее разрешение холста
    // подгоняем под итоговый размер на экране (не больше 4×, чтобы не грузить видеокарту)
    const res = () => Math.min(4, (devicePixelRatio || 1) * mascotScale());
    const app = new PIXI.Application({ width: W, height: H, backgroundAlpha: 0, antialias: true,
      resolution: res(), autoDensity: true });
    btn.append(app.view);
    el._app = app;
    el._fitRes = () => {
      const r = res();
      if (app.renderer.resolution === r) return;
      app.renderer.resolution = r;
      app.renderer.resize(W, H);
    };
    const abort = el._abort = new AbortController();
    const cfg = L2D_MODELS[S.l2dModel] || L2D_MODELS.hiyori;
    let model, bubbleT, voiced = false, mouth = 0, talking = 0;
    const say = (text, ms = 2200) => {
      bubble.textContent = text; bubble.classList.add('show');
      clearTimeout(bubbleT); bubbleT = setTimeout(() => bubble.classList.remove('show'), ms);
    };
    // озвучку грузим параллельно с моделью: приветствие звучит через 1,5 с, модель может грузиться дольше
    loadVoices(cfg.file);
    const url = chrome.runtime.getURL(`live2d/${cfg.file.toLowerCase()}/${cfg.file}.model3.json`);
    PIXI.live2d.Live2DModel.from(url, { autoInteract: false })
      .then((m) => {
        if (!el.isConnected) return m.destroy();
        model = m;
        // Голос есть только там, где движения ссылаются на звуковые файлы (у официальных сэмплов это Хару)
        const mot = m.internalModel.settings.motions || {};
        voiced = Object.values(mot).some((g) => g.some((x) => x.Sound));
        const k = Math.min(W / m.width, H / (m.height * cfg.crop));
        m.scale.set(k);
        m.x = (W - m.width) / 2; m.y = cfg.crop < 1 ? 4 : H - m.height;
        app.stage.addChild(m);
        // Губы двигаются, пока персонаж говорит
        m.internalModel.on('beforeModelUpdate', () => {
          if (mouth <= 0) return;
          mouth = Math.max(0, mouth - 0.06);
          try { m.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', Math.min(1, mouth)); } catch (e) {}
        });
      })
      .catch((e) => { console.warn('[FunPay Plus] Live2D:', e); l2dFailed = true; removeMascot(); addMascot(); });

    // Слежение за курсором по всей странице
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      addEventListener('mousemove', (e) => {
        if (!model) return;
        const r = app.view.getBoundingClientRect(); // focus() ждёт координаты сцены, а не окна
        model.focus(e.clientX - r.left, e.clientY - r.top);
      }, { passive: true, signal: abort.signal });
    }
    // Озвучка из voice.json: губы двигаются, пока играет файл
    const talk = (key) => {
      clearInterval(talking);
      if (!S.mascotSound || !playVoice(cfg.file, key, () => { clearInterval(talking); mouth = 0; })) return false;
      talking = setInterval(() => { mouth = Math.max(mouth, 0.3 + Math.random() * 0.7); }, 140);
      return true;
    };
    // персонажа убрали или сменили: голос обрываем вместе с ним
    abort.signal.addEventListener('abort', () => { clearInterval(talking); voiceAudio?.pause(); voiceAudio = null; });

    btn.addEventListener('click', () => {
      if (!model) return;
      const unread = unreadCount();
      // Ищем озвученную фразу в voice.json
      let key;
      if (unread && Math.random() < 0.5) {
        key = unread <= 20 ? `u${unread}` : 'many';
      } else {
        key = pick(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
      }
      // Японские фразы из движений (у Хару) глушим, если есть своя озвучка: голоса не накладываются
      PIXI.live2d.SoundManager.volume = S.mascotSound && !voiceIndex[key] ? S.soundVolume : 0;
      const mot = model.internalModel.settings.motions || {};
      model.motion(mot.TapBody ? 'TapBody' : 'Idle', undefined, PIXI.live2d.MotionPriority.FORCE);
      const exps = model.internalModel.settings.expressions;
      if (exps?.length) model.expression(Math.floor(Math.random() * exps.length));
      const text = { 'p1': 'Привет ♡', 'p2': 'Продажи будут!', 'p3': 'Ты лучший продавец ♡', 'p4': 'Не забудь поднять лоты!',
                     'p5': 'Только 5★ отзывы~', 'p6': 'Удачного дня!', 'p7': 'Я слежу за чатами ♡', 'many': 'У тебя много непрочитанных ♡' }[key] ||
            (unread ? `У тебя ${unread} непрочитанных ♡` : pick(L2D_PHRASES));
      say(text, 4000);
      if (S.mascotSound && !talk(key) && !voiced) FPP_SOUNDS.play('pop', S.soundVolume * 0.7);
    });
    try {
      if (!sessionStorage.getItem('fppNekoHi')) {
        sessionStorage.setItem('fppNekoHi', '1');
        // персонажа могли убрать или сменить за эти полторы секунды: тогда молчим
        setTimeout(() => { if (!el.isConnected) return; say('Привет! Нажми на меня ♡', 3000); talk('hi'); }, 1500);
      }
    } catch (e) {}
    return true;
  }

  function addMascot() {
    if (window.top !== window) return;
    let el = document.getElementById('fpp-neko');
    if (!S.mascot) { removeMascot(); return; }
    if (el || !document.body) return;

    el = document.createElement('div');
    el.id = 'fpp-neko';
    el.innerHTML = `
      <div class="fpp-neko-bubble" aria-live="polite"></div>
      <button type="button" class="fpp-neko-btn" aria-label="Кошечка FunPay Plus, погладить">${NEKO_SVG}</button>`;
    document.body.append(el);
    applyMascotPlacement(el);
    initMascotDrag(el);
    if (initLive2D(el)) return;

    const btn = el.querySelector('.fpp-neko-btn'), bubble = el.querySelector('.fpp-neko-bubble');
    let clicks = 0, clickT, stateT, bubbleT;

    // Голова и зрачки следят за курсором, как у Live2D-моделей
    // Слои смещаются на разную глубину (параллакс), волосы догоняют голову с инерцией
    const q = (s) => el.querySelector(s);
    const look = q('.fpp-neko-look'), pupils = el.querySelectorAll('.fpp-neko-pupil');
    const bangs = q('.fpp-neko-bangs'), hairBack = q('.fpp-neko-hairw'), tail = q('.fpp-neko-tailw');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let tx = 0, ty = 0, x = 0, y = 0, hx = 0, hv = 0, idle = 0;
      addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 500));
        ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.4)) / 400));
        idle = 0;
      }, { passive: true });
      const f = (n) => n.toFixed(2);
      const tick = (t) => {
        if (!el.isConnected) return;
        // без курсора больше 4 с: лёгкий взгляд по сторонам
        if (++idle > 240) { tx = Math.sin(t / 2100) * 0.5; ty = Math.sin(t / 3300) * 0.25; }
        x += (tx - x) * 0.08; y += (ty - y) * 0.08;
        // пружина для волос: отстают от головы и чуть раскачиваются
        hv = (hv + (x - hx) * 0.06) * 0.88; hx += hv;
        const lag = x - hx;
        look.setAttribute('transform', `rotate(${f(x * 6)} 100 150) translate(${f(x * 4)} ${f(y * 3)})`);
        bangs.setAttribute('transform', `translate(${f(x * 2.5)} ${f(y * 1.5)}) rotate(${f(-lag * 8)} 100 50)`);
        hairBack.setAttribute('transform', `translate(${f(-x * 2)} ${f(-y)}) rotate(${f(-lag * 10)} 100 84)`);
        tail.setAttribute('transform', `rotate(${f(-x * 8)} 128 205)`);
        pupils.forEach((p) => p.setAttribute('transform', `translate(${f(x * 4)} ${f(y * 3.5)})`));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    const say = (text, ms = 2200) => {
      bubble.textContent = text;
      bubble.classList.add('show');
      clearTimeout(bubbleT);
      bubbleT = setTimeout(() => bubble.classList.remove('show'), ms);
    };

    const hearts = (n) => {
      for (let i = 0; i < n; i++) {
        const h = document.createElement('span');
        h.className = 'fpp-neko-heart';
        h.textContent = pick(['♥', '♡', '✦']);
        h.style.left = 30 + Math.random() * 50 + '%';
        h.style.setProperty('--dx', (Math.random() * 60 - 30).toFixed(0) + 'px');
        h.style.animationDelay = i * 90 + 'ms';
        h.addEventListener('animationend', () => h.remove());
        el.append(h);
      }
    };

    btn.addEventListener('click', () => {
      // 5 быстрых кликов подряд: кошечка кружится и мурчит
      clicks++;
      clearTimeout(clickT);
      clickT = setTimeout(() => { clicks = 0; }, 1200);
      const spin = clicks >= 5;
      if (spin) clicks = 0;

      el.classList.remove('fpp-neko-click', 'fpp-neko-spin');
      void el.offsetWidth; // перезапуск анимации
      el.classList.add(spin ? 'fpp-neko-spin' : 'fpp-neko-click');
      clearTimeout(stateT);
      stateT = setTimeout(() => el.classList.remove('fpp-neko-click', 'fpp-neko-spin'), spin ? 1200 : 900);

      const unread = document.querySelectorAll('.contact-item.unread').length;
      say(spin ? 'Голова кружится~ @_@' : unread && Math.random() < 0.5
        ? `Ня! У тебя ${unread} непрочитанных ♡` : pick(NEKO_PHRASES));
      if (S.mascotSound) FPP_SOUNDS.nya(spin ? 'purr' : pick(['nya', 'nya', 'nyaa', 'mew']), S.soundVolume);
      hearts(spin ? 7 : 3);
    });

    // Приветствие при первом появлении за сессию
    try {
      if (!sessionStorage.getItem('fppNekoHi')) {
        sessionStorage.setItem('fppNekoHi', '1');
        setTimeout(() => say('Привет! Нажми на меня ♡', 3000), 1500);
      }
    } catch (e) {}
  }

  /* =================== СТРАНИЦА РАСШИРЕНИЯ (#funpay-plus) =================== */
  const DASH_HASH = '#funpay-plus';
  const WALLPAPERS = [
    ['aurora', 'Северное сияние'], ['stars', 'Звёздное небо'], ['particles', 'Частицы'],
    ['grid', 'Сетка (реагирует на мышь)'], ['matrix', 'Матрица'], ['waves', 'Неоновые волны'],
    ['sakura', 'Сакура'], ['fireflies', 'Светлячки'], ['custom', 'Свои обои…'], ['none', 'Выключены']
  ];
  const SOUND_OPTS = [
    ['site', 'Стандартный FunPay'], ['off', 'Без звука'], ['chime', 'Перезвон'], ['pop', 'Поп'],
    ['bell', 'Колокольчик'], ['coin', 'Монетка'], ['soft', 'Мягкий аккорд'], ['custom', 'Свой файл…']
  ];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opts = (list) => list.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  let baseTitle = '';

  // Кнопка «✦ Plus» в шапке, слева от «Покупки»
  function addNavButton() {
    const ul = document.querySelector('.navbar-nav.navbar-right');
    if (!ul || ul.querySelector('.fpp-nav')) return;
    const li = document.createElement('li');
    li.className = 'fpp-nav';
    li.innerHTML = `<a href="${DASH_HASH}" title="Страница FunPay Plus"><span class="fpp-nav-txt">✦ Plus</span></a>`;
    ul.prepend(li);
    syncNavActive();
  }
  const syncNavActive = () => document.querySelector('.fpp-nav')?.classList.toggle('active', location.hash === DASH_HASH);

  // Показываем страницу расширения вместо содержимого сайта (шапка и подвал остаются)
  function route() {
    syncNavActive();
    const content = document.getElementById('content');
    if (!content) return;
    let dash = document.getElementById('fpp-dash');
    if (location.hash === DASH_HASH) {
      if (!dash) {
        baseTitle = document.title;
        dash = buildDashboard();
        content.before(dash);
      }
      content.style.display = 'none';
      document.title = 'FunPay Plus';
      scrollTo(0, 0);
    } else if (dash) {
      dash.remove();
      content.style.display = '';
      document.title = baseTitle;
    }
  }

  // Golden key: показываем замаскированным, полный ключ только копируем
  function bindGoldenKey(d) {
    const val = d.querySelector('#fd-gk'), btn = d.querySelector('#fd-gkCopy');
    let key = '', t;
    const mask = (k) => k.length > 8 ? k.slice(0, 4) + '******' + k.slice(-4) : '******';
    chrome.runtime.sendMessage({ type: 'goldenKey' }, (r) => {
      key = (!chrome.runtime.lastError && r?.ok && r.key) || '';
      val.textContent = key ? mask(key) : 'Не найден — войди в аккаунт';
      val.classList.toggle('fpp-gk-empty', !key);
      btn.disabled = !key;
    });
    btn.addEventListener('click', async () => {
      if (!key) return;
      try { await navigator.clipboard.writeText(key); btn.textContent = 'Скопировано ✓'; }
      catch (e) { btn.textContent = 'Ошибка'; }
      clearTimeout(t);
      t = setTimeout(() => { btn.textContent = 'Копировать'; }, 1500);
    });
  }

  // Переключение вкладок боковой/верхней навигации страницы расширения
  function bindDashTabs(d) {
    const tabs = [...d.querySelectorAll('.fpp-tab')];
    const panels = [...d.querySelectorAll('.fpp-panel')];
    const show = (name) => {
      tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
      });
      panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
      try { localStorage.setItem('fpp-dash-tab', name); } catch (e) {}
    };
    tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
    let saved = 'main';
    try { saved = localStorage.getItem('fpp-dash-tab') || 'main'; } catch (e) {}
    if (tabs.some((t) => t.dataset.tab === saved)) show(saved);
  }

  function buildDashboard() {
    const d = document.createElement('div');
    d.id = 'fpp-dash';
    d.className = 'container';
    d.innerHTML = `
      <div class="fpp-dash-head">
        <h1>✦ FunPay Plus</h1>
        <p>Настройки расширения и инструменты продавца. Всё сохраняется автоматически.</p>
      </div>
      <div class="fpp-dash-body">
        <nav class="fpp-tabs" role="tablist" aria-label="Разделы настроек">
          <button type="button" class="fpp-tab active" data-tab="main" role="tab" aria-selected="true">
            <span class="fpp-ico">🏠</span>Главная страница</button>
          <button type="button" class="fpp-tab" data-tab="custom" role="tab" aria-selected="false">
            <span class="fpp-ico">🎨</span>Кастомизация</button>
          <button type="button" class="fpp-tab" data-tab="mods" role="tab" aria-selected="false">
            <span class="fpp-ico">🧩</span>Модификации</button>
        </nav>

        <div class="fpp-panels">
          <div class="fpp-grid fpp-panel" data-panel="main" role="tabpanel">
            <section class="fpp-card fpp-gk-card">
              <h2><span class="fpp-ico">🔑</span>Golden key</h2>
              <p class="fpp-muted">Ключ входа в аккаунт. Никому не передавай — с ним можно зайти без пароля.</p>
              <div class="fpp-gk-row">
                <code id="fd-gk" class="fpp-gk-val">Загрузка…</code>
                <button type="button" class="fpp-btn fpp-primary" id="fd-gkCopy" disabled aria-label="Скопировать golden key">Копировать</button>
              </div>
            </section>

            <section class="fpp-card fpp-raise-card">
              <div class="fpp-card-head">
                <h2><span class="fpp-ico">🚀</span>Автоподнятие лотов</h2>
                <label class="fpp-switch" title="Включить автоподнятие">
                  <input type="checkbox" id="fd-autoRaise" aria-label="Автоподнятие лотов"><span></span>
                </label>
              </div>
              <p class="fpp-muted fpp-raise-hint">Поднимает лоты, как только FunPay разрешит. Работает, пока открыт браузер.</p>
              <div id="fd-raise-list" class="fpp-raise-list"></div>
              <div class="fpp-actions">
                <button type="button" class="fpp-btn fpp-primary" id="fd-raiseNow">Поднять сейчас</button>
                <button type="button" class="fpp-btn" id="fd-raiseRefresh">Обновить список лотов</button>
                <label class="fpp-check"><input type="checkbox" id="fd-raiseNotify"> Уведомлять о поднятии</label>
              </div>
            </section>

            <section class="fpp-card">
              <h2><span class="fpp-ico">💾</span>Резервная копия</h2>
              <p class="fpp-muted">Настройки, шаблоны, заметки и чёрный список в одном файле.</p>
              <div class="fpp-actions">
                <button type="button" class="fpp-btn" id="fd-export">Скачать</button>
                <button type="button" class="fpp-btn" id="fd-import">Загрузить</button>
                <input type="file" id="fd-importFile" accept="application/json,.json" hidden>
              </div>
            </section>
          </div>

          <div class="fpp-grid fpp-panel" data-panel="custom" role="tabpanel" hidden>
            <section class="fpp-card">
              <h2><span class="fpp-ico">🎨</span>Тема и обои</h2>
              <label class="fpp-check"><input type="checkbox" id="fd-dark"> Тёмная тема</label>
              <label for="fd-wallpaper">Живые обои</label>
              <select id="fd-wallpaper">${opts(WALLPAPERS)}</select>
              <label for="fd-wallFile">Свои обои: картинка, GIF или видео</label>
              <input type="file" id="fd-wallFile" accept="image/*,video/*">
              <div id="fd-wallHint" class="fpp-sbp-hint" aria-live="polite"></div>
              <label for="fd-wallOpacity">Яркость обоев</label>
              <input type="range" id="fd-wallOpacity" min="0.2" max="1" step="0.05">
            </section>

            <section class="fpp-card">
              <h2><span class="fpp-ico">🌈</span>Цветовая палитра</h2>
              <p class="fpp-muted">Цвет кнопок, ссылок, подсветки, живых обоев и иконки уведомлений.</p>
              <div class="fpp-pals" id="fd-palList" role="radiogroup" aria-label="Цветовая палитра">${FPP_PALETTE.swatchesHtml()}</div>
              <div class="fpp-two">
                <div>
                  <label for="fd-paletteA">Основной цвет</label>
                  <input type="color" id="fd-paletteA">
                </div>
                <div>
                  <label for="fd-paletteB">Второй цвет</label>
                  <input type="color" id="fd-paletteB">
                </div>
              </div>
              <div class="fpp-actions">
                <button type="button" class="fpp-btn" id="fd-palRandom">🎲 Случайная</button>
                <button type="button" class="fpp-btn" id="fd-palWall">🖼 Под свои обои</button>
              </div>
              <div id="fd-palHint" class="fpp-sbp-hint" aria-live="polite"></div>
            </section>

            <section class="fpp-card">
              <h2><span class="fpp-ico">🐾</span>Персонаж</h2>
              <div class="fpp-checks">
                <label class="fpp-check"><input type="checkbox" id="fd-mascot"> Показывать</label>
                <label class="fpp-check"><input type="checkbox" id="fd-mascotSound"> Звуки</label>
              </div>
              <div class="fpp-two">
                <div>
                  <label for="fd-l2dModel">Модель</label>
                  <select id="fd-l2dModel">${opts(Object.entries(L2D_MODELS).map(([k, m]) => [k, m.name]))}</select>
                </div>
                <div>
                  <label for="fd-mascotSide">Угол экрана</label>
                  <select id="fd-mascotSide">${opts([['left', 'Слева'], ['right', 'Справа']])}</select>
                </div>
              </div>
              <label for="fd-mascotScale">Размер <span id="fd-mascotScaleVal" class="fpp-muted"></span></label>
              <input type="range" id="fd-mascotScale" min="0.5" max="2.5" step="0.05">
              <label for="fd-mascotX">Отступ от края <span id="fd-mascotXVal" class="fpp-muted"></span></label>
              <input type="range" id="fd-mascotX" min="0" max="600" step="2">
              <label for="fd-mascotY">Отступ от низа <span id="fd-mascotYVal" class="fpp-muted"></span></label>
              <input type="range" id="fd-mascotY" min="0" max="600" step="2">
              <div class="fpp-actions">
                <span class="fpp-muted">Персонажа можно перетащить мышью.</span>
                <button type="button" class="fpp-btn" id="fd-mascotReset">Сбросить</button>
              </div>
            </section>

            <section class="fpp-card">
              <h2><span class="fpp-ico">🔔</span>Звук сообщений</h2>
              <div class="fpp-row">
                <select id="fd-sound" aria-label="Звук сообщений">${opts(SOUND_OPTS)}</select>
                <button type="button" class="fpp-btn" id="fd-testSound" aria-label="Прослушать звук">▶</button>
              </div>
              <input type="file" id="fd-customFile" accept="audio/*" hidden style="margin-top:8px">
              <small id="fd-customName" class="fpp-muted"></small>
              <label for="fd-soundVolume">Громкость</label>
              <input type="range" id="fd-soundVolume" min="0.05" max="1" step="0.05">
            </section>
          </div>

          <div class="fpp-grid fpp-panel" data-panel="mods" role="tabpanel" hidden>
            <section class="fpp-card">
              <h2><span class="fpp-ico">🕶</span>Приватность</h2>
              <p class="fpp-muted">Скрывает ники и аватарки покупателей в чатах, диалогах, заказах и отзывах. Удобно для стримов и скриншотов.</p>
              <label class="fpp-check"><input type="checkbox" id="fd-blurNames"> Замыливать ники покупателей</label>
              <label class="fpp-check"><input type="checkbox" id="fd-blurHover"> Показывать ник при наведении мыши</label>
              <p class="fpp-muted">Ваш ник: <b id="fd-meName">определяется…</b> — он не замыливается.</p>
              <label for="fd-blurStrength">Сила размытия <span id="fd-blurStrengthVal" class="fpp-muted"></span></label>
              <input type="range" id="fd-blurStrength" min="1" max="20" step="1">
            </section>

            <section class="fpp-card">
              <h2><span class="fpp-ico">🛠</span>Лоты и чат</h2>
              <label for="fd-translateMode">Перевод лота на английский</label>
              <select id="fd-translateMode">${opts([['button', 'По нажатию кнопки'], ['auto', 'Автоматически при сохранении']])}</select>
              <p class="fpp-muted">Автоматически переводятся только пустые английские поля и те, что расширение заполнило раньше. Ручной перевод не перезаписывается.</p>
              <label for="fd-gcloudKey">Ключ Google Cloud Translation</label>
              <div class="fpp-row">
                <input type="password" id="fd-gcloudKey" class="fpp-input" autocomplete="off" spellcheck="false" placeholder="AIza…">
                <button type="button" class="fpp-btn fpp-primary" id="fd-gcloudSave">Проверить и сохранить</button>
                <button type="button" class="fpp-btn" id="fd-gcloudDel" hidden>Удалить</button>
              </div>
              <p class="fpp-muted" id="fd-gcloudStatus" role="status"></p>
              <details class="fpp-muted">
                <summary>Как получить ключ</summary>
                <ol>
                  <li>Откройте <a href="https://console.cloud.google.com/apis/library/translate.googleapis.com" target="_blank" rel="noopener">Cloud Translation API</a>, создайте проект и нажмите «Enable».</li>
                  <li>Подключите к проекту платёжный аккаунт (Billing): без него API не работает.</li>
                  <li>APIs &amp; Services → Credentials → Create credentials → API key.</li>
                  <li>В настройках ключа разрешите только Cloud Translation API. Ограничение по сайтам не ставьте, с ним расширение не сможет работать.</li>
                </ol>
                Бесплатно 500 000 символов в месяц, дальше по тарифам Google. Ключ хранится только в этом браузере и не попадает в экспорт настроек. Чтобы вернуться к бесплатному переводчику, нажмите «Удалить».
              </details>
              <label class="fpp-check"><input type="checkbox" id="fd-realPrices"> Реальные цены лотов (без комиссии) в таблице раздела</label>
              <label class="fpp-check"><input type="checkbox" id="fd-sectionFee"> Показывать комиссию раздела на странице своих предложений</label>
              <label class="fpp-check"><input type="checkbox" id="fd-emojiPanel"> Панель эмодзи в чате</label>
            </section>

            <section class="fpp-card">
              <h2><span class="fpp-ico">💬</span>Быстрые ответы</h2>
              <p class="fpp-muted">По одному в строке. В чате: кнопки в правой колонке, на уровне кнопки отправки, или Alt+1…9. Переменные: {имя}, {лот}.</p>
              <textarea id="fd-templates" rows="6" aria-label="Быстрые ответы"></textarea>
            </section>

            <section class="fpp-card">
              <h2><span class="fpp-ico">🚫</span>Чёрный список</h2>
              <p class="fpp-muted">Добавляйте людей кнопкой «🚫 В ЧС» в чате. Их диалоги подсвечиваются красным.</p>
              <div id="fd-blacklist"></div>
            </section>
          </div>
        </div>
      </div>`;
    bindDashboard(d);
    bindGoldenKey(d);
    bindDashTabs(d);
    return d;
  }

  function bindDashboard(d) {
    const $ = (id) => d.querySelector('#fd-' + id);
    const save = (o) => chrome.storage.sync.set(o);

    $('autoRaise').checked = !!S.autoRaise;
    $('raiseNotify').checked = S.raiseNotify !== false;
    $('dark').checked = !!S.dark;
    $('wallpaper').value = S.wallpaper;
    $('wallOpacity').value = S.wallOpacity;
    $('sound').value = S.sound;
    $('soundVolume').value = S.soundVolume;
    $('templates').value = (S.templates || []).join('\n');
    const showCustom = () => { $('customFile').hidden = $('sound').value !== 'custom'; };
    showCustom();
    chrome.storage.local.get({ customSoundName: '' }, (v) => { $('customName').textContent = v.customSoundName; });

    $('autoRaise').onchange = (e) => save({ autoRaise: e.target.checked });
    $('raiseNotify').onchange = (e) => save({ raiseNotify: e.target.checked });
    $('mascot').checked = !!S.mascot;
    $('mascotSound').checked = !!S.mascotSound;
    $('mascot').onchange = (e) => save({ mascot: e.target.checked });
    $('mascotSound').onchange = (e) => save({ mascotSound: e.target.checked });
    $('l2dModel').value = L2D_MODELS[S.l2dModel] ? S.l2dModel : 'hiyori';
    $('l2dModel').onchange = (e) => save({ l2dModel: e.target.value });

    // Размер и положение персонажа. Ползунки двигают его сразу, в storage пишем с задержкой
    const showPlacement = () => {
      $('mascotScale').value = mascotScale();
      $('mascotSide').value = S.mascotSide === 'right' ? 'right' : 'left';
      $('mascotX').value = Math.round(+S.mascotX || 0);
      $('mascotY').value = Math.round(+S.mascotY || 0);
      $('mascotScaleVal').textContent = Math.round(mascotScale() * 100) + '%';
      $('mascotXVal').textContent = $('mascotX').value + ' px';
      $('mascotYVal').textContent = $('mascotY').value + ' px';
    };
    showPlacement();
    const savePlacement = debounce(() => save({
      mascotScale: S.mascotScale, mascotSide: S.mascotSide, mascotX: S.mascotX, mascotY: S.mascotY
    }), 250);
    const nudge = (key, val) => {
      S[key] = val;
      applyMascotPlacement();
      showPlacement();
      savePlacement();
    };
    $('mascotScale').oninput = (e) => nudge('mascotScale', +e.target.value);
    $('mascotX').oninput = (e) => nudge('mascotX', +e.target.value);
    $('mascotY').oninput = (e) => nudge('mascotY', +e.target.value);
    $('mascotSide').onchange = (e) => nudge('mascotSide', e.target.value);
    $('mascotReset').onclick = () => {
      Object.assign(S, {
        mascotScale: DEFAULTS.mascotScale, mascotSide: DEFAULTS.mascotSide,
        mascotX: DEFAULTS.mascotX, mascotY: DEFAULTS.mascotY
      });
      applyMascotPlacement();
      showPlacement();
      savePlacement();
    };
    // перетащили персонажа мышью — обновляем ползунки в открытой панели
    d._syncPlacement = showPlacement;

    // Лоты и чат
    $('translateMode').value = S.translateMode === 'auto' ? 'auto' : 'button';
    $('translateMode').onchange = (e) => save({ translateMode: e.target.value });

    // Свой ключ Google Cloud: храним в local (не синхронизируется), перед сохранением проверяем запросом.
    // Панель встроена в страницу FunPay, и её скрипты видят DOM, поэтому сохранённый ключ в поле
    // не подставляем, а показываем замаскированным, как golden key
    const keyStatus = (k, note = '') => {
      $('gcloudStatus').textContent = (note ? note + ' ' : '') + (k
        ? `Сохранён ключ ${k.slice(0, 4)}…${k.slice(-4)}, перевод идёт через Cloud Translation API.`
        : 'Без ключа используется бесплатный переводчик Google, его иногда закрывают капчей.');
      $('gcloudDel').hidden = !k;
      $('gcloudKey').placeholder = k ? 'Вставьте новый ключ, чтобы заменить' : 'AIza…';
    };
    chrome.storage.local.get({ gcloudKey: '' }, (v) => keyStatus(v.gcloudKey));
    const saveKey = () => {
      const key = $('gcloudKey').value.trim(), btn = $('gcloudSave');
      if (!key) { toast('Вставьте ключ в поле'); $('gcloudKey').focus(); return; }
      btn.disabled = true;
      $('gcloudStatus').textContent = 'Проверяю ключ…';
      chrome.runtime.sendMessage({ type: 'translateCheck', key }, (r) => {
        btn.disabled = false;
        if (chrome.runtime.lastError) { $('gcloudStatus').textContent = 'Расширение перезагружено, обновите страницу'; return; }
        if (!r?.ok) { $('gcloudStatus').textContent = '✗ Ключ не сохранён: ' + (r?.error || 'нет ответа'); return; }
        chrome.storage.local.set({ gcloudKey: key }, () => {
          $('gcloudKey').value = '';
          keyStatus(key, `✓ Ключ работает («Привет» → «${r.text}»).`);
        });
      });
    };
    $('gcloudSave').onclick = saveKey;
    $('gcloudKey').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } };
    $('gcloudDel').onclick = () => {
      if (!confirm('Удалить ключ Google Cloud? Перевод вернётся на бесплатный переводчик Google.')) return;
      chrome.storage.local.remove('gcloudKey', () => { keyStatus(''); toast('Ключ удалён'); });
    };
    for (const k of ['realPrices', 'sectionFee', 'emojiPanel']) {
      $(k).checked = S[k] !== false;
      $(k).onchange = (e) => save({ [k]: e.target.checked });
    }

    // Замыливание ников
    const blurPx =() => Math.min(20, Math.max(1, +S.blurStrength || 5));
    $('blurNames').checked = !!S.blurNames;
    $('blurHover').checked = S.blurHover !== false;
    $('blurStrength').value = blurPx();
    $('blurStrengthVal').textContent = blurPx() + ' px';
    const showMe = () => { $('meName').textContent = ME.name || 'не определён'; };
    showMe();
    d._syncMe = showMe;
    $('blurNames').onchange = (e) => { S.blurNames = e.target.checked; applyNameBlur(); save({ blurNames: e.target.checked }); };
    $('blurHover').onchange = (e) => { S.blurHover = e.target.checked; applyNameBlur(); save({ blurHover: e.target.checked }); };
    const saveBlur = debounce(() => save({ blurStrength: S.blurStrength }), 250);
    $('blurStrength').oninput = (e) => {
      S.blurStrength = +e.target.value;
      $('blurStrengthVal').textContent = S.blurStrength + ' px';
      applyNameBlur();
      saveBlur();
    };
    $('dark').onchange = (e) => save({ dark: e.target.checked });
    $('wallpaper').onchange = (e) => save({ wallpaper: e.target.value });
    // Яркость меняем на странице сразу, а в storage пишем с задержкой: у sync лимит записей в минуту
    const saveOpacity = debounce(() => save({ wallOpacity: S.wallOpacity }), 250);
    $('wallOpacity').oninput = (e) => {
      S.wallOpacity = +e.target.value;
      const w = document.getElementById('fpp-wallpaper');
      if (w) w.style.opacity = S.wallOpacity;
      saveOpacity();
    };
    $('wallFile').onchange = async (e) => {
      const f = e.target.files[0], hint = $('wallHint');
      if (!f) return;
      if (!/^(image|video)\//.test(f.type)) { hint.textContent = 'Нужна картинка, GIF или видео'; return; }
      try {
        await wallFile(f);
        $('wallpaper').value = 'custom';
        hint.textContent = `Загружено: ${f.name}`;
        if (S.wallpaper === 'custom') startWallpaper(); else save({ wallpaper: 'custom' });
      } catch { hint.textContent = 'Не удалось сохранить файл'; }
    };

    // Цветовая палитра. Пипетка красит страницу сразу, в storage пишем с задержкой (у sync лимит записей)
    const P = FPP_PALETTE;
    const markPalette = P.radios($('palList'), (id) => { $('palHint').textContent = ''; save(P.choose(S, id)); });
    const showPalette = () => {
      markPalette(S);
      const { a, b } = P.colors(S);
      // открытую пипетку не дёргаем, иначе цвет прыгнет назад при перетаскивании
      if (document.activeElement !== $('paletteA')) $('paletteA').value = a;
      if (document.activeElement !== $('paletteB')) $('paletteB').value = b;
    };
    showPalette();
    d._syncPalette = showPalette;
    const savePalette = debounce(() => save({ palette: 'custom', paletteA: S.paletteA, paletteB: S.paletteB }), 250);
    const pickColor = () => {
      Object.assign(S, { palette: 'custom', paletteA: $('paletteA').value, paletteB: $('paletteB').value });
      PAL = P.apply(root, S);
      markPalette(S);
      $('palHint').textContent = '';
      savePalette();
    };
    $('paletteA').oninput = pickColor;
    $('paletteB').oninput = pickColor;
    $('palRandom').onclick = () => {
      const [a, b] = P.random();
      $('palHint').textContent = '';
      save({ palette: 'custom', paletteA: a, paletteB: b });
    };
    $('palWall').onclick = async (e) => {
      const btn = e.currentTarget, hint = $('palHint');
      if (S.wallpaper !== 'custom') { hint.textContent = 'Сначала загрузите свои обои в карточке «Тема и обои»'; return; }
      btn.disabled = true;
      hint.textContent = 'Подбираю цвета…';
      try {
        const c = await wallColors();
        if (!c) hint.textContent = 'На обоях почти нет цвета, выберите палитру вручную';
        else { save({ palette: 'custom', paletteA: c.a, paletteB: c.b }); hint.textContent = 'Палитра подобрана под обои'; }
      } catch (err) {
        hint.textContent = 'Не удалось прочитать обои';
      } finally {
        btn.disabled = false;
      }
    };
    $('sound').onchange = (e) => { save({ sound: e.target.value }); showCustom(); };
    $('soundVolume').onchange = (e) => save({ soundVolume: +e.target.value });
    $('templates').oninput = debounce(() => save({
      templates: $('templates').value.split('\n').map((s) => s.trim()).filter(Boolean)
    }), 400);

    $('customFile').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { $('customName').textContent = 'Файл больше 2 МБ'; return; }
      const r = new FileReader();
      r.onload = () => chrome.storage.local.set({ customSound: r.result, customSoundName: f.name },
        () => { $('customName').textContent = f.name; });
      r.readAsDataURL(f);
    };
    $('testSound').onclick = () => {
      const name = $('sound').value, vol = +$('soundVolume').value;
      if (name === 'custom') {
        chrome.storage.local.get({ customSound: '' }, (v) => FPP_SOUNDS.play('custom', vol, v.customSound));
      } else {
        FPP_SOUNDS.play(name, vol);
      }
    };

    const raiseCmd = (type, btn, label) => {
      btn.disabled = true; btn.textContent = 'Проверяю…';
      chrome.runtime.sendMessage({ type }, (r) => {
        btn.disabled = false; btn.textContent = label;
        if (chrome.runtime.lastError) toast('Расширение перезагружено, обновите страницу');
        else if (r && !r.ok) toast(r.error);
      });
    };
    $('raiseNow').onclick = (e) => raiseCmd('raiseNow', e.target, 'Поднять сейчас');
    $('raiseRefresh').onclick = (e) => raiseCmd('raiseRefresh', e.target, 'Обновить список лотов');

    $('export').onclick = async () => {
      const sync = await chrome.storage.sync.get(null);
      const local = await chrome.storage.local.get(null);
      delete local.raise; // состояние поднятия не переносим
      delete local.gcloudKey; // ключ API в файл не кладём: файлом могут поделиться
      const blob = new Blob([JSON.stringify({ app: 'funpay-plus', v: 1, sync, local }, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob), download: `funpay-plus-${new Date().toISOString().slice(0, 10)}.json`
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('import').onclick = () => $('importFile').click();
    $('importFile').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== 'funpay-plus') throw new Error('это не файл FunPay Plus');
        if (data.sync) await chrome.storage.sync.set(data.sync);
        if (data.local) await chrome.storage.local.set(data.local);
        toast('Настройки восстановлены');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        toast('Не удалось загрузить: ' + err.message);
      }
    };

    renderRaise(d);
    renderBlacklist(d);
  }

  function fmtIn(ts) {
    const ms = ts - Date.now();
    if (ms <= 0) return 'сейчас';
    const m = Math.ceil(ms / 60000);
    return m >= 60 ? `через ${Math.floor(m / 60)} ч ${m % 60} мин` : `через ${m} мин`;
  }

  function renderRaise(d = document.getElementById('fpp-dash')) {
    const box = d?.querySelector('#fd-raise-list');
    if (!box) return;
    chrome.storage.local.get({ raise: null }, ({ raise }) => {
      if (!raise) {
        box.innerHTML = '<div class="fpp-muted">Лоты ещё не проверялись. Включите автоподнятие или нажмите «Поднять сейчас».</div>';
        return;
      }
      const cls = { true: 'ok', wait: 'wait', false: 'err' };
      const rows = Object.values(raise.games || {}).map((g) => `
        <div class="fpp-raise-row ${cls[g.ok] || ''}" title="${esc(g.msg || 'Ещё не поднимались')}">
          <span class="fpp-dot" aria-hidden="true"></span>
          <b>${esc(g.name)}</b>
          <span class="fpp-raise-next">${g.next ? fmtIn(g.next) : ''}</span>
        </div>`).join('');
      box.innerHTML = (raise.error ? `<div class="fpp-raise-err">${esc(raise.error)}</div>` : '')
        + (rows || '<div class="fpp-muted">Категорий с лотами не найдено</div>');
    });
  }

  function renderBlacklist(d = document.getElementById('fpp-dash')) {
    const box = d?.querySelector('#fd-blacklist');
    if (!box) return;
    const names = Object.keys(S.blacklist || {});
    box.innerHTML = names.length
      ? names.map((n) => `<div class="fpp-bl-row"><span>${esc(n)}</span><button type="button" class="fpp-btn" data-name="${esc(n)}">Убрать</button></div>`).join('')
      : '<div class="fpp-muted">Пусто</div>';
    box.querySelectorAll('button').forEach((b) => { b.onclick = () => setBlacklisted(b.dataset.name, false); });
  }

  // Боковая панель с чатом: настоящий /chat/ FunPay в iframe (тот же домен — история, отправка, список диалогов работают как на сайте)
  function buildChatDock() {
    if (window.top !== window || document.getElementById('fpp-chat-btn') || location.pathname.startsWith('/chat')) return;
    let side = localStorage.getItem('fpp-chat-side') || 'right';
    const btn = Object.assign(document.createElement('button'), { id: 'fpp-chat-btn', type: 'button', textContent: '💬', title: 'Чат (Alt+C)' });
    btn.setAttribute('aria-label', 'Открыть чат'); btn.setAttribute('aria-expanded', 'false');
    const dock = document.createElement('aside');
    dock.id = 'fpp-chat-dock'; dock.setAttribute('aria-label', 'Чат FunPay');
    dock.innerHTML = `
      <div class="fpp-chat-head">
        <b>Сообщения</b>
        <button type="button" data-a="side" title="Переместить на другую сторону" aria-label="Сменить сторону">⇄</button>
        <button type="button" data-a="reload" title="Обновить" aria-label="Обновить">⟳</button>
        <button type="button" data-a="tab" title="Открыть во вкладке" aria-label="Открыть во вкладке">↗</button>
        <button type="button" data-a="close" title="Закрыть" aria-label="Закрыть">✕</button>
      </div>
      <iframe title="Чат FunPay"></iframe>`;
    document.body.append(btn, dock);
    const frame = dock.querySelector('iframe');
    const applySide = () => { dock.dataset.side = side; btn.dataset.side = side; };
    applySide();

    // прячем шапку/подвал сайта внутри iframe — остаётся только чат
    frame.addEventListener('load', () => {
      try {
        const d = frame.contentDocument;
        d.documentElement.classList.add('fpp-in-dock');
        const st = d.createElement('style');
        st.textContent = `header,#header,footer,.footer,.wrapper-footer,#fpp-fab,#fpp-panel,#fpp-neko,#fpp-wallpaper,#fpp-chat-btn{display:none!important}
          body{padding:0!important} .wrapper-content{padding:0!important}
          .container{width:100%!important;max-width:none!important;padding:0 4px!important}`;
        d.head.append(st);
        // ссылки вне чата открываем в основной вкладке
        d.addEventListener('click', (e) => {
          const a = e.target.closest('a[href]');
          if (a && !/\/chat\//.test(a.href) && a.origin === location.origin) { e.preventDefault(); location.href = a.href; }
        });
      } catch { /* другой домен — оставляем как есть */ }
    });

    const toggle = (open = !dock.classList.contains('open')) => {
      if (open && !frame.src) frame.src = '/chat/';
      dock.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Закрыть чат' : 'Открыть чат');
      localStorage.setItem('fpp-chat-open', open ? '1' : '');
    };
    btn.onclick = () => toggle();
    dock.querySelector('.fpp-chat-head').onclick = (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'close') toggle(false);
      else if (a === 'reload') frame.contentWindow?.location.reload();
      else if (a === 'tab') window.open(frame.contentWindow?.location.href || '/chat/', '_blank');
      else if (a === 'side') { side = side === 'right' ? 'left' : 'right'; localStorage.setItem('fpp-chat-side', side); applySide(); }
    };
    addEventListener('keydown', (e) => {
      if (e.altKey && e.code === 'KeyC') { e.preventDefault(); toggle(); }
      else if (e.key === 'Escape' && dock.classList.contains('open')) toggle(false);
    });
    if (localStorage.getItem('fpp-chat-open')) toggle(true);
  }

  /* =================== СТАТИСТИКА ПРОДАЖ (/orders/trade) =================== */
  const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  // «сегодня, 6:20» / «вчера, 6:20» / «23 октября, 17:26» / «23 октября 2025, 17:26»
  function parseOrderDate(s) {
    s = s.trim().toLowerCase();
    const now = new Date(), d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (s.startsWith('сегодня')) return d;
    if (s.startsWith('вчера')) { d.setDate(d.getDate() - 1); return d; }
    const m = s.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/);
    if (!m) return null;
    // «ма» совпадает и с «марта», поэтому ищем самое длинное совпадение
    let mi = -1, best = 0;
    MONTHS.forEach((p, i) => { if (m[2].startsWith(p) && p.length > best) { best = p.length; mi = i; } });
    if (mi < 0) return null;
    const r = new Date(m[3] ? +m[3] : now.getFullYear(), mi, +m[1]);
    if (!m[3] && r > now) r.setFullYear(r.getFullYear() - 1);
    return r;
  }

  // Состояние блока статистики переживает перерисовки от MutationObserver
  const ST = {
    period: (() => { try { return localStorage.getItem('fpp-stats-period') || 'd30'; } catch { return 'd30'; } })(),
    filter: '', buyer: '', loading: false, progress: '', key: ''
  };
  const PERIODS = [['d1', 'Сегодня', 0], ['d7', '7 дней', 6], ['d30', '30 дней', 29], ['all', 'Всё время', Infinity]];

  // Кэш заказов в localStorage funpay.com (отдельно для каждого аккаунта): старые продажи не грузим заново
  // Режим: продажи (/orders/trade) или покупки (/orders/)
  const statsMode = () => location.pathname.startsWith('/orders/trade') ? 'sales'
    : /^\/orders\/?$/.test(location.pathname) ? 'buy' : null;
  const ordKey = () => 'fpp-orders-' + (statsMode() === 'buy' ? 'buy-' : '') + (appDataId() || 'x');
  let ORD = null;
  function orderCache() {
    if (!ORD) {
      try { ORD = JSON.parse(localStorage.getItem(ordKey())) || {}; } catch { ORD = {}; }
      ORD.list = ORD.list || {}; // id -> { d: 'Y-M-D', s, k, b, t }
    }
    return ORD;
  }
  function saveOrderCache() { try { localStorage.setItem(ordKey(), JSON.stringify(ORD)); } catch { /* переполнено — работаем без кэша */ } }
  const rowId = (r) => (r.getAttribute('href') || '').match(/orders\/([A-Z0-9]+)/i)?.[1]
    || r.querySelector('.tc-order')?.textContent.replace('#', '').trim();
  const rowBuyer = (r) => r.querySelector('.tc-user .media-user-name')?.textContent.trim() || '';

  function readOrders() {
    const C = orderCache(); let changed = false;
    // DOM свежее кэша: статус «оплачен» может смениться на «закрыт» или «возврат»
    for (const r of document.querySelectorAll('a.tc-item')) {
      const id = rowId(r); if (!id) continue;
      const st = (r.querySelector('.tc-status')?.textContent || '').trim().toLowerCase();
      const date = parseOrderDate(r.querySelector('.tc-date-time')?.textContent || '');
      const o = {
        d: date ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : C.list[id]?.d || '',
        s: parseFloat((r.querySelector('.tc-price')?.textContent || '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0,
        k: st.startsWith('возврат') ? 'refund' : st.startsWith('оплач') ? 'paid' : 'closed',
        b: rowBuyer(r),
        t: (r.querySelector('.order-desc div')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      };
      const prev = C.list[id];
      if (!prev || prev.k !== o.k || prev.s !== o.s || prev.d !== o.d || prev.b !== o.b) { C.list[id] = o; changed = true; }
    }
    if (changed) saveOrderCache();

    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Object.entries(C.list).map(([id, o]) => {
      const [y, m, d] = o.d.split('-').map(Number);
      const date = y ? new Date(y, m - 1, d) : null;
      return { id, date, ago: date ? Math.round((today - date) / 864e5) : Infinity, sum: o.s, kind: o.k, buyer: o.b, desc: o.t };
    });
  }

  // «Всё время»: жмём «Показать больше заказов», пока кнопка не исчезнет
  async function loadAllOrders() {
    if (ST.loading) return;
    ST.loading = true;
    try {
      for (let i = 0; i < 300; i++) {
        const more = document.querySelector('.dyn-table-continue');
        if (!more || more.offsetParent === null || more.disabled) break;
        const rows = document.querySelectorAll('a.tc-item'), before = rows.length;
        // история уже сохранена: догружаем, только пока не дошли до известных заказов
        const C = orderCache(), lastId = rows.length && rowId(rows[rows.length - 1]);
        if (C.full && lastId && C.list[lastId]) break;
        ST.progress = `Загружаю заказы… ${before}`; ST.key = ''; renderSalesStats();
        more.click();
        // ждём подгрузку новой порции (до 10 с)
        let ok = false;
        for (let t = 0; t < 50 && !ok; t++) {
          await new Promise((r) => setTimeout(r, 200));
          ok = document.querySelectorAll('a.tc-item').length > before;
        }
        if (!ok) break;
      }
      readOrders();
      const more = document.querySelector('.dyn-table-continue');
      if (!more || more.offsetParent === null) { orderCache().full = true; saveOrderCache(); }
    } finally {
      ST.loading = false; ST.progress = ''; ST.key = ''; renderSalesStats();
    }
  }

  function applyStatsFilter() {
    document.querySelectorAll('a.tc-item').forEach((r) => {
      const k = r.classList.contains('fpp-order-paid') ? 'paid' : r.classList.contains('fpp-order-refund') ? 'refund' : 'closed';
      r.classList.toggle('fpp-stats-hidden', (!!ST.filter && ST.filter !== k) || (!!ST.buyer && rowBuyer(r) !== ST.buyer));
    });
  }

  function renderSalesStats() {
    const mode = statsMode();
    if (!mode) return;
    const B = mode === 'buy';
    const L = B
      ? { title: 'Статистика покупок', total: 'Потрачено', who: ['продавец', 'продавца', 'продавцов'], closed: 'Завершено', paid: 'Ждут вашего подтверждения',
          byDay: 'Траты по дням', byMonth: 'Траты по месяцам', top: 'Топ покупок', none: 'Нет покупок за период', people: 'Продавцы',
          person: 'Продавец', spent: 'Потрачено у него', loyal: 'повторно', noPeople: 'Нет продавцов за период', back: 'покупали повторно' }
      : { title: 'Статистика продаж', total: 'Выручка', who: ['покупатель', 'покупателя', 'покупателей'], closed: 'Закрыто', paid: 'Ждут подтверждения',
          byDay: 'Выручка по дням', byMonth: 'Выручка по месяцам', top: 'Топ лотов', none: 'Нет продаж за период', people: 'Постоянные покупатели',
          person: 'Покупатель', spent: 'Потратил', loyal: 'постоянный', noPeople: 'Нет покупателей за период', back: 'вернулись' };
    const orders = readOrders();
    const key = [orders.length, document.querySelectorAll('a.tc-item').length, orders.filter((o) => o.kind !== 'closed').length,
      ST.period, ST.filter, ST.buyer, ST.loading, ST.progress].join('|');
    if (key === ST.key && document.getElementById('fpp-stats')) return;
    ST.key = key;

    let box = document.getElementById('fpp-stats');
    if (!box) {
      const anchor = document.querySelector('form.orders-filter, .orders-filter') || document.querySelector('.tc');
      if (!anchor) return;
      box = document.createElement('section');
      box.id = 'fpp-stats'; box.setAttribute('aria-label', L.title);
      anchor.after(box);
      box.addEventListener('click', onStatsClick);
    }

    const lim = PERIODS.find((p) => p[0] === ST.period)?.[2] ?? 29;
    const inP = orders.filter((o) => o.ago <= lim);
    const sold = inP.filter((o) => o.kind !== 'refund');
    const sumOf = (a) => a.reduce((s, o) => s + o.sum, 0);
    const of = (k) => inP.filter((o) => o.kind === k);
    const revenue = sumOf(sold), closed = of('closed'), paid = of('paid'), refund = of('refund');
    const buyers = new Set(sold.map((o) => o.buyer).filter(Boolean));
    const rub = (v) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
    const pl = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;
    const orderW = (n) => `${n} ${pl(n, 'заказ', 'заказа', 'заказов')}`;

    // График: по часам нельзя (нет часов в датах), поэтому дни; для «всего времени» — месяцы
    const byMonth = ST.period === 'all';
    const buckets = new Map();
    for (const o of sold) {
      if (!o.date) continue;
      const k = byMonth ? o.date.getFullYear() * 12 + o.date.getMonth() : o.ago;
      buckets.set(k, (buckets.get(k) || 0) + o.sum);
    }
    let keys;
    if (byMonth) {
      const ks = [...buckets.keys()];
      const lo = ks.length ? Math.min(...ks) : 0, hi = ks.length ? Math.max(...ks) : 0;
      keys = Array.from({ length: Math.min(24, hi - lo + 1) }, (_, i) => hi - Math.min(24, hi - lo + 1) + 1 + i);
    } else {
      const n = Math.max(7, lim + 1);
      keys = Array.from({ length: n }, (_, i) => n - 1 - i);
    }
    const max = Math.max(1, ...keys.map((k) => buckets.get(k) || 0));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const label = (k) => byMonth
      ? new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
      : new Date(today - k * 864e5).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    const bars = keys.map((k) => {
      const v = buckets.get(k) || 0;
      return `<div class="fpp-st-bar" style="--h:${(v / max) * 100}%" tabindex="0" aria-label="${label(k)}: ${rub(v)}"><em>${label(k)}<br><b>${rub(v)}</b></em></div>`;
    }).join('');

    const lots = new Map();
    for (const o of sold) if (o.desc) { const l = lots.get(o.desc) || { n: 0, s: 0 }; l.n++; l.s += o.sum; lots.set(o.desc, l); }
    const top = [...lots.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 5);
    const topMax = top[0]?.[1].s || 1;

    // Покупатели: кто сколько потратил, сколько раз брал, возвраты, последняя покупка
    const bm = new Map();
    for (const o of inP) {
      if (!o.buyer) continue;
      const x = bm.get(o.buyer) || { n: 0, s: 0, r: 0, last: null };
      if (o.kind === 'refund') x.r++; else { x.n++; x.s += o.sum; }
      if (o.date && (!x.last || o.date > x.last)) x.last = o.date;
      bm.set(o.buyer, x);
    }
    const topB = [...bm.entries()].filter(([, x]) => x.n).sort((a, b) => b[1].s - a[1].s || b[1].n - a[1].n).slice(0, 8);
    const repeat = [...bm.values()].filter((x) => x.n > 1).length;
    const repeatPct = buyers.size ? Math.round((repeat / buyers.size) * 100) : 0;
    const ago = (d) => { if (!d) return '—'; const n = Math.round((today - d) / 864e5); return n === 0 ? 'сегодня' : n === 1 ? 'вчера' : `${n} дн. назад`; };

    const more = document.querySelector('.dyn-table-continue');
    const hasMore = more && more.offsetParent !== null && !orderCache().full;
    const tab = ([id, name]) => `<button type="button" class="fpp-st-tab${ST.period === id ? ' on' : ''}" data-period="${id}" aria-pressed="${ST.period === id}">${name}</button>`;
    const card = (f, cls, title, value, sub) => `
      <button type="button" class="fpp-st-card ${cls}${ST.filter === f ? ' on' : ''}" data-filter="${f}" aria-pressed="${ST.filter === f}" title="Показать в таблице только эти заказы">
        <span>${title}</span><b>${value}</b><i>${sub}</i></button>`;

    box.innerHTML = `
      <header class="fpp-st-head">
        <h2>${L.title}</h2>
        <div class="fpp-st-tabs" role="group" aria-label="Период">${PERIODS.map(tab).join('')}</div>
      </header>
      <div class="fpp-st-hero">
        <div><span>${L.total}</span><b>${rub(revenue)}</b><i>${orderW(sold.length)} · ${buyers.size} ${pl(buyers.size, ...L.who)}</i></div>
        <div><span>Средний чек</span><b>${rub(sold.length ? revenue / sold.length : 0)}</b><i>за выбранный период</i></div>
      </div>
      <div class="fpp-st-cards">
        ${card('closed', '', L.closed, rub(sumOf(closed)), orderW(closed.length))}
        ${card('paid', 'paid', L.paid, rub(sumOf(paid)), orderW(paid.length))}
        ${card('refund', 'refund', 'Возвраты', rub(sumOf(refund)), orderW(refund.length))}
      </div>
      <div class="fpp-st-row">
        <div class="fpp-st-panel"><span>${byMonth ? L.byMonth : L.byDay}</span>
          <div class="fpp-st-bars${keys.length > 14 ? ' dense' : ''}">${bars}</div></div>
        <div class="fpp-st-panel"><span>${L.top}</span>
          <ol class="fpp-st-top">${top.map(([d, l]) => `
            <li style="--w:${(l.s / topMax) * 100}%"><em title="${esc(d)}">${esc(d)}</em><b>${rub(l.s)}</b><i>${l.n}×</i></li>`).join('') || `<li class="empty">${L.none}</li>`}
          </ol></div>
      </div>
      <div class="fpp-st-panel fpp-st-buyers">
        <div class="fpp-st-bhead"><span>${L.people}</span>
          <i>${buyers.size} всего · ${repeat} ${L.back} (${repeatPct}%)</i></div>
        ${topB.length ? `<table>
          <thead><tr><th>#</th><th>${L.person}</th><th>Заказов</th><th>${L.spent}</th><th>Средний чек</th><th>Возвраты</th><th>Последний</th></tr></thead>
          <tbody>${topB.map(([name, x], i) => `
            <tr class="${ST.buyer === name ? 'on' : ''}">
              <td>${i + 1}</td>
              <td><button type="button" class="fpp-st-buyer" data-buyer="${esc(name)}" title="Показать только эти заказы">${esc(name)}</button>${x.n > 1 ? ` <em class="fpp-st-loyal">${L.loyal}</em>` : ''}</td>
              <td>${x.n}</td><td><b>${rub(x.s)}</b></td><td>${rub(x.s / x.n)}</td>
              <td class="${x.r ? 'bad' : ''}">${x.r}</td><td>${ago(x.last)}</td>
            </tr>`).join('')}</tbody></table>` : `<p class="empty">${L.noPeople}</p>`}
      </div>
      <footer class="fpp-st-foot">
        ${ST.progress ? `<span class="fpp-st-progress">${ST.progress}</span>` : ''}
        ${ST.filter || ST.buyer ? `<button type="button" class="fpp-st-reset" data-act="reset">✕ Сбросить фильтр${ST.buyer ? `: <b>${esc(ST.buyer)}</b>` : ''}</button>` : ''}
        ${hasMore ? `<button type="button" class="fpp-st-load" data-act="all"${ST.loading ? ' disabled' : ''}>${ST.loading ? 'Загрузка…' : 'Загрузить все заказы'}</button>` : ''}
      </footer>`;
    applyStatsFilter();
  }

  function onStatsClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.period) {
      ST.period = b.dataset.period;
      try { localStorage.setItem('fpp-stats-period', ST.period); } catch {}
      if (ST.period === 'all') loadAllOrders();
    } else if (b.dataset.filter !== undefined) {
      ST.filter = ST.filter === b.dataset.filter ? '' : b.dataset.filter;
    } else if (b.dataset.buyer !== undefined) {
      ST.buyer = ST.buyer === b.dataset.buyer ? '' : b.dataset.buyer;
    } else if (b.dataset.act === 'reset') { ST.filter = ''; ST.buyer = ''; }
    else if (b.dataset.act === 'all') loadAllOrders();
    ST.key = ''; renderSalesStats();
  }

  /* =================== ПАСХАЛКА: 5 кликов по шапке — сайт рушится =================== */
  function initGravityEgg() {
    if (window.top !== window) return;
    let n = 0, timer;
    document.addEventListener('click', (e) => {
      const head = e.target.closest('#header');
      if (!head || document.getElementById('fpp-physics')) return;
      const link = e.target.closest('a,button,input,select');
      // считаем клики по фону шапки и по логотипу; логотип во время серии не переходит по ссылке
      const logo = link && link.matches('.navbar-brand, .logo, a[href="https://funpay.com/"], a[href="/"]');
      if (link && !logo) { n = 0; return; }
      if (logo && n > 0) e.preventDefault();
      clearTimeout(timer); timer = setTimeout(() => { n = 0; }, 1500);
      if (++n >= 5) { n = 0; e.preventDefault(); collapseSite(); }
    }, true);
  }

  function collapseSite() {
    const SEL = 'a, button, img, input, select, textarea, label, h1, h2, h3, h4, .tc-item, .badge, .avatar-photo, .rating-stars, .contact-item, .chat-msg-item, .offer-tc-container, .profile-header';
    const picked = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (picked.length >= 400) break;
      if (el.closest('[id^="fpp-"]') || picked.some((p) => p.contains(el))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.top > innerHeight || r.width > innerWidth * 0.9) continue;
      picked.push(el);
    }
    if (!picked.length) return;

    const layer = document.createElement('div');
    layer.id = 'fpp-physics';
    layer.innerHTML = '<div class="fpp-phys-hint">Таскайте мышкой · Esc — вернуть сайт</div>';
    const bodies = picked.map((el) => {
      const r = el.getBoundingClientRect();
      const c = el.cloneNode(true);
      // переносим вычисленный вид, чтобы копия выглядела как оригинал
      const cs = getComputedStyle(el);
      for (const p of ['color', 'background', 'font', 'border', 'border-radius', 'padding', 'box-shadow', 'text-align', 'line-height', 'display'])
        c.style.setProperty(p, cs.getPropertyValue(p));
      c.removeAttribute('id'); c.removeAttribute('href');
      c.classList.add('fpp-phys-body');
      Object.assign(c.style, { width: r.width + 'px', height: r.height + 'px', margin: 0 });
      layer.append(c);
      el.style.visibility = 'hidden';
      return { el, c, x: r.left, y: r.top, w: r.width, h: r.height, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3, a: 0, va: 0 };
    });
    document.body.append(layer);

    const G = 0.5, BOUNCE = 0.35, FRICTION = 0.985;
    let drag = null, raf2 = 0, last = { x: 0, y: 0 };
    const step = () => {
      const W = innerWidth, H = innerHeight;
      for (const b of bodies) {
        if (b === drag?.b) {
          b.vx = (drag.x - drag.ox - b.x) * 0.35; b.vy = (drag.y - drag.oy - b.y) * 0.35;
        } else b.vy += G;
        b.vx *= FRICTION; b.vy *= FRICTION;
        b.x += b.vx; b.y += b.vy;
        if (b.y + b.h > H) { b.y = H - b.h; b.vy *= -BOUNCE; b.vx *= 0.9; if (Math.abs(b.vy) < 1) b.vy = 0; }
        if (b.y < 0) { b.y = 0; b.vy *= -BOUNCE; }
        if (b.x < 0) { b.x = 0; b.vx *= -BOUNCE; }
        if (b.x + b.w > W) { b.x = W - b.w; b.vx *= -BOUNCE; }
      }
      // столкновения прямоугольников: расталкиваем по оси наименьшего перекрытия
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const A = bodies[i], B = bodies[j];
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        if (ox <= 0 || oy <= 0) continue;
        const ma = A === drag?.b ? 0 : 1, mb = B === drag?.b ? 0 : 1, s = ma + mb || 1;
        if (ox < oy) {
          const d = (A.x < B.x ? -1 : 1) * ox;
          A.x += d * ma / s; B.x -= d * mb / s;
          const v = (A.vx + B.vx) / 2; A.vx = v; B.vx = v;
        } else {
          const d = (A.y < B.y ? -1 : 1) * oy;
          A.y += d * ma / s; B.y -= d * mb / s;
          const v = (A.vy + B.vy) / 2; A.vy = v * (ma ? 1 : 0) || A.vy * -BOUNCE; B.vy = v;
        }
      }
      for (const b of bodies) {
        b.va = b.va * 0.9 + b.vx * 0.15; b.a = Math.max(-25, Math.min(25, b.a * 0.95 + b.va * 0.1));
        b.c.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.a}deg)`;
      }
      raf2 = requestAnimationFrame(step);
    };
    step();

    layer.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.fpp-phys-body'); if (!c) return;
      const b = bodies.find((x) => x.c === c);
      drag = { b, x: e.clientX, y: e.clientY, ox: e.clientX - b.x, oy: e.clientY - b.y };
      last = { x: e.clientX, y: e.clientY };
      layer.setPointerCapture(e.pointerId); e.preventDefault();
    });
    layer.addEventListener('pointermove', (e) => { if (drag) { drag.x = e.clientX; drag.y = e.clientY; last = { x: e.clientX, y: e.clientY }; } });
    const drop = () => { drag = null; };
    layer.addEventListener('pointerup', drop); layer.addEventListener('pointercancel', drop);

    const restore = (e) => {
      if (e.key !== 'Escape') return;
      cancelAnimationFrame(raf2); removeEventListener('keydown', restore);
      bodies.forEach((b) => { b.el.style.visibility = ''; });
      layer.remove();
    };
    addEventListener('keydown', restore);
  }

  // Плавающая панель: заметки и быстрые ссылки
  function buildPanel() {
    if (document.getElementById('fpp-fab')) return;
    const fab = Object.assign(document.createElement('button'), { id: 'fpp-fab', textContent: '✦', title: 'FunPay Plus' });
    fab.setAttribute('aria-label', 'Открыть панель FunPay Plus');
    const p = document.createElement('div');
    p.id = 'fpp-panel'; p.setAttribute('role', 'dialog');
    p.innerHTML = `
      <b style="font-size:15px">FunPay Plus</b>
      <h4>Черновик / заметки</h4>
      <textarea id="fpp-memo" rows="4" placeholder="Логины, ключи заказов, напоминания…"></textarea>
      <h4>Быстро</h4>
      <div class="fpp-row" style="flex-wrap:wrap">
        <a class="fpp-btn" href="/orders/trade">Продажи</a>
        <a class="fpp-btn" href="/chat/">Чаты</a>
        <a class="fpp-btn" href="/account/balance">Баланс</a>
        <a class="fpp-btn" href="#funpay-plus">Настройки Plus</a>
        <button class="fpp-btn" id="fpp-top">Наверх</button>
      </div>`;
    document.body.append(fab, p);
    fab.onclick = () => p.classList.toggle('open');

    const $ = (id) => p.querySelector('#' + id);
    chrome.storage.local.get({ memo: '' }, (v) => { $('fpp-memo').value = v.memo; });
    $('fpp-memo').addEventListener('input', debounce(() => chrome.storage.local.set({ memo: $('fpp-memo').value }), 300));
    $('fpp-top').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Кнопки шаблонов. На странице чата — внизу правой колонки, на уровне кнопки отправки.
  // Если правой колонки нет (чат в заказе) или FunPay прячет её на узком экране — над полем ввода
  const narrowChat = matchMedia('(max-width: 991px)'); // с этой ширины FunPay скрывает .chat-detail
  narrowChat.addEventListener('change', () => injectTemplates(true));

  function injectTemplates(force) {
    document.querySelectorAll('textarea[name="content"], .chat-form textarea').forEach((ta) => {
      const parent = ta.closest('form') || ta.parentElement;
      const chat = ta.closest('.chat-full');
      const side = (!narrowChat.matches && chat?.querySelector('.chat-detail')) || null;
      // панель одна на чат: убираем оставшуюся в другом месте (например, после изменения ширины окна)
      (side ? parent : chat?.querySelector('.chat-detail'))?.querySelector('.fpp-templates')?.remove();
      const host = side || parent;
      let box = host.querySelector('.fpp-templates');
      if (box && !force) return;
      box?.remove();
      box = document.createElement('div');
      box.className = side ? 'fpp-templates fpp-templates-side' : 'fpp-templates';
      const list = S.templates || [];
      if (side && list.length) {
        box.append(Object.assign(document.createElement('div'), { className: 'fpp-templates-title', textContent: 'Быстрые ответы' }));
      }
      list.forEach((txt, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'fpp-btn';
        // в колонке места больше: показываем текст целиком (CSS обрезает до двух строк)
        if (side) b.append(Object.assign(document.createElement('span'), { className: 'fpp-tpl-text', textContent: txt }));
        else b.textContent = txt.length > 28 ? txt.slice(0, 26) + '…' : txt;
        b.title = i < 9 ? `${txt}\n(Alt+${i + 1})` : txt;
        b.onclick = () => {
          // при переключении диалога FunPay может пересоздать форму, поэтому поле ищем в момент клика
          const field = (side && chat.querySelector('.chat-form textarea')) || ta;
          field.value = (field.value ? field.value + ' ' : '') + fillTplVars(txt);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.focus();
        };
        box.append(b);
      });
      if (side) side.append(box); else ta.before(box);
    });
  }

  // Переменные в шаблонах: {имя} — собеседник, {лот} — лот/заказ, о котором идёт речь
  function fillTplVars(txt) {
    const q = (sel) => document.querySelector(sel)?.textContent.trim() || '';
    const name = q('.chat-header .media-user-name') || q('.chat-full-header .media-user-name') || q('.param-item .media-user-name');
    const lot = q('.chat-detail-list .order-desc div') || q('.chat-header .media-user-info a') || q('.order-desc div')
      || [...document.querySelectorAll('.param-item')].find((p) => /Краткое описание|Short description/i.test(p.textContent))
        ?.querySelector('div')?.textContent.trim() || '';
    return txt.replace(/\{(имя|name)\}/gi, name).replace(/\{(лот|lot)\}/gi, lot);
  }

  /* ---------- Вкл/выкл лотов прямо из списка ---------- */
  // Открываем форму редактирования в фоне, меняем галочку «Активное» и сохраняем
  async function setOfferActive(offerUrl, on) {
    const html = await (await fetch(offerUrl, { credentials: 'include' })).text();
    const form = new DOMParser().parseFromString(html, 'text/html').querySelector('form.form-offer-editor');
    if (!form) throw new Error('форма не найдена');
    const fd = new FormData(form);
    fd.delete('active');
    if (on) fd.set('active', 'on');
    fd.set('location', 'trade');
    const action = new URL(form.getAttribute('action') || '/lots/offerSave', location.origin);
    const r = await fetch(action, {
      method: 'POST', credentials: 'include', body: new URLSearchParams(fd),
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.msg || j.error || 'HTTP ' + r.status);
  }

  // Состояние лота видно прямо в списке: у выключенного FunPay ставит класс warning (a.tc-item.warning)
  const isOfferActive = (row) => !row.classList.contains('warning');

  function addOfferToggles() {
    document.querySelectorAll('a.tc-item[href*="offerEdit"]').forEach((row) => {
      if (row.querySelector('.fpp-offer-toggle')) return;
      const b = document.createElement('button');
      b.type = 'button';
      const show = (state) => { // true — активен, false — выключен, null — ещё не знаем
        const off = state === false;
        b.className = 'fpp-offer-toggle' + (state ? ' on' : '');
        b.title = state === null ? 'Проверяю, активен ли лот…' : off ? 'Лот выключен — включить' : 'Лот активен — выключить';
        b.setAttribute('aria-label', b.title);
        b.textContent = state === null ? '…' : off ? '○' : '●';
        b.disabled = state === null;
        b.dataset.state = state === null ? '' : String(state);
        row.classList.toggle('fpp-off', off);
      };
      show(isOfferActive(row));
      b.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const turnOn = b.dataset.state !== 'true';
        b.disabled = true;
        try {
          await setOfferActive(row.href, turnOn);
          row.classList.toggle('warning', !turnOn);
          show(turnOn);
          toast(turnOn ? 'Лот включён' : 'Лот выключен');
        } catch (err) { toast('Не удалось: ' + err.message); b.disabled = false; }
      };
      row.prepend(b);
    });
  }

  /* ---------- Массовое вкл/выкл лотов на своей странице продавца ---------- */
  const offerEditUrl = (row) => {
    const id = (row.href.match(/[?&](?:id|offer)=(\d+)/) || [])[1];
    return id ? `${location.origin}/lots/offerEdit?offer=${id}` : null;
  };

  async function massToggle(rows, on, btn) {
    rows = rows.filter(offerEditUrl);
    if (!rows.length) return toast('Лоты не найдены');
    if (!confirm(`${on ? 'Включить' : 'Выключить'} лотов: ${rows.length}?`)) return;
    const label = btn.textContent;
    let ok = 0, fail = 0;
    for (const [i, row] of rows.entries()) {
      btn.textContent = `${i + 1}/${rows.length}…`;
      try {
        await setOfferActive(offerEditUrl(row), on);
        row.classList.toggle('fpp-off', !on);
        row.classList.toggle('warning', !on);
        ok++;
      } catch { fail++; }
      await new Promise((r) => setTimeout(r, 400)); // не долбим сервер
    }
    btn.textContent = label;
    toast(`Готово: ${ok}${fail ? `, ошибок: ${fail}` : ''}`);
  }

  function addMassToggle() {
    const m = location.pathname.match(/^\/users\/(\d+)/);
    if (!m || !ME.id || String(ME.id) !== m[1]) return;
    const mk = (text, on, getRows) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fpp-btn fpp-mass-btn';
      b.textContent = text;
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); massToggle(getRows(), on, b); };
      return b;
    };
    // По разделам (каждая категория лотов)
    document.querySelectorAll('.offer').forEach((sec) => {
      const head = sec.querySelector('.offer-list-title-container, .offer-list-title');
      if (!head || head.querySelector('.fpp-mass')) return;
      const box = document.createElement('span');
      box.className = 'fpp-mass';
      const rows = () => [...sec.querySelectorAll('a.tc-item')];
      box.append(mk('⏻ Выкл. все', false, rows), mk('▶ Вкл. все', true, rows));
      head.append(box);
    });
    // Общие кнопки для всех лотов
    const first = document.querySelector('.offer');
    if (first && !document.getElementById('fpp-mass-all')) {
      const box = document.createElement('div');
      box.id = 'fpp-mass-all'; box.className = 'fpp-mass';
      const all = () => [...document.querySelectorAll('.offer a.tc-item')];
      box.append(mk('⏻ Выключить все лоты', false, all), mk('▶ Включить все лоты', true, all));
      first.before(box);
    }
  }

  /* ---------- Копирование чужих лотов ---------- */
  // На странице лота сохраняем поля, в редакторе нового лота — вставляем
  function readOfferPage() {
    const params = {};
    document.querySelectorAll('.param-item').forEach((p) => {
      const k = p.querySelector('h5')?.textContent.trim();
      const v = p.querySelector('div')?.innerText.trim();
      if (k && v) params[k] = v;
    });
    const find = (re) => Object.entries(params).find(([k]) => re.test(k))?.[1] || '';
    const price = document.querySelector('.payment-value, .tc-price')?.textContent.replace(/[^\d.,]/g, '').replace(',', '.') || '';
    return {
      summary: find(/Краткое описание|Short description/i),
      desc: find(/Подробное описание|Detailed description/i),
      price, params, from: location.href
    };
  }

  function addOfferCopy() {
    // Страница чужого лота
    if (location.pathname === '/lots/offer' && !document.getElementById('fpp-copy-offer')) {
      const anchor = document.querySelector('.param-item');
      if (anchor) {
        const b = document.createElement('button');
        b.id = 'fpp-copy-offer'; b.type = 'button'; b.className = 'fpp-btn';
        b.textContent = '📋 Скопировать лот';
        b.onclick = () => chrome.storage.local.set({ copiedOffer: readOfferPage() }, () =>
          toast('Лот скопирован — откройте «Добавить предложение» и нажмите «Вставить»'));
        anchor.parentElement.prepend(b);
      }
    }
    // Редактор лота
    const form = document.querySelector('form.form-offer-editor');
    if (!form || form.querySelector('#fpp-paste-offer')) return;
    const b = document.createElement('button');
    b.id = 'fpp-paste-offer'; b.type = 'button'; b.className = 'fpp-btn';
    b.textContent = '📥 Вставить скопированный лот';
    b.onclick = () => chrome.storage.local.get({ copiedOffer: null }, ({ copiedOffer: o }) => {
      if (!o) return toast('Сначала скопируйте лот на его странице');
      const put = (el, v) => {
        if (!el || !v) return;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      form.querySelectorAll('input[name^="fields[summary]"]').forEach((el) => put(el, o.summary));
      form.querySelectorAll('textarea[name^="fields[desc]"]').forEach((el) => put(el, o.desc));
      put(form.querySelector('input[name="price"]'), o.price);
      // Остальные параметры — по совпадению подписи поля
      form.querySelectorAll('.form-group').forEach((g) => {
        const label = g.querySelector('label')?.textContent.trim();
        const v = label && o.params[label];
        const el = v && g.querySelector('select, input[type="text"], textarea');
        if (!el || /summary|desc|price/.test(el.name)) return;
        if (el.tagName === 'SELECT') {
          const opt = [...el.options].find((op) => op.textContent.trim() === v);
          if (opt) put(el, opt.value);
        } else put(el, v);
      });
      toast('Лот вставлен — проверьте поля перед сохранением');
    });
    form.prepend(b);
  }

  // Клик по номеру заказа (#ABCD1234) копирует его
  function addOrderCopyButtons() {
    document.querySelectorAll('.tc-order, .order-id, h1.page-header').forEach((el) => {
      if (el.dataset.fpp) return;
      const m = el.textContent.match(/#([A-Z0-9]{6,10})/);
      if (!m) return;
      el.dataset.fpp = 1;
      const b = Object.assign(document.createElement('button'), { className: 'fpp-btn', textContent: '⧉', title: 'Копировать номер заказа' });
      b.style.marginLeft = '6px';
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(m[1]); toast('Скопировано: #' + m[1]); };
      el.append(b);
    });
  }

  // Личные заметки о собеседнике (хранятся локально, видны только вам)
  // + кнопка чёрного списка рядом с заметкой
  function addBuyerNotes() {
    // Только шапка открытого диалога, не список контактов
    const header = document.querySelector('.chat-header .media-user-name');
    const existing = document.querySelector('.fpp-note-wrap');
    // Диалог не выбран: заметка не нужна
    if (!header || header.closest('.chat-not-selected')) { existing?.remove(); return; }
    const name = header.textContent.trim();
    if (!name) return;
    if (existing && existing.dataset.user === name) { syncBlState(existing); return; }
    existing?.remove();

    const wrap = document.createElement('div');
    wrap.className = 'fpp-note-wrap';
    wrap.dataset.user = name;
    wrap.innerHTML = `
      <div class="fpp-bl-banner" role="alert">⚠ Этот пользователь в вашем чёрном списке</div>
      <div class="fpp-note-row">
        <textarea class="fpp-note" aria-label="Заметка о собеседнике"></textarea>
        <button type="button" class="fpp-btn fpp-bl-btn"></button>
      </div>`;
    const ta = wrap.querySelector('textarea');
    ta.placeholder = `Заметка о ${name} (видна только вам)`;
    const key = 'note:' + name;
    chrome.storage.local.get({ [key]: '' }, (v) => { ta.value = v[key]; });
    ta.addEventListener('input', debounce(() => chrome.storage.local.set({ [key]: ta.value }), 300));
    wrap.querySelector('.fpp-bl-btn').onclick = () => {
      setBlacklisted(name, !(S.blacklist || {})[name]);
      syncBlState(wrap); markBlacklisted();
    };
    syncBlState(wrap);
    (header.closest('.chat-header') || header.parentElement).after(wrap);
  }

  function syncBlState(wrap) {
    const on = !!(S.blacklist || {})[wrap.dataset.user];
    wrap.classList.toggle('fpp-bl', on);
    const b = wrap.querySelector('.fpp-bl-btn');
    b.textContent = on ? '✓ Убрать из ЧС' : '🚫 В ЧС';
    b.title = on ? 'Убрать из чёрного списка' : 'Добавить в чёрный список';
  }

  /* ---------- Чёрный список ---------- */
  function setBlacklisted(name, on) {
    const bl = { ...(S.blacklist || {}) };
    if (on) bl[name] = Date.now(); else delete bl[name];
    S.blacklist = bl;
    chrome.storage.local.set({ blacklist: bl });
  }

  function markBlacklisted() {
    const bl = S.blacklist || {};
    document.querySelectorAll('.contact-item').forEach((el) => {
      const n = el.querySelector('.media-user-name')?.textContent.trim();
      el.classList.toggle('fpp-bl-contact', !!(n && bl[n]));
    });
  }

  // Цвет строки заказа по статусу: «Оплачен» ждёт действий, «Возврат» — деньги вернули.
  // Смотрим текст, а не классы FunPay, чтобы не зависеть от их вёрстки
  function markOrderStatus() {
    document.querySelectorAll('.tc-item').forEach((el) => {
      const t = (el.querySelector('.tc-status')?.textContent || '').trim().toLowerCase();
      el.classList.toggle('fpp-order-paid', t.startsWith('оплач'));
      el.classList.toggle('fpp-order-refund', t.startsWith('возврат'));
    });
  }

  // Подсветка непрочитанных диалогов и счётчик в заголовке вкладки
  function highlightUnread() {
    const unread = { length: unreadCount() };
    document.querySelectorAll('.contact-item').forEach((el) => el.classList.toggle('fpp-unread-glow', el.classList.contains('unread')));
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    const t = unread.length ? `(${unread.length}) ${base}` : base;
    if (document.title !== t) document.title = t;
    notifySound(unread.length);
  }

  /* ---------- Экспорт и импорт лотов ---------- */
  // Лот = все поля формы редактирования. Экспорт: открываем форму каждого лота в фоне.
  // Импорт: открываем форму нового лота в нужном разделе, подставляем поля и сохраняем
  const LOT_SKIP = new Set(['csrf_token', 'offer_id', 'location', 'deleted']);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  async function loadOfferForm(url) {
    const html = await (await fetch(url, { credentials: 'include' })).text();
    const form = new DOMParser().parseFromString(html, 'text/html').querySelector('form.form-offer-editor');
    if (!form) throw new Error('форма не найдена');
    return form;
  }

  async function readLot(url) {
    const lot = {};
    for (const [k, v] of new FormData(await loadOfferForm(url))) {
      if (LOT_SKIP.has(k) || typeof v !== 'string') continue;
      if (k in lot) lot[k] = [].concat(lot[k], v); else lot[k] = v;
    }
    if (!lot.node_id) throw new Error('нет раздела');
    return lot;
  }

  async function createLot(lot) {
    const form = await loadOfferForm(`${location.origin}/lots/offerEdit?node=${encodeURIComponent(lot.node_id)}`);
    const fd = new FormData(form);
    // Галочки, которых нет в файле, снимаем: в файл попадают только отмеченные
    form.querySelectorAll('input[type="checkbox"][name]').forEach((cb) => { if (!(cb.name in lot)) fd.delete(cb.name); });
    for (const [k, v] of Object.entries(lot)) {
      if (LOT_SKIP.has(k) || k === 'node_id') continue;
      fd.delete(k);
      [].concat(v).forEach((x) => fd.append(k, x));
    }
    fd.set('offer_id', '0');
    fd.set('location', 'trade');
    const action = new URL(form.getAttribute('action') || '/lots/offerSave', location.origin);
    const r = await fetch(action, {
      method: 'POST', credentials: 'include', body: new URLSearchParams(fd),
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error((j.errors && Object.values(j.errors).flat().join('; ')) || j.msg || j.error || 'HTTP ' + r.status);
  }

  function downloadBlob(blob, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // В Excel каждое поле — колонка. Несколько значений одного поля (name[]) — через перевод строки
  function lotsToTable(lots) {
    const cols = ['node_id'];
    lots.forEach((l) => Object.keys(l).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
    return [cols, ...lots.map((l) => cols.map((k) => [].concat(l[k] ?? '').join('\n')))];
  }

  function tableToLots(rows) {
    const [head, ...body] = rows;
    if (!head?.includes('node_id')) throw new Error('в первой строке нет колонки node_id');
    return body.map((r) => {
      const lot = {};
      head.forEach((k, i) => {
        const v = r[i] ?? '';
        if (!k || v === '') return;
        lot[k] = k.endsWith('[]') ? v.split('\n') : v;
      });
      return lot;
    }).filter((l) => l.node_id);
  }

  /* --- Минимальный .xlsx: zip без сжатия на запись, deflate-raw браузера на чтение --- */
  const CRC_T = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b) => { let c = -1; for (const x of b) c = CRC_T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], dir = [];
    let off = 0;
    for (const [name, text] of files) {
      const n = enc.encode(name), d = enc.encode(text), crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true);
      h.setUint16(26, n.length, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true);
      c.setUint16(28, n.length, true); c.setUint32(42, off, true);
      parts.push(h, n, d); dir.push(c, n);
      off += 30 + n.length + d.length;
    }
    const size = dir.reduce((s, p) => s + p.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...dir, e], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function unzip(buf) {
    const v = new DataView(buf), out = {};
    let e = buf.byteLength - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('это не .xlsx');
    let p = v.getUint32(e + 16, true);
    const dec = new TextDecoder();
    for (let i = v.getUint16(e + 10, true); i > 0; i--) {
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
      const lo = v.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
      const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
      const raw = new Uint8Array(buf, start, csize);
      out[name] = method === 0 ? raw
        : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

  function buildXlsx(rows) {
    const sheet = rows.map((r, y) => `<row r="${y + 1}">` + r.map((v, x) =>
      `<c r="${colName(x)}${y + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join('') + '</row>').join('');
    const NS = 'http://schemas.openxmlformats.org';
    return zipStore([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${NS}/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}/spreadsheetml/2006/main" ` +
        `xmlns:r="${NS}/officeDocument/2006/relationships"><sheets><sheet name="Лоты" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
      ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}/spreadsheetml/2006/main">` +
        `<sheetData>${sheet}</sheetData></worksheet>`]
    ]);
  }

  async function parseXlsx(buf) {
    const files = await unzip(buf), dec = new TextDecoder();
    const xml = (name) => files[name] && new DOMParser().parseFromString(dec.decode(files[name]), 'application/xml');
    const text = (el) => [...el.getElementsByTagName('t')].map((t) => t.textContent).join('');
    const shared = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') || [])].map(text);
    const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if (!sheetName) throw new Error('в файле нет листа');
    const rows = [];
    for (const row of xml(sheetName).getElementsByTagName('row')) {
      const r = [];
      for (const c of row.getElementsByTagName('c')) {
        const ref = (c.getAttribute('r') || '').replace(/\d+/g, '');
        const x = ref ? [...ref].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1 : r.length;
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        r[x] = t === 's' ? shared[+v] ?? '' : t === 'inlineStr' ? text(c) : v;
      }
      rows[+row.getAttribute('r') - 1 || rows.length] = r;
    }
    return rows.filter(Boolean);
  }

  function addLotsExportImport() {
    const m = location.pathname.match(/^\/users\/(\d+)/);
    if (!m || !ME.id || String(ME.id) !== m[1] || document.getElementById('fpp-lots-io')) return;
    const anchor = document.getElementById('fpp-mass-all') || document.querySelector('.offer');
    if (!anchor) return;

    const box = document.createElement('div');
    box.id = 'fpp-lots-io'; box.className = 'fpp-mass';
    box.innerHTML = `
      <button type="button" class="fpp-btn fpp-mass-btn" data-act="export">📤 Экспорт лотов</button>
      <select class="fpp-lots-fmt" aria-label="Формат файла">
        <option value="xlsx">Excel (.xlsx)</option><option value="json">JSON</option>
      </select>
      <button type="button" class="fpp-btn fpp-mass-btn" data-act="import">📥 Импорт лотов</button>
      <input type="file" accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>`;
    anchor.before(box);
    const [exp, fmt, imp, file] = box.querySelectorAll('button, select, input');

    exp.onclick = async () => {
      const urls = [...new Set([...document.querySelectorAll('.offer a.tc-item')].map(offerEditUrl).filter(Boolean))];
      if (!urls.length) return toast('Лоты не найдены');
      exp.disabled = true;
      const lots = []; let fail = 0;
      for (const [i, url] of urls.entries()) {
        exp.textContent = `${i + 1}/${urls.length}…`;
        try { lots.push(await readLot(url)); } catch { fail++; }
        await pause(400);
      }
      exp.disabled = false; exp.textContent = '📤 Экспорт лотов';
      if (!lots.length) return toast('Не удалось прочитать лоты');
      const name = `funpay-lots-${new Date().toISOString().slice(0, 10)}`;
      if (fmt.value === 'json') {
        downloadBlob(new Blob([JSON.stringify({ app: 'funpay-plus', type: 'lots', version: 1, lots }, null, 2)], { type: 'application/json' }), name + '.json');
      } else downloadBlob(buildXlsx(lotsToTable(lots)), name + '.xlsx');
      toast(`Сохранено лотов: ${lots.length}${fail ? `, ошибок: ${fail}` : ''}`);
    };

    imp.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      let lots;
      try {
        if (/\.xlsx$/i.test(f.name)) lots = tableToLots(await parseXlsx(await f.arrayBuffer()));
        else {
          const data = JSON.parse(await f.text());
          lots = Array.isArray(data) ? data : data.lots;
        }
        if (!Array.isArray(lots)) throw new Error('нет списка лотов');
        lots = lots.filter((l) => l && l.node_id);
      } catch (e) { return toast('Не удалось прочитать файл: ' + e.message); }
      if (!lots.length) return toast('В файле нет лотов');
      if (!confirm(`Создать новых лотов: ${lots.length}?`)) return;
      imp.disabled = true;
      let ok = 0; const errs = [];
      for (const [i, lot] of lots.entries()) {
        imp.textContent = `${i + 1}/${lots.length}…`;
        try { await createLot(lot); ok++; } catch (e) { errs.push(`#${i + 1}: ${e.message}`); }
        await pause(800);
      }
      imp.disabled = false; imp.textContent = '📥 Импорт лотов';
      if (errs.length) console.warn('[FunPay Plus] ошибки импорта лотов:\n' + errs.join('\n'));
      toast(`Создано лотов: ${ok}${errs.length ? `, ошибок: ${errs.length} (подробности в консоли)` : ''}`);
      if (ok) setTimeout(() => location.reload(), 1800);
    };
  }

  /* ---------- Панель эмодзи в чате ---------- */
  const EMOJI = {
    '😀': '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😴 😷 🤒 🥵 🥶 😵 🤯 🥳 😎 🤓 😕 😟 🙁 😮 😲 😳 🥺 😢 😭 😱 😤 😡 🤬 💀 🤡 👻 👽 🤖',
    '👍': '👍 👎 👌 ✌️ 🤞 🤝 🙏 👏 🙌 👋 🤙 💪 👀 👉 👈 👆 👇 ✋ 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 🔥 ✨ ⭐ 🌟 💥 💤',
    '🎮': '🎮 🕹️ 🎯 🏆 🥇 🎁 🎉 🎊 💎 💰 💵 💳 🪙 🛒 📦 🚀 ⚡ 🔑 🔒 🔓 ⏳ ⌛ ⏰ 📩 📌 ✅ ❌ ❗ ❓ ⚠️ 🆗 🆕 ➡️ ⬅️ 🔁'
  };

  // Клик мимо панели закрывает её. Обработчик один на страницу: формы чата FunPay пересоздаёт,
  // и свой обработчик на document у каждой панели копился бы вместе со старыми формами
  document.addEventListener('pointerdown', (e) => {
    document.querySelectorAll('.fpp-emoji').forEach((w) => { if (!w.contains(e.target)) w._open?.(false); });
  });

  function insertAtCaret(ta, text) {
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    ta.focus();
    ta.setRangeText(text, s, e, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function addEmojiPanel() {
    if (!S.emojiPanel) return;
    document.querySelectorAll('textarea[name="content"], .chat-form textarea').forEach((ta) => {
      const parent = ta.closest('form') || ta.parentElement;
      if (parent.querySelector('.fpp-emoji')) return;
      // В чате — круглая кнопка слева от кнопки отправки, в остальных формах — над полем ввода
      const sendBox = parent.querySelector('.chat-form-btn');
      const wrap = document.createElement('div');
      wrap.className = sendBox ? 'fpp-emoji fpp-emoji-chat' : 'fpp-emoji';
      wrap.innerHTML = `
        ${sendBox
          ? '<button type="button" class="btn btn-gray btn-round fpp-emoji-toggle" aria-expanded="false" aria-label="Эмодзи" title="Эмодзи">😊</button>'
          : '<button type="button" class="fpp-btn fpp-emoji-toggle" aria-expanded="false" title="Эмодзи">😊 Эмодзи</button>'}
        <div class="fpp-emoji-pop" role="dialog" aria-label="Эмодзи" hidden>
          <div class="fpp-emoji-tabs">${Object.keys(EMOJI).map((k, i) =>
            `<button type="button" class="fpp-emoji-tab${i ? '' : ' active'}" data-k="${k}">${k}</button>`).join('')}</div>
          <div class="fpp-emoji-grid"></div>
        </div>`;
      const toggle = wrap.querySelector('.fpp-emoji-toggle'), pop = wrap.querySelector('.fpp-emoji-pop');
      const grid = wrap.querySelector('.fpp-emoji-grid');
      const show = (k) => {
        grid.innerHTML = EMOJI[k].split(' ').map((em) => `<button type="button" class="fpp-emoji-item">${em}</button>`).join('');
        wrap.querySelectorAll('.fpp-emoji-tab').forEach((t) => t.classList.toggle('active', t.dataset.k === k));
      };
      show(Object.keys(EMOJI)[0]);
      const open = wrap._open = (on) => { pop.hidden = !on; toggle.setAttribute('aria-expanded', on); };
      // mousedown не забирает фокус у поля ввода, чтобы курсор оставался на месте
      wrap.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
      toggle.onclick = () => open(pop.hidden);
      wrap.querySelector('.fpp-emoji-tabs').onclick = (e) => { const t = e.target.closest('.fpp-emoji-tab'); if (t) show(t.dataset.k); };
      grid.onclick = (e) => { const b = e.target.closest('.fpp-emoji-item'); if (b) insertAtCaret(ta, b.textContent); };
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { open(false); ta.focus(); } });
      if (sendBox) sendBox.before(wrap); else ta.before(wrap);
    });
  }
})();
