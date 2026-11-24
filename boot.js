'use strict';
// Web/PWA bootstrap: open the local database, then start the (shared) app, then register the service worker.
(async () => {
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`无法加载 ${src}`));
    document.body.append(s);
  });

  try {
    const { persistent } = await GlossWeb.init();
    window.glossStorageOk = persistent;
    await loadScript('main/app.js');
  } catch (err) {
    document.getElementById('content').textContent = `启动失败：${err.message}`;
    return;
  }

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // A new version took over: reload once so the page and its scripts match.
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  }
})();
