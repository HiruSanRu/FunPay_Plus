// Выполняется в контексте страницы (world: MAIN).
// Глушит стандартные звуки FunPay, если в настройках включено «Свой звук».
// Флаг ставит content script: <html data-fpp-mute="1">.
// Удачное воспроизведение отмечаем в data-fpp-site-played, чтобы content script знал, нужен ли запасной звук.
(() => {
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const root = document.documentElement;
    if (root.dataset.fppMute === '1') return Promise.resolve();
    const p = orig.apply(this, args);
    p?.then?.(() => { root.dataset.fppSitePlayed = String(Date.now()); }, () => {});
    return p;
  };
})();
