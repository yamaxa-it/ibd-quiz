'use strict';
const root = document.getElementById('app');
const auth = ONLINE ? makeAuth(localStorage, 'ibd_auth', true) : null;
const LS = 'ibd_v2';
let P = { name: '', weak: [], best: {}, session: null, sig: '' };
try { Object.assign(P, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem(LS, JSON.stringify(P)); } catch (e) {} };
let QM = new Map(), PARTS = [], kb = null, busy = false;
const LET = 'ABCDEFGH';
const rom = n => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };

function setView(node) { kb = null; node.classList.add('rise'); root.replaceChildren(node); window.scrollTo(0, 0); }
function msg(title, text, retry) {
  const c = el('section', 'card'); c.append(el('h2', 'serif', title)); if (text) c.append(el('p', 'muted', text));
  if (retry) { const b = el('button', 'btn', 'Попробовать снова'); b.onclick = boot; c.append(b); }
  return c;
}
const errBack = e => { const v = msg('Что-то пошло не так', e.message || String(e)); const b = el('button', 'btn', 'На главную'); b.onclick = home; v.append(b); setView(v); };

async function boot() {
  if (!ONLINE) return setView(msg('Сайт ещё не настроен', 'Заполни SUPABASE_URL и SUPABASE_KEY в файле config.js (см. README).'));
  setView(msg('Загрузка…', ''));
  let Q;
  try { Q = await auth.rest('questions?select=id,part,q,options&order=id.asc&limit=1000'); }
  catch (e) { return setView(msg('Не удалось загрузить тесты', 'Проверь интернет и настройки Supabase (anonymous sign-ins должны быть включены).', true)); }
  if (!Q.length) return setView(msg('Тестов пока нет', 'Администратор ещё не загрузил вопросы.'));
  QM = new Map(Q.map(q => [q.id, q]));
  const m = new Map(); Q.forEach(q => { if (!m.has(q.part)) m.set(q.part, []); m.get(q.part).push(q.id); });
  PARTS = [...m.keys()].sort((a, b) => a - b).map(n => ({ n, ids: m.get(n) }));
  const sig = hash(Q.map(q => q.q).join('\n'));
  if (P.sig !== sig) { P.sig = sig; P.weak = []; P.best = {}; P.session = null; save(); }
  P.weak = P.weak.filter(id => QM.has(id));
  if (P.name) auth.rpc('set_name', { p_name: P.name }).catch(() => {});
  P.name ? home() : welcome();
}

function nameForm(label, done) {
  const wrap = el('div'), row = el('div', 'row');
  const inp = el('input', 'input'); inp.maxLength = 30; inp.placeholder = 'Твоё имя в рейтинге'; inp.value = P.name; inp.setAttribute('aria-label', 'Имя в рейтинге');
  const b = el('button', 'btn', label), er = el('div', 'err');
  const go = async () => {
    const v = inp.value.trim().replace(/[<>\u0000-\u001f]/g, '');
    if (!v) { inp.focus(); return; }
    b.disabled = true; er.textContent = '';
    try { await auth.rpc('set_name', { p_name: v }); P.name = v; save(); done(); }
    catch (e) { er.textContent = 'Не удалось сохранить имя: ' + e.message; b.disabled = false; }
  };
  b.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  row.append(inp, b); wrap.append(row, er); return wrap;
}

function welcome() {
  const v = el('section', 'card');
  v.append(el('div', 'eyebrow', 'Добро пожаловать'), el('h1', null, 'Как тебя называть в рейтинге?'));
  v.append(el('p', 'lead', 'Имя увидят другие участники. Настоящие данные вводить не нужно, подойдёт псевдоним.'));
  v.append(nameForm('Начать', home)); setView(v);
}

function activeSession() { const s = P.session; return s && s.items && s.i < s.items.length && s.items.every(it => QM.has(it.id)) ? s : null; }

function home() {
  const v = el('div');
  v.append(el('div', 'eyebrow', 'Подготовка к тестам'), el('h1', null, 'Исламское банковское дело'));
  const total = PARTS.reduce((a, p) => a + p.ids.length, 0);
  v.append(el('p', 'lead', 'Вопросов: ' + total + '. Порядок вопросов и вариантов ответа перемешивается при каждом прохождении. Прогресс сохраняется, а результаты попадают в рейтинг.'));
  const who = el('div', 'muted'); who.append('Ты в рейтинге как «' + P.name + '» · ');
  const ch = el('button', 'link', 'сменить имя'); ch.onclick = () => { const w = el('section', 'card'); w.append(el('h2', 'serif', 'Сменить имя')); w.append(nameForm('Сохранить', home)); const bk = el('button', 'link', 'Назад'); bk.onclick = home; w.append(bk); setView(w); };
  who.append(ch); v.append(who);
  const s = activeSession(), g = el('div', 'grid');
  PARTS.forEach(p => {
    const c = el('button', 'card part'); c.type = 'button';
    c.append(el('div', 'num', rom(p.n)), el('div', 'ttl', 'Часть ' + p.n), el('div', 'meta', p.ids.length + ' вопросов'));
    const best = P.best[p.n], meter = el('div', 'meter'), i = el('i'); i.style.width = (best ? Math.round(best / p.ids.length * 100) : 0) + '%'; meter.append(i); c.append(meter);
    if (s && !s.retry && s.part === p.n) { c.append(el('span', 'badge go', 'продолжить · ' + (s.i + 1))); c.onclick = question; }
    else { if (best !== undefined) c.append(el('span', 'badge', best + ' / ' + p.ids.length)); c.onclick = () => begin(p.n, p.ids, false); }
    g.append(c);
  });
  v.append(g);
  const row = el('div', 'row');
  if (P.weak.length) { const b = el('button', 'btn', 'Слабые вопросы (' + P.weak.length + ')'); b.onclick = () => begin(0, P.weak.slice(), true); row.append(b); }
  if (s && s.retry) { const b = el('button', 'btn ghost', 'Продолжить: работа над ошибками'); b.onclick = question; row.append(b); }
  const rs = el('button', 'link', 'Сбросить локальный прогресс');
  rs.onclick = () => { if (confirm('Удалить сохранённый на этом устройстве прогресс? Рейтинг не изменится.')) { P.weak = []; P.best = {}; P.session = null; save(); home(); } };
  row.append(rs); v.append(row); setView(v);
}

async function begin(n, ids, retry) {
  setView(msg('Подготовка…', ''));
  const args = { p_part: retry ? 0 : n, p_retry: retry, p_ids: retry ? ids : null };
  let aid;
  try {
    try { aid = await auth.rpc('start_attempt', args); }
    catch (e) { if (/name required/i.test(e.message) && P.name) { await auth.rpc('set_name', { p_name: P.name }); aid = await auth.rpc('start_attempt', args); } else throw e; }
  } catch (e) { return errBack(e); }
  const items = shuffle(ids).map(id => ({ id, order: shuffle(QM.get(id).options.map((_, k) => k)), a: null }));
  P.session = { aid, part: n, retry, items, i: 0 }; save(); question();
}

function question() {
  const S = P.session, it = S.items[S.i], q = QM.get(it.id), n = S.items.length;
  const v = el('div'), top = el('div', 'top2');
  top.append(el('span', null, (S.retry ? 'Работа над ошибками' : 'Часть ' + S.part) + ' · вопрос ' + (S.i + 1) + ' из ' + n));
  const ex = el('button', 'link', 'Выйти'); ex.onclick = home; top.append(ex); v.append(top);
  const pr = el('div', 'progress'), pi = el('i'); pi.style.width = (S.i / n * 100) + '%'; pr.append(pi); v.append(pr);
  v.append(el('h2', 'q', q.q));
  const box = el('div', 'opts'), err = el('div', 'err'), row = el('div', 'row');
  const nb = el('button', 'btn', S.i === n - 1 ? 'Показать результат' : 'Дальше'); nb.hidden = true; row.append(nb);
  nb.onclick = () => { S.i++; save(); S.i < n ? question() : results(); };
  const btns = it.order.map((k, pos) => {
    const b = el('button', 'opt'); b.type = 'button'; b.dataset.k = k;
    b.append(el('span', 'ltr', LET[pos]), el('span', 'txt', q.options[k])); box.append(b); return b;
  });
  const reveal = (c, r) => {
    btns.forEach(b => {
      b.disabled = true; const k = +b.dataset.k;
      if (k === r) { b.classList.add('ok'); b.append(el('span', 'tag', c === r ? 'Верно' : 'Правильный ответ')); }
      else if (k === c) { b.classList.add('bad'); b.append(el('span', 'tag', 'Неверно')); }
    });
    nb.hidden = false; nb.focus();
  };
  btns.forEach(b => b.onclick = async () => {
    if (busy || it.a) return; busy = true; err.textContent = ''; btns.forEach(x => x.disabled = true);
    const k = +b.dataset.k;
    try {
      const r = await auth.rpc('check_answer', { p_attempt: S.aid, p_qid: it.id, p_choice: k });
      it.a = { c: k, r }; const w = P.weak.indexOf(it.id);
      if (k === r) { if (w >= 0) P.weak.splice(w, 1); } else if (w < 0) P.weak.push(it.id);
      save(); reveal(k, r);
    } catch (e) { btns.forEach(x => x.disabled = false); err.textContent = 'Не удалось проверить ответ: ' + e.message + '. Попробуй ещё раз.'; }
    busy = false;
  });
  v.append(box, err, row); setView(v);
  if (it.a) reveal(it.a.c, it.a.r);
  kb = e => { if (/^[1-9]$/.test(e.key) && btns[+e.key - 1] && !btns[+e.key - 1].disabled) btns[+e.key - 1].click(); else if ((e.key === 'Enter') && !nb.hidden && document.activeElement !== nb) nb.click(); };
}
addEventListener('keydown', e => { if (kb && !(e.target instanceof HTMLInputElement)) kb(e); });

function results() {
  const S = P.session, n = S.items.length, wrong = []; let right = 0;
  S.items.forEach(it => { if (it.a && it.a.c === it.a.r) right++; else wrong.push(it); });
  if (!S.retry && (P.best[S.part] === undefined || right > P.best[S.part])) P.best[S.part] = right;
  const sp = S.part, sr = S.retry; P.session = null; save();
  const v = el('div');
  v.append(el('div', 'eyebrow', sr ? 'Работа над ошибками' : 'Часть ' + sp), el('div', 'score', right + ' из ' + n));
  v.append(el('p', 'lead', wrong.length ? 'Ошибок: ' + wrong.length + '. Разбор ниже.' : (sr ? 'Без ошибок.' : 'Без ошибок. Результат отправлен в рейтинг.')));
  const row = el('div', 'row');
  if (wrong.length) { const b = el('button', 'btn', 'Повторить ошибки (' + wrong.length + ')'); const ids = wrong.map(w => w.id); b.onclick = () => begin(0, ids, true); row.append(b); }
  if (!sr) { const b = el('button', 'btn ghost', 'Пройти часть заново'); b.onclick = () => begin(sp, PARTS.find(p => p.n === sp).ids, false); row.append(b); }
  const lb = el('button', 'btn ghost', 'Рейтинг'); lb.onclick = board; row.append(lb);
  const h = el('button', 'btn ghost', 'К списку частей'); h.onclick = home; row.append(h); v.append(row);
  if (wrong.length) {
    const hd = el('h2', 'serif', 'Вопросы с ошибками'); hd.style.marginTop = '30px'; v.append(hd);
    wrong.forEach(it => { const q = QM.get(it.id), m = el('div', 'miss'); m.append(el('div', 'qq', q.q));
      m.append(el('div', 'w', 'Твой ответ: ' + (it.a ? q.options[it.a.c] : '—')), el('div', 'r', 'Правильно: ' + (it.a ? q.options[it.a.r] : '—'))); v.append(m); });
  }
  setView(v);
}

async function board() {
  const v = el('div'); v.append(el('div', 'eyebrow', 'Рейтинг'), el('h1', null, 'Кто решил больше'));
  v.append(el('p', 'lead', 'Считается сумма лучших результатов по каждой части. Ответы проверяет сервер, подделать счёт нельзя.'));
  const st = el('p', 'muted', 'Загрузка…'); v.append(st); const bk = el('button', 'btn ghost', 'Назад'); bk.onclick = home; setView(v);
  try {
    const rows = await auth.rpc('get_leaderboard'), total = PARTS.reduce((a, p) => a + p.ids.length, 0); st.remove();
    if (!rows.length) v.append(el('p', 'muted', 'Пока никто не прошёл ни одной части.'));
    else {
      const t = el('table', 'tbl'), hr = el('tr'); ['#', 'Имя', 'Решено', 'Частей'].forEach(x => hr.append(el('th', null, x))); t.append(hr);
      rows.forEach((r, i) => { const tr = el('tr', r.is_me ? 'me' : ''); const c0 = el('td', 'rk', i + 1); tr.append(c0, el('td', null, r.name), el('td', null, r.solved + ' / ' + total), el('td', null, r.parts_done + ' / ' + PARTS.length)); t.append(tr); });
      const w = el('div', 'tblw'); w.append(t); v.append(w);
    }
  } catch (e) { st.textContent = 'Не удалось загрузить рейтинг: ' + e.message; }
  const r = el('div', 'row'); r.append(bk); v.append(r);
}

document.getElementById('brand').onclick = () => { if (PARTS.length && P.name) home(); };
document.getElementById('navBoard').onclick = () => { if (PARTS.length && P.name) board(); };
boot();
