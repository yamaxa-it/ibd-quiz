'use strict';
if (top !== self) { document.body.replaceChildren(); throw new Error('framed'); }
const root = document.getElementById('app');
const auth = ONLINE ? makeAuth(sessionStorage, 'ibd_admin_auth', false) : null;
const logoutBtn = document.getElementById('logout');
let idle;
function arm() { clearTimeout(idle); idle = setTimeout(() => out('Сессия завершена из-за неактивности (15 минут).'), 15 * 60 * 1000); }
['click', 'keydown'].forEach(ev => addEventListener(ev, () => { if (auth && auth.has()) arm(); }, { passive: true }));
async function out(note) { clearTimeout(idle); await auth.logout(); logoutBtn.hidden = true; login(note); }
logoutBtn.onclick = () => out();
const setView = n => { n.classList.add('rise'); root.replaceChildren(n); window.scrollTo(0, 0); };
const card = (title, sub) => { const c = el('section', 'card'); c.append(el('div', 'eyebrow', 'Только для администратора'), el('h1', null, title)); if (sub) c.append(el('p', 'lead', sub)); return c; };
const field = (type, ph, ac) => { const i = el('input', 'input'); i.type = type; i.placeholder = ph; if (ac) i.autocomplete = ac; i.style.marginTop = '10px'; i.style.width = '100%'; return i; };
const onEnter = (inp, fn) => inp.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); });

function login(note) {
  const c = card('Вход', 'Нужны email, пароль и код из приложения-аутентификатора.');
  const em = field('email', 'Email', 'username'), pw = field('password', 'Пароль', 'current-password');
  const b = el('button', 'btn', 'Войти'), er = el('div', 'err', note || ''); b.style.marginTop = '14px';
  const go = async () => {
    if (!em.value || !pw.value) return; b.disabled = true; er.textContent = '';
    try { await auth.password(em.value.trim(), pw.value); pw.value = ''; arm(); logoutBtn.hidden = false; await proceed(); }
    catch (e) { er.textContent = /invalid|credentials/i.test(e.message) ? 'Неверный email или пароль.' : e.message; b.disabled = false; }
  };
  b.onclick = go; onEnter(pw, go); c.append(em, pw, b, er); setView(c);
}

async function proceed() {
  const cand = await auth.rpc('admin_candidate');
  if (cand !== true) { const c = card('Нет доступа', 'Этот аккаунт не является администратором.'); const b = el('button', 'btn ghost', 'Выйти'); b.onclick = () => out(); c.append(b); return setView(c); }
  if (auth.claims().aal === 'aal2') return dash();
  return mfa();
}

async function mfa() {
  const u = await auth.user(), fs = (u.factors || []).filter(f => f.factor_type === 'totp');
  const ver = fs.find(f => f.status === 'verified');
  let id, c;
  if (ver) { id = ver.id; c = card('Код подтверждения', 'Введи 6-значный код из приложения-аутентификатора.'); }
  else {
    for (const f of fs) { try { await auth.mfa.remove(f.id); } catch (e) {} }
    const en = await auth.mfa.enroll(); id = en.id;
    c = card('Настройка двухфакторной защиты', 'Отсканируй QR-код в Google Authenticator, Authy или похожем приложении, затем введи код.');
    const img = el('img', 'qr'); img.alt = 'QR-код для аутентификатора'; img.src = en.totp.qr_code; c.append(img);
    c.append(el('div', 'muted', 'Если сканировать нельзя, введи ключ вручную:'), el('code', 'sec', en.totp.secret));
  }
  const inp = field('text', '000000', 'one-time-code'); inp.inputMode = 'numeric'; inp.maxLength = 6;
  const b = el('button', 'btn', 'Подтвердить'), er = el('div', 'err'); b.style.marginTop = '14px';
  const go = async () => {
    if (!/^\d{6}$/.test(inp.value.trim())) { er.textContent = 'Введи 6 цифр.'; return; }
    b.disabled = true; er.textContent = '';
    try { await auth.mfa.verify(id, inp.value.trim()); await proceed(); }
    catch (e) { er.textContent = 'Неверный или просроченный код. ' + (e.message || ''); b.disabled = false; }
  };
  b.onclick = go; onEnter(inp, go); c.append(inp, b, er); setView(c);
}

/* ---------------- Панель ---------------- */
let players = [], sortKey = 'solved', sortDir = -1, filt = '', tab = 'players';
const wrap = el('div');

function dash() {
  const v = el('div'), tabs = el('div', 'tabs');
  [['players', 'Игроки'], ['tests', 'Тесты']].forEach(([k, t]) => {
    const b = el('button', 'chip tab', t); b.setAttribute('aria-selected', String(k === tab));
    b.onclick = () => { tab = k; dash(); }; tabs.append(b);
  });
  v.append(el('div', 'eyebrow', 'Панель администратора'), el('h1', null, tab === 'players' ? 'Игроки и результаты' : 'Тесты'), tabs);
  const body = el('div'); v.append(body); setView(v);
  (tab === 'players' ? playersTab : testsTab)(body).catch(e => body.append(el('p', 'err', 'Ошибка: ' + e.message)));
}

const csvCell = x => { let s = String(x ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
function download(name, text, type) { const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

async function playersTab(body) {
  body.append(el('p', 'muted', 'Загрузка…'));
  players = await auth.rpc('admin_players'); body.replaceChildren();
  const week = Date.now() - 7 * 864e5;
  const st = el('div', 'stats');
  [[players.length, 'игроков'], [players.filter(p => p.last_active && new Date(p.last_active) > week).length, 'активны за 7 дней'], [players.reduce((a, p) => a + p.attempts, 0), 'прохождений частей'], [players.reduce((a, p) => a + p.retries, 0), 'повторов ошибок']]
    .forEach(([n, l]) => { const s = el('div', 'card stat'); s.append(el('b', null, n), el('span', null, l)); st.append(s); });
  body.append(st);
  const bar = el('div', 'row'), q = el('input', 'input'); q.placeholder = 'Поиск по имени'; q.value = filt; q.style.maxWidth = '320px';
  const ex = el('button', 'btn ghost', 'Экспорт CSV');
  ex.onclick = () => download('players.csv', '\ufeff' + [['Имя', 'Решено', 'Частей', 'Прохождений', 'Повторов', 'Последняя активность', 'Регистрация'].map(csvCell).join(',')]
    .concat(players.map(p => [p.name, p.solved, p.parts_done, p.attempts, p.retries, p.last_active || '', p.joined].map(csvCell).join(','))).join('\r\n'), 'text/csv;charset=utf-8');
  bar.append(q, ex); body.append(bar);
  const holder = el('div'); holder.style.marginTop = '14px'; body.append(holder);
  const draw = () => {
    holder.replaceChildren();
    const rows = players.filter(p => p.name.toLowerCase().includes(filt.toLowerCase())).sort((a, b) => ((a[sortKey] > b[sortKey]) - (a[sortKey] < b[sortKey])) * sortDir || a.name.localeCompare(b.name));
    if (!rows.length) { holder.append(el('p', 'muted', 'Игроков пока нет.')); return; }
    const t = el('table', 'tbl'), hr = el('tr');
    [['name', 'Имя'], ['solved', 'Решено'], ['parts_done', 'Частей'], ['attempts', 'Прохождений'], ['retries', 'Повторов'], ['last_active', 'Активность']].forEach(([k, l]) => {
      const th = el('th', null, l + (k === sortKey ? (sortDir < 0 ? ' ↓' : ' ↑') : '')); th.onclick = () => { sortDir = k === sortKey ? -sortDir : -1; sortKey = k; draw(); }; hr.append(th);
    });
    hr.append(el('th')); t.append(hr);
    rows.forEach(p => {
      const tr = el('tr'), nm = el('td'), nb = el('button', 'link', p.name); nm.append(nb);
      const del = el('button', 'link', 'Удалить'); del.style.color = 'var(--bad)'; const dc = el('td'); dc.append(del);
      tr.append(nm, el('td', null, p.solved), el('td', null, p.parts_done), el('td', null, p.attempts), el('td', null, p.retries), el('td', null, fmtDate(p.last_active)), dc); t.append(tr);
      let open = null;
      nb.onclick = async () => {
        if (open) { open.remove(); open = null; return; }
        open = el('tr'); const td = el('td', 'wrap'); td.colSpan = 7; td.append(el('span', 'muted', 'Загрузка…')); open.append(td); tr.after(open);
        try {
          const a = await auth.rpc('admin_player_attempts', { p_user: p.user_id }); td.replaceChildren();
          td.append(el('div', 'muted', 'Зарегистрирован: ' + fmtDate(p.joined)));
          if (!a.length) { td.append(el('div', 'muted', 'Попыток нет.')); return; }
          const t2 = el('table', 'tbl'), h2 = el('tr'); ['Дата', 'Часть', 'Правильно', 'Отвечено'].forEach(x => h2.append(el('th', null, x))); t2.append(h2);
          a.forEach(r => { const rr = el('tr'); rr.append(el('td', null, fmtDate(r.created_at)), el('td', null, r.retry ? 'повтор ошибок' : 'часть ' + r.part), el('td', null, r.correct + ' / ' + r.total), el('td', null, r.answered + ' / ' + r.total)); t2.append(rr); });
          const w = el('div', 'tblw'); w.append(t2); td.append(w);
        } catch (e) { td.replaceChildren(el('span', 'err', e.message)); }
      };
      del.onclick = async () => { if (!confirm('Удалить результаты игрока «' + p.name + '»? Действие необратимо.')) return; try { await auth.rpc('admin_delete_player', { p_user: p.user_id }); dash(); } catch (e) { alert(e.message); } };
    });
    const w = el('div', 'tblw'); w.append(t); holder.append(w);
  };
  q.oninput = () => { filt = q.value; draw(); }; draw();
  const dz = el('div'); dz.style.marginTop = '34px'; dz.append(el('h2', 'serif', 'Опасная зона'));
  const rb = el('button', 'btn danger', 'Очистить результаты всех игроков');
  rb.onclick = async () => { if (prompt('Все результаты и рейтинг будут удалены. Введи слово УДАЛИТЬ для подтверждения.') !== 'УДАЛИТЬ') return; try { await auth.rpc('admin_reset_results'); dash(); } catch (e) { alert(e.message); } };
  dz.append(rb); body.append(dz);
}

/* ---------------- Тесты ---------------- */
function parseTxt(t) {
  const out = [], clean = x => x.replace(/\s*\+{3,}\s*$/, '').replace(/\s+/g, ' ').trim();
  t.replace(/\r/g, '').split(/\n[ \t]*\+{3,}[ \t]*(?:\n|$)/).forEach((b, bi) => {
    const parts = b.split(/\n[ \t]*={3,}[ \t]*(?:\n|$)/).map(x => x.trim()).filter(Boolean); if (!parts.length) return;
    if (bi === 0) { const pp = parts[0].split(/\n\s*\n/); parts[0] = pp[pp.length - 1].trim(); }
    const rest = parts.slice(1), ci = rest.map((o, i) => o.startsWith('#') ? i : -1).filter(i => i >= 0);
    out.push({ q: clean(parts[0]), options: rest.map(o => clean(o.replace(/^#\s*/, ''))), correct: ci.length === 1 ? ci[0] : -1 });
  });
  return out;
}
function validate(items) {
  const err = [];
  if (!Array.isArray(items) || !items.length) return ['Файл пуст или имеет неверный формат.'];
  if (items.length > 1000) err.push('Слишком много вопросов (максимум 1000).');
  items.forEach((x, i) => {
    const n = i + 1;
    if (!x || typeof x.q !== 'string' || !x.q.trim() || x.q.length > 2000) { err.push('Вопрос ' + n + ': нет текста вопроса.'); return; }
    if (!Array.isArray(x.options) || x.options.length < 2 || x.options.length > 8 || x.options.some(o => typeof o !== 'string' || !o.trim() || o.length > 1000)) { err.push('Вопрос ' + n + ': нужно от 2 до 8 непустых вариантов.'); return; }
    if (!Number.isInteger(x.correct) || x.correct < 0 || x.correct >= x.options.length) err.push('Вопрос ' + n + ': не определён единственный правильный ответ.');
  });
  return err;
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf); let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('это не DOCX/XLSX');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {};
  for (let i = 0; i < n; i++) {
    const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    const st = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    files[name] = async () => { const x = u8.subarray(st, st + cs); if (m === 0) return new TextDecoder().decode(x); return new Response(new Blob([x]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); };
  }
  return files;
}
const xml = s => new DOMParser().parseFromString(s, 'application/xml');
async function readDocx(f) {
  const z = await unzip(await f.arrayBuffer()); if (!z['word/document.xml']) throw new Error('в файле нет word/document.xml');
  return [...xml(await z['word/document.xml']()).getElementsByTagName('w:p')].map(p => [...p.getElementsByTagName('w:t')].map(t => t.textContent).join('')).join('\n');
}
async function readXlsx(f) {
  const z = await unzip(await f.arrayBuffer());
  const ss = z['xl/sharedStrings.xml'] ? [...xml(await z['xl/sharedStrings.xml']()).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const nm = Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0]; if (!nm) throw new Error('в файле нет листов');
  const out = [];
  [...xml(await z[nm]()).getElementsByTagName('row')].forEach((row, ri) => {
    const cells = [];
    [...row.getElementsByTagName('c')].forEach(c => {
      let idx = 0; for (const ch of (c.getAttribute('r') || 'A').replace(/\d+/g, '')) idx = idx * 26 + ch.charCodeAt(0) - 64;
      const v = c.getElementsByTagName('v')[0], t = c.getElementsByTagName('t')[0], ty = c.getAttribute('t');
      cells[idx - 1] = String(ty === 's' && v ? ss[+v.textContent] : ty === 'inlineStr' && t ? t.textContent : v ? v.textContent : '').trim();
    });
    let r = Array.from(cells, x => x || ''); if (/^\d+$/.test(r[0]) && r.length > 2) r = r.slice(1);
    const q = r[0], options = r.slice(1).filter(Boolean);
    if (ri === 0 && /^(вопрос|question)/i.test(q || '')) return;
    if (q && options.length >= 2) out.push({ q, options, correct: 0 }); // в таблице правильный ответ — первый вариант (A)
  });
  return out;
}
function qlist(box, list, run) {
  list.forEach(q => {
    const w = el('div', 'miss'), r = el('div', 'row'), eb = el('button', 'link', 'Изменить'), db = el('button', 'link del', 'Удалить');
    r.style.marginTop = '6px'; r.append(eb, db); w.append(el('div', 'qq', q.q), el('div', 'r', 'Верно: ' + q.options[q.correct]), r);
    db.onclick = () => confirm('Удалить вопрос?') && run(() => auth.rpc('admin_delete_question', { p_id: q.id }));
    eb.onclick = () => {
      const qi = el('textarea', 'input'), oi = el('textarea', 'input'), ci = el('select', 'input'), sv = el('button', 'btn', 'Сохранить'), er = el('div', 'err');
      qi.value = q.q; qi.rows = 3; oi.value = q.options.join('\n'); oi.rows = 5; sv.style.marginTop = '10px';
      const lines = () => oi.value.split('\n').map(x => x.trim()).filter(Boolean);
      const fill = () => { ci.replaceChildren(); lines().forEach((x, i) => { const o = el('option', null, 'Верный: ' + (i + 1) + '. ' + x.slice(0, 50)); o.value = i; ci.append(o); }); };
      fill(); ci.value = q.correct; oi.oninput = () => { const k = ci.value; fill(); ci.value = k; };
      sv.onclick = () => { const x = { q: qi.value.trim(), options: lines(), correct: +ci.value }, e2 = validate([x]); if (e2.length) { er.textContent = e2[0]; return; } run(() => auth.rpc('admin_update_question', { p_id: q.id, p_q: x.q, p_options: x.options, p_correct: x.correct })); };
      w.replaceChildren(el('div', 'muted', 'Вопрос'), qi, el('div', 'muted mt', 'Варианты (по одному в строке)'), oi, ci, sv, er);
    };
    box.append(w);
  });
}

async function testsTab(body) {
  body.append(el('p', 'muted', 'Загрузка…'));
  const [subs, tests, qs] = await Promise.all([auth.rest('subjects?select=id,title&order=id.asc'), auth.rest('tests?select=id,subject_id,title&order=id.asc'), auth.rpc('admin_questions')]);
  body.replaceChildren();
  const cnt = {}; qs.forEach(q => cnt[q.part] = (cnt[q.part] || 0) + 1);
  const run = async fn => { try { await fn(); dash(); } catch (e) { alert(e.message); } };
  const ns = el('section', 'card'), r0 = el('div', 'row'), ni = el('input', 'input'), nb = el('button', 'btn', 'Добавить предмет');
  ni.placeholder = 'Название предмета'; ni.maxLength = 80; r0.style.marginTop = '0';
  nb.onclick = () => ni.value.trim() && run(() => auth.rpc('admin_add_subject', { p_title: ni.value.trim() }));
  onEnter(ni, () => nb.click()); r0.append(ni, nb); ns.append(el('h2', null, 'Новый предмет'), r0); body.append(ns);
  if (!subs.length) body.append(el('p', 'muted mt', 'Предметов пока нет. Добавь первый.'));
  subs.forEach(s => {
    const c = el('section', 'card mt'), h = el('div', 'row'), ds = el('button', 'link del push', 'Удалить предмет');
    h.style.marginTop = '0'; h.append(el('h2', null, s.title), ds); c.append(h);
    ds.onclick = () => confirm('Удалить предмет «' + s.title + '» со всеми тестами и результатами по ним?') && run(() => auth.rpc('admin_delete_subject', { p_id: s.id }));
    const ts = tests.filter(t => t.subject_id === s.id);
    if (!ts.length) c.append(el('p', 'muted', 'Тестов пока нет.'));
    ts.forEach(t => {
      const rr = el('div', 'row'), d = el('button', 'link del push', 'Удалить'); rr.style.marginTop = '4px';
      d.onclick = () => confirm('Удалить тест «' + t.title + '»?') && run(() => auth.rpc('admin_delete_test', { p_id: t.id }));
      const qb = el('button', 'link', 'Вопросы'), pn = el('div'); pn.hidden = true;
      qb.onclick = () => { pn.hidden = !pn.hidden; if (!pn.hidden && !pn.childNodes.length) qlist(pn, qs.filter(q => q.part === t.id), run); };
      rr.append(el('span', null, t.title), el('span', 'muted', (cnt[t.id] || 0) + ' вопросов'), qb, d); c.append(rr, pn);
    });
    c.append(el('h2', 'mt', 'Добавить тест'));
    const ti = el('input', 'input'), fi = el('input', 'input'), ub = el('button', 'btn', 'Загрузить'), pv = el('div'), row = el('div', 'row');
    ti.placeholder = 'Название теста'; ti.maxLength = 80; fi.type = 'file'; fi.accept = '.json,.txt,.docx,.xlsx'; ub.disabled = true;
    let items = null;
    fi.onchange = async () => {
      items = null; ub.disabled = true; pv.replaceChildren(); const f = fi.files[0]; if (!f) return;
      if (f.size > 4e6) { pv.append(el('p', 'bad-t', 'Файл слишком большой.')); return; }
      try { if (/\.docx$/i.test(f.name)) items = parseTxt(await readDocx(f)); else if (/\.xlsx$/i.test(f.name)) items = await readXlsx(f); else { const t = await f.text(); items = /\.json$/i.test(f.name) || /^\s*\[/.test(t) ? JSON.parse(t) : parseTxt(t); } }
      catch (e) { pv.append(el('p', 'bad-t', 'Не удалось прочитать файл: ' + e.message)); return; }
      if (Array.isArray(items)) items = items.map(x => x && typeof x === 'object' ? { q: x.q, options: x.options, correct: x.correct } : x);
      const er = validate(items);
      if (er.length) { const u = el('ul', 'clean bad-t'); er.slice(0, 12).forEach(x => u.append(el('li', null, x))); pv.append(el('p', 'bad-t', 'Найдены ошибки:'), u); items = null; return; }
      pv.append(el('p', 'ok-t', 'Проверка пройдена: ' + items.length + ' вопросов.'), el('p', 'muted', 'Первый: ' + items[0].q.slice(0, 120))); ub.disabled = false;
      if (!ti.value) ti.value = f.name.replace(/\.[^.]+$/, '').slice(0, 80);
    };
    ub.onclick = () => {
      if (!items || !ti.value.trim()) { ti.focus(); return; } ub.disabled = true;
      // Варианты перемешиваются, чтобы порядок в базе не выдавал правильный ответ
      const payload = items.map(x => { const p = shuffle(x.options.map((_, i) => i)); return { q: x.q, options: p.map(i => x.options[i]), correct: p.indexOf(x.correct) }; });
      run(() => auth.rpc('admin_add_test', { p_subject: s.id, p_title: ti.value.trim(), p_items: payload })).finally(() => { ub.disabled = false; });
    };
    row.append(ti, fi, ub); c.append(row, pv); body.append(c);
  });
}

(async function start() {
  if (!ONLINE) return setView(card('Не настроено', 'Заполни SUPABASE_URL и SUPABASE_KEY в config.js.'));
  if (auth.has()) { try { arm(); logoutBtn.hidden = false; await proceed(); return; } catch (e) {} }
  login();
})();
