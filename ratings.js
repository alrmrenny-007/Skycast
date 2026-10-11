/* ratings.js
   Pure condition-rating logic for Skycast. No DOM, no network.
   Browser: window.Ratings      Node: require('./ratings.js')
   Every threshold lives in CONFIG so it is easy to tune. */
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

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const r0 = v => Math.round(v);

  /* ---------- time formatting ---------- */
  function hourParts(t) {
    const H = parseInt(t.slice(0, 2), 10);
    return { H, h12: H % 12 === 0 ? 12 : H % 12, mer: H < 12 ? 'AM' : 'PM' };
  }
  const fmtHour = t => { const p = hourParts(t); return `${p.h12} ${p.mer}`; };
  const fmtShort = t => { const p = hourParts(t); return `${p.h12}${p.mer === 'AM' ? 'a' : 'p'}`; };
  function fmtRange(startT, endT) {
    const p = hourParts(startT);
    const q = hourParts(String((hourParts(endT).H + 1) % 24).padStart(2, '0') + ':00');
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
  function rateRunHour(h, cfg) {
    cfg = cfg || CONFIG.run;
    const t = num(h.temp, 15), hum = num(h.humidity, 50), w = num(h.wind, 5);
    const uv = num(h.uv, 0), pop = num(h.pop, 0), rain = num(h.precip, 0);
    let score = 100; const reasons = [], breaches = [];

    if (t > cfg.tempMax) { score -= Math.min(50, (t - cfg.tempMax) * 6 + 10); breaches.push('temp'); reasons.push(`Hot (${r0(t)}°)`); }
    else if (t > 18) score -= (t - 18) * 1.5;
    else if (t < 5) { score -= Math.min(35, (5 - t) * 3); reasons.push(`Cold (${r0(t)}°)`); }

    if (hum > cfg.humidityMax) { score -= Math.min(30, (hum - cfg.humidityMax) * 1.2 + 5); breaches.push('humidity'); reasons.push(`Humid (${r0(hum)}%)`); }

    if (w > cfg.windHard) { score -= Math.min(40, 18 + (w - cfg.windHard) * 2); breaches.push('wind'); reasons.push(`Very windy (${r0(w)} km/h)`); }
    else if (w > cfg.windMax) { score -= (w - cfg.windMax) * 1.2; reasons.push(`Breezy (${r0(w)} km/h)`); }

    if (uv >= cfg.uvHigh) { score -= Math.min(30, (uv - cfg.uvMax) * 6); breaches.push('uv'); reasons.push(`Very high UV (${r0(uv)})`); }
    else if (uv > cfg.uvMax) { score -= (uv - cfg.uvMax) * 5; reasons.push(`High UV (${r0(uv)})`); }

    if (rain >= 0.5 || pop >= 60) {
      score -= Math.min(25, Math.max(rain * 8, (pop - 40) * 0.5));
      reasons.push('Rain likely');
    }

    score = clamp(r0(score), 0, 100);
    // one limit broken caps you at Fair, two or more cap you at Poor
    if (breaches.length >= 2) score = Math.min(score, cfg.fair - 1);
    else if (breaches.length === 1) score = Math.min(score, cfg.great - 1);
    // after dark: never better than Fair, late night never better than Poor
    if (h.isDay === false) {
      const H = parseInt(String(h.t || '12').slice(0, 2), 10);
      const late = H >= 22 || H < 5;
      score = clamp(Math.min(score - 10, late ? cfg.fair - 1 : cfg.great - 1), 0, 100);
      reasons.push(late ? 'Late night: poor visibility and safety' : 'Dark: wear reflective gear');
    }

    const label = score >= cfg.great ? 'Great' : score >= cfg.fair ? 'Fair' : 'Poor';
    return { score, label, reasons, breaches };
  }
  const rateRunDay = hours => hours.map(h => Object.assign({ hour: h }, rateRunHour(h)));
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
    if (t < 3) items.push('Thermal base layer, tights, gloves and a beanie');
    else if (t < 10) items.push('Long sleeves, leggings and light gloves');
    else if (t < 17) items.push('Light long-sleeve or tee with shorts');
    else if (t < 24) items.push('Breathable tee and shorts');
    else items.push('Moisture-wicking singlet and light shorts');
    if (t >= 22) items.push('Light colours to reflect heat');
    if (w > 20 && t < 20) items.push('Windbreaker for exposed stretches');
    if (rain >= 0.5 || pop >= 50) items.push('Water-resistant shell and shoes with good grip');
    if (uv >= 3 && h.isDay !== false) items.push('Cap, sunglasses and SPF 30+');
    if (h.isDay === false) items.push('Reflective vest and a headlamp');
    return items;
  }
  function safetyTips(rating, h) {
    const tips = [], t = num(h.temp, 15);
    if (rating.label === 'Great') tips.push('Prime conditions. Good day for a longer or faster session.');
    else if (rating.label === 'Fair') tips.push('Manageable. Ease the pace and listen to your body.');
    else tips.push('Tough conditions. Shorten the run, go indoors, or pick a better window.');
    if (rating.breaches.includes('temp')) tips.push('Heat risk: slow down, use shade, stop if dizzy or nauseous.');
    if (rating.breaches.includes('humidity')) tips.push('Sweat cools you less in humid air, so effort will feel harder.');
    if (rating.breaches.includes('wind')) tips.push('Run into the wind first so it helps you on the way back.');
    if (rating.breaches.includes('uv')) tips.push('Strong UV: pick shade or run earlier or later.');
    if (t < 3) tips.push('Watch for ice on paths and warm up indoors first.');
    return tips;
  }
  function gearAdvice(rating, h) {
    const ml = hydrationMl(h), t = num(h.temp, 15);
    return {
      outfit: outfit(h),
      hydration: {
        ml,
        text: `Drink 300–500 ml before you start, then sip every 15–20 minutes${t >= 25 ? ' and add electrolytes' : ''}.`
      },
      safety: safetyTips(rating, h)
    };
  }

  /* ================= AGRI-PLANNER ================= */
  function ratePlantingHour(h, cfg) {
    cfg = cfg || CONFIG.plant;
    if (h.isDay === false) return { score: 0, label: 'Avoid', reasons: ['Too dark to work'] };
    const t = num(h.temp, 20), uv = num(h.uv, 0), w = num(h.wind, 5), pop = num(h.pop, 0), rain = num(h.precip, 0);
    let score = 100; const reasons = [];

    if (uv > cfg.uvMax) { score -= Math.min(45, (uv - cfg.uvMax) * 10); reasons.push(`Strong sun (UV ${r0(uv)}) stresses seedlings`); }
    if (t > cfg.tempIdealHigh) { score -= Math.min(45, (t - cfg.tempIdealHigh) * 6 + 5); reasons.push(`Hot (${r0(t)}°)`); }
    else if (t < cfg.tempIdealLow) { score -= Math.min(40, (cfg.tempIdealLow - t) * 4); reasons.push(`Cool (${r0(t)}°)`); }
    if (w > cfg.windMax) { score -= Math.min(25, (w - cfg.windMax) * 1.5); reasons.push(`Windy (${r0(w)} km/h) dries the soil`); }
    if (rain >= 2 || pop >= 70) { score -= 25; reasons.push('Heavy rain: soil too wet to work'); }

    score = clamp(r0(score), 0, 100);
    const label = score >= cfg.ideal ? 'Ideal' : score >= cfg.okay ? 'Okay' : 'Avoid';
    return { score, label, reasons };
  }
  const ratePlantingDay = hours => hours.map(h => Object.assign({ hour: h }, ratePlantingHour(h)));
  const bestPlantingWindows = rated => bestWindows(rated, [['Ideal'], ['Okay']]);

  function sowingNote(soilT) {
    if (soilT == null) return { title: 'Soil temperature unknown', text: 'Check with a soil thermometer before sowing.' };
    if (soilT < 10) return { title: `Cold soil (${soilT}°)`, text: 'Too cold for most seeds. Wait, or start seedlings indoors.' };
    if (soilT < 18) return { title: `Cool soil (${soilT}°)`, text: 'Good for peas, spinach, lettuce, radish and other cool-season crops.' };
    if (soilT <= 30) return { title: `Warm soil (${soilT}°)`, text: 'Good for tomato, beans, maize, okra and other warm-season crops.' };
    return { title: `Hot soil (${soilT}°)`, text: 'Shade seedlings, mulch, and water deeply after planting.' };
  }

  function soilStatus(m) {
    const pct = r0(m * 100);
    const label = m < 0.12 ? 'Very dry' : m < 0.20 ? 'Dry' : m < 0.35 ? 'Moist' : 'Wet';
    const tone = m < 0.20 ? 'warn' : m < 0.35 ? 'ok' : 'wet';
    return { pct, label, tone };
  }

  const sameDay = (a, b) => a.time && b.time && a.time.slice(0, 10) === b.time.slice(0, 10);
  const whenText = (h, first) => (sameDay(h, first) ? `at ${fmtHour(h.t)}` : `tomorrow at ${fmtHour(h.t)}`);

  function bestWateringHour(look) {
    const ok = look.filter(h => {
      const H = parseInt(h.t.slice(0, 2), 10);
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
      status = 'skip'; headline = 'Skip watering today. The soil is already wet.';
    } else if (rain && idx <= 14 && (totalRain >= cfg.rainTotalMm || num(rain.pop, 0) >= 70)) {
      status = 'skip';
      headline = idx === 0 ? 'Skip watering, rain is expected right now.'
                           : `Skip watering today, rain expected ${whenText(rain, look[0])}.`;
    } else if (hasSoil && moisture < cfg.soilDry) {
      status = 'water';
      const best = bestWateringHour(look);
      headline = best ? `Water ${whenText(best, look[0])}. The soil is dry and no heavy rain is due.`
                      : 'Water soon. The soil is dry and no heavy rain is due.';
    } else if (!hasSoil && !rain) {
      status = 'ok'; headline = 'No rain expected. Check the top 2 cm of soil and water if it is dry.';
    } else {
      status = 'ok';
      headline = hasSoil ? 'Soil moisture is fine. No watering needed today.'
                         : 'Light rain possible. Hold off and check the soil later.';
    }

    const detail = `Rain next 24h: ${totalRain} mm` + (soil ? ` · Soil moisture ${soil.pct}% (${soil.label})` : '');
    return { status, headline, detail, totalRain, rainAt: rain ? rain.t : null, soil, moisture: hasSoil ? moisture : null };
  }

  return {
    CONFIG, fmtHour, fmtShort, fmtRange, findWindows,
    rateRunHour, rateRunDay, bestRunWindows, hydrationMl, gearAdvice,
    ratePlantingHour, ratePlantingDay, bestPlantingWindows, sowingNote,
    soilStatus, irrigationAdvice
  };
});
