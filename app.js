'use strict';
/* =========================================================
   Skycast client app
   Modules: Store/Prefs/Units · Icons · FX · Sound · Tabs · Saved cities
            Data source · Run · Garden · Sleep · Reminder · Install · Main
   Rating maths lives in ratings.js
   ========================================================= */
const $ = id => document.getElementById(id);
const R = window.Ratings;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const RAIN = [51,53,55,56,57,61,63,65,66,67,80,81,82];
const SNOW = [71,73,75,77,85,86];
const STORM = [95,96,99];
const NAMES = {0:'Clear sky',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',48:'Foggy',
  51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Freezing drizzle',
  61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Showers',81:'Showers',
  82:'Heavy showers',85:'Snow showers',86:'Snow showers',95:'Thunderstorm',96:'Thunderstorm',99:'Thunderstorm'};
const ICON_CLOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICON_CAL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';

let data = null, Ctx = null, curPlace = null, curPhase = 0, loadedAt = Date.now(), mode = 'day';

function kindOf(c) {
  if (c <= 1) return 'clear';
  if (c === 2) return 'partly';
  if (c === 3) return 'cloud';
  if (c === 45 || c === 48) return 'fog';
  if (RAIN.includes(c)) return 'rain';
  if (SNOW.includes(c)) return 'snow';
  if (STORM.includes(c)) return 'storm';
  return 'cloud';
}

/* =========================================================
   MODULE: storage, preferences, units
   ========================================================= */
const Store = {
  get(k, d) { try { const v = localStorage.getItem('skycast.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('skycast.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
const DEFAULT_LIMITS = { tempMax: 25, humidityMax: 70, windMax: 15, uvMax: 5 };
const Prefs = Object.assign({ temp: 'C', wind: 'kmh', crop: 'general', remind: false }, Store.get('prefs', {}));
Prefs.limits = Object.assign({}, DEFAULT_LIMITS, Prefs.limits || {});
const savePrefs = () => Store.set('prefs', Prefs);

const fmtT = c => (Prefs.temp === 'F' ? Math.round(c * 9 / 5 + 32) : Math.round(c)) + '°';
const fmtW = k => (Prefs.wind === 'mph' ? Math.round(k * 0.621371) + ' mph' : Math.round(k) + ' km/h');
function applyUnits() { if (R) R.setFormat({ temp: fmtT, wind: fmtW }); }

/* =========================================================
   MODULE: moon + clay icons
   ========================================================= */
function moonPhase(date) {
  const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  return (((date.getTime() - ref) / 86400000) % syn + syn) % syn / syn;
}
function moonName(p) {
  if (p < 0.03 || p > 0.97) return 'New moon';
  if (p < 0.22) return 'Waxing crescent';
  if (p < 0.28) return 'First quarter';
  if (p < 0.47) return 'Waxing gibbous';
  if (p < 0.53) return 'Full moon';
  if (p < 0.72) return 'Waning gibbous';
  if (p < 0.78) return 'Last quarter';
  return 'Waning crescent';
}
function moonPath(p, r) {
  const rx = r * Math.abs(Math.cos(2 * Math.PI * p));
  if (p < 0.5) {
    const s = p < 0.25 ? 0 : 1;
    return `M0 ${-r} A${r} ${r} 0 0 1 0 ${r} A${rx} ${r} 0 0 ${s} 0 ${-r} Z`;
  }
  const s = p < 0.75 ? 0 : 1;
  return `M0 ${-r} A${r} ${r} 0 0 0 0 ${r} A${rx} ${r} 0 0 ${s} 0 ${-r} Z`;
}
function cloud(v, tf) {
  const s = v === 'd' ? 'sphereD' : 'sphereW', b = v === 'd' ? 'baseD' : 'baseW';
  return `<g transform="${tf || ''}"><rect x="24" y="72" width="78" height="22" rx="11" fill="url(#${b})"/>` +
    `<circle cx="32" cy="72" r="20" fill="url(#${s})"/><circle cx="54" cy="52" r="26" fill="url(#${s})"/>` +
    `<circle cx="80" cy="60" r="22" fill="url(#${s})"/><circle cx="92" cy="77" r="16" fill="url(#${s})"/></g>`;
}
function sunShape(cx, cy, r) {
  return `<circle cx="${cx}" cy="${cy}" r="${r * 1.8}" fill="url(#sunGlow)"/>` +
         `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sunGrad)"/>`;
}
function moonShape(cx, cy, r, p) {
  return `<g transform="translate(${cx},${cy})"><circle r="${r * 1.9}" fill="url(#moonGlow)"/>` +
         `<circle r="${r}" fill="rgba(150,165,215,.12)"/><path d="${moonPath(p, r)}" fill="url(#moonGrad)"/></g>`;
}
function drops(list) {
  return list.map(([x, y, d]) => `<g transform="translate(${x},${y})"><path class="drop" style="animation-delay:${d}s" ` +
    `d="M0 0C-5 7-5 12 0 12C5 12 5 7 0 0Z" fill="url(#dropGrad)"/></g>`).join('');
}
function icon(kind, isDay, p) {
  let s = '';
  if (kind === 'clear') s = isDay ? sunShape(60, 60, 28) : moonShape(60, 62, 32, p);
  else if (kind === 'partly') s = isDay
    ? sunShape(44, 44, 22) + cloud('w', 'translate(14,18) scale(.85)')
    : moonShape(46, 68, 28, p) + cloud('d', 'translate(54,2) scale(.55)');
  else if (kind === 'cloud') s = cloud('d', 'translate(-2,-14) scale(.75)') + cloud('w', 'translate(8,10) scale(.88)');
  else if (kind === 'fog') s = cloud('w', 'translate(0,-12) scale(.92)') +
    `<rect x="30" y="86" width="60" height="6" rx="3" fill="rgba(255,255,255,.75)"/>` +
    `<rect x="40" y="98" width="50" height="6" rx="3" fill="rgba(255,255,255,.75)"/>`;
  else if (kind === 'rain') s = cloud('w', 'translate(2,-14) scale(.96)') + drops([[40,84,0],[58,92,.4],[76,84,.8],[92,92,.2]]);
  else if (kind === 'storm') s = `<ellipse cx="60" cy="92" rx="36" ry="14" fill="url(#glowB)"/>` +
    `<polygon class="bolt" points="66,66 50,94 62,94 56,116 84,84 70,84 80,66" fill="url(#boltGrad)"/>` +
    cloud('w', 'translate(2,-14) scale(.96)') + drops([[36,86,0],[88,86,.5]]);
  else if (kind === 'snow') {
    s = cloud('w', 'translate(2,-14) scale(.96)');
    [[40,90,0],[60,100,.8],[82,90,1.6]].forEach(([x, y, d]) => {
      s += `<circle class="flake" style="animation-delay:${d}s" cx="${x}" cy="${y}" r="4.5" fill="#fff"/>`;
    });
  }
  return `<svg viewBox="0 0 120 120" class="ic" aria-hidden="true">${s}</svg>`;
}

(function makeHill() {
  const W = 380, H = 70;
  const y = x => 26 + 9 * Math.sin(x / W * Math.PI * 1.8 + .4) + 4 * Math.sin(x / W * Math.PI * 4.6 + 1.3);
  const all = [];
  for (let x = 0; x <= W; x += 4) all.push([x, y(x)]);
  const toPath = pts => 'M' + pts.map(p => p[0] + ',' + p[1].toFixed(1)).join(' L');
  const line = toPath(all), right = all.filter(p => p[0] >= W * 0.55);
  let bumps = '';
  for (let x = W * 0.55; x <= W; x += 11) {
    bumps += `<circle cx="${x.toFixed(0)}" cy="${(y(x) - 1.5 - ((x * 7) % 3)).toFixed(1)}" r="${(4 + ((x * 3) % 3)).toFixed(1)}" fill="#fff"/>`;
  }
  let ice = '';
  [292, 312, 334, 352, 372].forEach((x, i) => {
    const yy = y(x) + 3, len = 9 + (i % 3) * 5;
    ice += `<path d="M${x - 3},${yy} L${x + 3},${yy} L${x},${yy + len}Z" fill="#eaf5ff"/>`;
  });
  let drips = '';
  [300, 332, 362].forEach((x, i) => {
    const yy = y(x) + 2;
    drips += `<g class="dr" style="animation-delay:${i * .8}s"><ellipse cx="${x}" cy="${yy}" rx="5" ry="3" fill="#bcd9ff"/>` +
             `<path d="M${x - 3},${yy} L${x + 3},${yy} L${x},${yy + 13}Z" fill="#9fc8ff"/></g>`;
  });
  $('hillBox').innerHTML =
    `<svg class="hill" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
    `<path class="fillp" d="${line} L${W},${H} L0,${H}Z"/>` +
    `<path d="${line}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.5"/>` +
    `<g class="snowcap"><path d="${toPath(right)}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>${bumps}${ice}</g>` +
    `<g class="dripcap">${drips}</g></svg>`;
})();

(function makeStars() {
  const box = $('stars');
  for (let i = 0; i < 45; i++) {
    const s = document.createElement('div'), size = 1 + Math.random() * 2;
    s.className = 'star';
    s.style.width = s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 55 + '%';
    s.style.animationDelay = Math.random() * 3 + 's';
    s.style.animationDuration = (2 + Math.random() * 3) + 's';
    box.appendChild(s);
  }
})();

/* =========================================================
   MODULE: falling rain / snow
   ========================================================= */
const cv = $('fx'), cx = cv.getContext('2d');
let fxMode = null, parts = [], raf = 0, lastT = 0, W = 0, H = 0, limit = 0;

function size() {
  const card = $('card').getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  W = card.width; H = card.height;
  cv.width = W * dpr; cv.height = H * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  limit = Tabs.active === 'weather' ? $('panel').getBoundingClientRect().top - card.top + 24 : H;
}
function spawn(init) {
  const x = Math.random() * W, y = init ? Math.random() * limit : -20;
  if (fxMode === 'rain') return { x, y, v: 11 + Math.random() * 9, l: 10 + Math.random() * 14 };
  return { x, y, v: .8 + Math.random() * 1.4, r: 1 + Math.random() * 2.4, ph: Math.random() * 6.28 };
}
function setFx(m, n) {
  fxMode = m; size(); parts = [];
  if (!m || reduce) { cancelAnimationFrame(raf); raf = 0; cx.clearRect(0, 0, W, H); return; }
  for (let i = 0; i < n; i++) parts.push(spawn(true));
  if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
}
function tick(t) {
  const dt = Math.min(2.5, (t - lastT) / 16.67); lastT = t;
  cx.clearRect(0, 0, W, H);
  if (fxMode === 'rain') {
    cx.strokeStyle = 'rgba(190,212,255,.5)'; cx.lineWidth = 1.3; cx.lineCap = 'round'; cx.beginPath();
    for (const p of parts) {
      p.y += p.v * dt; p.x -= p.v * .12 * dt;
      cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.l * .12, p.y + p.l);
      if (p.y > limit) Object.assign(p, spawn(false));
    }
    cx.stroke();
  } else if (fxMode === 'snow') {
    cx.fillStyle = 'rgba(255,255,255,.92)';
    for (const p of parts) {
      p.y += p.v * dt; p.ph += .02 * dt; p.x += Math.sin(p.ph) * .5 * dt;
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.283); cx.fill();
      if (p.y > limit) Object.assign(p, spawn(false));
    }
  }
  raf = requestAnimationFrame(tick);
}
window.addEventListener('resize', () => { if (fxMode) size(); });

/* =========================================================
   MODULE: ambient weather sound (synthesised, no audio files)
   ========================================================= */
const Sound = {
  ctx: null, master: null, noise: null, nodes: [], timers: [], on: false, kind: null,
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0; this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 3, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return true;
  },
  src() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(); return s; },
  layer(type, freq, q, gain) {
    const c = this.ctx, s = this.src(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(this.master);
    this.nodes.push(s, f, g);
    return f;
  },
  build(kind) {
    this.teardown();
    const c = this.ctx;
    if (kind === 'rain' || kind === 'storm') { this.layer('bandpass', 1400, .5, .55); this.layer('highpass', 5000, .7, .12); }
    if (kind === 'storm') this.thunder();
    if (kind === 'wind' || kind === 'calm') {
      const f = this.layer('lowpass', kind === 'wind' ? 420 : 260, .7, kind === 'wind' ? .7 : .35);
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = .12; lg.gain.value = kind === 'wind' ? 220 : 90;
      lfo.connect(lg); lg.connect(f.frequency); lfo.start();
      this.nodes.push(lfo, lg);
    }
  },
  thunder() {
    const go = () => {
      if (!this.on || this.kind !== 'storm') return;
      const c = this.ctx, s = this.src(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
      f.type = 'lowpass'; f.frequency.value = 150;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.9, t + .4); g.gain.exponentialRampToValueAtTime(.001, t + 3.5);
      s.connect(f); f.connect(g); g.connect(this.master);
      setTimeout(() => { try { s.stop(); } catch (e) { /* already stopped */ } }, 3800);
      this.timers.push(setTimeout(go, 9000 + Math.random() * 14000));
    };
    this.timers.push(setTimeout(go, 4000));
  },
  teardown() {
    this.timers.forEach(clearTimeout); this.timers = [];
    this.nodes.forEach(n => { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* ignore */ } });
    this.nodes = [];
  },
  async start(kind) {
    if (!this.init()) return false;
    await this.ctx.resume();
    this.on = true; this.kind = kind; this.build(kind);
    this.master.gain.cancelScheduledValues(0);
    this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(.5, this.ctx.currentTime + 1.5);
    return true;
  },
  stop() {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.cancelScheduledValues(0);
    this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + .8);
    setTimeout(() => { if (!this.on) this.teardown(); }, 1000);
  },
  set(kind) { if (this.on && kind !== this.kind) { this.kind = kind; this.build(kind); } }
};
function soundKindFor(d) {
  const k = kindOf(d.code);
  if (k === 'storm') return 'storm';
  if (k === 'rain') return 'rain';
  if (k === 'snow' || d.temp <= 2) return 'wind';
  return 'calm';
}
function paintSound() {
  const b = $('soundBtn');
  b.setAttribute('aria-pressed', Sound.on);
  b.textContent = Sound.on ? '🔊' : '🔈';
}

/* =========================================================
   MODULE: views (dock) + Day/Week toggle
   ========================================================= */
const Tabs = {
  active: 'weather',
  show(name) {
    this.active = name;
    $('card').dataset.view = name;
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
    document.querySelectorAll('.dock [data-go]').forEach(b => b.setAttribute('aria-pressed', b.dataset.go === name));
    $('toggle').classList.toggle('away', name !== 'weather');
    $('views').scrollTop = 0;
    if (fxMode) size();
  }
};
document.querySelectorAll('.dock [data-go]').forEach(b =>
  b.addEventListener('click', () => Tabs.show(Tabs.active === b.dataset.go ? 'weather' : b.dataset.go)));
document.querySelectorAll('#toggle [data-m]').forEach(b =>
  b.addEventListener('click', () => { setMode(b.dataset.m); Tabs.show('weather'); }));

function setMode(m) {
  mode = m;
  $('toggle').classList.toggle('week', m === 'week');
  document.querySelectorAll('#toggle [data-m]').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
  document.querySelectorAll('#tlabels [data-l]').forEach(s => s.classList.toggle('on', s.dataset.l === m));
  $('fLbl').innerHTML = (m === 'day' ? ICON_CLOCK : ICON_CAL) + ' Forecast';
  renderForecast();
}

/* =========================================================
   MODULE: saved cities
   ========================================================= */
const Saved = {
  list: Store.get('saved', []),
  key: p => (+p.lat).toFixed(2) + ',' + (+p.lon).toFixed(2),
  has(p) { return !!p && this.list.some(x => this.key(x) === this.key(p)); },
  toggle(p) {
    if (!p) return;
    if (this.has(p)) this.list = this.list.filter(x => this.key(x) !== this.key(p));
    else this.list.push({ name: p.name, lat: p.lat, lon: p.lon });
    Store.set('saved', this.list); this.render();
  },
  remove(i) { this.list.splice(i, 1); Store.set('saved', this.list); this.render(); },
  render() {
    $('saved').innerHTML = this.list.map((p, i) =>
      `<span class="sc"><button type="button" class="scgo" data-i="${i}">${p.name}</button>` +
      `<button type="button" class="scx" data-i="${i}" aria-label="Remove ${p.name}">×</button></span>`).join('');
    const saved = this.has(curPlace);
    const b = $('saveBtn');
    b.setAttribute('aria-pressed', saved);
    b.textContent = saved ? '★ Saved (tap to remove)' : '☆ Save this city';
    b.disabled = !curPlace;
  }
};
$('saved').addEventListener('click', e => {
  const go = e.target.closest('.scgo'), x = e.target.closest('.scx');
  if (go) { const p = Saved.list[+go.dataset.i]; if (p) { openSearch(false); load(p.lat, p.lon, p.name); } }
  else if (x) Saved.remove(+x.dataset.i);
});
$('saveBtn').addEventListener('click', () => Saved.toggle(curPlace));

/* =========================================================
   MODULE: data source (live fetch + mock fallback)
   ========================================================= */
const Config = {
  // Add ?mock=1 to the link to force demo data.
  forceMock: new URLSearchParams(location.search).has('mock'),
  // LIVE FETCH PLACEHOLDER: point this at your own soil sensor or farm API.
  // It should return JSON such as { "moisture": 0.27 } (volumetric water content, 0 to 1).
  // Leave as null to use the soil model from Open-Meteo.
  soilSensorUrl: null,
  parseSensor: j => (j && typeof j.moisture === 'number' ? j.moisture : null)
};
const Mock = {
  fill(hours, force) {
    let filled = 0, total = 0;
    const out = hours.map((h, i) => {
      const hr = parseInt(h.t.slice(0, 2), 10), f = Object.assign({}, h);
      const set = (k, v) => { total++; if (force || f[k] == null) { f[k] = v; filled++; } };
      set('uv', h.isDay ? +Math.max(0, 9 * Math.sin(Math.PI * (hr - 6) / 12)).toFixed(1) : 0);
      set('humidity', Math.round(55 + 25 * Math.cos((hr - 5) * Math.PI / 12)));
      set('wind', Math.round(8 + 6 * Math.sin((hr - 9) * Math.PI / 12)));
      set('pop', i >= 5 && i <= 7 ? 80 : 10);          // demo rain event ~5 hours ahead
      set('precip', i >= 5 && i <= 6 ? 2.4 : 0);
      set('soilM', 0.27);
      set('soilT', Math.round(h.temp - 3));
      set('et', 0.1);
      return f;
    });
    return { hours: out, filled, total };
  }
};
async function resolveData(d) {
  const base = (d.hourly || []).slice(0, 24);
  if (!base.length) return null;
  const m = Mock.fill(base, Config.forceMock);
  let source = m.filled === 0 ? 'live' : m.filled === m.total ? 'mock' : 'mixed';
  let moisture = m.hours[0].soilM, soilT = m.hours[0].soilT;
  if (Config.soilSensorUrl) {
    try {
      const j = await (await fetch(Config.soilSensorUrl)).json();
      const v = Config.parseSensor(j);
      if (v != null) { moisture = v; if (source === 'mock') source = 'mixed'; }
    } catch (e) { /* sensor offline: keep model value */ }
  }
  return { hours: m.hours, source, moisture, soilT, aqi: d.aqi };
}
function setBadges(src) {
  const text = { live: 'Live data', mixed: 'Partly demo data', mock: 'Demo data' }[src];
  document.querySelectorAll('[data-badge]').forEach(b => { b.textContent = text; b.dataset.src = src; });
}

/* =========================================================
   MODULE: shared UI helpers
   ========================================================= */
const toneOf = l => ({ Great: 'good', Ideal: 'good', Fair: 'mid', Okay: 'mid' })[l] || 'bad';
const list = items => `<ul class="list">${items.map(x => `<li>${x}</li>`).join('')}</ul>`;
const tile = (label, value, tone, hint) =>
  `<div class="tile ${tone}"><small>${label}</small><b>${value}</b><em>${hint}</em></div>`;
function aqiLabel(v) { return v <= 50 ? 'Good' : v <= 100 ? 'Moderate' : v <= 150 ? 'Unhealthy for some' : 'Unhealthy'; }
function renderStrip(el, rated, sel, onPick) {
  const x = el.scrollLeft;
  el.innerHTML = rated.map((r, i) => {
    const t = r.hour.t, lab = i === 0 ? 'Now' : R.fmtShort(t);
    return `<button type="button" class="bar ${toneOf(r.label)}" data-i="${i}" aria-pressed="${i === sel}" ` +
      `aria-label="${R.fmtHour(t)}: ${r.label}, score ${r.score}">` +
      `<span class="track"><span class="fill" style="height:${Math.max(8, r.score)}%"></span></span>` +
      `<span class="hr">${lab}</span></button>`;
  }).join('');
  el.scrollLeft = x;
  el.onclick = e => { const b = e.target.closest('.bar'); if (b) onPick(+b.dataset.i); };
}
function scrollToSel(el, sel) { const b = el.children[sel]; if (b) el.scrollLeft = Math.max(0, b.offsetLeft - 40); }

/* =========================================================
   MODULE: Run & Fitness
   ========================================================= */
const RunView = {
  sel: 0, rated: [], wins: [], ctx: null, remindMsg: '',
  cfg() {
    const l = Prefs.limits;
    return Object.assign({}, R.CONFIG.run, { tempMax: l.tempMax, humidityMax: l.humidityMax, windMax: l.windMax,
      windHard: l.windMax + 15, uvMax: l.uvMax, uvHigh: l.uvMax + 3 });
  },
  render(ctx) { this.ctx = ctx; this.refresh(false); scrollToSel($('runStrip'), this.sel); },
  refresh(keepSel) {
    this.rated = R.rateRunDay(this.ctx.hours, this.cfg());
    this.wins = R.bestRunWindows(this.rated);
    this.sel = keepSel ? Math.min(this.sel, this.rated.length - 1) : (this.wins.length ? this.wins[0].start : 0);
    this.paintBest(); this.paintRemind(); this.paintAll(); this.paintLimits();
  },
  pick(i) { this.sel = i; this.paintAll(); },
  msUntil(i) { return new Date(this.rated[i].hour.time) - new Date(data.now) - (Date.now() - loadedAt); },
  paintBest() {
    const w = this.wins[0];
    const air = this.ctx.aqi != null ? `<p class="note" style="margin-top:6px">Air quality ${this.ctx.aqi} · ${aqiLabel(this.ctx.aqi)}</p>` : '';
    if (!w) {
      $('runBest').innerHTML = `<p class="kicker">Best time to run</p><p class="big">No good window</p>` +
        `<p class="sub">The next 24 hours look rough. Try an indoor session.</p>${air}`;
      return;
    }
    const a = this.rated[w.start].hour, b = this.rated[w.end].hour;
    const until = this.msUntil(w.start), mins = Math.round(until / 60000);
    const open = until <= 0 && this.msUntil(w.end) + 3600000 > 0;
    const note = mins > 0 && mins <= 120 ? `<br><span class="startpill">Starts in ${mins} min</span>` : open ? `<br><span class="startpill">Window is open now</span>` : '';
    $('runBest').innerHTML = `<p class="kicker">Best time to run</p>` +
      `<p class="big">${R.fmtRange(a.t, b.t)}</p>` +
      `<p class="sub"><span class="pill ${toneOf(w.label)}">${w.label}</span> &nbsp;${fmtT(a.temp)} · humidity ${a.humidity}% · UV ${a.uv}${note}</p>${air}`;
  },
  paintRemind() {
    $('remindCard').innerHTML =
      `<div class="row"><div><h3 style="margin:0;color:var(--ink)">🔔 Run reminder</h3>` +
      `<p class="note">Nudge me 30 minutes before my best window</p></div>` +
      `<button class="sw" id="remindSw" role="switch" aria-checked="${Prefs.remind}" aria-label="Run reminder"></button></div>` +
      `<p class="note" id="remindNote">${this.remindMsg || 'Works while Skycast is open or running in the background on your phone.'}</p>`;
    $('remindSw').onclick = () => Reminder.toggle();
  },
  paintAll() {
    renderStrip($('runStrip'), this.rated, this.sel, i => this.pick(i));
    const r = this.rated[this.sel], h = r.hour, c = this.cfg();
    $('runDetail').innerHTML =
      `<div class="row"><h3>${this.sel === 0 ? 'Now' : R.fmtHour(h.t)}</h3><span class="pill ${toneOf(r.label)}">${r.label} · ${r.score}</span></div>` +
      `<div class="tiles">` +
        tile('Temperature', fmtT(h.temp), h.temp <= c.tempMax ? 'ok' : 'bad', `Target under ${fmtT(c.tempMax)}`) +
        tile('Humidity', h.humidity + '%', h.humidity <= c.humidityMax ? 'ok' : 'bad', `Target under ${c.humidityMax}%`) +
        tile('Wind', fmtW(h.wind), h.wind <= c.windMax ? 'ok' : h.wind <= c.windHard ? 'warn' : 'bad', `Calm under ${fmtW(c.windMax)}`) +
        tile('UV index', h.uv, h.uv <= c.uvMax ? 'ok' : h.uv < c.uvHigh ? 'warn' : 'bad', `Low under ${c.uvMax}`) +
      `</div>` +
      (r.reasons.length ? list(r.reasons) : `<p class="note">All four conditions are within your limits.</p>`);

    const g = R.gearAdvice(r, h);
    $('runGear').innerHTML = `<h3>Gear &amp; safety</h3>` +
      `<h4>What to wear</h4>${list(g.outfit)}` +
      `<h4>Hydration</h4><p class="hyd">💧 <b>${g.hydration.ml} ml</b> per hour</p><p class="note">${g.hydration.text}</p>` +
      `<h4>Safety</h4>${list(g.safety)}`;
  },
  paintLimits() {
    const L = Prefs.limits;
    const rows = [
      ['tempMax', 'Max temperature', fmtT(L.tempMax)],
      ['humidityMax', 'Max humidity', L.humidityMax + '%'],
      ['windMax', 'Max wind', fmtW(L.windMax)],
      ['uvMax', 'Max UV index', String(L.uvMax)]
    ];
    $('limitsCard').innerHTML = `<h3>Your limits</h3>` + rows.map(([k, label, val]) =>
      `<div class="lim"><span>${label}</span><span class="stp">` +
      `<button class="step" data-k="${k}" data-d="-1" aria-label="Lower ${label}">−</button>` +
      `<span class="lv">${val}</span>` +
      `<button class="step" data-k="${k}" data-d="1" aria-label="Raise ${label}">+</button></span></div>`).join('') +
      `<button class="linkbtn" id="limReset">Reset to defaults</button>`;
  }
};
const LIMIT_RULES = { tempMax: [1, 10, 38], humidityMax: [5, 40, 95], windMax: [2, 5, 40], uvMax: [1, 2, 10] };
$('limitsCard').addEventListener('click', e => {
  const s = e.target.closest('.step');
  if (s) {
    const [step, lo, hi] = LIMIT_RULES[s.dataset.k];
    Prefs.limits[s.dataset.k] = Math.min(hi, Math.max(lo, Prefs.limits[s.dataset.k] + step * +s.dataset.d));
    savePrefs(); RunView.refresh(true); Reminder.schedule();
  } else if (e.target.id === 'limReset') {
    Prefs.limits = Object.assign({}, DEFAULT_LIMITS); savePrefs(); RunView.refresh(false); Reminder.schedule();
  }
});

/* =========================================================
   MODULE: run reminder (works while the app is open)
   ========================================================= */
const Reminder = {
  timer: 0,
  async permission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'default') return await Notification.requestPermission();
    return Notification.permission;
  },
  async toggle() {
    if (!Prefs.remind) {
      const p = await this.permission();
      if (p === 'unsupported') RunView.remindMsg = 'This browser does not support notifications.';
      else if (p !== 'granted') RunView.remindMsg = 'Notifications are blocked. Allow them for this site in your browser settings.';
      else { Prefs.remind = true; RunView.remindMsg = ''; }
    } else { Prefs.remind = false; RunView.remindMsg = ''; }
    savePrefs(); this.schedule(); RunView.paintRemind();
  },
  schedule() {
    clearTimeout(this.timer);
    if (!Prefs.remind || !RunView.wins.length || !data) return;
    const w = RunView.wins[0], delay = RunView.msUntil(w.start) - 30 * 60000;
    if (delay <= 0 || delay > 2147000000) return;
    this.timer = setTimeout(() => {
      const a = RunView.rated[w.start].hour, b = RunView.rated[w.end].hour;
      this.notify('Best run window starts in 30 minutes', `${R.fmtRange(a.t, b.t)} · ${fmtT(a.temp)} · ${w.label} conditions`);
    }, delay);
  },
  async notify(title, body) {
    const opts = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'run-window' };
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
    } catch (e) { try { new Notification(title, opts); } catch (e2) { /* not supported */ } }
  }
};

/* =========================================================
   MODULE: Garden
   ========================================================= */
const GardenView = {
  sel: 0, rated: [], wins: [], ctx: null, crop: null, pcfg: null,
  render(ctx) {
    this.ctx = ctx;
    this.crop = R.CROPS[Prefs.crop] || R.CROPS.general;
    this.pcfg = R.cropConfig(this.crop);
    this.rated = R.ratePlantingDay(ctx.hours, this.pcfg.plant);
    this.wins = R.bestPlantingWindows(this.rated);
    this.sel = this.wins.length ? this.wins[0].start : 0;
    this.paintCrops(); this.paintWarn(); this.paintIrrigation(); this.paintBest(); this.paintAll(); this.paintSow();
    scrollToSel($('plantStrip'), this.sel);
  },
  pick(i) { this.sel = i; this.paintAll(); },
  paintCrops() {
    $('crops').innerHTML = Object.keys(R.CROPS).map(k =>
      `<button type="button" class="crop" role="radio" aria-checked="${k === Prefs.crop}" data-k="${k}">${R.CROPS[k].emoji} ${R.CROPS[k].name}</button>`).join('');
  },
  paintWarn() {
    const alerts = R.plantAlerts(data.daily, this.crop);
    $('warnCard').innerHTML = `<h3>Frost &amp; heat watch · ${this.crop.name}</h3>` + (alerts.length
      ? `<div class="warns">${alerts.slice(0, 4).map(a => `<div class="wn ${a.level}"><span class="wi" aria-hidden="true">${a.icon}</span><span>${a.text}</span></div>`).join('')}</div>`
      : `<p class="note">✅ No frost or heat risk for ${this.crop.name} in the next 3 days.</p>`);
  },
  paintIrrigation() {
    const a = R.irrigationAdvice(this.ctx.hours, this.ctx.moisture, this.pcfg.irrigation);
    const el = $('irrAlert');
    el.dataset.status = a.status;
    el.innerHTML = `<span class="ico" aria-hidden="true">${{ skip: '🌧️', water: '💦', ok: '🌿' }[a.status]}</span>` +
      `<div><p class="head2">${a.headline}</p><p class="sub2">${a.detail}</p></div>`;

    const s = a.soil, soilT = this.ctx.soilT;
    $('soilCard').innerHTML = `<h3>Soil &amp; rain</h3>` +
      (s ? `<div class="gauge" role="img" aria-label="Soil moisture ${s.pct} percent, ${s.label}">` +
           `<i style="left:${Math.min(97, s.pct / 50 * 100)}%"></i></div>` +
           `<div class="gl"><span>Dry</span><span>Moist</span><span>Wet</span></div>`
         : `<p class="note">Soil moisture is not available for this location.</p>`) +
      `<div class="tiles t3">` +
        tile('Moisture', s ? s.pct + '%' : '--', s ? s.tone : 'warn', s ? s.label : 'No data') +
        tile('Soil temp', soilT != null ? fmtT(soilT) : '--', 'ok', 'At 6 cm') +
        tile('Rain 24h', a.totalRain + ' mm', a.totalRain >= 3 ? 'wet' : 'ok', a.rainAt ? 'From ' + R.fmtHour(a.rainAt) : 'None due') +
      `</div>`;
  },
  paintBest() {
    const w = this.wins[0];
    if (!w) {
      $('plantBest').innerHTML = `<p class="kicker">Best planting window</p><p class="big">None today</p>` +
        `<p class="sub">Heat, strong UV or rain make the next 24 hours poor for planting ${this.crop.name === 'General' ? '' : this.crop.name}.</p>`;
      return;
    }
    const a = this.rated[w.start].hour, b = this.rated[w.end].hour;
    $('plantBest').innerHTML = `<p class="kicker">Best planting window · ${this.crop.name}</p>` +
      `<p class="big">${R.fmtRange(a.t, b.t)}</p>` +
      `<p class="sub"><span class="pill ${toneOf(w.label)}">${w.label}</span> &nbsp;UV ${a.uv} · ${fmtT(a.temp)} · wind ${fmtW(a.wind)}</p>`;
  },
  paintAll() {
    renderStrip($('plantStrip'), this.rated, this.sel, i => this.pick(i));
    const r = this.rated[this.sel], h = r.hour, c = this.pcfg.plant;
    $('plantDetail').innerHTML =
      `<div class="row"><h3>${this.sel === 0 ? 'Now' : R.fmtHour(h.t)}</h3><span class="pill ${toneOf(r.label)}">${r.label} · ${r.score}</span></div>` +
      `<div class="tiles t3">` +
        tile('Temp', fmtT(h.temp), h.temp >= c.tempIdealLow && h.temp <= c.tempIdealHigh ? 'ok' : 'warn', `${fmtT(c.tempIdealLow)}–${fmtT(c.tempIdealHigh)} ideal`) +
        tile('UV', h.uv, h.uv <= c.uvMax ? 'ok' : 'bad', `Under ${c.uvMax} ideal`) +
        tile('Wind', fmtW(h.wind), h.wind <= c.windMax ? 'ok' : 'warn', `Under ${fmtW(c.windMax)}`) +
      `</div>` +
      (r.reasons.length ? list(r.reasons) : `<p class="note">Gentle sun and mild temperatures. Good for transplanting and sowing.</p>`);
  },
  paintSow() {
    const n = R.sowingNote(this.ctx.soilT, this.crop);
    $('sowNote').innerHTML = `<h3>What to sow</h3><p style="font-weight:700;margin-bottom:4px">${n.title}</p><p class="note">${n.text}</p>`;
  }
};
$('crops').addEventListener('click', e => {
  const b = e.target.closest('.crop');
  if (!b || !Ctx) return;
  Prefs.crop = b.dataset.k; savePrefs();
  GardenView.render(Ctx);
  paintWeather();
});

/* =========================================================
   MODULE: Sleep forecast
   ========================================================= */
const SleepView = {
  night: [],
  render(ctx) {
    this.night = R.nightWindow(ctx.hours);
    const moonLit = Math.round((1 - Math.cos(2 * Math.PI * curPhase)) / 2 * 100);
    const sc = R.sleepScore(this.night, { aqi: ctx.aqi, moonLit });
    if (!sc) {
      $('sleepScore').innerHTML = '<p class="note">Not enough data for tonight yet.</p>';
      ['sleepChart', 'sleepFactors', 'sleepTips'].forEach(id => { $(id).innerHTML = ''; });
      return;
    }
    const bed = R.bestBedtime(ctx.hours), C = 2 * Math.PI * 46;
    $('sleepScore').innerHTML = `<div class="ring">` +
      `<svg viewBox="0 0 120 120" role="img" aria-label="Sleep score ${sc.score} out of 100">` +
      `<circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="10"/>` +
      `<circle cx="60" cy="60" r="46" fill="none" style="stroke:var(--${sc.tone})" stroke-width="10" stroke-linecap="round" ` +
      `stroke-dasharray="${(C * sc.score / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>` +
      `<text x="60" y="64" text-anchor="middle" class="rt">${sc.score}</text><text x="60" y="82" text-anchor="middle" class="rs">of 100</text></svg>` +
      `<div><p class="kicker">Tonight</p><p class="big">${sc.label} sleep</p>` +
      `<p class="sub">${bed ? `Best bedtime: <b>${R.fmtHour(bed.t)}</b><br>` : ''}Coolest at ${R.fmtHour(sc.coolest.t)} (${fmtT(sc.coolest.temp)})</p></div></div>`;

    this.paintChart(sc);
    $('sleepFactors').innerHTML = `<h3>What affects your sleep</h3><div class="tiles">` +
      sc.factors.map(f => tile(f.name, f.value, f.tone, f.hint)).join('') + `</div>`;
    $('sleepTips').innerHTML = `<h3>Tips for tonight</h3>${list(sc.tips)}`;
  },
  paintChart(sc) {
    const n = this.night.length;
    if (n < 2) { $('sleepChart').innerHTML = '<h3>Overnight temperature</h3><p class="note">Not enough hours left tonight for a chart.</p>'; return; }
    const Wd = 320, Ht = 110, px = 14, py = 14;
    const temps = this.night.map(h => h.temp), lo = Math.min(...temps) - 1, hi = Math.max(...temps) + 1;
    const X = i => px + (Wd - 2 * px) * i / (n - 1), Y = t => py + (Ht - 2 * py) * (1 - (t - lo) / (hi - lo || 1));
    let d = `M${X(0)},${Y(temps[0])}`;
    for (let i = 1; i < n; i++) { const cxm = (X(i - 1) + X(i)) / 2; d += ` C${cxm},${Y(temps[i - 1])} ${cxm},${Y(temps[i])} ${X(i)},${Y(temps[i])}`; }
    let ticks = '';
    this.night.forEach((h, i) => { if (i % 2 === 0) ticks += `<text x="${X(i)}" y="${Ht + 14}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".65">${R.fmtShort(h.t)}</text>`; });
    this.sel = Math.max(0, this.night.findIndex(h => h.t === sc.coolest.t));
    $('sleepChart').innerHTML = `<h3>Overnight temperature</h3>` +
      `<svg class="chartsvg" viewBox="0 0 ${Wd} ${Ht + 20}" role="img" aria-label="Overnight temperature curve">` +
      `<path d="${d} L${X(n - 1)},${Ht} L${X(0)},${Ht} Z" fill="url(#areaGrad)"/>` +
      `<path d="${d}" fill="none" stroke="#efe6ff" stroke-width="2.5" stroke-linecap="round"/>` +
      `<line id="scLine" y1="${py}" y2="${Ht}" stroke="rgba(255,255,255,.5)" stroke-dasharray="3 3"/>` +
      `<circle id="scDot" r="6" fill="#fff" stroke="rgba(120,90,200,.7)" stroke-width="3"/>${ticks}</svg>` +
      `<input type="range" class="scrub" id="scrub" min="0" max="${n - 1}" value="${this.sel}" aria-label="Pick an hour tonight">` +
      `<p class="at" id="scAt"></p>`;
    const upd = () => {
      const i = +$('scrub').value, h = this.night[i], x = X(i), y = Y(h.temp);
      $('scLine').setAttribute('x1', x); $('scLine').setAttribute('x2', x);
      $('scDot').setAttribute('cx', x); $('scDot').setAttribute('cy', y);
      const rainy = (h.precip || 0) >= 0.1, calm = (h.wind || 0) <= 20 && !rainy;
      $('scAt').innerHTML = `<b>${R.fmtHour(h.t)}</b> · ${fmtT(h.temp)} · ${h.humidity}% humidity · wind ${fmtW(h.wind)} · ${rainy ? 'rain' : calm ? 'calm' : 'breezy'}`;
    };
    $('scrub').oninput = upd; upd();
  }
};

/* =========================================================
   MODULE: forecast row, sun line, hero chips
   ========================================================= */
function sleepTip(d, kind) {
  if (d.aqi != null && d.aqi > 100) return '😷 Air quality is poor tonight. Keep windows closed.';
  if (kind === 'snow') return '❄️ Snowy night. Perfect for a cozy blanket.';
  if (kind === 'rain' || kind === 'storm') return '🌧️ Rain outside, which makes great sleeping sounds.';
  if (d.temp >= 28) return '🥵 Warm night. Keep the room cool and use a fan.';
  if (d.temp <= 12) return '🧣 Chilly night. A warm blanket will help.';
  if (d.cloud < 20) return '✨ Clear skies, a good night for stargazing before bed.';
  return '😴 Calm and comfortable. Good conditions for sleep.';
}
function wd(s) { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }); }
function item(label, svg, t) {
  return `<div class="it"><span class="lb">${label}</span><div class="chip">${svg}</div><span class="tp">${t}</span></div>`;
}
function renderForecast() {
  if (!data) return;
  let html = '';
  if (mode === 'day') {
    html = data.hourly.map((h, i) => item(i === 0 ? 'Now' : h.t, icon(kindOf(h.code), h.isDay, curPhase), fmtT(h.temp))).join('');
  } else {
    html = data.daily.map((d, i) => item(i === 0 ? 'Today' : wd(d.d), icon(kindOf(d.code), true, curPhase), fmtT(d.max))).join('');
  }
  $('scroller').innerHTML = html;
  $('scroller').scrollLeft = 0;
}
function paintWeather() {
  const d = data;
  if (!d) return;
  const kind = kindOf(d.code);
  $('stime').textContent = d.now.slice(11, 16);
  $('temp').textContent = fmtT(d.temp);
  $('big').innerHTML = icon(kind, d.isDay, curPhase);
  $('cap').textContent = (NAMES[d.code] || 'Weather') + (d.isDay ? '' : ' · ' + moonName(curPhase));
  $('tip').textContent = sleepTip(d, kind);
  if (!R) return;

  const s = R.sunInfo(d.now, d.sunrise, d.sunset, d.daily[1] ? d.daily[1].sunrise : null);
  let line = `🌅 ${R.fmtTime(s.rise)} · 🌇 ${R.fmtTime(s.set)}`;
  if (s.golden) {
    line += s.golden.active
      ? `<br>✨ Golden hour now, until ${R.fmtTime(s.golden.end)}`
      : `<br>✨ ${s.golden.label}${s.golden.tomorrow ? ' tomorrow' : ''} ${R.fmtTime(s.golden.start)}`;
  }
  $('sun').innerHTML = line;

  const chips = [], n = d.nowcast;
  if (n) {
    if (n.state === 'starts') chips.push(`<span class="chipx rain">☔ Rain in ${n.inMin} min · ${R.fmtTime(n.startT)}</span>`);
    else if (n.state === 'ongoing') chips.push(`<span class="chipx rain">🌧 ${n.endT ? 'Rain until ' + R.fmtTime(n.endT) : 'Rain for the next 2 hours'}</span>`);
    else if (!['rain', 'storm', 'snow'].includes(kind)) chips.push(`<span class="chipx mute">🌤 No rain for 2 hours</span>`);
  }
  const crop = R.CROPS[Prefs.crop] || R.CROPS.general;
  R.plantAlerts(d.daily, crop).filter(a => a.level === 'bad').slice(0, 2)
    .forEach(a => chips.push(`<button type="button" class="chipx bad" data-go="garden">${a.icon} ${a.short}</button>`));
  $('chips').innerHTML = chips.join('');
}
$('chips').addEventListener('click', e => { if (e.target.closest('[data-go]')) Tabs.show('garden'); });

/* test any look by adding ?demo=rain, storm, snow, cold, night or day to the link */
function demo(d) {
  const m = new URLSearchParams(location.search).get('demo');
  if (!m) return;
  if (m === 'rain') d.code = 63;
  if (m === 'storm') d.code = 95;
  if (m === 'snow') { d.code = 73; d.temp = -8; }
  if (m === 'cold') { d.code = 0; d.temp = -12; }
  if (m === 'night') { d.isDay = false; d.code = 0; d.cloud = 10; }
  if (m === 'day') { d.isDay = true; d.code = 0; }
}

/* =========================================================
   MODULE: settings + install
   ========================================================= */
function paintSeg() {
  document.querySelectorAll('.seg2').forEach(seg =>
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', Prefs[seg.dataset.pref] === b.dataset.v)));
}
function openSettings(open) {
  $('settings').hidden = !open;
  if (open) { paintSeg(); paintInstall(); $('settings').querySelector('.x').focus(); }
  else $('settingsBtn').focus();
}
$('settingsBtn').addEventListener('click', () => openSettings(true));
$('settings').addEventListener('click', e => {
  if (e.target.closest('[data-close]')) { openSettings(false); return; }
  const b = e.target.closest('.seg2 button');
  if (b) { Prefs[b.parentElement.dataset.pref] = b.dataset.v; savePrefs(); paintSeg(); refresh(); }
});

let deferredInstall = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function paintInstall() {
  const el = $('installBox');
  if (isStandalone()) el.textContent = 'Skycast is installed on this device. ✓';
  else if (deferredInstall) {
    el.innerHTML = '<button type="button" class="primary" id="installBtn">Install Skycast</button>' +
      '<p class="note" style="margin-top:8px">Adds a home-screen icon and opens full screen.</p>';
    $('installBtn').onclick = async () => {
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch (e) { /* dismissed */ }
      deferredInstall = null; paintInstall();
    };
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) el.textContent = 'On iPhone: tap the Share button in Safari, then "Add to Home Screen".';
  else el.textContent = 'Open your browser menu and choose "Install app" or "Add to Home screen".';
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; paintInstall(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; paintInstall(); });
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* =========================================================
   MAIN
   ========================================================= */
function setCity(name) { $('cityName').textContent = name; }

function applyData(d) {
  data = d; curPhase = moonPhase(new Date()); loadedAt = Date.now();
  const kind = kindOf(d.code);
  const rainy = kind === 'rain' || kind === 'storm', snowy = kind === 'snow';
  const dark = !d.isDay || rainy, cold = d.temp <= 2 || snowy;

  $('card').className = 'card ' + (dark ? 'dark' : 'light') + (rainy ? ' rainy' : '') +
    (snowy ? ' snowy' : '') + (kind === 'storm' ? ' storm' : '') + (cold ? ' cold' : '') +
    (!d.isDay ? ' isnight' : '') + (!d.isDay && !rainy && !snowy && d.cloud < 85 ? ' starry' : '');

  paintWeather();
  renderForecast();
  setFx(rainy ? 'rain' : snowy ? 'snow' : null, kind === 'storm' ? 170 : rainy ? 120 : 70);
  Sound.set(soundKindFor(d));
}

// Re-draw everything from the data already loaded (used when units change).
function refresh() {
  applyUnits();
  if (!data) return;
  paintWeather(); renderForecast();
  if (Ctx && R) { RunView.render(Ctx); GardenView.render(Ctx); SleepView.render(Ctx); }
}

async function load(lat, lon, name) {
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    demo(d);

    curPlace = { name, lat: +lat, lon: +lon }; Store.set('last', curPlace);
    setCity(name); Saved.render();
    $('msg').textContent = '';
    applyData(d);

    try {
      if (!R) throw new Error('ratings.js did not load');
      Ctx = await resolveData(d);
      if (Ctx) {
        RunView.render(Ctx); GardenView.render(Ctx); SleepView.render(Ctx);
        setBadges(Ctx.source); Reminder.schedule();
      }
    } catch (err) {
      console.error(err);
      const m = '<p class="note">Could not build this view. Make sure ratings.js is uploaded next to index.js.</p>';
      $('runBest').innerHTML = m; $('irrAlert').innerHTML = m; $('sleepScore').innerHTML = m;
    }
  } catch (e) {
    if (data) $('msg').textContent = 'Could not load weather. Try again.';
    else { setCity('Search a city'); $('msg').textContent = 'Could not load weather.'; }
  }
}

function openSearch(open) {
  $('searchBox').hidden = !open;
  $('city').setAttribute('aria-expanded', open);
  if (open) $('q').focus();
}
async function search(text) {
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(text));
    const p = await r.json();
    if (p.error) { $('msg').textContent = `Couldn't find "${text}". Check the spelling.`; return; }
    openSearch(false); $('q').value = '';
    load(p.lat, p.lon, p.name + ', ' + (p.cc || p.country));
  } catch (e) { $('msg').textContent = 'Search failed. Try again.'; }
}
async function locate(lat, lon) {
  let name = 'Your location';
  try {
    const p = await Promise.race([
      fetch(`/api/reverse?lat=${lat}&lon=${lon}`).then(r => r.json()),
      new Promise(r => setTimeout(() => r(null), 2500))
    ]);
    if (p && p.name) name = p.name + (p.cc ? ', ' + p.cc : '');
  } catch (e) { /* keep default name */ }
  load(lat, lon, name);
}
function fallbackStart() {
  const last = Store.get('last', null);
  if (last && last.lat != null) load(last.lat, last.lon, last.name);
  else search('London');
}
function geo() {
  if (!navigator.geolocation) { fallbackStart(); return; }
  navigator.geolocation.getCurrentPosition(
    pos => locate(pos.coords.latitude, pos.coords.longitude),
    () => { if (!data) fallbackStart(); else $('msg').textContent = 'Location is blocked. Search a city instead.'; },
    { timeout: 8000, maximumAge: 600000 }
  );
}

$('city').addEventListener('click', () => openSearch($('searchBox').hidden));
$('locBtn').addEventListener('click', () => { openSearch(false); geo(); });
$('form').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('q').value.trim();
  if (v) search(v);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('settings').hidden) openSettings(false); else openSearch(false);
});
$('soundBtn').addEventListener('click', async () => {
  if (Sound.on) Sound.stop();
  else if (!(await Sound.start(data ? soundKindFor(data) : 'calm'))) $('msg').textContent = 'Sound is not supported in this browser.';
  paintSound();
});

applyUnits();
setMode('day');
paintSeg();
Saved.render();
paintInstall();
geo();
