'use strict';
// Tiny DOM helpers shared by the renderer windows. Everything user-/OCR-derived goes through
// text nodes (never innerHTML), so captured text can't inject markup.

const ui = (() => {
  const ICONS = {
    speaker: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    pin: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    cards: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 10h8"/><path d="M8 14h5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  };

  /** Static, trusted SVG strings only. */
  function icon(name, size = 16) {
    const wrap = document.createElement('span');
    wrap.style.display = 'contents';
    wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    return wrap.firstChild;
  }

  /** h('div.card#id', { onclick }, child, 'text', [more]) */
  function h(spec, props, ...children) {
    const [, tag = 'div', rest = ''] = /^([a-z0-9]*)(.*)$/i.exec(spec);
    const node = document.createElement(tag || 'div');
    for (const m of rest.matchAll(/([.#])([^.#]+)/g)) {
      if (m[1] === '.') node.classList.add(m[2]); else node.id = m[2];
    }
    if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k in node && k !== 'list') node[k] = v;
        else node.setAttribute(k, v === true ? '' : v);
      }
    } else if (props != null) {
      children.unshift(props);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return node;
  }

  /** Like el.replaceChildren(...), but skips null/false/undefined instead of rendering them as text. */
  function replace(el, ...children) {
    el.replaceChildren();
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add); else el.append(c);
    };
    children.forEach(add);
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** `sentence` as a fragment with `term` (and simple inflections of it) wrapped in <mark>. */
  function highlight(sentence, term) {
    const frag = document.createDocumentFragment();
    const base = escapeRe(term.trim()).replace(/\s+/g, '\\s+');
    const stem = escapeRe(term.trim().replace(/(e|y)$/i, ''));
    for (const re of [`${base}[a-z]*`, term.length > 3 ? `${stem}[a-z]*` : null]) {
      if (!re) continue;
      const m = new RegExp(`(^|[^A-Za-z])(${re})`, 'i').exec(sentence);
      if (m) {
        const start = m.index + m[1].length;
        frag.append(sentence.slice(0, start), h('mark', m[2]), sentence.slice(start + m[2].length));
        return frag;
      }
    }
    frag.append(sentence);
    return frag;
  }

  /** Browser voices; on Windows these are often Chinese-only, so this is only the fallback. */
  function speakInPage(text) {
    const synth = window.speechSynthesis;
    if (!synth) return false;
    const voices = synth.getVoices();
    const voice = voices.find((v) => /^en[-_]US/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang));
    // Voices load asynchronously on some browsers (Android Chrome): with an empty list, just ask for
    // lang en-US and let the engine choose. A non-empty list without an English voice is a real "no".
    if (!voice && voices.length) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (voice) u.voice = voice;
    u.rate = 0.95;
    synth.speak(u);
    return true;
  }

  /** Read English aloud: the main process's system voice first, the page's own voices second. */
  async function speak(text) {
    let ok = false;
    try { ok = (await window.gloss.speak(text)).ok; } catch { /* fall through */ }
    if (!ok) ok = speakInPage(text);
    if (!ok) toast('没有可用的英文语音（可在 Windows 设置 → 时间和语言 → 语音 中添加）');
    return ok;
  }
  if (window.speechSynthesis) window.speechSynthesis.getVoices(); // kick off async voice loading

  function timeAgo(ts, now = Date.now()) {
    const s = Math.max(0, (now - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  function duration(ms) {
    const min = ms / 60000;
    if (min < 60) return `${Math.max(1, Math.round(min))} 分钟`;
    const days = ms / 86400000;
    if (days < 1) return '半天';
    return `${Math.round(days)} 天`;
  }

  let toastTimer;
  function toast(message) {
    let el = document.querySelector('.toast');
    if (!el) { el = h('div.toast', { role: 'status' }); document.body.append(el); }
    el.textContent = message;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  return { icon, h, replace, highlight, speak, timeAgo, duration, toast };
})();
