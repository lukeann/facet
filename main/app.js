'use strict';
const { h, replace, icon, highlight, speak, timeAgo, duration, toast } = ui;

const contentEl = document.getElementById('content');
const navEl = document.getElementById('nav');
const captureBtn = document.getElementById('capture');

const LANGS = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ja', '日本語'], ['ko', '한국어'],
  ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['ru', 'Русский'],
];

let view = 'articles';
let viewParam = null; // e.g. the article id for the reader
let settings = null;
let stats = { total: 0, due: 0, mastered: 0 };
let teardown = null; // per-view cleanup (keyboard handlers)

// The same UI runs in the Electron desktop app and as a phone web app (PWA); 'web' has no screen capture,
// global hotkey or tray, and keeps its data in the browser.
const IS_WEB = gloss.platform === 'web';
const COARSE = window.matchMedia('(pointer: coarse)').matches; // touch screen: no keyboard shortcuts to mention

document.getElementById('logo').append(icon('scan', 16));
if (!IS_WEB) {
  captureBtn.hidden = false;
  captureBtn.append(icon('scan', 16), '截图翻译');
  captureBtn.addEventListener('click', () => gloss.capture.start());
}
function setHotkeyHint() {
  const el = document.getElementById('hotkey-hint');
  el.hidden = IS_WEB;
  if (!IS_WEB) el.textContent = `快捷键 ${settings.hotkey}`;
}

const speakOrToast = (text) => speak(text); // speak() reports a missing voice itself

// ---- shell ---------------------------------------------------------------------------------
const NAV = [
  { id: 'articles', label: '文章', icon: 'file' },
  { id: 'vocab', label: '生词本', icon: 'book', badge: () => (stats.total ? { text: stats.total } : null) },
  { id: 'review', label: '复习', icon: 'cards', badge: () => (stats.due ? { text: stats.due, hot: true } : null) },
  { id: 'settings', label: '设置', icon: 'sliders' },
];

function renderNav() {
  replace(navEl, ...NAV.map((n) => {
    const b = n.badge && n.badge();
    return h('button.nav-item', { className: `nav-item${view === n.id || (n.id === 'articles' && view === 'reader') ? ' active' : ''}`, onclick: () => go(n.id) },
      icon(n.icon, 17), h('span.grow', n.label), b && h('span.badge', { className: `badge${b.hot ? ' hot' : ''}` }, b.text));
  }));
}

function hotkeyKeys(accel) {
  return h('span.keys', accel.split('+').map((k) => h('kbd', k === 'CommandOrControl' ? 'Ctrl' : k)));
}

async function refreshMeta() {
  [settings, stats] = await Promise.all([gloss.settings.get(), gloss.vocab.stats()]);
  setHotkeyHint();
  renderNav();
}

async function go(next, param = null) {
  if (teardown) { teardown(); teardown = null; }
  view = next;
  viewParam = param;
  await refreshMeta();
  contentEl.scrollTop = 0;
  const render = {
    articles: () => Articles.libraryView(),
    reader: () => Articles.readerView(viewParam, (fn) => { teardown = fn; }),
    vocab: vocabView, review: reviewView, settings: settingsView,
  }[view];
  replace(contentEl, await render());
}

gloss.vocab.onChanged(() => {
  if (view === 'vocab') go('vocab');       // list changed under us
  else refreshMeta();                       // keep badges fresh (the reader refreshes its own marks)
});
gloss.article.onChanged(() => { if (view === 'articles') go('articles'); });
gloss.app.onNavigate((v) => go(v));

// ---- vocabulary -----------------------------------------------------------------------------
async function vocabView() {
  const [words, articleList] = await Promise.all([gloss.vocab.list(), gloss.article.list()]);
  const titles = new Map(articleList.map((a) => [a.id, a.title]));
  const root = h('div.view');
  const sub = `共 ${stats.total} 个${stats.due ? ` · ${stats.due} 个待复习` : ''}${stats.mastered ? ` · ${stats.mastered} 个已掌握` : ''}`;

  if (!words.length) {
    root.append(h('div.empty',
      h('div.ring', icon('scan', 26)),
      h('h2', '还没有生词'),
      IS_WEB
        ? h('p', '在文章里点击单词，就能连同上下文一起保存到这里。电脑上保存的词，导出数据后在「设置」里导入即可。')
        : h('p', `按 ${settings.hotkey} 截取屏幕上的文字。在翻译浮窗里点击单词，就能连同上下文一起保存到这里。`),
      IS_WEB
        ? h('button.btn.primary', { onclick: () => go('articles') }, icon('file', 16), '去读文章')
        : h('button.btn.primary', { onclick: () => gloss.capture.start() }, icon('scan', 16), '开始截图翻译')));
    return root;
  }

  const list = h('div.list');
  const input = h('input', { type: 'search', placeholder: '搜索单词、释义或语境', oninput: () => paint() });
  const exportBtn = h('button.btn.sm', {
    title: '导出为 CSV（可导入 Anki 等工具）',
    onclick: async () => {
      const r = await gloss.vocab.exportCsv();
      if (r.ok && r.data) toast('已导出'); else if (!r.ok) toast(r.error);
    },
  }, icon('download', 14), '导出');

  root.append(
    h('header.page-head', h('div', h('h1', '生词本'), h('p.sub', sub)),
      h('div.head-actions', h('label.search', icon('search', 15), input), exportBtn)),
    list);

  function paint() {
    const q = input.value.trim().toLowerCase();
    const shown = words.filter((w) => !q || [w.text, w.translation, ...w.contexts.map((c) => c.sentence)].join('\n').toLowerCase().includes(q));
    replace(list, ...(shown.length
      ? shown.map((w) => row(w, titles))
      : [h('p.muted', { style: { padding: '28px 4px' } }, '没有匹配的结果')]));
  }
  paint();
  return root;
}

function row(w, titles) {
  let open = false;
  const first = w.contexts[0];
  const detail = h('div.detail', { hidden: true });
  const del = h('button.icon-btn', { title: '删除' }, icon('trash', 15));
  let armed = null;
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!armed) {
      replace(del, '确认?'); del.style.cssText = 'width:auto;padding:0 8px;color:var(--danger);font-size:12px';
      armed = setTimeout(() => { armed = null; replace(del, icon('trash', 15)); del.style.cssText = ''; }, 2500);
      return;
    }
    clearTimeout(armed);
    await gloss.vocab.remove(w.id);
  });

  const el = h('article.row', {
    onclick: () => {
      open = !open;
      el.classList.toggle('open', open);
      detail.hidden = !open;
      if (open && !detail.childNodes.length) fillDetail(detail, w, titles);
    },
  },
  h('div.row-top',
    h('span.word', w.text),
    w.phonetic && h('span.phon', w.phonetic),
    h('span.acts',
      h('button.icon-btn', { title: '朗读', onclick: (e) => { e.stopPropagation(); speakOrToast(w.text); } }, icon('speaker', 15)), del),
    h('span.when', timeAgo(w.createdAt))),
  w.translation && h('div.trans', w.translation),
  first && h('div.ctx', highlight(first.sentence, w.text)),
  detail);
  return el;
}

function fillDetail(detail, w, titles) {
  const defs = (w.meanings || []).filter((m) => m.definition);
  const wait = w.srs.due - Date.now();
  detail.append(
    h('div.d', w.srs.reps ? `已复习 ${w.srs.reps} 次` : '还没复习过', ' · ',
      wait <= 0 ? '现在可以复习' : `下次复习在 ${duration(wait)}后`),
    defs.length ? h('ul.defs', defs.map((m) => h('li', h('span.pos', m.pos), m.definition))) : null,
    ...w.contexts.map((c) => h('div.c',
      h('div.s', highlight(c.sentence, w.text)), c.translation && h('div.t', c.translation),
      h('div.d', timeAgo(c.at), c.articleId && titles.has(c.articleId)
        ? [' · ', h('a.src', { onclick: () => go('reader', c.articleId) }, `来自《${titles.get(c.articleId)}》`)] : null))),
  );
}

// ---- review ------------------------------------------------------------------------------------
// The review schedule follows the forgetting curve: forgetting is fastest right after learning, so the first
// reviews come close together and then spread out (see src/core/srs.js).
const rhythmNote = () => h('p.note.rhythm',
  '复习节奏（按遗忘曲线）：新词 20 分钟后第一次出现，之后依次是 8 小时 → 1 天 → 2 天 → 6 天 → 14 天 → 31 天 → 90 天。'
  + '每次“记得”就走下一档；“忘了”会退回一半，10 分钟后再来。');

const nextDueText = () => {
  if (stats.due) return `已有 ${stats.due} 个词到期，可以开始复习。`;
  if (stats.next) return `下一个词在 ${duration(Math.max(stats.next - Date.now(), 60000))}后到期。`;
  return '';
};

async function reviewView() {
  const queue = await gloss.vocab.due();
  const root = h('div.review');
  if (!queue.length) {
    root.append(h('div.done', h('div.ring', icon('check', 26)),
      h('h2', stats.total ? '现在没有需要复习的词' : '还没有可复习的词'),
      h('p', stats.total ? (nextDueText() || '新保存的词会自动加入复习队列。') : (IS_WEB ? '先去读文章，点词保存下来。' : '先去读文章或截图翻译，把生词保存下来。')),
      stats.total ? rhythmNote() : null));
    return root;
  }

  let i = 0, revealed = false, busy = false;
  let total = queue.length;

  function paint() {
    if (i >= total) {
      const nextEl = h('p');
      replace(root, h('div.done',
        h('h2', '本轮完成'), h('p', `复习了 ${new Set(queue.map((q) => q.id)).size} 个词`), nextEl,
        h('button.btn.primary', { style: { marginTop: '12px' }, onclick: () => go('vocab') }, '返回生词本'),
        rhythmNote()));
      refreshMeta().then(() => { nextEl.textContent = nextDueText(); });
      return;
    }
    const w = queue[i];
    const c = w.contexts[0];
    const card = h('div.card',
      h('div.prompt', c ? highlight(c.sentence, w.text) : h('b', w.text)),
      !revealed && h('p.hint', COARSE ? '回忆这个词的意思，再点下面的按钮显示答案' : '回忆这个词的意思，然后按空格显示答案'));
    if (revealed) {
      const defs = (w.meanings || [])[0];
      card.append(h('div.answer',
        h('div.w', h('b', w.text), w.phonetic && h('span.muted', w.phonetic),
          h('button.icon-btn', { title: '朗读', onclick: () => speakOrToast(w.text) }, icon('speaker', 16))),
        h('div.tr', w.translation || '（没有保存释义）'),
        defs && h('div.df', `${defs.pos ? defs.pos + '. ' : ''}${defs.definition}`),
        c && c.translation && h('div.ct', c.translation)));
    }
    const grade = (g, label, key) => h('button.btn', { className: `btn${g === 'good' ? ' primary' : ''}`, disabled: busy, onclick: () => answer(g) },
      h('span', label), h('small', COARSE ? duration(w.preview[g]) : `${key} · ${duration(w.preview[g])}`));
    replace(root, 
      h('div.progress', h('span', `${Math.min(i + 1, total)} / ${total}`), h('div.bar', h('i', { style: { width: `${(i / total) * 100}%` } }))),
      card,
      h('div.actions', revealed
        ? [grade('again', '忘了', '1'), grade('hard', '模糊', '2'), grade('good', '记得', '3')]
        : h('button.btn.primary', { onclick: reveal }, '显示答案')));
  }

  function reveal() { revealed = true; paint(); }
  async function answer(g) {
    if (busy) return;
    busy = true;
    const r = await gloss.vocab.review(queue[i].id, g);
    // A forgotten word comes back before the session ends (it is due again in 10 minutes anyway).
    if (g === 'again' && r.ok && r.data) { queue.push({ ...queue[i], ...r.data }); total = queue.length; }
    i += 1; revealed = false; busy = false;
    paint();
  }

  const onKey = (e) => {
    if (i >= total) return;
    if (!revealed && (e.code === 'Space' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
    else if (revealed) {
      const g = { 1: 'again', 2: 'hard', 3: 'good' }[e.key];
      if (g) answer(g);
    }
  };
  window.addEventListener('keydown', onKey);
  teardown = () => window.removeEventListener('keydown', onKey);
  paint();
  return root;
}

// ---- settings -----------------------------------------------------------------------------------
async function settingsView() {
  const info = await gloss.app.info();
  const root = h('div.view');

  const save = async (patch, quiet) => {
    const r = await gloss.settings.set(patch);
    if (!r.ok) { toast(r.error); return false; }
    settings = r.data;
    setHotkeyHint();
    if (!quiet) toast('已保存');
    return true;
  };

  const field = (title, desc, control) => h('div.field', h('div.l', h('b', title), desc && h('span', desc)), control);
  const text = (key, type = 'text', placeholder = '') => h('input', {
    type, value: settings[key] || '', placeholder, spellcheck: false, autocomplete: 'off',
    onchange: (e) => save({ [key]: e.target.value.trim() }),
  });

  // hotkey recorder
  const rec = h('button.btn.rec', { title: '点击后按下新的组合键' });
  const showKeys = () => { rec.className = 'btn rec'; replace(rec, hotkeyKeys(settings.hotkey)); };
  showKeys();
  rec.addEventListener('click', () => {
    rec.classList.add('recording'); replace(rec, '按下新的快捷键…（Esc 取消）');
    const onKey = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return finish();
      const accel = toAccelerator(e);
      if (!accel) return; // only modifiers so far
      finish();
      if (!(e.ctrlKey || e.altKey || e.metaKey)) { toast('请至少包含 Ctrl、Alt 或 Win 键'); return; }
      if (await save({ hotkey: accel }, true)) { showKeys(); toast(`快捷键已改为 ${accel}`); }
    };
    const finish = () => { window.removeEventListener('keydown', onKey, true); showKeys(); };
    window.addEventListener('keydown', onKey, true);
  });

  const langSel = h('select', { onchange: (e) => save({ targetLang: e.target.value }) },
    LANGS.map(([v, l]) => h('option', { value: v, selected: settings.targetLang === v }, l)));
  const provSel = h('select', { onchange: (e) => save({ provider: e.target.value }) },
    [['auto', '自动'], ['mymemory', 'MyMemory'], ['baidu', '百度翻译']].map(([v, l]) => h('option', { value: v, selected: settings.provider === v }, l)));
  const login = h('label.switch', h('input', { type: 'checkbox', checked: !!settings.launchAtLogin, onchange: (e) => save({ launchAtLogin: e.target.checked }) }), h('i'));

  // moving data between devices: merge, never overwrite
  const dataButton = (label, ico, work) => {
    const btn = h('button.btn.sm', { onclick: async () => {
      btn.disabled = true;
      const r = await work();
      btn.disabled = false;
      if (!r.ok) toast(r.error);
      else if (r.data) toast(typeof r.data === 'string' ? '完成' : describeMerge(r.data));
    } }, icon(ico, 14), label);
    return btn;
  };
  const describeMerge = (m) => {
    const parts = [];
    if (m.vocab.added) parts.push(`新增 ${m.vocab.added} 个词`);
    if (m.articles.added) parts.push(`新增 ${m.articles.added} 篇文章`);
    const upd = m.vocab.updated + m.articles.updated;
    if (upd) parts.push(`更新 ${upd} 条`);
    return parts.length ? `已合并：${parts.join('，')}` : '没有新内容，已是最新';
  };

  // ---- sync through a private GitHub repo: connect once per device, then it runs by itself ----
  const describeSync = (r) => {
    if (!r.ok) return r.error;
    const pulled = (r.pulled ? r.pulled.vocab + r.pulled.articles : 0);
    const parts = [];
    if (pulled) parts.push(`从云端合并了 ${pulled} 条`);
    if (r.pushed && r.pushed.length) parts.push('已上传本机的改动');
    return parts.length ? parts.join('，') : '已是最新';
  };

  const syncBox = h('section.group');
  async function paintSync() {
    const st = await gloss.sync.status();
    const parts = [h('h2', '同步')];
    if (!st.configured) {
      const repoIn = h('input', { type: 'text', placeholder: 'yourname/facet-data', spellcheck: false, autocomplete: 'off' });
      const tokenIn = h('input', { type: 'password', placeholder: 'github_pat_…', spellcheck: false, autocomplete: 'off' });
      const err = h('p.err');
      const connect = h('button.btn.primary.sm', { onclick: async () => {
        err.textContent = '';
        connect.disabled = true; replace(connect, '连接中…');
        const r = await gloss.sync.connect({ repo: repoIn.value, token: tokenIn.value });
        if (!r.ok) { connect.disabled = false; replace(connect, '连接并同步'); err.textContent = r.error; return; }
        toast(`已连接：${describeSync(r)}`);
        paintSync();
      } }, '连接并同步');
      parts.push(
        h('p.note', '用你自己的私有 GitHub 仓库，在电脑和手机之间自动同步生词、文章和复习进度。数据只在你的设备和这个仓库之间传输。'),
        field('仓库', '必须是私有仓库，建议专门新建一个', repoIn),
        field('访问令牌', '只授权这一个仓库的读写；保存在本机，不会上传', tokenIn),
        h('details.adv', h('summary', '怎么获取令牌？'),
          h('ol.steps',
            h('li', '在 GitHub 新建一个私有仓库（勾选 Add a README），比如叫 facet-data。'),
            h('li', '头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。'),
            h('li', 'Repository access 选 Only select repositories，只选刚建的那个仓库。'),
            h('li', 'Permissions → Repository permissions → Contents 选 Read and write。'),
            h('li', '生成后复制令牌（只显示一次），粘贴到上面。令牌有有效期，过期后重新生成即可。'))),
        err,
        h('div.modal-foot', connect));
    } else {
      const last = st.last;
      const line = st.syncing ? '同步中…'
        : !last ? '还没有同步过'
          : last.ok ? `上次同步：${timeAgo(last.at)} · ${describeSync(last)}` : `上次同步失败：${last.error}`;
      const now = h('button.btn.sm', { disabled: st.syncing, onclick: async () => {
        now.disabled = true;
        const r = await gloss.sync.run();
        if (!r.ok) toast(r.error);
        paintSync();
      } }, icon('refresh', 14), '立即同步');
      let armed = null;
      const off = h('button.btn.ghost.sm', { onclick: async () => {
        if (!armed) { replace(off, '确认断开'); armed = setTimeout(() => { armed = null; replace(off, '断开'); }, 3000); return; }
        clearTimeout(armed);
        await gloss.sync.disconnect();
        toast('已断开同步，本机数据保留');
        paintSync();
      } }, '断开');
      parts.push(
        field(`已连接 ${st.repo}`, line, h('div.btns', now, off)),
        h('p.note', '打开应用、改动后几秒、回到前台和每隔 5 分钟都会自动同步。两台设备同时改动时会自动合并，不会互相覆盖。'));
    }
    replace(syncBox, parts);
  }
  const offSyncStatus = gloss.sync.onStatus(() => paintSync());
  teardown = offSyncStatus;

  const translateGroup = h('section.group', h('h2', '翻译'),
    field('翻译成', '英文原文会翻译成这种语言；其他语言默认译成英文', langSel),
    IS_WEB ? null : field('翻译服务', '默认使用免费的 MyMemory，无需配置', provSel),
    h('details.adv', h('summary', '提升额度（可选）'),
      field('MyMemory 邮箱', '填写后每日免费额度从 5,000 提升到 50,000 字符', text('myMemoryEmail', 'text', 'you@example.com')),
      IS_WEB ? null : field('百度翻译 App ID', '在百度翻译开放平台申请，译文质量更稳定', text('baiduAppId')),
      IS_WEB ? null : field('百度翻译密钥', '仅保存在本机', text('baiduSecret', 'password')),
      IS_WEB ? null : h('p.note', '配置百度翻译后，“自动”会优先使用它；失败时回退到 MyMemory。')));

  const dataGroup = h('section.group', h('h2', '数据'),
    field('导出数据', '生词和文章导出成一个文件，可用来备份或转移到另一台设备',
      dataButton('导出', 'download', () => gloss.data.exportFile())),
    field('导入数据', '与现有内容合并，不会覆盖；同一个词的语境会合并，复习进度取最近一次',
      dataButton('导入', 'plus', () => gloss.data.importFile())),
    IS_WEB
      ? h('p.note', window.glossStorageOk === false
        ? '⚠ 这个浏览器没有允许保存数据（可能是隐私模式），关闭页面后内容会丢失。'
        : '数据保存在这台设备的浏览器里，不会上传。清除浏览器数据会删除它，所以请定期导出备份。')
      : field('数据位置', '全部保存在本机，一个 JSON 文件', h('button.btn.sm', { onclick: () => gloss.app.openDataFolder() }, '打开所在文件夹')),
    IS_WEB ? null : h('p.path', { style: { paddingTop: '8px' } }, info.dataFile));

  replace(root,
    h('header.page-head', h('div', h('h1', '设置'))),
    IS_WEB ? null : h('section.group', h('h2', '截图'),
      field('截图快捷键', '在任何界面按下即可开始框选', rec)),
    translateGroup,
    h('section.group', h('h2', '复习'), rhythmNote()),
    IS_WEB ? null : h('section.group', h('h2', '通用'),
      field('开机自动启动', '启动后在托盘中等待，不打开窗口', login)),
    syncBox,
    dataGroup,
    h('p.muted', { style: { fontSize: '12px' } }, `见词如面 · Facet ${info.version}`));
  await paintSync();
  return root;
}

const KEY_NAMES = {
  Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
};
/** KeyboardEvent -> Electron accelerator ("Ctrl+Alt+T"), or null while only modifiers are held. */
function toAccelerator(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else key = KEY_NAMES[e.code] || null;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, key].join('+');
}

go('articles');
