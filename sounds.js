// Звуки уведомлений: синтезируются через Web Audio, файлы не нужны.
// Подключается и в content script, и в popup.
var FPP_SOUNDS = (() => {
  let ctx;
  const ac = () => (ctx ||= new (self.AudioContext || self.webkitAudioContext)());

  // Одна нота: частота, начало, длительность, тип волны, громкость
  function tone(f, start, dur, type = 'sine', vol = 0.25) {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f;
    const t = c.currentTime + start;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const presets = {
    chime: () => { tone(880, 0, 0.5); tone(1320, 0.12, 0.6); },
    pop:   () => { tone(600, 0, 0.12, 'triangle', 0.35); tone(900, 0.05, 0.1, 'triangle', 0.2); },
    bell:  () => { tone(1046, 0, 1.2, 'sine', 0.2); tone(2093, 0, 0.8, 'sine', 0.08); },
    coin:  () => { tone(988, 0, 0.08, 'square', 0.12); tone(1319, 0.08, 0.35, 'square', 0.12); },
    soft:  () => { tone(523, 0, 0.35, 'sine', 0.18); tone(659, 0.15, 0.35, 'sine', 0.18); tone(784, 0.3, 0.5, 'sine', 0.18); }
  };

  // name: ключ пресета или 'custom' (тогда нужен dataURL), volume 0..1
  function play(name, volume = 0.8, customUrl) {
    if (name === 'custom') {
      if (!customUrl) return;
      const a = new Audio(customUrl);
      a.volume = volume;
      a.play().catch(() => {});
      return;
    }
    const fn = presets[name];
    if (!fn) return;
    const c = ac();
    if (c.state === 'suspended') c.resume();
    // Громкость: временно подменяем мастер через gain в tone() нельзя, поэтому масштабируем
    const orig = tone;
    tone = (f, s, d, t, v = 0.25) => orig(f, s, d, t, v * volume);
    try { fn(); } finally { tone = orig; }
  }

  // Голос кошечки: пила через два полосовых фильтра (форманты «н» → «я»)
  function voice({ dur, p1, p2, p3, volume }) {
    const c = ac();
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime;
    const o = c.createOscillator(), lfo = c.createOscillator(), lfoGain = c.createGain();
    const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
    const g2 = c.createGain(), env = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(p1, t);
    o.frequency.linearRampToValueAtTime(p2, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(p3, t + dur);
    // Лёгкое вибрато, чтобы звучало живее
    lfo.frequency.value = 7; lfoGain.gain.value = p2 * 0.02;
    lfo.connect(lfoGain).connect(o.frequency);
    // Первый формант: закрытый «н» раскрывается в «а»
    f1.type = 'bandpass'; f1.Q.value = 5;
    f1.frequency.setValueAtTime(400, t);
    f1.frequency.linearRampToValueAtTime(950, t + 0.09);
    // Второй формант: «я» скользит сверху вниз
    f2.type = 'bandpass'; f2.Q.value = 8;
    f2.frequency.setValueAtTime(1200, t);
    f2.frequency.linearRampToValueAtTime(2400, t + 0.08);
    f2.frequency.linearRampToValueAtTime(1500, t + dur);
    g2.gain.value = 0.7;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5 * volume, t + 0.04);
    env.gain.setValueAtTime(0.5 * volume, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(f1).connect(env);
    o.connect(f2).connect(g2).connect(env);
    env.connect(c.destination);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }

  // Мурчание: низкий гул, модулированный ~24 Гц
  function purr(volume) {
    const c = ac();
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime, dur = 1.1;
    const o = c.createOscillator(), lp = c.createBiquadFilter(), env = c.createGain();
    const am = c.createOscillator(), amGain = c.createGain(), vca = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 65;
    lp.type = 'lowpass'; lp.frequency.value = 350;
    am.type = 'sine'; am.frequency.value = 24; amGain.gain.value = 0.5;
    vca.gain.value = 0.5;
    am.connect(amGain).connect(vca.gain);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.6 * volume, t + 0.15);
    env.gain.setValueAtTime(0.6 * volume, t + dur - 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(vca).connect(env).connect(c.destination);
    o.start(t); am.start(t); o.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
  }

  // kind: nya | nyaa | mew | purr
  function nya(kind = 'nya', volume = 0.8) {
    const r = 0.92 + Math.random() * 0.16; // каждый раз чуть разный голос
    if (kind === 'purr') return purr(volume);
    if (kind === 'nyaa') return voice({ dur: 0.75, p1: 560 * r, p2: 820 * r, p3: 600 * r, volume });
    if (kind === 'mew') return voice({ dur: 0.28, p1: 900 * r, p2: 1150 * r, p3: 980 * r, volume: volume * 0.8 });
    return voice({ dur: 0.36, p1: 540 * r, p2: 780 * r, p3: 640 * r, volume });
  }

  // Браузер блокирует звук до первого действия пользователя — «размораживаем» контекст
  function unlock() { try { ac().resume(); } catch (e) {} }

  return { play, unlock, nya, names: Object.keys(presets) };
})();
