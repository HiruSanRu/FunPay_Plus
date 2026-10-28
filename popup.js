const $ = (id) => document.getElementById(id);
const DEF = {
  dark: true, wallpaper: 'aurora', wallOpacity: 0.9, autoRaise: false, templates: [],
  sound: 'site', soundVolume: 0.8, palette: FPP_PALETTE.DEF, paletteA: '', paletteB: ''
};

const save = (obj) => chrome.storage.sync.set(obj);
const showCustom = () => { $('customFile').style.display = $('sound').value === 'custom' ? 'block' : 'none'; };

// Палитра: образцы как на странице расширения, popup перекрашивается сразу
let pal = { palette: DEF.palette, paletteA: '', paletteB: '' };
$('palList').innerHTML = FPP_PALETTE.swatchesHtml();
const markPalette = FPP_PALETTE.radios($('palList'), (id) => save(FPP_PALETTE.choose(pal, id)));
const showPalette = () => { FPP_PALETTE.apply(document.documentElement, pal); markPalette(pal); };
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'sync' || !(c.palette || c.paletteA || c.paletteB)) return;
  for (const k of ['palette', 'paletteA', 'paletteB']) if (c[k]) pal[k] = c[k].newValue;
  showPalette();
});

chrome.storage.sync.get(DEF, (s) => {
  pal = { palette: s.palette, paletteA: s.paletteA, paletteB: s.paletteB };
  showPalette();
  $('dark').checked = s.dark;
  $('wallpaper').value = s.wallpaper;
  $('wallOpacity').value = s.wallOpacity;
  $('autoRaise').checked = s.autoRaise;
  $('templates').value = s.templates.join('\n');
  $('sound').value = s.sound;
  $('soundVolume').value = s.soundVolume;
  showCustom();
});
chrome.storage.local.get({ customSoundName: '' }, (v) => { $('customName').textContent = v.customSoundName; });

$('dark').onchange = (e) => save({ dark: e.target.checked });
$('wallpaper').onchange = (e) => save({ wallpaper: e.target.value });
// У sync лимит записей в минуту: пока ползунок тянут, пишем с задержкой, при отпускании — сразу
let opT;
$('wallOpacity').oninput = (e) => { clearTimeout(opT); opT = setTimeout(() => save({ wallOpacity: +e.target.value }), 150); };
$('wallOpacity').onchange = (e) => { clearTimeout(opT); save({ wallOpacity: +e.target.value }); };
$('autoRaise').onchange = (e) => save({ autoRaise: e.target.checked });
$('openPage').onclick = () => chrome.tabs.create({ url: 'https://funpay.com/#funpay-plus' });
$('sound').onchange = (e) => { save({ sound: e.target.value }); showCustom(); };
$('soundVolume').onchange = (e) => save({ soundVolume: +e.target.value });

// Свой звук хранится в local (в sync есть лимит 8 КБ на ключ)
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

let t;
$('templates').oninput = (e) => {
  clearTimeout(t);
  t = setTimeout(() => save({ templates: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }), 400);
};
