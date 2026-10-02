// Web paneli: botun tüm metinlerini düzenlemek için. Bot ile aynı süreçte çalışır
// (değişiklikler anında geçerli olur, yeniden başlatma gerekmez). Ek bağımlılık yok.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const texts = require('../texts');
const tickets = require('../features/tickets');

const PUBLIC = path.join(__dirname, 'public');
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
};
const SESSION_TTL_MS = 12 * 3600_000;
const COOKIE = 'retronex_session';
const MAX_BODY = 32 * 1024;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILS = 5;

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

function startPanel(client) {
  const password = process.env.PANEL_PASSWORD;
  if (!password) {
    console.log('ℹ️ Web paneli kapalı (PANEL_PASSWORD tanımlı değil).');
    return null;
  }
  if (password.length < 10) {
    console.error('❌ PANEL_PASSWORD en az 10 karakter olmalı; web paneli başlatılmadı.');
    return null;
  }

  const secureCookie = process.env.PANEL_COOKIE_SECURE === 'true';
  const trustProxy = process.env.PANEL_TRUST_PROXY === 'true';
  const sessions = new Map(); // token -> expiry
  const fails = new Map(); // ip -> { count, resetAt }

  const clientIp = (req) => (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;

  setInterval(() => {
    const now = Date.now();
    for (const [k, exp] of sessions) if (exp < now) sessions.delete(k);
    for (const [k, v] of fails) if (v.resetAt < now) fails.delete(k);
  }, 60_000).unref();

  const getSession = (req) => {
    const token = /(?:^|;\s*)retronex_session=([a-f0-9]{64})/.exec(req.headers.cookie ?? '')?.[1];
    return token && (sessions.get(token) ?? 0) > Date.now() ? token : null;
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('İstek çok büyük.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Geçersiz JSON.')); }
    });
    req.on('error', reject);
  });

  const SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };

  const refreshesTicketPanel = (key) => key.startsWith('ticket.panel.') || key.startsWith('ticket.cat.') || key === 'color.ticket';

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /api/session') return send(res, 200, { authenticated: !!getSession(req) });

    // Durum değiştiren isteklerde CSRF koruması (SameSite=Strict'e ek olarak)
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'retronex-panel') {
      return send(res, 403, { error: 'Geçersiz istek.' });
    }

    if (route === 'POST /api/login') {
      const ip = clientIp(req);
      const f = fails.get(ip);
      if (f && f.resetAt > Date.now() && f.count >= LOGIN_MAX_FAILS) {
        return send(res, 429, { error: 'Çok fazla başarısız deneme. 15 dakika sonra tekrar dene.' });
      }
      const body = await readJson(req);
      const good = crypto.timingSafeEqual(sha(body.password ?? ''), sha(password));
      if (!good) {
        const cur = f && f.resetAt > Date.now() ? f : { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
        cur.count++;
        fails.set(ip, cur);
        return send(res, 401, { error: 'Şifre hatalı.' });
      }
      fails.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_TTL_MS);
      return send(res, 200, { ok: true }, {
        'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureCookie ? '; Secure' : ''}`,
      });
    }

    const token = getSession(req);
    if (!token) return send(res, 401, { error: 'Giriş gerekli.' });

    if (route === 'POST /api/logout') {
      sessions.delete(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }

    if (route === 'GET /api/texts') return send(res, 200, { groups: texts.list(), samples: texts.SAMPLES });

    if (route === 'PUT /api/texts') {
      const { key, value } = await readJson(req);
      const err = texts.validate(key, value);
      if (err) return send(res, 400, { error: err });
      texts.setText(key, value);
      return send(res, 200, { ok: true, panelRefreshed: await maybeRefresh(key) });
    }

    if (route === 'POST /api/texts/reset') {
      const { key } = await readJson(req);
      if (!texts.defs.has(key)) return send(res, 400, { error: 'Bilinmeyen anahtar.' });
      texts.resetText(key);
      return send(res, 200, { ok: true, value: texts.defs.get(key).value, panelRefreshed: await maybeRefresh(key) });
    }

    if (route === 'POST /api/actions/ticket-panel') {
      try {
        return send(res, 200, { ok: true, result: await tickets.ensurePanel(client) });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    return send(res, 404, { error: 'Bulunamadı.' });
  }

  // Bilet paneli metinleri değişince Discord'daki mesajı da güncelle
  async function maybeRefresh(key) {
    if (!refreshesTicketPanel(key)) return null;
    try { return await tickets.ensurePanel(client); } catch (e) { return `hata: ${e.message}`; }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return await api(req, res, url);
      }
      const file = FILES[url.pathname];
      if (req.method !== 'GET' || !file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, file[0])), { 'Content-Type': file[1], 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    } catch (e) {
      if (!res.headersSent) send(res, e.message === 'İstek çok büyük.' ? 413 : 400, { error: e.message });
    }
  });

  const port = Number(process.env.PANEL_PORT) || 3000;
  const host = process.env.PANEL_HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`🌐 Web paneli: http://${host}:${port}`));
  return server;
}

module.exports = { startPanel };
