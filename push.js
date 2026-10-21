'use strict';
/* push.js: push alerts for Skycast (rain soon, frost and heat, best run window).
   Works only after the one-time setup (see the steps). Nothing here runs without it.
   Uses Node's built-in crypto, so there is nothing extra to install. */
const crypto = require('crypto');
let R = null;
try { R = require('./ratings.js'); } catch (e) { /* ratings.js missing: alerts that need it are skipped */ }

const SUBS = 'skycast:subs', KEY = 'skycast:sub:';
const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(String(s), 'base64url');

/* ---------- Web Push encryption (RFC 8291) and VAPID signing (RFC 8292) ---------- */
function hkdf(salt, ikm, info, len) { return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len)); }

function encrypt(payload, uaPublicB64, authB64, opt) {
  opt = opt || {};
  const ua = unb64u(uaPublicB64), auth = unb64u(authB64);
  const ecdh = crypto.createECDH('prime256v1');
  if (opt.asPrivate) ecdh.setPrivateKey(unb64u(opt.asPrivate)); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(ua);
  const salt = opt.salt ? unb64u(opt.salt) : crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]);
  const ikm = hkdf(auth, secret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);          // 0x02 marks the last (only) record
  const body = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.concat([salt, Buffer.from([0, 0, 0x10, 0]), Buffer.from([asPub.length]), asPub]);   // record size 4096
  return Buffer.concat([header, body]);
}

function vapidHeader(endpoint, pub, priv, subject) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const p = unb64u(pub);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), d: priv }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${pub}`;
}

function newKeys() {
  const e = crypto.createECDH('prime256v1');
  e.generateKeys();
  const priv = e.getPrivateKey();
  return { pub: b64u(e.getPublicKey()), priv: b64u(Buffer.concat([Buffer.alloc(32 - priv.length), priv])) };
}

async function sendPush(sub, payload, vapid, fetchFn) {
  const body = encrypt(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const res = await (fetchFn || fetch)(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'normal',
               Authorization: vapidHeader(sub.endpoint, vapid.pub, vapid.priv, vapid.sub) },
    body
  });
  return res.status;
}

/* ---------- what to tell one person (pure, easy to test) ---------- */
function buildMessages(rec, w) {
  const msgs = [], last = rec.last || {}, a = rec.alerts || {}, prefs = rec.prefs || {};
  if (!R) return msgs;
  const today = w.now.slice(0, 10), city = rec.place.name, F = prefs.temp === 'F';
  const temp = c => (F ? Math.round(c * 9 / 5 + 32) : Math.round(c)) + '°';
  R.setFormat({ temp, wind: k => Math.round(k) + ' km/h' });
  const crop = R.CROPS[prefs.crop] || R.CROPS.general;

  const n = w.nowcast;                                                     // rain starting soon
  if (a.rain && n && n.state === 'starts' && n.inMin <= 40) {
    const mark = today + ' ' + n.startT;
    if (last.rain !== mark) msgs.push({ payload: { title: `☔ Rain in ${n.inMin} min`, body: `Rain starts around ${R.fmtTime(n.startT)} in ${city}.`, tag: 'rain' }, mark: { rain: mark } });
  }

  if (a.frost && last.frost !== today) {                                  // frost or heat danger (once a day)
    const bad = R.plantAlerts(w.daily, crop).find(x => x.level === 'bad');
    if (bad) msgs.push({ payload: { title: `${bad.icon} ${bad.short}`, body: bad.text, tag: 'frost' }, mark: { frost: today } });
  }

  if (a.run && last.run !== today && w.hourly.length && w.hourly[0].humidity != null) {   // best run window about to start
    const L = prefs.limits || {}, cfg = {};
    if (L.tempMax) cfg.tempMax = L.tempMax;
    if (L.humidityMax) cfg.humidityMax = L.humidityMax;
    if (L.windMax) { cfg.windMax = L.windMax; cfg.windHard = L.windMax + 15; }
    if (L.uvMax) { cfg.uvMax = L.uvMax; cfg.uvHigh = L.uvMax + 3; }
    const rated = R.rateRunDay(w.hourly, cfg), win = R.bestRunWindows(rated)[0];
    if (win) {
      const h = rated[win.start].hour, mins = Math.round((new Date(h.time) - new Date(w.now)) / 60000);
      if (mins >= 20 && mins <= 75) {
        msgs.push({ payload: { title: '🏃 Best run window starts soon', body: `${R.fmtRange(h.t, rated[win.end].hour.t)} · ${temp(h.temp)} · ${win.label} conditions`, tag: 'run' }, mark: { run: today } });
      }
    }
  }
  return msgs;
}

/* ---------- the routes ---------- */
module.exports = function mount(app, ctx) {
  const kvCfg = () => {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? { url, token } : null;
  };
  const kv = ctx.kv || (async cmd => {
    const c = kvCfg();
    const r = await fetch(c.url, { method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  });
  const vapid = () => (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY, sub: process.env.VAPID_SUBJECT || 'mailto:skycast@example.com' } : null);
  const authed = req => {
    const s = process.env.CRON_SECRET;
    if (!s) return false;
    const k = String(req.query.key || (req.headers.authorization || '').replace(/^Bearer /, ''));
    return k.length === s.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(s));
  };
  const idOf = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
  const ready = () => !!(vapid() && (ctx.kv || kvCfg()) && process.env.CRON_SECRET);

  app.use('/api/push', ctx.express.json({ limit: '20kb' }));

  app.get('/api/push/status', (req, res) => {
    const missing = [];
    if (!vapid()) missing.push('security keys');
    if (!ctx.kv && !kvCfg()) missing.push('database');
    if (!process.env.CRON_SECRET) missing.push('CRON_SECRET');
    res.json({ enabled: missing.length === 0, key: process.env.VAPID_PUBLIC_KEY || null, missing });
  });

  // one-time page that creates your security keys (needs ?key=YOUR CRON_SECRET)
  app.get('/api/push/setup', (req, res) => {
    if (!authed(req)) return res.status(401).send('Add ?key=YOUR_CRON_SECRET to the link. Set CRON_SECRET in Vercel first.');
    const k = newKeys();
    res.type('html').send('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:20px;max-width:560px;line-height:1.5">' +
      '<h2>Skycast push keys</h2><p>Copy each value into <b>Vercel → your project → Settings → Environment Variables</b>, then redeploy.</p>' +
      '<p><b>VAPID_PUBLIC_KEY</b><br><textarea readonly rows=3 style="width:100%">' + k.pub + '</textarea></p>' +
      '<p><b>VAPID_PRIVATE_KEY</b> (keep it secret)<br><textarea readonly rows=2 style="width:100%">' + k.priv + '</textarea></p>' +
      '<p>If you already added keys, keep using those. Making new keys would stop alerts for people who already turned them on.</p></body>');
  });

  app.post('/api/push/subscribe', async (req, res) => {
    try {
      if (!ready()) return res.status(503).json({ error: 'Not set up' });
      const b = req.body || {}, s = b.sub || {}, pl = b.place || {};
      const ok = s.endpoint && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 600 && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string' &&
                 s.keys.p256dh.length < 200 && s.keys.auth.length < 100 && typeof pl.lat === 'number' && typeof pl.lon === 'number' && Math.abs(pl.lat) <= 90 && Math.abs(pl.lon) <= 180;
      if (!ok) return res.status(400).json({ error: 'Bad request' });
      const id = idOf(s.endpoint);
      const old = await kv(['GET', KEY + id]);
      if (!old && (await kv(['SCARD', SUBS])) >= 500) return res.status(429).json({ error: 'Full' });
      const al = b.alerts || {}, pr = b.prefs || {}, lim = pr.limits || {};
      const rec = {
        sub: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
        place: { name: String(pl.name || 'Your city').slice(0, 80), lat: pl.lat, lon: pl.lon },
        alerts: { rain: !!al.rain, frost: !!al.frost, run: !!al.run },
        prefs: { crop: String(pr.crop || 'general').slice(0, 20), temp: pr.temp === 'F' ? 'F' : 'C',
                 limits: { tempMax: +lim.tempMax || 25, humidityMax: +lim.humidityMax || 70, windMax: +lim.windMax || 15, uvMax: +lim.uvMax || 5 } },
        last: old ? (JSON.parse(old).last || {}) : {}, at: Date.now()
      };
      await kv(['SET', KEY + id, JSON.stringify(rec)]);
      await kv(['SADD', SUBS, id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  app.post('/api/push/unsubscribe', async (req, res) => {
    try {
      const ep = req.body && req.body.endpoint;
      if (!ready() || !ep) return res.json({ ok: true });
      const id = idOf(ep);
      await kv(['DEL', KEY + id]); await kv(['SREM', SUBS, id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  /* Run this every 15 minutes: https://YOUR-APP/api/cron?key=YOUR_CRON_SECRET */
  async function runCron(now) {
    const t0 = Date.now(), v = vapid(), out = { subscribers: 0, checked: 0, sent: 0, removed: 0, leftForNextRun: 0 };
    const ids = (await kv(['SMEMBERS', SUBS])) || [];
    out.subscribers = ids.length;
    const handle = async id => {
      const raw = await kv(['GET', KEY + id]);
      if (!raw) { await kv(['SREM', SUBS, id]); return; }
      const rec = JSON.parse(raw);
      out.checked++;
      let w; try { w = await ctx.getWeather(rec.place.lat, rec.place.lon); } catch (e) { return; }
      let changed = false;
      for (const m of buildMessages(rec, w)) {
        let st = 0; try { st = await sendPush(rec.sub, m.payload, v, ctx.fetchPush); } catch (e) { st = 0; }
        if (st === 404 || st === 410) { await kv(['DEL', KEY + id]); await kv(['SREM', SUBS, id]); out.removed++; return; }
        if (st >= 200 && st < 300) { out.sent++; rec.last = Object.assign(rec.last || {}, m.mark); changed = true; }
      }
      if (changed) await kv(['SET', KEY + id, JSON.stringify(rec)]);
    };
    for (let i = 0; i < ids.length; i += 4) {
      if (Date.now() - t0 > 7500) { out.leftForNextRun = ids.length - i; break; }     // stay inside Vercel's 10 second limit
      await Promise.all(ids.slice(i, i + 4).map(id => handle(id).catch(() => {})));
    }
    return out;
  }
  app.get('/api/cron', async (req, res) => {
    if (!authed(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (!ready()) return res.json({ skipped: 'push is not fully set up yet' });
    try { res.json(await runCron()); } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  mount.runCron = runCron;
};
module.exports.internals = { encrypt, vapidHeader, newKeys, buildMessages, sendPush };
