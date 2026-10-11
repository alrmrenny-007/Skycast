const express = require('express');
const path = require('path');
const app = express();

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/search', async (req, res) => {
  try {
    const q = encodeURIComponent(req.query.q || '');
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1`);
    const d = await r.json();
    if (!d.results) return res.status(404).json({ error: 'Not found' });
    const p = d.results[0];
    res.json({ name: p.name, country: p.country, lat: p.latitude, lon: p.longitude });
  } catch (e) { res.status(500).json({ error: 'Search failed' }); }
});

app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon needed' });
  try {
    const w = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day,cloud_cover&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
    const a = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi`;
    const [wr, ar] = await Promise.all([
      fetch(w).then(r => r.json()),
      fetch(a).then(r => r.json())
    ]);
    res.json({
      temp: Math.round(wr.current.temperature_2m),
      code: wr.current.weather_code,
      isDay: wr.current.is_day === 1,
      cloud: wr.current.cloud_cover,
      now: wr.current.time,
      sunrise: wr.daily.sunrise[0],
      sunset: wr.daily.sunset[0],
      aqi: ar.current ? ar.current.us_aqi : null
    });
  } catch (e) { res.status(500).json({ error: 'Weather failed' }); }
});

if (require.main === module) {
  app.listen(3000, () => console.log('http://localhost:3000'));
}
module.exports = app;
