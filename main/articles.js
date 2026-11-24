'use strict';
// Article library + reader (main window). Loaded before app.js; app.js calls Articles.* and provides go().

const Articles = (() => {
  const { h, replace, icon, timeAgo, toast } = ui;
  const T = GlossText; // tokenizer / sentence splitter shared with the main process (src/core/text.js)
  const contentEl = () => document.getElementById('content');

  /** Two-click delete: first click arms the button, second confirms. */
  function armDelete(btn, onConfirm) {
    let timer = null;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (timer) { clearTimeout(timer); timer = null; onConfirm(); return; }
      replace(btn, '确认?');
      btn.style.cssText = 'width:auto;padding:0 8px;color:var(--danger);font-size:12px';
      timer = setTimeout(() => { timer = null; replace(btn, icon('trash', 15)); btn.style.cssText = ''; }, 2500);
    });
  }

  // ---- library ---------------------------------------------------------------------------------
  async function libraryView() {
    const list = await gloss.article.list();
    const root = h('div.view');
    const addBtn = h('button.btn.primary', { onclick: () => openAddDialog() }, icon('plus', 16), '添加文章');

    if (!list.length) {
      root.append(h('div.empty',
        h('div.ring', icon('book', 26)),
        h('h2', '文章库是空的'),
        h('p', gloss.platform === 'web'
          ? '把想读的英文文章放进来：粘贴文本，或导入 TXT 文件。在电脑上添加的文章，导出数据后到「设置」里导入即可。'
          : '把想读的英文文章放进来：粘贴文本、输入网址（也支持微信公众号文章链接），或导入 TXT 文件。翻译浮窗里也能一键把截图存为文章。'),
        addBtn));
      return root;
    }

    // How well this article fits the reader: share of its words they already know or are learning.
    const FIT_LABEL = { good: '适合', hard: '偏难', easy: '偏易' };
    const FIT_HINT = '熟悉度 = 你认识的词和学习中的词，占全文词数的比例。90–97% 读起来最舒服；太低会吃力，太高学不到新词。';
    const fitChip = (a) => {
      const f = a.fam && a.fam.familiarity;
      if (f == null) return null;
      return h('span', { className: `fit ${a.fam.fit}`, title: FIT_HINT },
        `${FIT_LABEL[a.fam.fit]} · 熟悉度 ${Math.round(f * 100)}% · 新词 ${a.fam.newWords}`);
    };
    const order = (mode) => [...list].sort(mode === 'fit'
      ? (x, y) => {
        const dx = x.fam && x.fam.familiarity != null ? Math.abs(x.fam.familiarity - 0.93) : 9;
        const dy = y.fam && y.fam.familiarity != null ? Math.abs(y.fam.familiarity - 0.93) : 9;
        return dx - dy;
      }
      : (x, y) => y.createdAt - x.createdAt);

    let mode = (() => { try { return localStorage.getItem('gloss.sort') === 'fit' ? 'fit' : 'recent'; } catch { return 'recent'; } })();
    const listEl = h('div.list');
    const sortEl = h('div.tabs');
    function paint() {
      replace(sortEl, [['recent', '最新'], ['fit', '最适合我']].map(([id, label]) => h('button', {
        className: id === mode ? 'on' : '',
        onclick: () => { mode = id; try { localStorage.setItem('gloss.sort', id); } catch { /* ignore */ } paint(); },
      }, label)));
      replace(listEl, order(mode).map((a) => {
        const del = h('button.icon-btn', { title: '删除' }, icon('trash', 15));
        armDelete(del, async () => { await gloss.article.remove(a.id); });
        return h('article.row.art-row', { onclick: () => go('reader', a.id) },
          h('div.row-top', h('span.art-title', a.title), h('span.acts', del), h('span.when', timeAgo(a.createdAt))),
          h('div.art-meta', [a.source, `${a.wordCount.toLocaleString()} 词`].filter(Boolean).join(' · '), fitChip(a)));
      }));
    }
    paint();

    // While few words are marked, every article looks hard: say why, and how to fix it.
    const mostlyUnknown = list.every((a) => !a.fam || a.fam.familiarity == null || a.fam.familiarity < 0.6);

    replace(root,
      h('header.page-head', h('div', h('h1', '文章'), h('p.sub', `共 ${list.length} 篇`)), h('div.head-actions', sortEl, addBtn)),
      mostlyUnknown ? h('p.note.tip-box', '熟悉度要靠你标记的词来算：读完一篇后点「全部标为已认识」，再点出真正的生词，数字会越来越准，“最适合我”的排序也就越有用。') : null,
      listEl);
    return root;
  }

  // ---- add dialog -----------------------------------------------------------------------------------
  function openAddDialog() {
    let mode = 'paste';
    // Fetching a URL needs the desktop app (a web page can't read other sites: browser cross-origin rules).
    const modes = [['paste', '粘贴文本'], ['url', '网址'], ['file', '文件']].filter(([id]) => !(id === 'url' && gloss.platform === 'web'));
    const message = h('p.err');
    const bodyEl = h('div.modal-body');
    const tabsEl = h('div.tabs');
    const back = h('div.modal-back', { onclick: (e) => { if (e.target === back) close(); } });
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() { window.removeEventListener('keydown', onKey); back.remove(); }
    window.addEventListener('keydown', onKey);

    /** Run an import; on success close the dialog and open the result. */
    async function run(button, work) {
      message.textContent = '';
      const label = button.textContent;
      button.disabled = true; button.textContent = '处理中…';
      const r = await work();
      button.disabled = false; button.textContent = label;
      if (!r.ok) { message.textContent = r.error; return; }
      if (r.data === null) return; // file dialog cancelled
      close();
      if (r.data.length === 1) go('reader', r.data[0].id);
      else { toast(`已添加 ${r.data.length} 个部分（长文已自动分段）`); go('articles'); }
    }

    function paint() {
      replace(tabsEl, modes.map(([id, label]) => h('button', { className: id === mode ? 'on' : '', onclick: () => { mode = id; message.textContent = ''; paint(); } }, label)));
      if (mode === 'paste') {
        const title = h('input', { placeholder: '标题（可不填）', spellcheck: false });
        const ta = h('textarea', { rows: 10, placeholder: '粘贴英文文章…', spellcheck: false });
        const go1 = h('button.btn.primary', { onclick: () => run(go1, () => gloss.article.add({ title: title.value.trim(), text: ta.value, source: '粘贴' })) }, '添加');
        replace(bodyEl, title, ta, h('div.modal-foot', go1));
        ta.focus();
      } else if (mode === 'url') {
        const url = h('input', { placeholder: 'https://…  或  https://mp.weixin.qq.com/s/…', spellcheck: false });
        const go1 = h('button.btn.primary', { onclick: () => run(go1, () => gloss.article.importUrl(url.value)) }, '抓取并添加');
        url.addEventListener('keydown', (e) => { if (e.key === 'Enter') go1.click(); });
        replace(bodyEl, url, h('p.note', '会在本机下载网页并提取正文，不经过任何第三方服务器。微信公众号文章如果要求验证，请改用粘贴。'), h('div.modal-foot', go1));
        url.focus();
      } else {
        const go1 = h('button.btn.primary', { onclick: () => run(go1, () => gloss.article.importFile()) }, icon('plus', 16), '选择 TXT / MD 文件…');
        replace(bodyEl, h('p.note', '适合古腾堡计划等来源的经典书籍。很长的书会自动按段落分成几部分，每部分约 3000 词。'), h('div.modal-foot', go1));
      }
    }
    paint();
    back.append(h('div.modal', h('h2', '添加文章'), tabsEl, bodyEl, message));
    document.body.append(back);
  }

  // ---- reader ---------------------------------------------------------------------------------------------
  async function readerView(id, setTeardown) {
    const [article, vocab, knownKeys] = await Promise.all([gloss.article.get(id), gloss.vocab.list(), gloss.vocab.known()]);
    if (!article) {
      return h('div.view', h('p.muted', '这篇文章不存在或已被删除。'),
        h('button.btn', { style: { marginTop: '12px' }, onclick: () => go('articles') }, '返回文章库'));
    }

    const tokens = T.tokenize(article.text);
    const sentences = T.splitSentences(article.text);

    // word -> 'lv1' | 'lv2' | 'lv3' (being learned, how well) | 'known' | 'new'
    // The level comes from the review schedule: the further along the forgetting curve, the lighter the colour.
    let learning = new Map();
    let known = new Set();
    const setMarks = (vocabList, keys) => {
      learning = new Map(vocabList.filter((w) => w.kind === 'word').map((w) => {
        const lv = GlossSrs.level(w.srs);
        return [w.key, lv >= 4 ? 'known' : `lv${lv}`];
      }));
      known = new Set(keys);
    };
    setMarks(vocab, knownKeys);
    const statusOf = (word) => {
      for (const c of T.wordCandidates(word)) {
        if (learning.has(c)) return learning.get(c);
        if (known.has(c)) return 'known';
      }
      return 'new';
    };

    // ---- text ----
    const body = h('div.article');
    const spans = [];
    let p = h('p');
    body.append(p);
    for (const t of tokens) {
      if (t.word) {
        const el = h('span.w', { dataset: { s: t.start, e: t.end } }, t.text);
        spans.push({ el, word: t.text });
        p.append(el);
        continue;
      }
      t.text.split(/\n{2,}/).forEach((seg, i) => {
        if (i > 0) { p = h('p'); body.append(p); }
        if (seg) p.append(seg);
      });
    }
    const spanEls = spans.map((s) => s.el);

    // ---- header / stats / finish bar ----
    const stats = h('span.chip');
    const finishBtn = h('button.btn');
    const finishText = h('span');
    const finish = h('div.finish', finishText, finishBtn);
    let unmarked = [];
    let armed = null;

    function applyMarks() {
      const seen = { new: new Set(), learning: new Set(), known: new Set() };
      let familiar = 0; // running words the reader knows or is learning
      for (const s of spans) {
        const st = statusOf(s.word);
        for (const lv of ['lv1', 'lv2', 'lv3']) s.el.classList.toggle(lv, st === lv);
        seen[st.startsWith('lv') ? 'learning' : st].add(s.word.toLowerCase());
        if (st !== 'new') familiar++;
      }
      unmarked = [...seen.new];
      const pct = spans.length ? Math.round((familiar / spans.length) * 100) : 0;
      stats.title = '熟悉度 = 你认识的词和学习中的词，占全文词数的比例';
      stats.textContent = `熟悉度 ${pct}% · 学习中 ${seen.learning.size} · 已认识 ${seen.known.size} · 新词 ${seen.new.size}`;
      finish.hidden = unmarked.length === 0;
      finishText.textContent = `读完了？剩下 ${unmarked.length} 个未标记的词，可以一次标为“已认识”。`;
      clearTimeout(armed); armed = null;
      replace(finishBtn, '全部标为已认识');
    }
    finishBtn.addEventListener('click', async () => {
      if (!armed) {
        replace(finishBtn, `确认标记 ${unmarked.length} 个词`);
        armed = setTimeout(() => { armed = null; replace(finishBtn, '全部标为已认识'); }, 3000);
        return;
      }
      clearTimeout(armed); armed = null;
      const r = await gloss.vocab.markKnown(unmarked);
      if (r.ok) { toast(`已标记 ${r.data} 个词`); await refreshMarks(); } else toast(r.error);
    });

    async function refreshMarks() {
      const [v, k] = await Promise.all([gloss.vocab.list(), gloss.vocab.known()]);
      setMarks(v, k);
      applyMarks();
    }

    // ---- lookup sheet ----
    const panel = h('section.panel.sheet', { hidden: true });
    const lookup = Lookup.create({
      panel, text: article.text, sentences, articleId: article.id, allowKnown: true, closable: true,
      onOpenLibrary: () => go('vocab'),
      onOpenArticle: (articleId) => { if (articleId !== article.id) go('reader', articleId); },
      onChange: refreshMarks,
      onClear: () => spanEls.forEach((el) => el.classList.remove('sel')),
    });
    function pick(o) {
      let first = null;
      for (const el of spanEls) {
        const inside = Number(el.dataset.s) >= o.start && Number(el.dataset.e) <= o.end;
        el.classList.toggle('sel', inside);
        if (inside && !first) first = el;
      }
      lookup.choose(o.start, o.end);
      // keep the chosen word above the sheet
      const r = first.getBoundingClientRect();
      if (r.bottom > window.innerHeight * 0.5) contentEl().scrollBy({ top: r.bottom - window.innerHeight * 0.4, behavior: 'smooth' });
    }

    // A tap or click on a word, or the end of a mouse drag-selection.
    body.addEventListener('click', (e) => setTimeout(() => {
      const o = Lookup.offsetsFromEvent(e, spanEls);
      if (o) pick(o);
    }, 0));

    // Touch screens have no "mouse released" moment for a drag-selection: long-press a word, drag the handles,
    // and pick the phrase once the selection has settled.
    let selTimer = null;
    const onSelectionChange = () => {
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.anchorNode || !body.contains(sel.anchorNode)) return;
        const o = Lookup.offsetsFromEvent({ target: body }, spanEls);
        if (o) pick(o);
      }, 450);
    };
    const touchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (touchDevice) document.addEventListener('selectionchange', onSelectionChange);

    const onKey = (e) => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      if (e.key === 'Escape') lookup.clear();
      else if (e.key === 'Enter') lookup.saveCurrent();
    };
    window.addEventListener('keydown', onKey);
    setTeardown(() => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('selectionchange', onSelectionChange);
      clearTimeout(selTimer);
      lookup.destroy();
    });

    const source = article.url
      ? h('a.src', { onclick: () => gloss.app.openExternal(article.url) }, article.source || article.url)
      : h('span', article.source || '');

    const root = h('div.view.reader',
      h('div.reader-bar', h('button.btn.ghost.sm', { onclick: () => go('articles') }, icon('back', 15), '文章库'), h('span.spacer'), stats),
      h('h1.art-h', article.title),
      h('div.art-meta', source),
      body, finish, panel);
    applyMarks();
    return root;
  }

  return { libraryView, readerView, openAddDialog };
})();
