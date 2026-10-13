/* ratings.js
   Pure condition-rating logic for Skycast. No DOM, no network.
   Browser: window.Ratings      Node: require('./ratings.js')
   Every threshold lives in CONFIG or CROPS so it is easy to tune.
   All user-facing sentences go through T() so they can be translated (see i18n.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ratings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONFIG = {
    run: { tempMax: 25, humidityMax: 70, windMax: 15, windHard: 30, uvMax: 5, uvHigh: 8, great: 75, fair: 50 },
    plant: { uvMax: 3, tempMin: 10, tempIdealLow: 15, tempIdealHigh: 25, windMax: 20, ideal: 75, okay: 50 },
    irrigation: { soilDry: 0.20, soilWet: 0.35, rainProb: 60, rainMm: 1, rainTotalMm: 3, lookAheadH: 24 }
  };

  /* Crop profiles. All temperatures are in °C, moisture is volumetric (0 to 1).
     tempIdeal: best air temperature range    soilTemp: soil range for sowing
     frostMin:  coldest night the crop tolerates    heatMax: air temperature where heat stress starts */
  const CROPS = {
    general: { name: 'General',  emoji: '🌱', tempIdeal: [15, 25], soilTemp: [18, 30], frostMin: 2,  heatMax: 35, moisture: [0.20, 0.35] },
    tomato:  { name: 'Tomato',   emoji: '🍅', tempIdeal: [18, 27], soilTemp: [16, 30], frostMin: 4,  heatMax: 33, moisture: [0.22, 0.38] },
    pepper:  { name: 'Pepper',   emoji: '🌶️', tempIdeal: [18, 28], soilTemp: [18, 32], frostMin: 5,  heatMax: 35, moisture: [0.20, 0.35] },
    maize:   { name: 'Maize',    emoji: '🌽', tempIdeal: [18, 30], soilTemp: [12, 35], frostMin: 2,  heatMax: 35, moisture: [0.18, 0.34] },
    beans:   { name: 'Beans',    emoji: '🫘', tempIdeal: [16, 27], soilTemp: [16, 32], frostMin: 3,  heatMax: 32, moisture: [0.20, 0.35] },
    spinach: { name: 'Spinach',  emoji: '🥬', tempIdeal: [8, 20],  soilTemp: [5, 22],  frostMin: -5, heatMax: 27, moisture: [0.22, 0.38] },
    lettuce: { name: 'Lettuce',  emoji: '🥗', tempIdeal: [10, 22], soilTemp: [7, 24],  frostMin: -2, heatMax: 27, moisture: [0.22, 0.38] },
    carrot:  { name: 'Carrot',   emoji: '🥕', tempIdeal: [10, 24], soilTemp: [8, 28],  frostMin: -4, heatMax: 30, moisture: [0.20, 0.36] },
    cabbage: { name: 'Cabbage',  emoji: '🥦', tempIdeal: [12, 22], soilTemp: [8, 24],  frostMin: -4, heatMax: 28, moisture: [0.22, 0.38] },
    cassava: { name: 'Cassava',  emoji: '🍠', tempIdeal: [22, 32], soilTemp: [20, 35], frostMin: 8,  heatMax: 38, moisture: [0.15, 0.30] },
    okra:    { name: 'Okra',     emoji: '🌿', tempIdeal: [22, 34], soilTemp: [18, 35], frostMin: 8,  heatMax: 40, moisture: [0.16, 0.32] }
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const r0 = v => Math.round(v);
  const pad = n => String(n).padStart(2, '0');
  const hr = h => parseInt(String(h.t).slice(0, 2), 10);

  /* Translation hook: setTranslator(key => translatedTemplate). Templates use {name} placeholders. */
  let TR = null;
  function T(key, vars) {
    let s = TR ? TR(key) : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? vars[n] : m));
    return s;
  }
  function setTranslator(fn) { TR = fn; }

  /* Output formatting can be swapped (e.g. °F, mph) without touching any rating maths. */
  let FMT = { temp: v => Math.round(v) + '°', wind: v => Math.round(v) + ' km/h' };
  function setFormat(f) { FMT = Object.assign({}, FMT, f); }

  /* ---------- time formatting ---------- */
  function hourParts(t) {
    const H = parseInt(t.slice(0, 2), 10);
    return { H, h12: H % 12 === 0 ? 12 : H % 12, mer: H < 12 ? 'AM' : 'PM' };
  }
  const fmtHour = t => { const p = hourParts(t); return `${p.h12} ${p.mer}`; };
  const fmtShort = t => { const p = hourParts(t); return `${p.h12}${p.mer === 'AM' ? 'a' : 'p'}`; };
  const fmtTime = t => { const p = hourParts(t); return `${p.h12}:${t.slice(3, 5)} ${p.mer}`; };
  function fmtRange(startT, endT) {
    const p = hourParts(startT);
    const q = hourParts(pad((hourParts(endT).H + 1) % 24) + ':00');
    return p.mer === q.mer ? `${p.h12} – ${q.h12} ${q.mer}` : `${p.h12} ${p.mer} – ${q.h12} ${q.mer}`;
  }

  /* ---------- window finding (shared) ---------- */
  function findWindows(rated, labels) {
    const wins = []; let cur = null;
    rated.forEach((r, i) => {
      if (labels.includes(r.label)) {
        if (!cur) cur = { start: i, end: i, sum: 0 };
        cur.end = i; cur.sum += r.score;
      } else if (cur) { wins.push(cur); cur = null; }
    });
    if (cur) wins.push(cur);
    return wins.map(w => {
      const hours = w.end - w.start + 1;
      return { start: w.start, end: w.end, hours, avg: r0(w.sum / hours) };
    });
  }
  function bestWindows(rated, tiers, max) {
    for (const labels of tiers) {
      const w = findWindows(rated, labels);
      if (w.length) {
        const key = x => x.avg + 5 * (Math.min(x.hours, 3) - 1);   // prefer longer windows
        return w.sort((a, b) => key(b) - key(a)).slice(0, max || 3)
                .map(x => Object.assign(x, { label: rated[x.start].label }));
      }
    }
    return [];
  }

  /* ================= RUN & FITNESS ================= */
  function rateRunHour(h, userCfg) {
    const cfg = Object.assign({}, CONFIG.run, userCfg || {});
    const t = num(h.temp, 15), hum = num(h.humidity, 50), w = num(h.wind, 5);
    const uv = num(h.uv, 0), pop = num(h.pop, 0), rain = num(h.precip, 0);
    let score = 100; const reasons = [], breaches = [];

    if (t > cfg.tempMax) { score -= Math.min(50, (t - cfg.tempMax) * 6 + 10); breaches.push('temp'); reasons.push(T('Hot ({v})', { v: FMT.temp(t) })); }
    else if (t > 18) score -= (t - 18) * 1.5;
    else if (t < 5) { score -= Math.min(35, (5 - t) * 3); reasons.push(T('Cold ({v})', { v: FMT.temp(t) })); }

    if (hum > cfg.humidityMax) { score -= Math.min(30, (hum - cfg.humidityMax) * 1.2 + 5); breaches.push('humidity'); reasons.push(T('Humid ({v})', { v: r0(hum) + '%' })); }

    if (w > cfg.windHard) { score -= Math.min(40, 18 + (w - cfg.windHard) * 2); breaches.push('wind'); reasons.push(T('Very windy ({v})', { v: FMT.wind(w) })); }
    else if (w > cfg.windMax) { score -= (w - cfg.windMax) * 1.2; reasons.push(T('Breezy ({v})', { v: FMT.wind(w) })); }

    if (uv >= cfg.uvHigh) { score -= Math.min(30, (uv - cfg.uvMax) * 6); breaches.push('uv'); reasons.push(T('Very high UV ({v})', { v: r0(uv) })); }
    else if (uv > cfg.uvMax) { score -= (uv - cfg.uvMax) * 5; reasons.push(T('High UV ({v})', { v: r0(uv) })); }

    if (rain >= 0.5 || pop >= 60) {
      score -= Math.min(25, Math.max(rain * 8, (pop - 40) * 0.5));
      reasons.push(T('Rain likely'));
    }

    score = clamp(r0(score), 0, 100);
    // one limit broken caps you at Fair, two or more cap you at Poor
    if (breaches.length >= 2) score = Math.min(score, cfg.fair - 1);
    else if (breaches.length === 1) score = Math.min(score, cfg.great - 1);

    // after dark: never better than Fair, late night never better than Poor
    if (h.isDay === false) {
      const late = hr(h) >= 22 || hr(h) < 5;
      score = clamp(Math.min(score - 10, late ? cfg.fair - 1 : cfg.great - 1), 0, 100);
      reasons.push(late ? T('Late night: poor visibility and safety') : T('Dark: wear reflective gear'));
    }

    const label = score >= cfg.great ? 'Great' : score >= cfg.fair ? 'Fair' : 'Poor';
    return { score, label, reasons, breaches };
  }
  const rateRunDay = (hours, cfg) => hours.map(h => Object.assign({ hour: h }, rateRunHour(h, cfg)));
  const bestRunWindows = rated => bestWindows(rated, [['Great'], ['Fair']]);

  function hydrationMl(h) {
    const t = num(h.temp, 15), hum = num(h.humidity, 50);
    let ml = 400;
    if (t > 15) ml += (t - 15) * 35;
    if (hum > 60) ml += (hum - 60) * 5;
    return Math.round(clamp(ml, 300, 1100) / 50) * 50;
  }
  function outfit(h) {
    const t = num(h.temp, 15), w = num(h.wind, 0), uv = num(h.uv, 0), pop = num(h.pop, 0), rain = num(h.precip, 0);
    const items = [];
    if (t < 3) items.push(T('Thermal base layer, tights, gloves and a beanie'));
    else if (t < 10) items.push(T('Long sleeves, leggings and light gloves'));
    else if (t < 17) items.push(T('Light long-sleeve or tee with shorts'));
    else if (t < 24) items.push(T('Breathable tee and shorts'));
    else items.push(T('Moisture-wicking singlet and light shorts'));
    if (t >= 22) items.push(T('Light colours to reflect heat'));
    if (w > 20 && t < 20) items.push(T('Windbreaker for exposed stretches'));
    if (rain >= 0.5 || pop >= 50) items.push(T('Water-resistant shell and shoes with good grip'));
    if (uv >= 3 && h.isDay !== false) items.push(T('Cap, sunglasses and SPF 30+'));
    if (h.isDay === false) items.push(T('Reflective vest and a headlamp'));
    return items;
  }
  function safetyTips(rating, h) {
    const tips = [], t = num(h.temp, 15);
    if (rating.label === 'Great') tips.push(T('Prime conditions. Good day for a longer or faster session.'));
    else if (rating.label === 'Fair') tips.push(T('Manageable. Ease the pace and listen to your body.'));
    else tips.push(T('Tough conditions. Shorten the run, go indoors, or pick a better window.'));
    if (rating.breaches.includes('temp')) tips.push(T('Heat risk: slow down, use shade, stop if dizzy or nauseous.'));
    if (rating.breaches.includes('humidity')) tips.push(T('Sweat cools you less in humid air, so effort will feel harder.'));
    if (rating.breaches.includes('wind')) tips.push(T('Run into the wind first so it helps you on the way back.'));
    if (rating.breaches.includes('uv')) tips.push(T('Strong UV: pick shade or run earlier or later.'));
    if (t < 3) tips.push(T('Watch for ice on paths and warm up indoors first.'));
    return tips;
  }
  function gearAdvice(rating, h) {
    const ml = hydrationMl(h), t = num(h.temp, 15);
    return {
      outfit: outfit(h),
      hydration: { ml, text: t >= 25 ? T('Drink 300–500 ml before you start, then sip every 15–20 minutes and add electrolytes.')
                                     : T('Drink 300–500 ml before you start, then sip every 15–20 minutes.') },
      safety: safetyTips(rating, h)
    };
  }

  /* ================= AGRI-PLANNER ================= */
  function cropConfig(crop) {
    crop = crop || CROPS.general;
    return {
      plant: Object.assign({}, CONFIG.plant, {
        tempMin: crop.tempIdeal[0] - 6, tempIdealLow: crop.tempIdeal[0], tempIdealHigh: crop.tempIdeal[1]
      }),
      irrigation: { soilDry: crop.moisture[0], soilWet: crop.moisture[1] }
    };
  }

  function ratePlantingHour(h, userCfg) {
    const cfg = Object.assign({}, CONFIG.plant, userCfg || {});
    if (h.isDay === false) return { score: 0, label: 'Avoid', reasons: [T('Too dark to work')] };
    const t = num(h.temp, 20), uv = num(h.uv, 0), w = num(h.wind, 5), pop = num(h.pop, 0), rain = num(h.precip, 0);
    let score = 100; const reasons = [];

    if (uv > cfg.uvMax) { score -= Math.min(45, (uv - cfg.uvMax) * 10); reasons.push(T('Strong sun (UV {v}) stresses seedlings', { v: r0(uv) })); }
    if (t > cfg.tempIdealHigh) { score -= Math.min(45, (t - cfg.tempIdealHigh) * 6 + 5); reasons.push(T('Hot ({v})', { v: FMT.temp(t) })); }
    else if (t < cfg.tempIdealLow) { score -= Math.min(40, (cfg.tempIdealLow - t) * 4); reasons.push(T('Cool ({v})', { v: FMT.temp(t) })); }
    if (w > cfg.windMax) { score -= Math.min(25, (w - cfg.windMax) * 1.5); reasons.push(T('Windy ({v}) dries the soil', { v: FMT.wind(w) })); }
    if (rain >= 2 || pop >= 70) { score -= 25; reasons.push(T('Heavy rain: soil too wet to work')); }

    score = clamp(r0(score), 0, 100);
    const label = score >= cfg.ideal ? 'Ideal' : score >= cfg.okay ? 'Okay' : 'Avoid';
    return { score, label, reasons };
  }
  const ratePlantingDay = (hours, cfg) => hours.map(h => Object.assign({ hour: h }, ratePlantingHour(h, cfg)));
  const bestPlantingWindows = rated => bestWindows(rated, [['Ideal'], ['Okay']]);

  function sowingNote(soilT, crop) {
    crop = crop || CROPS.general;
    const lo = crop.soilTemp[0], hi = crop.soilTemp[1], cn = T(crop.name);
    if (soilT == null) return { title: T('Soil temperature unknown'), text: T('Check with a soil thermometer before sowing.') };
    const v = FMT.temp(soilT);
    if (crop === CROPS.general) {
      if (soilT < 10) return { title: T('Cold soil ({v})', { v }), text: T('Too cold for most seeds. Wait, or start seedlings indoors.') };
      if (soilT < 18) return { title: T('Cool soil ({v})', { v }), text: T('Good for peas, spinach, lettuce, radish and other cool-season crops.') };
      if (soilT <= 30) return { title: T('Warm soil ({v})', { v }), text: T('Good for tomato, beans, maize, okra and other warm-season crops.') };
      return { title: T('Hot soil ({v})', { v }), text: T('Shade seedlings, mulch, and water deeply after planting.') };
    }
    if (soilT < lo) return { title: T('Soil is cold for {crop} ({v})', { crop: cn, v }), text: T('{crop} germinates best above {lo}. Wait, or start seedlings indoors.', { crop: cn, lo: FMT.temp(lo) }) };
    if (soilT > hi) return { title: T('Soil is hot for {crop} ({v})', { crop: cn, v }), text: T('Above {hi} seeds struggle. Sow in the cool of the day, mulch and water deeply.', { hi: FMT.temp(hi) }) };
    return { title: T('Good sowing soil for {crop} ({v})', { crop: cn, v }), text: T('Ideal soil range is {lo} to {hi}.', { lo: FMT.temp(lo), hi: FMT.temp(hi) }) };
  }

  function soilStatus(m) {
    const pct = r0(m * 100);
    const label = m < 0.12 ? 'Very dry' : m < 0.20 ? 'Dry' : m < 0.35 ? 'Moist' : 'Wet';
    const tone = m < 0.20 ? 'warn' : m < 0.35 ? 'ok' : 'wet';
    return { pct, label: T(label), tone };
  }

  const sameDay = (a, b) => a.time && b.time && a.time.slice(0, 10) === b.time.slice(0, 10);
  const whenText = (h, first) => (sameDay(h, first) ? T('at {t}', { t: fmtHour(h.t) }) : T('tomorrow at {t}', { t: fmtHour(h.t) }));

  function bestWateringHour(look) {
    const ok = look.filter(h => {
      const H = hr(h);
      return ((H >= 5 && H <= 7) || (H >= 18 && H <= 20)) && num(h.pop, 0) < 40;
    });
    if (!ok.length) return null;
    return ok.reduce((a, b) => (num(b.temp, 99) < num(a.temp, 99) ? b : a));
  }

  function irrigationAdvice(hours, moisture, cfg) {
    cfg = Object.assign({}, CONFIG.irrigation, cfg || {});
    const look = hours.slice(0, cfg.lookAheadH);
    const totalRain = Math.round(look.reduce((s, h) => s + num(h.precip, 0), 0) * 10) / 10;
    const idx = look.findIndex(h => num(h.pop, 0) >= cfg.rainProb || num(h.precip, 0) >= cfg.rainMm);
    const rain = idx >= 0 ? look[idx] : null;
    const hasSoil = typeof moisture === 'number';
    const soil = hasSoil ? soilStatus(moisture) : null;
    let status, headline;

    if (hasSoil && moisture >= cfg.soilWet) {
      status = 'skip'; headline = T('Skip watering today. The soil is already wet.');
    } else if (rain && idx <= 14 && (totalRain >= cfg.rainTotalMm || num(rain.pop, 0) >= 70)) {
      status = 'skip';
      headline = idx === 0 ? T('Skip watering, rain is expected right now.')
                           : T('Skip watering today, rain expected {when}.', { when: whenText(rain, look[0]) });
    } else if (hasSoil && moisture < cfg.soilDry) {
      status = 'water';
      const best = bestWateringHour(look);
      headline = best ? T('Water {when}. The soil is dry and no heavy rain is due.', { when: whenText(best, look[0]) })
                      : T('Water soon. The soil is dry and no heavy rain is due.');
    } else if (!hasSoil && !rain) {
      status = 'ok'; headline = T('No rain expected. Check the top 2 cm of soil and water if it is dry.');
    } else {
      status = 'ok';
      headline = hasSoil ? T('Soil moisture is fine. No watering needed today.')
                         : T('Light rain possible. Hold off and check the soil later.');
    }

    const detail = T('Rain next 24h: {mm} mm', { mm: totalRain }) + (soil ? ' · ' + T('Soil moisture {pct}% ({label})', { pct: soil.pct, label: soil.label }) : '');
    return { status, headline, detail, totalRain, rainAt: rain ? rain.t : null, soil, moisture: hasSoil ? moisture : null };
  }

  /* Frost and heat warnings from the 7-day daily forecast. daily: [{d, min, max}] */
  function plantAlerts(daily, crop) {
    crop = crop || CROPS.general;
    const out = [], days = (daily || []).slice(0, 3);
    const who = crop === CROPS.general ? T('most plants') : T(crop.name);
    const hardy = crop === CROPS.general ? T('Hardy plants') : T(crop.name);
    const when = (i, night) => (i === 0 ? (night ? T('tonight') : T('today')) : i === 1 ? T('tomorrow') : T('in 2 days'));
    days.forEach((d, i) => {
      if (typeof d.min === 'number') {
        const w = when(i, true), v = FMT.temp(d.min);
        if (d.min <= crop.frostMin) {
          out.push(d.min <= 0
            ? { level: 'bad', icon: '🥶', short: T('Frost {when} ({v})', { when: w, v }),
                text: T('Frost danger {when}: {v} is too cold for {who} (limit {lim}). Cover or bring plants in.', { when: w, v, who, lim: FMT.temp(crop.frostMin) }) }
            : { level: 'bad', icon: '🥶', short: T('Cold {when} ({v})', { when: w, v }),
                text: T('Cold risk {when}: {v} is too cold for {who} (limit {lim}). Cover or bring plants in.', { when: w, v, who, lim: FMT.temp(crop.frostMin) }) });
        } else if (d.min <= 0) {
          out.push({ level: 'info', icon: '❄️', short: T('Light frost {when}', { when: w }),
            text: T('Light frost {when} ({v}). {who} can handle it.', { when: w, v, who: hardy }) });
        }
      }
      if (typeof d.max === 'number') {
        const w = when(i, false), v = FMT.temp(d.max);
        if (d.max >= crop.heatMax) {
          out.push({ level: 'bad', icon: '🔥', short: T('Heat {when} ({v})', { when: w, v }),
            text: T('Heat stress {when}: up to {v}. Water in the early morning and shade seedlings.', { when: w, v }) });
        } else if (d.max >= crop.heatMax - 3) {
          out.push({ level: 'warn', icon: '☀️', short: T('Hot {when} ({v})', { when: w, v }),
            text: T('Getting hot {when}: up to {v}. Mulch and check soil moisture.', { when: w, v }) });
        }
      }
    });
    const rank = { bad: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  /* ================= CROP CALENDAR =================
     clim: { meanT:[12], frostDays:[12], rain:[12] }  (monthly averages for the location) */
  function cropMonthScore(clim, m, crop) {
    const t = clim.meanT[m], fd = clim.frostDays[m], rain = clim.rain[m];
    const lo = crop.tempIdeal[0], hi = crop.tempIdeal[1];
    let s = 100;
    if (t < lo) s -= Math.min(100, (lo - t) * 12); else if (t > hi) s -= Math.min(100, (t - hi) * 12);
    if (fd > 0) {
      if (crop.frostMin >= 0) s -= Math.min(70, 30 + fd * 5);
      else if (crop.frostMin > -3) s -= Math.min(40, fd * 3);
    }
    if (rain < 30) s -= 15; else if (rain > 300) s -= 10;
    s = clamp(r0(s), 0, 100);
    return { score: s, label: s >= 75 ? 'Best' : s >= 50 ? 'Okay' : 'Avoid' };
  }
  const cropCalendar = (clim, crop) => clim.meanT.map((_, m) => cropMonthScore(clim, m, crop || CROPS.general));
  function cropsForMonth(clim, m) {
    return Object.keys(CROPS).filter(k => k !== 'general')
      .map(k => Object.assign({ key: k }, cropMonthScore(clim, m, CROPS[k])))
      .filter(x => x.score >= 75).sort((a, b) => b.score - a.score).slice(0, 6);
  }

  /* ================= SLEEP ================= */
  function nightWindow(hours) {
    const inNight = h => { const H = hr(h); return H >= 20 || H < 7; };
    const start = hours.findIndex(inNight);
    if (start < 0) return [];
    let end = start;
    while (end < hours.length && inNight(hours[end])) end++;
    return hours.slice(start, end);
  }
  function sleepComfortHour(h) {
    const t = num(h.temp, 18), hum = num(h.humidity, 50), w = num(h.wind, 5), code = num(h.code, 0), rain = num(h.precip, 0);
    let s = 100;
    if (t > 22) s -= Math.min(40, (t - 22) * 6); else if (t > 20) s -= (t - 20) * 2; else if (t < 10) s -= Math.min(25, (10 - t) * 3);
    if (hum > 70) s -= Math.min(20, (hum - 70) * 0.8); else if (hum < 30) s -= Math.min(10, (30 - hum) * 0.5);
    if (w > 30) s -= 15; else if (w > 20) s -= 8;
    if (code >= 95) s -= 25; else if (rain >= 2) s -= 10;
    return clamp(r0(s), 0, 100);
  }
  function bestBedtime(hours) {
    let best = null;
    hours.forEach((h, i) => {
      if (![21, 22, 23, 0].includes(hr(h))) return;
      const win = hours.slice(i, i + 7);
      if (win.length < 5) return;
      const avg = win.reduce((s, x) => s + sleepComfortHour(x), 0) / win.length;
      if (!best || avg > best.avg + 1) best = { i, t: h.t, avg: r0(avg) };
    });
    return best;
  }
  function sleepScore(night, opts) {
    opts = opts || {};
    if (!night || !night.length) return null;
    const avg = k => night.reduce((s, h) => s + num(h[k], 0), 0) / night.length;
    const tAvg = avg('temp'), hAvg = avg('humidity');
    const wMax = Math.max.apply(null, night.map(h => num(h.wind, 0)));
    const storm = night.some(h => num(h.code, 0) >= 95);
    const heavy = night.some(h => num(h.precip, 0) >= 2);
    const soft = night.some(h => num(h.precip, 0) > 0.1 && num(h.precip, 0) < 2);
    const clear = night.every(h => num(h.code, 0) <= 2);
    let score = 100; const factors = [], tips = [];

    let tp = 0;
    if (tAvg > 22) tp = Math.min(35, (tAvg - 22) * 5); else if (tAvg > 20) tp = (tAvg - 20) * 2; else if (tAvg < 10) tp = Math.min(20, (10 - tAvg) * 2.5);
    score -= tp;
    factors.push({ name: T('Temperature'), value: FMT.temp(tAvg), tone: tp <= 3 ? 'ok' : tp <= 15 ? 'warn' : 'bad', hint: T('Ideal {lo}–{hi}', { lo: FMT.temp(15), hi: FMT.temp(20) }) });
    if (tAvg > 22) tips.push(T('Warm night: open windows early, use a fan and a light sheet.'));
    if (tAvg < 10) tips.push(T('Cold night: add a blanket and warm the room before bed.'));

    let hp = 0;
    if (hAvg > 70) hp = Math.min(20, (hAvg - 70) * 0.8); else if (hAvg < 30) hp = Math.min(10, (30 - hAvg) * 0.5);
    score -= hp;
    factors.push({ name: T('Humidity'), value: r0(hAvg) + '%', tone: hp <= 2 ? 'ok' : hp <= 10 ? 'warn' : 'bad', hint: T('Ideal 30–70%') });
    if (hAvg > 70) tips.push(T('Humid air: a fan or dehumidifier helps you sleep deeper.'));

    let np = 0, noise, ntone = 'ok';
    if (storm) { np = 25; noise = T('Stormy'); ntone = 'bad'; tips.push(T('Thunderstorm tonight: earplugs or white noise can help.')); }
    else if (heavy) { np = 10; noise = T('Loud rain'); ntone = 'warn'; }
    else if (wMax > 30) { np = 15; noise = T('Very windy'); ntone = 'bad'; tips.push(T('Strong wind: close windows and shutters to cut the noise.')); }
    else if (wMax > 20) { np = 8; noise = T('Breezy'); ntone = 'warn'; }
    else if (soft) { noise = T('Soft rain'); tips.push(T('Soft rain is great for sleep. Try the rain sound.')); }
    else noise = T('Calm');
    score -= np;
    factors.push({ name: T('Noise'), value: noise, tone: ntone, hint: T('Wind up to {v}', { v: FMT.wind(wMax) }) });

    if (typeof opts.aqi === 'number') {
      const ap = opts.aqi > 150 ? 20 : opts.aqi > 100 ? 12 : opts.aqi > 50 ? 4 : 0;
      score -= ap;
      factors.push({ name: T('Air quality'), value: String(opts.aqi), tone: ap === 0 ? 'ok' : ap <= 4 ? 'warn' : 'bad', hint: opts.aqi <= 50 ? T('Good') : opts.aqi <= 100 ? T('Moderate') : T('Unhealthy') });
      if (opts.aqi > 100) tips.push(T('Poor air: keep windows closed and run a purifier if you have one.'));
    }
    if (clear && typeof opts.moonLit === 'number' && opts.moonLit >= 85) {
      score -= 3; tips.push(T('Bright moon and clear sky: use blackout curtains.'));
    }
    tips.push(T('Put screens away 30 minutes before bed for easier sleep.'));

    score = clamp(r0(score), 0, 100);
    const label = score >= 80 ? 'Great' : score >= 60 ? 'Good' : score >= 40 ? 'Restless' : 'Rough';
    const coolest = night.reduce((a, b) => (num(b.temp, 99) < num(a.temp, 99) ? b : a));
    return { score, label, tone: score >= 80 ? 'good' : score >= 60 ? 'mid' : 'bad', factors, tips, tAvg, hAvg,
             coolest: { t: coolest.t, temp: coolest.temp } };
  }

  /* ================= SUN ================= */
  function sunInfo(now, sunrise, sunset, nextSunrise) {
    const HOUR = 3600000, n = new Date(now).getTime(), rise = new Date(sunrise).getTime(), set = new Date(sunset).getTime();
    const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
    const add = (s, h) => hhmm(new Date(new Date(s).getTime() + h * HOUR));
    const cut = s => s.slice(11, 16);
    let g;
    if (n < rise) g = { label: 'Morning golden hour', start: cut(sunrise), end: add(sunrise, 1), active: false };
    else if (n < rise + HOUR) g = { label: 'Morning golden hour', start: cut(sunrise), end: add(sunrise, 1), active: true };
    else if (n < set - HOUR) g = { label: 'Evening golden hour', start: add(sunset, -1), end: cut(sunset), active: false };
    else if (n < set) g = { label: 'Evening golden hour', start: add(sunset, -1), end: cut(sunset), active: true };
    else g = nextSunrise ? { label: 'Morning golden hour', start: cut(nextSunrise), end: add(nextSunrise, 1), active: false, tomorrow: true } : null;
    return { rise: cut(sunrise), set: cut(sunset), golden: g };
  }

  return {
    CONFIG, CROPS, T, setTranslator, setFormat, fmtHour, fmtShort, fmtTime, fmtRange, findWindows,
    rateRunHour, rateRunDay, bestRunWindows, hydrationMl, gearAdvice,
    cropConfig, ratePlantingHour, ratePlantingDay, bestPlantingWindows, sowingNote,
    soilStatus, irrigationAdvice, plantAlerts,
    cropMonthScore, cropCalendar, cropsForMonth,
    nightWindow, sleepComfortHour, bestBedtime, sleepScore, sunInfo
  };
});
