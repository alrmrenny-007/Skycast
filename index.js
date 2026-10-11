const express = require('express');
const path = require('path');
const app = express();

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'index.html')));

app.get('/ratings.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'ratings.js')));

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

const rd = (v, p) => (v == null ? null : Math.round(v * 10 ** p) / 10 ** p);
const at = (arr, k) => (arr && arr[k] != null ? arr[k] : null);

app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon needed' });
  try {
    const w = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,is_day,cloud_cover` +
      `&hourly=temperature_2m,weather_code,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
      `&timezone=auto&forecast_days=7`;
    // Extra hourly data for the Garden and Run views, kept in its own request so a
    // problem here can never break the main weather. If it fails the page uses demo data.
    const x = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=relative_humidity_2m,wind_speed_10m,uv_index,precipitation_probability,precipitation,` +
      `soil_moisture_3_to_9cm,soil_temperature_6cm,evapotranspiration` +
      `&timezone=auto&forecast_days=3`;
    const a = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi`;

    const [wr, ex, ar] = await Promise.all([
      fetch(w).then(r => r.json()),
      fetch(x).then(r => r.json()).catch(() => null),
      fetch(a).then(r => r.json()).catch(() => ({}))
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

    const daily = wr.daily.time.map((d, k) => ({
      d,
      max: Math.round(wr.daily.temperature_2m_max[k]),
      min: Math.round(wr.daily.temperature_2m_min[k]),
      code: wr.daily.weather_code[k]
    }));

    res.json({
      temp: Math.round(cur.temperature_2m),
      code: cur.weather_code,
      isDay: cur.is_day === 1,
      cloud: cur.cloud_cover,
      now: cur.time,
      sunrise: wr.daily.sunrise[0],
      sunset: wr.daily.sunset[0],
      aqi: ar.current ? ar.current.us_aqi : null,
      hourly,
      daily
    });
  } catch (e) { res.status(500).json({ error: 'Weather failed' }); }
});

if (require.main === module) {
  app.listen(3000, () => console.log('http://localhost:3000'));
}
module.exports = app;
