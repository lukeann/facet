'use strict';
// Word / phrase lookup panel shared by the translation popup and the article reader (and, later, the web app).
// Given a selection (start/end offsets into `text`), it shows the translation, dictionary entry and the
// sentence the word came from, and lets the user save it (with that sentence as context) or mark it as known.
// All text goes through text nodes (ui.h), never innerHTML.

const Lookup = (() => {
  const { h, replace, icon, highlight, speak, toast } = ui;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * @param {object} o
   * @param {HTMLElement} o.panel            element the panel renders into (hidden while nothing is selected)
   * @param {string} o.text                  the full text the offsets refer to
   * @param {{text:string,start:number,end:number}[]} o.sentences
   * @param {() => Promise<{ok:boolean,data?:{text:string}}>} [o.fullTranslation]  reused when the sentence is the whole text
   * @param {string} [o.articleId]           stored with the saved context so the word links back to its article
   * @param {boolean} [o.allowKnown]         show "I know this word"
   * @param {boolean} [o.closable]           show a close button
   * @param {() => void} [o.onChange]        called after a word is saved / removed / marked known
   * @param {() => void} [o.onClear]
   * @param {(articleId: string) => void} [o.onOpenArticle]  makes "seen before in <article>" a link
   */
  function create(o) {
    let sel = null;
    let alive = true;

    // article id -> title, for "seen before in <article>" links (fetched once, on first use)
    let titles = null;
    const getTitles = async () => {
      if (!titles) titles = new Map((await gloss.article.list()).map((a) => [a.id, a.title]));
      return titles;
    };

    const current = () => sel;
    function clear() {
      sel = null;
      render();
      if (o.onClear) o.onClear();
    }

    function choose(start, end) {
      const text = o.text.slice(start, end);
      const sentence = (o.sentences.find((x) => start >= x.start && start < x.end) || { text: o.text }).text;
      const single = !/\s/.test(text);
      const mine = {
        text, start, end, sentence, single,
        hasContext: sentence.trim().toLowerCase() !== text.trim().toLowerCase(),
        translation: undefined, dict: single ? undefined : null, ctxTranslation: undefined, saved: null,
      };
      sel = mine;
      render();
      const refresh = () => { if (alive && sel === mine) render(); };

      gloss.translate(text).then((r) => { mine.translation = r.ok ? r.data.text : null; mine.tError = r.ok ? '' : r.error; refresh(); });
      if (single) mine.dictPromise = gloss.lookup(text).then((r) => { mine.dict = r.ok ? r.data : null; refresh(); });
      if (mine.hasContext) {
        const full = sentence.trim() === o.text.trim() && o.fullTranslation;
        mine.ctxPromise = (full ? o.fullTranslation() : gloss.translate(sentence)).then((r) => {
          mine.ctxTranslation = r.ok ? r.data.text : null; refresh();
        });
      } else mine.ctxTranslation = null;

      // Have I met this word before? Show the other sentences it was saved from.
      gloss.vocab.find(text).then(async (entry) => {
        mine.existing = entry || null;
        mine.seen = [];
        if (entry) {
          const t = await getTitles();
          mine.seen = (entry.contexts || []).filter((c) => c.sentence !== sentence).slice(0, 3)
            .map((c) => ({ ...c, title: c.articleId ? t.get(c.articleId) : null }));
          mine.exact = entry.key === GlossText.normalizeKey(text);
          mine.alreadyHere = mine.exact && entry.contexts.some((c) => c.sentence === sentence);
        }
        refresh();
      }).catch(() => {});
      return mine;
    }

    function render() {
      o.panel.hidden = !sel;
      if (!sel) return;
      const s = sel;
      const head = h('div.p-head',
        h('span.p-word', s.text),
        s.dict && s.dict.phonetic && h('span.p-phon', s.dict.phonetic),
        h('button.icon-btn', { title: '朗读', onclick: () => speak(s.text) }, icon('speaker', 16)),
        o.closable && h('span.spacer'),
        o.closable && h('button.icon-btn', { title: '关闭', onclick: clear }, icon('x', 16)));

      const trans = s.translation === undefined ? h('div.skeletons', h('i.skeleton'))
        : s.translation === null ? h('div.err', s.tError || '翻译失败')
          : h('div.p-trans', s.translation);

      let defs = null;
      if (s.single && s.dict === undefined) defs = h('div.skeletons', { style: { marginTop: '8px' } }, h('i.skeleton'));
      else if (s.dict && s.dict.meanings.length) {
        defs = h('ul.defs', s.dict.meanings.map((m) => h('li', h('span.pos', m.pos), m.definition)));
      }

      let ctx = null;
      if (s.hasContext) {
        ctx = h('div.ctx',
          h('div.ctx-label', '语境'),
          h('div.ctx-s', highlight(s.sentence, s.text)),
          s.ctxTranslation === undefined ? h('div.skeletons', { style: { marginTop: '6px' } }, h('i.skeleton'))
            : s.ctxTranslation ? h('div.ctx-t', s.ctxTranslation) : null);
      }
      let seen = null;
      if (s.seen && s.seen.length) {
        seen = h('div.seen',
          h('div.ctx-label', `你之前见过它（共 ${s.existing.contexts.length} 处）`),
          s.seen.map((c) => h('div.seen-item',
            h('div.ctx-s', highlight(c.sentence, s.existing.text)),
            c.translation && h('div.ctx-t', c.translation),
            c.title && (o.onOpenArticle
              ? h('a.src', { onclick: () => o.onOpenArticle(c.articleId) }, `来自《${c.title}》`)
              : h('span.muted', `来自《${c.title}》`)))));
      }
      replace(o.panel, head, trans, defs, ctx, seen, footer(s));
    }

    function footer(s) {
      if (s.saving) return h('div.foot', h('span.spacer'), h('button.btn.primary', { disabled: true }, '保存中…'));
      if (s.known) return h('div.foot', h('span.state', icon('check', 16), '已标记为认识'), h('span.spacer'));
      if (s.saved) {
        const { created, id } = s.saved;
        return h('div.foot',
          h('span.state', icon('check', 16), created ? '已保存到生词本' : '已在生词本中，已补充语境'),
          created
            ? h('button.btn.ghost.sm', { onclick: async () => { await gloss.vocab.remove(id); s.saved = null; render(); if (o.onChange) o.onChange(); } }, '撤销')
            : (o.onOpenLibrary ? h('button.btn.ghost.sm', { onclick: o.onOpenLibrary }, '查看') : null));
      }
      // Already in the word list and this very sentence is saved: nothing left to do.
      if (s.alreadyHere) return h('div.foot', h('span.state', icon('check', 16), '已在生词本中'), h('span.spacer'));
      return h('div.foot',
        o.allowKnown && s.single && !s.existing ? h('button.btn.ghost.sm', { title: '不用学，以后不再标记它', onclick: () => markKnown(s) }, '我认识') : null,
        h('span.spacer'),
        h('button.btn.primary', { disabled: s.translation === undefined, onclick: () => save(s) },
          s.exact && s.hasContext ? '补充这条语境' : '保存到生词本'));
    }

    async function markKnown(s) {
      const r = await gloss.vocab.markKnown([s.text]);
      if (!r.ok) { toast(r.error); return; }
      s.known = true;
      if (alive && sel === s) render();
      if (o.onChange) o.onChange();
    }

    async function save(s) {
      if (sel !== s || s.saving || s.saved) return;
      s.saving = true; render();
      // Give the dictionary / context translation a moment to arrive so they are saved too.
      await Promise.race([Promise.allSettled([s.dictPromise, s.ctxPromise]), sleep(2500)]);
      const r = await gloss.vocab.save({
        text: s.text,
        translation: s.translation || '',
        phonetic: (s.dict && s.dict.phonetic) || '',
        meanings: (s.dict && s.dict.meanings) || [],
        context: s.hasContext ? { sentence: s.sentence, translation: s.ctxTranslation || '', articleId: o.articleId } : undefined,
      });
      s.saving = false;
      if (r.ok) s.saved = { id: r.data.entry.id, created: r.data.created };
      else toast(r.error);
      if (alive && sel === s) render();
      if (r.ok && o.onChange) o.onChange();
    }

    return {
      choose, clear, current,
      /** Enter-key shortcut: save the current selection if it can be saved. */
      saveCurrent() { if (sel && !sel.saved && !sel.known && sel.translation !== undefined) save(sel); },
      destroy() { alive = false; },
    };
  }

  /**
   * Turn a mouseup (or the current text selection) over word spans into [start, end) offsets,
   * snapped to whole words. Returns null when nothing word-like was picked.
   */
  function offsetsFromEvent(e, spans) {
    let first = null, last = null;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      for (const sp of spans) if (range.intersectsNode(sp)) { first = first || sp; last = sp; }
    } else {
      const sp = e.target.closest && e.target.closest('.w');
      if (sp) first = last = sp;
    }
    if (!first) return null;
    if (selection) selection.removeAllRanges();
    return { start: Number(first.dataset.s), end: Number(last.dataset.e) };
  }

  return { create, offsetsFromEvent };
})();
