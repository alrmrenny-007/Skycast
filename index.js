const express = require('express');
const path = require('path');
const zlib = require('zlib');
const app = express();

/* ---------------------------------------------------------
   Pages and scripts (flat structure, one route per file)
   --------------------------------------------------------- */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/ratings.js', (req, res) => res.sendFile(path.join(__dirname, 'ratings.js')));
app.get('/extras.js', (req, res) => res.sendFile(path.join(__dirname, 'extras.js')));

/* ---------------------------------------------------------
   Install as an app: manifest, service worker, icons
   --------------------------------------------------------- */
app.get('/manifest.json', (req, res) => {
  res.type('application/manifest+json').json({
    name: 'Skycast',
    short_name: 'Skycast',
    description: 'Weather, garden planner, run planner and sleep forecast',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#1d2757',
    theme_color: '#1d2757',
    shortcuts: [
      { name: 'Widget view', short_name: 'Widget', url: '/?widget=1' },
      { name: 'Rain radar', short_name: 'Radar', url: '/?view=map' },
      { name: 'Run planner', short_name: 'Run', url: '/?view=run' },
      { name: 'Garden planner', short_name: 'Garden', url: '/?view=garden' },
      { name: 'Sleep forecast', short_name: 'Sleep', url: '/?view=sleep' }
    ],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  });
});

const SW = `
const CACHE = 'skycast-v5';
const SHELL = ['/', '/app.js', '/ratings.js', '/extras.js', '/manifest.json', '/icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first so updates show up straight away; falls back to the last saved copy when offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('/')))
  );
});
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Skycast', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || 'skycast', data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => (list.length ? list[0].focus() : self.clients.openWindow(url))));
});
`;
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript').send(SW);
});

/* Icons are drawn in code (no image files to upload). */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = buf => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makeIcon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const px = 1.4 / size;
  const circ = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
  const box = (x, y, x0, y0, x1, y1, rr) => {          // rounded box distance
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - rr, hy = (y1 - y0) / 2 - rr;
    const dx = Math.abs(x - cx) - hx, dy = Math.abs(y - cy) - hy;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rr;
  };
  const cover = d => Math.min(1, Math.max(0, 0.5 - d / px));
  const mix = (a, b, t) => a + (b - a) * t;
  let o = 0;
  for (let j = 0; j < size; j++) {
    raw[o++] = 0;
    for (let i = 0; i < size; i++) {
      const x = i / size, y = j / size;
      // background: blue to deep navy with a soft glow
      let r = mix(70, 22, y), g = mix(130, 30, y), b = mix(225, 80, y);
      const glow = Math.max(0, 1 - Math.hypot(x - 0.35, y - 0.3) / 0.7) * 0.35;
      r += (255 - r) * glow; g += (255 - g) * glow; b += (255 - b) * glow;
      // crescent moon
      const moon = Math.max(circ(x, y, 0.40, 0.38, 0.17), -circ(x, y, 0.47, 0.34, 0.15));
      let a = cover(moon);
      r = mix(r, 255, a); g = mix(g, 244, a); b = mix(b, 205, a);
      // cloud
      const cloud = Math.min(circ(x, y, 0.44, 0.66, 0.095), circ(x, y, 0.56, 0.59, 0.125),
                             circ(x, y, 0.68, 0.65, 0.095), box(x, y, 0.38, 0.62, 0.74, 0.745, 0.06));
      a = cover(cloud);
      const shade = 0.82 + 0.18 * (1 - Math.min(1, Math.max(0, (y - 0.48) / 0.28)));
      r = mix(r, 255 * shade, a); g = mix(g, 255 * shade, a); b = mix(b, 255, a);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = 255;
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const iconCache = {};
const sendIcon = size => (req, res) => {
  if (!iconCache[size]) iconCache[size] = makeIcon(size);
  res.set('Cache-Control', 'public, max-age=86400').type('image/png').send(iconCache[size]);
};
app.get('/icon-192.png', sendIcon(192));
app.get('/icon-512.png', sendIcon(512));
app.get('/apple-touch-icon.png', sendIcon(180));

/* ---------------------------------------------------------
   Weather API
   --------------------------------------------------------- */
app.get('/api/search', async (req, res) => {
  try {
    const q = encodeURIComponent(req.query.q || '');
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1`);
    const d = await r.json();
    if (!d.results) return res.status(404).json({ error: 'Not found' });
    const p = d.results[0];
    res.json({ name: p.name, country: p.country, cc: p.country_code, lat: p.latitude, lon: p.longitude });
  } catch (e) { res.status(500).json({ error: 'Search failed' }); }
});

// Turns GPS coordinates into a place name like "Makurdi, NG". Never fails the app.
app.get('/api/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const d = await r.json();
    const name = d.city || d.locality || d.principalSubdivision || null;
    res.json({ name, cc: d.countryCode || null });
  } catch (e) { res.json({ name: null, cc: null }); }
});

// Monthly climate averages for the crop calendar (3 past years from the Open-Meteo archive).
function buildClimate(daily, years) {
  const sum = Array(12).fill(0), cnt = Array(12).fill(0), frost = Array(12).fill(0), rain = Array(12).fill(0);
  daily.time.forEach((d, i) => {
    const m = parseInt(d.slice(5, 7), 10) - 1;
    const t = daily.temperature_2m_mean[i], mn = daily.temperature_2m_min[i], p = daily.precipitation_sum[i];
    if (t != null) { sum[m] += t; cnt[m]++; }
    if (mn != null && mn <= 1) frost[m]++;
    if (p != null) rain[m] += p;
  });
  return {
    meanT: sum.map((s, m) => (cnt[m] ? Math.round(s / cnt[m] * 10) / 10 : null)),
    frostDays: frost.map(f => Math.round(f / years * 10) / 10),
    rain: rain.map(r => Math.round(r / years)),
    years
  };
}
app.get('/api/climate', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon needed' });
  try {
    const y = new Date().getFullYear();
    const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=${y - 3}-01-01&end_date=${y - 1}-12-31` +
      `&daily=temperature_2m_mean,temperature_2m_min,precipitation_sum&timezone=auto`;
    const j = await fetch(u).then(r => r.json());
    if (!j.daily || !j.daily.time) throw new Error('no data');
    res.set('Cache-Control', 'public, s-maxage=86400, max-age=86400').json(buildClimate(j.daily, 3));
  } catch (e) { res.status(500).json({ error: 'Climate failed' }); }
});

const rd = (v, p) => (v == null ? null : Math.round(v * 10 ** p) / 10 ** p);
const at = (arr, k) => (arr && arr[k] != null ? arr[k] : null);

// "Rain in 20 minutes": looks at the next 2 hours in 15-minute steps.
function buildNowcast(m, curTime) {
  if (!m || !m.time || !m.precipitation) return null;
  const floor15 = curTime.slice(0, 14) + String(Math.floor(parseInt(curTime.slice(14, 16), 10) / 15) * 15).padStart(2, '0');
  let i = m.time.findIndex(t => t >= floor15);
  if (i < 0) return null;
  const slots = m.time.slice(i, i + 8).map((t, k) => ({ t: t.slice(11, 16), time: t, mm: m.precipitation[i + k] || 0 }));
  if (!slots.length) return null;
  const wet = s => s.mm >= 0.1;
  const mins = s => Math.max(0, Math.round((new Date(s.time) - new Date(curTime)) / 60000));
  if (wet(slots[0])) {
    const dry = slots.find(s => !wet(s));
    return { state: 'ongoing', endT: dry ? dry.t : null, inMin: 0 };
  }
  const w = slots.find(wet);
  return w ? { state: 'starts', startT: w.t, inMin: mins(w) } : { state: 'none' };
}

async function getWeather(lat, lon) {
  {
    const w = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,is_day,cloud_cover` +
      `&hourly=temperature_2m,weather_code,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
      `&timezone=auto&forecast_days=7`;
    // Extra requests are kept separate so a problem in one can never break the main weather.
    const x = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=relative_humidity_2m,wind_speed_10m,uv_index,precipitation_probability,precipitation,` +
      `soil_moisture_3_to_9cm,soil_temperature_6cm,evapotranspiration` +
      `&timezone=auto&forecast_days=3`;
    const n = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&minutely_15=precipitation&timezone=auto&forecast_days=2`;
    const a = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi`;
    const yq = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m&daily=temperature_2m_max,temperature_2m_min&past_days=1&forecast_days=1&timezone=auto`;

    const [wr, ex, nc, ar, yr] = await Promise.all([
      fetch(w).then(r => r.json()),
      fetch(x).then(r => r.json()).catch(() => null),
      fetch(n).then(r => r.json()).catch(() => null),
      fetch(a).then(r => r.json()).catch(() => ({})),
      fetch(yq).then(r => r.json()).catch(() => null)
    ]);
    if (!wr.current) throw new Error('no data');

    const cur = wr.current;
    const nowHour = cur.time.slice(0, 13) + ':00';
    let i = wr.hourly.time.findIndex(t => t >= nowHour);
    if (i < 0) i = 0;

    const eh = ex && ex.hourly && ex.hourly.time ? ex.hourly : null;
    let j = eh ? eh.time.findIndex(t => t >= nowHour) : -1;
    if (j < 0) j = 0;

    const hourly = wr.hourly.time.slice(i, i + 24).map((t, k) => ({
      time: t,
      t: t.slice(11, 16),
      temp: Math.round(wr.hourly.temperature_2m[i + k]),
      code: wr.hourly.weather_code[i + k],
      isDay: wr.hourly.is_day[i + k] === 1,
      humidity: eh ? rd(at(eh.relative_humidity_2m, j + k), 0) : null,
      wind: eh ? rd(at(eh.wind_speed_10m, j + k), 0) : null,
      uv: eh ? rd(at(eh.uv_index, j + k), 1) : null,
      pop: eh ? rd(at(eh.precipitation_probability, j + k), 0) : null,
      precip: eh ? rd(at(eh.precipitation, j + k), 1) : null,
      soilM: eh ? rd(at(eh.soil_moisture_3_to_9cm, j + k), 3) : null,
      soilT: eh ? rd(at(eh.soil_temperature_6cm, j + k), 0) : null,
      et: eh ? rd(at(eh.evapotranspiration, j + k), 2) : null
    }));

    // yesterday at the same hour, plus yesterday's high and low (for "3° warmer than yesterday")
    let yesterday = null;
    try {
      if (yr && yr.hourly && yr.daily) {
        const d0 = new Date(nowHour); d0.setDate(d0.getDate() - 1);
        const pad = n => String(n).padStart(2, '0');
        const target = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}T${pad(d0.getHours())}:00`;
        const yi = yr.hourly.time.indexOf(target);
        if (yi >= 0 && yr.hourly.temperature_2m[yi] != null) {
          yesterday = { temp: Math.round(yr.hourly.temperature_2m[yi]), max: Math.round(yr.daily.temperature_2m_max[0]), min: Math.round(yr.daily.temperature_2m_min[0]) };
        }
      }
    } catch (e) { yesterday = null; }

    const daily = wr.daily.time.map((d, k) => ({
      d,
      max: Math.round(wr.daily.temperature_2m_max[k]),
      min: Math.round(wr.daily.temperature_2m_min[k]),
      code: wr.daily.weather_code[k],
      sunrise: wr.daily.sunrise[k],
      sunset: wr.daily.sunset[k]
    }));

    return {
      temp: Math.round(cur.temperature_2m),
      code: cur.weather_code,
      isDay: cur.is_day === 1,
      cloud: cur.cloud_cover,
      now: cur.time,
      sunrise: wr.daily.sunrise[0],
      sunset: wr.daily.sunset[0],
      aqi: ar.current ? ar.current.us_aqi : null,
      nowcast: buildNowcast(nc && nc.minutely_15, cur.time),
      yesterday,
      hourly,
      daily
    };
  }
}

app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon needed' });
  try { res.json(await getWeather(lat, lon)); } catch (e) { res.status(500).json({ error: 'Weather failed' }); }
});

// Push alerts (optional): needs push.js next to this file and a few settings in Vercel.
try { require('./push.js')(app, { express, getWeather }); } catch (e) { console.log('Push alerts are not active:', e.message); }

if (require.main === module) {
  app.listen(3000, () => console.log('http://localhost:3000'));
}
module.exports = app;
