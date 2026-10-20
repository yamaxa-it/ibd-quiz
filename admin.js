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

async function testsTab(body) {
  body.append(el('p', 'muted', 'Загрузка…'));
  const cur = await auth.rpc('admin_questions'); body.replaceChildren();
  const info = el('section', 'card');
  const byPart = {}; cur.forEach(q => byPart[q.part] = (byPart[q.part] || 0) + 1);
  info.append(el('h2', 'serif', 'Сейчас в базе'), el('p', 'lead', cur.length ? cur.length + ' вопросов · части: ' + Object.keys(byPart).map(k => byPart[k]).join(' / ') : 'Тесты ещё не загружены.'));
  if (cur.length) {
    const b = el('button', 'btn ghost', 'Скачать текущие тесты (JSON)');
    b.onclick = () => download('questions-backup.json', JSON.stringify(cur.map(q => ({ q: q.q, options: q.options, correct: q.correct })), null, 1), 'application/json');
    info.append(b);
  }
  body.append(info);
  const up = el('section', 'card'); up.style.marginTop = '16px';
  up.append(el('h2', 'serif', 'Загрузить новые тесты'));
  up.append(el('p', 'lead', 'Файл questions.json (его готовлю я) или текст в формате с «+++++» и «=====». Загрузка заменяет все текущие тесты. Правильные ответы нигде не показываются игрокам и хранятся только на сервере.'));
  const file = el('input', 'input'); file.type = 'file'; file.accept = '.json,.txt,application/json,text/plain';
  const sz = el('input', 'input'); sz.type = 'number'; sz.min = '1'; sz.max = '500'; sz.value = '30'; sz.style.maxWidth = '120px'; sz.setAttribute('aria-label', 'Вопросов в части');
  const r1 = el('div', 'row'); r1.append(file); const r2 = el('div', 'row'); r2.append(el('span', 'muted', 'Вопросов в одной части:'), sz);
  const prev = el('div'), go = el('button', 'btn', 'Загрузить в базу'); go.hidden = true;
  up.append(r1, r2, prev, go); body.append(up);
  let items = null;
  const show = () => {
    prev.replaceChildren(); go.hidden = true; if (!items) return;
    const e = validate(items);
    if (e.length) { const u = el('ul', 'clean bad-t'); e.slice(0, 12).forEach(x => u.append(el('li', null, x))); if (e.length > 12) u.append(el('li', null, 'и ещё ' + (e.length - 12) + '…')); prev.append(el('p', 'bad-t', 'Найдены ошибки, загрузка невозможна:'), u); return; }
    const c = Math.max(1, Math.min(500, parseInt(sz.value, 10) || 30)), sizes = []; for (let i = 0; i < items.length; i += c) sizes.push(Math.min(c, items.length - i));
    prev.append(el('p', 'ok-t', 'Проверка пройдена: ' + items.length + ' вопросов. Части: ' + sizes.join(' / ') + '.'));
    const s = items[0]; const m = el('div', 'miss'); m.append(el('div', 'qq', 'Пример: ' + s.q)); s.options.forEach((o, i) => m.append(el('div', i === s.correct ? 'r' : 'muted', (i === s.correct ? '✓ ' : '· ') + o))); prev.append(m);
    go.hidden = false;
  };
  sz.oninput = show;
  file.onchange = async () => {
    items = null; prev.replaceChildren(); const f = file.files[0]; if (!f) return;
    if (f.size > 4e6) { prev.append(el('p', 'bad-t', 'Файл слишком большой.')); return; }
    try { const t = await f.text(); items = /\.json$/i.test(f.name) || /^\s*\[/.test(t) ? JSON.parse(t) : parseTxt(t); }
    catch (e) { prev.append(el('p', 'bad-t', 'Не удалось прочитать файл: ' + e.message)); return; }
    if (Array.isArray(items)) items = items.map(x => x && typeof x === 'object' ? { q: x.q, options: x.options, correct: x.correct } : x);
    show();
  };
  go.onclick = async () => {
    const c = Math.max(1, Math.min(500, parseInt(sz.value, 10) || 30));
    if (!confirm('Заменить все текущие тесты на ' + items.length + ' новых? Результаты игроков сохранятся, но их локальный прогресс по старым вопросам сбросится.')) return;
    go.disabled = true;
    // Варианты перемешиваются здесь, чтобы порядок в базе не выдавал правильный ответ
    const payload = items.map(x => { const perm = shuffle(x.options.map((_, i) => i)); return { q: x.q, options: perm.map(i => x.options[i]), correct: perm.indexOf(x.correct) }; });
    try { const n = await auth.rpc('admin_replace_questions', { p_items: payload, p_chunk: c }); alert('Загружено вопросов: ' + n); dash(); }
    catch (e) { go.disabled = false; prev.append(el('p', 'bad-t', 'Ошибка загрузки: ' + e.message)); }
  };
}

(async function start() {
  if (!ONLINE) return setView(card('Не настроено', 'Заполни SUPABASE_URL и SUPABASE_KEY в config.js.'));
  if (auth.has()) { try { arm(); logoutBtn.hidden = false; await proceed(); return; } catch (e) {} }
  login();
})();
