'use strict';
const API = String(typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '').trim().replace(/\/+$/, '');
const KEYV = String(typeof SUPABASE_KEY === 'string' ? SUPABASE_KEY : '').trim();
const ONLINE = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(API) && KEYV.length > 20;

const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined && x !== null) e.textContent = String(x); return e; };
const nowS = () => Math.floor(Date.now() / 1000);
const fmtDate = s => s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const rnd = n => { const a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n; let x; do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim); return x % n; };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const jwtPart = s => { try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); } catch (e) { return {}; } };

(function theme() {
  const d = document.documentElement;
  let t = null; try { t = localStorage.getItem('ibd_theme'); } catch (e) {}
  if (t === 'light') d.dataset.theme = 'light';
  addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('theme'); if (!b) return;
    b.onclick = () => { const l = d.dataset.theme !== 'light'; if (l) d.dataset.theme = 'light'; else delete d.dataset.theme; try { localStorage.setItem('ibd_theme', l ? 'light' : 'dark'); } catch (e) {} };
  });
})();

// Минимальный клиент Supabase без сторонних библиотек (меньше поверхность атаки).
function makeAuth(storage, key, anonymous) {
  let s = null, tp = null;
  try { s = JSON.parse(storage.getItem(key) || 'null'); } catch (e) {}
  const persist = () => { try { s ? storage.setItem(key, JSON.stringify(s)) : storage.removeItem(key); } catch (e) {} };
  const H = t => ({ apikey: KEYV, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (t || KEYV) });
  async function call(url, opt) {
    const r = await fetch(url, opt), t = await r.text(); let j = null;
    if (t) { try { j = JSON.parse(t); } catch (e) {} }
    if (!r.ok) throw Object.assign(new Error((j && (j.msg || j.message || j.error_description || j.error)) || ('Ошибка ' + r.status)), { status: r.status });
    return j;
  }
  const take = j => { s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || nowS() + (j.expires_in || 3600) }; persist(); return s; };
  const gt = (path, body, t, method) => call(API + '/auth/v1' + path, { method: method || 'POST', headers: H(t), body: body === undefined ? undefined : JSON.stringify(body) });
  async function tokenInner() {
    if (!s) { if (anonymous) await self.anon(); else throw new Error('Нужен вход'); }
    if (s.expires_at - nowS() < 60) {
      try { await self.refresh(); }
      catch (e) { if (anonymous) await self.anon(); else { s = null; persist(); throw new Error('Сессия истекла, войди снова'); } }
    }
    return s.access_token;
  }
  const self = {
    has: () => !!s,
    anon: async () => take(await gt('/signup', { data: {} })),
    password: async (email, pw) => take(await gt('/token?grant_type=password', { email, password: pw })),
    refresh: async () => take(await gt('/token?grant_type=refresh_token', { refresh_token: s.refresh_token })),
    token: () => tp || (tp = tokenInner().finally(() => { tp = null; })),
    claims: () => s ? jwtPart(s.access_token.split('.')[1]) : {},
    logout: async () => { try { if (s) await gt('/logout', {}, s.access_token); } catch (e) {} s = null; persist(); },
    user: async () => gt('/user', undefined, await self.token(), 'GET'),
    rpc: async (name, args) => call(API + '/rest/v1/rpc/' + name, { method: 'POST', headers: H(await self.token()), body: JSON.stringify(args || {}) }),
    rest: async path => call(API + '/rest/v1/' + path, { headers: H(await self.token()) }),
    mfa: {
      enroll: async () => gt('/factors', { factor_type: 'totp', friendly_name: 'admin-' + Date.now() }, await self.token()),
      remove: async id => gt('/factors/' + id, undefined, await self.token(), 'DELETE'),
      verify: async (id, code) => { const t = await self.token(); const c = await gt('/factors/' + id + '/challenge', {}, t); return take(await gt('/factors/' + id + '/verify', { challenge_id: c.id, code }, t)); }
    }
  };
  return self;
}
