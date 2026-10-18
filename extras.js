'use strict';
/* =========================================================
   Skycast extras: rain radar map + share-as-picture
   Loaded after app.js, so it can use its helpers ($, data, curPlace, icon, fmtT ...)
   ========================================================= */

/* ---------- Rain radar (Rain Viewer tiles on a Leaflet map) ---------- */
const Radar = {
  map: null, layer: null, marker: null, base: null, frames: [], host: '', idx: 0, shownFor: null,

  loadLib() {
    if (window.L) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  async open() {
    if (!curPlace) return;
    $('mapSheet').hidden = false;
    $('mapNote').textContent = 'Loading map…';
    try {
      await this.loadLib();
      await this.init();
      setTimeout(() => this.map && this.map.invalidateSize(), 80);
    } catch (e) {
      $('mapNote').textContent = 'Could not load the map. Check your connection and try again.';
    }
  },
  close() { $('mapSheet').hidden = true; $('mapBtn').focus(); },

  async init() {
    const dark = $('card').classList.contains('dark');
    const at = [curPlace.lat, curPlace.lon];
    if (!this.map) {
      this.map = L.map('mapEl', { attributionControl: false, minZoom: 3, maxZoom: 10 }).setView(at, 6);
    }
    if (this.base) this.map.removeLayer(this.base);
    this.base = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`,
      { subdomains: 'abcd', maxZoom: 10 }).addTo(this.map);
    if (this.marker) this.map.removeLayer(this.marker);
    this.marker = L.circleMarker(at, { radius: 7, color: '#fff', weight: 3, fillColor: '#3d8bff', fillOpacity: 1 }).addTo(this.map);
    const key = at.join(',');
    if (this.shownFor !== key) { this.map.setView(at, 6); this.shownFor = key; }

    // radar frames: past 2 hours, every 10 minutes
    if (!this.frames.length || Date.now() - (this.loadedAt || 0) > 5 * 60000) {
      const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
      this.host = j.host; this.frames = (j.radar && j.radar.past) || []; this.loadedAt = Date.now();
    }
    if (!this.frames.length) { $('mapNote').textContent = 'Radar is not available right now.'; return; }
    const sl = $('mapSlider');
    sl.max = this.frames.length - 1;
    this.setFrame(this.frames.length - 1);
    $('mapNote').textContent = 'Shows the last 2 hours of rain. Pinch or drag to move around.';
  },

  setFrame(i) {
    this.idx = Math.max(0, Math.min(this.frames.length - 1, i));
    const f = this.frames[this.idx];
    // free radar tiles: 256px, "Universal Blue" colours (2), smoothed (1_1), real tiles up to zoom 7
    const url = `${this.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
    if (this.layer) this.layer.setUrl(url);
    else this.layer = L.tileLayer(url, { opacity: 0.75, maxNativeZoom: 7, maxZoom: 10, zIndex: 5 }).addTo(this.map);
    $('mapSlider').value = this.idx;
    const when = new Date(f.time * 1000), mins = Math.round((Date.now() - when.getTime()) / 60000);
    $('mapTime').innerHTML = `<b>${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b> · ${mins <= 5 ? 'now' : mins + ' min ago'}`;
  }
};
$('mapBtn').addEventListener('click', () => Radar.open());
$('mapClose').addEventListener('click', () => Radar.close());
$('mapPrev').addEventListener('click', () => Radar.setFrame(Radar.idx - 1));
$('mapNext').addEventListener('click', () => Radar.setFrame(Radar.idx + 1));
// "change" (not "input") so dragging the slider does not request tiles for every frame it passes
$('mapSlider').addEventListener('change', e => Radar.setFrame(+e.target.value));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('mapSheet').hidden) Radar.close(); });

/* ---------- Share today's weather as a picture ---------- */
const Share = {
  loadImage(src) {
    return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
  },
  async render() {
    const cs = getComputedStyle($('card')), v = n => cs.getPropertyValue(n).trim() || '#27366f';
    const Wd = 1080, Ht = 1350, cvs = document.createElement('canvas');
    cvs.width = Wd; cvs.height = Ht;
    const c = cvs.getContext('2d');

    const g = c.createLinearGradient(0, 0, 0, Ht);
    g.addColorStop(0, v('--bg1')); g.addColorStop(0.55, v('--bg2')); g.addColorStop(1, v('--bg3'));
    c.fillStyle = g; c.fillRect(0, 0, Wd, Ht);

    if ($('card').classList.contains('isnight')) {            // a few stars at night
      c.fillStyle = '#fff';
      for (let i = 0; i < 60; i++) {
        c.globalAlpha = 0.25 + Math.random() * 0.7;
        c.beginPath(); c.arc(Math.random() * Wd, Math.random() * 600, 1 + Math.random() * 2.5, 0, 6.283); c.fill();
      }
      c.globalAlpha = 1;
    }

    // the weather icon: copy the shared gradients into a stand-alone SVG so it can be drawn on the canvas
    const defs = document.querySelector('svg defs').innerHTML;
    const svg = icon(kindOf(data.code), data.isDay, curPhase)
      .replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" ')
      .replace(/^(<svg[^>]*>)/, `$1<defs>${defs}</defs>`);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try { c.drawImage(await this.loadImage(url), (Wd - 640) / 2, 330, 640, 640); } catch (e) { /* draw text only */ } finally { URL.revokeObjectURL(url); }

    const ink = v('--ink'), ink2 = v('--ink2'), font = '-apple-system, system-ui, "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = ink; c.font = `500 58px ${font}`; c.fillText(curPlace.name, Wd / 2, 130);
    c.font = `700 230px ${font}`; c.fillText(fmtT(data.temp), Wd / 2, 330);
    c.fillStyle = ink2; c.font = `400 52px ${font}`;
    c.fillText($('cap').textContent, Wd / 2, 1030);
    const d0 = data.daily && data.daily[0];
    if (d0) c.fillText(`H ${fmtT(d0.max)}   ·   L ${fmtT(d0.min)}`, Wd / 2, 1105);
    c.font = `400 40px ${font}`;
    c.fillText(new Date(data.now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), Wd / 2, 1170);
    c.fillStyle = ink; c.globalAlpha = 0.8; c.font = `700 44px ${font}`; c.fillText('Skycast', Wd / 2, 1280); c.globalAlpha = 1;
    return new Promise(resolve => cvs.toBlob(resolve, 'image/png'));
  },
  async share() {
    if (!data || !curPlace) return;
    const btn = $('shareBtn');
    btn.disabled = true;
    try {
      const blob = await this.render();
      const file = new File([blob], 'skycast-weather.png', { type: 'image/png' });
      const text = `${curPlace.name}: ${fmtT(data.temp)}, ${$('cap').textContent}`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Skycast', text });
      } else {                                              // no share sheet (desktop): download the picture
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'skycast-weather.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') $('msg').textContent = 'Could not make the picture. Try again.';
    } finally { btn.disabled = false; }
  }
};
$('shareBtn').addEventListener('click', () => Share.share());

/* =========================================================
   LANGUAGES: French, Hindi, Yoruba, Hausa
   Translates everything on screen while the app runs, so no other file changes.
   Anything missing from the list below simply stays in English.
   Pick a language in Settings.
   ========================================================= */
const I18N = (() => {
  const LANGS = { en: 'English', fr: 'Français', hi: 'हिन्दी', yo: 'Yorùbá', ha: 'Hausa' };
  const ORDER = ['fr', 'hi', 'yo', 'ha'];
  // English ¦ French ¦ Hindi ¦ Yoruba ¦ Hausa      ({name} marks a part that is filled in later)
  const RAW = `
Loading… ¦ Chargement… ¦ लोड हो रहा है… ¦ Ń gbé e wá… ¦ Ana lodawa…
Go ¦ OK ¦ जाएँ ¦ Lọ ¦ Je
Finding your location… ¦ Recherche de votre position… ¦ आपकी लोकेशन ढूँढ रहे हैं… ¦ Ń wá ibi tí o wà… ¦ Ana neman wurinka…
Reading the sky… ¦ Lecture du ciel… ¦ आसमान पढ़ रहे हैं… ¦ Ń ka ojú ọ̀run… ¦ Ana karanta sama…
Almost there… ¦ Presque terminé… ¦ बस थोड़ा और… ¦ Ó fẹ́rẹ̀ parí… ¦ Kusa ya ƙare…
Updating… ¦ Mise à jour… ¦ अपडेट हो रहा है… ¦ Ń ṣàtúnṣe… ¦ Ana sabuntawa…
Search a city ¦ Rechercher une ville ¦ शहर खोजें ¦ Wá ìlú kan ¦ Nemo birni
Use my location ¦ Utiliser ma position ¦ मेरी लोकेशन ¦ Lo ibi tí mo wà ¦ Yi amfani da wurina
Save this city ¦ Enregistrer cette ville ¦ यह शहर सहेजें ¦ Fi ìlú yìí pamọ́ ¦ Ajiye wannan birni
Saved (tap to remove) ¦ Enregistrée (toucher pour retirer) ¦ सहेजा गया (हटाने के लिए छुएँ) ¦ A ti fipamọ́ (tẹ láti yọ kúrò) ¦ An ajiye (taɓa don cirewa)
Forecast ¦ Prévisions ¦ पूर्वानुमान ¦ Ìsọtẹ́lẹ̀ ¦ Hasashe
DAY ¦ JOUR ¦ दिन ¦ ỌJỌ́ ¦ RANA
WEEK ¦ SEMAINE ¦ सप्ताह ¦ ỌSẸ̀ ¦ MAKON
Now ¦ Maintenant ¦ अभी ¦ Báyìí ¦ Yanzu
Today ¦ Aujourd'hui ¦ आज ¦ Òní ¦ Yau
Tonight ¦ Ce soir ¦ आज रात ¦ Alẹ́ òní ¦ Yau da dare
Garden planner ¦ Jardin ¦ बागवानी योजना ¦ Ètò ọgbà ¦ Shirin lambu
Run & fitness ¦ Course et forme ¦ दौड़ और फिटनेस ¦ Sísáré àti ìlera ¦ Gudu da lafiya
Sleep forecast ¦ Prévisions de sommeil ¦ नींद का पूर्वानुमान ¦ Ìsọtẹ́lẹ̀ oorun ¦ Hasashen barci
Settings ¦ Réglages ¦ सेटिंग्स ¦ Àtòjọ ¦ Saituna
Language ¦ Langue ¦ भाषा ¦ Èdè ¦ Harshe
Temperature ¦ Température ¦ तापमान ¦ Ìwọ̀n ooru ¦ Zafin yanayi
Wind speed ¦ Vitesse du vent ¦ हवा की गति ¦ Ìyára afẹ́fẹ́ ¦ Saurin iska
Widget view ¦ Vue widget ¦ विजेट व्यू ¦ Ìwòran widget ¦ Kallon widget
Open widget view ¦ Ouvrir la vue widget ¦ विजेट व्यू खोलें ¦ Ṣí ìwòran widget ¦ Buɗe kallon widget
Install ¦ Installer ¦ इंस्टॉल करें ¦ Fi sórí ẹ̀rọ ¦ Shigar
About ¦ À propos ¦ जानकारी ¦ Nípa rẹ̀ ¦ Game da
Skycast is installed on this device. ✓ ¦ Skycast est installé sur cet appareil. ✓ ¦ Skycast इस डिवाइस पर इंस्टॉल है। ✓ ¦ A ti fi Skycast sórí ẹ̀rọ yìí. ✓ ¦ An shigar da Skycast a wannan na'ura. ✓
Install Skycast ¦ Installer Skycast ¦ Skycast इंस्टॉल करें ¦ Fi Skycast sórí ẹ̀rọ ¦ Shigar da Skycast
Adds a home-screen icon and opens full screen. ¦ Ajoute une icône sur l'écran d'accueil et s'ouvre en plein écran. ¦ होम स्क्रीन पर आइकन जोड़ता है और फ़ुल स्क्रीन में खुलता है। ¦ Ó máa fi àmì sí orí ojú ìbẹ̀rẹ̀, ó sì ṣí ní kíkún. ¦ Yana ƙara alama a allon gida kuma yana buɗewa cikakke.
Rain radar ¦ Radar de pluie ¦ बारिश रडार ¦ Radá òjò ¦ Radar ruwan sama
Light rain ¦ Pluie faible ¦ हल्की बारिश ¦ Òjò díẹ̀ ¦ Ruwan sama kaɗan
Heavy rain ¦ Forte pluie ¦ तेज़ बारिश ¦ Òjò ńlá ¦ Ruwan sama mai ƙarfi
Weather data by Rain Viewer ¦ Données météo par Rain Viewer ¦ मौसम डेटा Rain Viewer से ¦ Ìsọfúnni ojú ọjọ́ láti ọwọ́ Rain Viewer ¦ Bayanan yanayi daga Rain Viewer
Loading map… ¦ Chargement de la carte… ¦ नक्शा लोड हो रहा है… ¦ Ń gbé àwòrán ilẹ̀ wá… ¦ Ana loda taswira…
Radar is not available right now. ¦ Le radar n'est pas disponible pour le moment. ¦ रडार अभी उपलब्ध नहीं है। ¦ Radá kò sí lọ́wọ́lọ́wọ́ yìí. ¦ Radar ba ya samuwa a yanzu.
{m} min ago ¦ il y a {m} min ¦ {m} मिनट पहले ¦ ìṣẹ́jú {m} sẹ́yìn ¦ mintuna {m} da suka wuce
now ¦ maintenant ¦ अभी ¦ báyìí ¦ yanzu
Clear sky ¦ Ciel dégagé ¦ साफ़ आसमान ¦ Ojú ọ̀run mọ́ ¦ Sama a sarari
Mostly clear ¦ Plutôt dégagé ¦ ज़्यादातर साफ़ ¦ Ó mọ́ jù ¦ Galibi a sarari
Partly cloudy ¦ Partiellement nuageux ¦ आंशिक बादल ¦ Ìkùukùu díẹ̀ ¦ Gajimare kaɗan
Overcast ¦ Couvert ¦ घने बादल ¦ Ìkùukùu bò ó ¦ Gajimare ya rufe
Foggy ¦ Brumeux ¦ कोहरा ¦ Kùrukùru ¦ Hazo
Light drizzle ¦ Légère bruine ¦ हल्की फुहार ¦ Ìrọ̀lẹ́ òjò díẹ̀ ¦ Ɗan ɗigon ruwa
Drizzle ¦ Bruine ¦ फुहार ¦ Ìrọ̀lẹ́ òjò ¦ Ɗigon ruwa
Heavy drizzle ¦ Forte bruine ¦ तेज़ फुहार ¦ Ìrọ̀lẹ́ òjò púpọ̀ ¦ Ɗigon ruwa mai yawa
Freezing drizzle ¦ Bruine verglaçante ¦ जमने वाली फुहार ¦ Ìrọ̀lẹ́ òjò dídì ¦ Ɗigon ruwa mai daskarewa
Rain ¦ Pluie ¦ बारिश ¦ Òjò ¦ Ruwan sama
Freezing rain ¦ Pluie verglaçante ¦ जमने वाली बारिश ¦ Òjò dídì ¦ Ruwan sama mai daskarewa
Light snow ¦ Légère neige ¦ हल्की बर्फ़बारी ¦ Yìnyín díẹ̀ ¦ Ɗan dusar ƙanƙara
Snow ¦ Neige ¦ बर्फ़बारी ¦ Yìnyín ¦ Dusar ƙanƙara
Heavy snow ¦ Forte neige ¦ भारी बर्फ़बारी ¦ Yìnyín púpọ̀ ¦ Dusar ƙanƙara mai yawa
Snow grains ¦ Grains de neige ¦ बर्फ़ के कण ¦ Hóró yìnyín ¦ Ƙwayoyin dusar ƙanƙara
Showers ¦ Averses ¦ बौछारें ¦ Òjò ẹlẹ́kùrọ́ ¦ Ruwan sama ɗan lokaci
Heavy showers ¦ Fortes averses ¦ तेज़ बौछारें ¦ Òjò ẹlẹ́kùrọ́ ńlá ¦ Ruwan sama mai ƙarfi
Snow showers ¦ Averses de neige ¦ बर्फ़ की बौछारें ¦ Yìnyín ẹlẹ́kùrọ́ ¦ Ruwan dusar ƙanƙara
Thunderstorm ¦ Orage ¦ आंधी-तूफ़ान ¦ Ìjì àti àrá ¦ Tsawa da guguwa
Weather ¦ Météo ¦ मौसम ¦ Ojú ọjọ́ ¦ Yanayi
New moon ¦ Nouvelle lune ¦ अमावस्या ¦ Òṣùpá tuntun ¦ Sabon wata
Waxing crescent ¦ Premier croissant ¦ शुक्ल पक्ष का अर्धचंद्र ¦ Òṣùpá ń tóbi ¦ Wata na girma
First quarter ¦ Premier quartier ¦ पहला चतुर्थांश ¦ Ìdá kìíní òṣùpá ¦ Kwata ta farko
Waxing gibbous ¦ Gibbeuse croissante ¦ बढ़ता गिब्बस चंद्र ¦ Òṣùpá ń kún ¦ Wata na cika
Full moon ¦ Pleine lune ¦ पूर्णिमा ¦ Òṣùpá kíkún ¦ Cikakken wata
Waning gibbous ¦ Gibbeuse décroissante ¦ घटता गिब्बस चंद्र ¦ Òṣùpá ń dínkù ¦ Wata na raguwa
Last quarter ¦ Dernier quartier ¦ अंतिम चतुर्थांश ¦ Ìdá ìkẹyìn òṣùpá ¦ Kwata ta ƙarshe
Waning crescent ¦ Dernier croissant ¦ कृष्ण पक्ष का अर्धचंद्र ¦ Òṣùpá ń parẹ́ ¦ Wata na ƙarewa
Rain in {m} min ¦ Pluie dans {m} min ¦ {m} मिनट में बारिश ¦ Òjò yóò rọ̀ ní ìṣẹ́jú {m} ¦ Ruwan sama cikin mintuna {m}
Rain until {t} ¦ Pluie jusqu'à {t} ¦ {t} तक बारिश ¦ Òjò títí di {t} ¦ Ruwan sama har {t}
Rain for the next 2 hours ¦ Pluie pendant les 2 prochaines heures ¦ अगले 2 घंटे बारिश ¦ Òjò fún wákàtí 2 tó ń bọ̀ ¦ Ruwan sama na awanni 2 masu zuwa
No rain for 2 hours ¦ Pas de pluie pendant 2 heures ¦ 2 घंटे तक बारिश नहीं ¦ Kò sí òjò fún wákàtí 2 ¦ Babu ruwan sama na awanni 2
Golden hour now, until {t} ¦ Heure dorée en cours, jusqu'à {t} ¦ गोल्डन आवर अभी, {t} तक ¦ Wákàtí wúrà báyìí, títí di {t} ¦ Sa'ar zinariya yanzu, har {t}
Morning golden hour {t} ¦ Heure dorée du matin {t} ¦ सुबह का गोल्डन आवर {t} ¦ Wákàtí wúrà òwúrọ̀ {t} ¦ Sa'ar zinariya ta safe {t}
Morning golden hour tomorrow {t} ¦ Heure dorée de demain matin {t} ¦ कल सुबह का गोल्डन आवर {t} ¦ Wákàtí wúrà òwúrọ̀ ọ̀la {t} ¦ Sa'ar zinariya ta safiyar gobe {t}
Evening golden hour {t} ¦ Heure dorée du soir {t} ¦ शाम का गोल्डन आवर {t} ¦ Wákàtí wúrà ìrọ̀lẹ́ {t} ¦ Sa'ar zinariya ta yamma {t}
Air quality is poor tonight. Keep windows closed. ¦ La qualité de l'air est mauvaise ce soir. Gardez les fenêtres fermées. ¦ आज रात हवा की गुणवत्ता खराब है। खिड़कियाँ बंद रखें। ¦ Afẹ́fẹ́ kò dára lálẹ́ òní. Pa fèrèsé mọ́. ¦ Ingancin iska ba shi da kyau a daren yau. Ka rufe tagogi.
Snowy night. Perfect for a cozy blanket. ¦ Nuit de neige. Parfait pour une couverture bien chaude. ¦ बर्फ़ीली रात। गरम कंबल के लिए बढ़िया। ¦ Alẹ́ yìnyín. Ó dára fún aṣọ ìbora gbígbóná. ¦ Daren dusar ƙanƙara. Ya dace da bargo mai ɗumi.
Rain outside, which makes great sleeping sounds. ¦ Il pleut dehors, un bruit parfait pour dormir. ¦ बाहर बारिश है, नींद के लिए बढ़िया आवाज़। ¦ Òjò ń rọ̀ lóde, ìró rẹ̀ dára fún oorun. ¦ Ana ruwan sama a waje, sautinsa yana taimakon barci.
Warm night. Keep the room cool and use a fan. ¦ Nuit chaude. Gardez la pièce fraîche et utilisez un ventilateur. ¦ गरम रात। कमरा ठंडा रखें और पंखा चलाएँ। ¦ Alẹ́ gbígbóná. Jẹ́ kí yàrá tutù, kí o sì lo afẹ́fẹ́. ¦ Daren zafi. Ka sa ɗaki ya yi sanyi ka yi amfani da fanka.
Chilly night. A warm blanket will help. ¦ Nuit fraîche. Une couverture chaude vous aidera. ¦ ठंडी रात। गरम कंबल मदद करेगा। ¦ Alẹ́ tútù. Aṣọ ìbora gbígbóná yóò ràn ọ́ lọ́wọ́. ¦ Daren sanyi. Bargo mai ɗumi zai taimaka.
Clear skies, a good night for stargazing before bed. ¦ Ciel dégagé, une belle nuit pour observer les étoiles avant de dormir. ¦ साफ़ आसमान, सोने से पहले तारे देखने के लिए अच्छी रात। ¦ Ojú ọ̀run mọ́, alẹ́ tó dára láti wo ìràwọ̀ kí o tó sùn. ¦ Sama a sarari, daren da ya dace a kalli taurari kafin barci.
Calm and comfortable. Good conditions for sleep. ¦ Calme et agréable. De bonnes conditions pour dormir. ¦ शांत और आरामदायक। नींद के लिए अच्छा मौसम। ¦ Ìdákẹ́jẹ́ẹ́ àti ìtùnú. Ipò rere fún oorun. ¦ Kwanciyar hankali da jin daɗi. Yanayi mai kyau na barci.
Best time to run ¦ Meilleur moment pour courir ¦ दौड़ने का सबसे अच्छा समय ¦ Àkókò tó dára jù láti sáré ¦ Lokaci mafi kyau na gudu
No good window ¦ Aucun bon créneau ¦ कोई अच्छा समय नहीं ¦ Kò sí àkókò tó dára ¦ Babu lokaci mai kyau
The next 24 hours look rough. Try an indoor session. ¦ Les 24 prochaines heures s'annoncent difficiles. Essayez une séance en intérieur. ¦ अगले 24 घंटे मुश्किल दिख रहे हैं। घर के अंदर कसरत करें। ¦ Wákàtí 24 tó ń bọ̀ kò dára. Gbìyànjú eré ìdárayá nínú ilé. ¦ Awanni 24 masu zuwa ba su da kyau. Gwada motsa jiki a cikin gida.
Air quality {a} ¦ Qualité de l'air {a} ¦ हवा की गुणवत्ता {a} ¦ Ìwọ̀n afẹ́fẹ́ {a} ¦ Ingancin iska {a}
Starts in {m} min ¦ Commence dans {m} min ¦ {m} मिनट में शुरू ¦ Yóò bẹ̀rẹ̀ ní ìṣẹ́jú {m} ¦ Zai fara cikin mintuna {m}
Window is open now ¦ Le créneau est ouvert maintenant ¦ समय अभी खुला है ¦ Àkókò náà ṣí báyìí ¦ Lokacin ya buɗe yanzu
humidity {h}% ¦ humidité {h} % ¦ नमी {h}% ¦ ọ̀rinrin {h}% ¦ danshi {h}%
{h}% humidity ¦ {h} % d'humidité ¦ {h}% नमी ¦ ọ̀rinrin {h}% ¦ danshi {h}%
wind {w} ¦ vent {w} ¦ हवा {w} ¦ afẹ́fẹ́ {w} ¦ iska {w}
calm ¦ calme ¦ शांत ¦ dákẹ́ ¦ shiru
breezy ¦ venteux ¦ हवादार ¦ afẹ́fẹ́ díẹ̀ ¦ iska kaɗan
rain ¦ pluie ¦ बारिश ¦ òjò ¦ ruwan sama
Run reminder ¦ Rappel de course ¦ दौड़ की याद दिलाना ¦ Ìránnilétí sísáré ¦ Tunatarwa ta gudu
Nudge me 30 minutes before my best window ¦ Prévenez-moi 30 minutes avant mon meilleur créneau ¦ मेरे सबसे अच्छे समय से 30 मिनट पहले याद दिलाएँ ¦ Rán mi létí ìṣẹ́jú 30 ṣáájú àkókò tó dára jù ¦ Tuna mini mintuna 30 kafin lokaci mafi kyau
This browser does not support notifications. ¦ Ce navigateur ne prend pas en charge les notifications. ¦ यह ब्राउज़र नोटिफ़िकेशन का समर्थन नहीं करता। ¦ Ẹ̀rọ ìwádìí yìí kò ṣe àtìlẹ́yìn ìfitónilétí. ¦ Wannan burauzar ba ta goyon bayan sanarwa.
Hourly rating ¦ Note par heure ¦ घंटे के अनुसार रेटिंग ¦ Ìdánimọ̀ wákàtí kọ̀ọ̀kan ¦ Ƙima ta kowane awa
Great ¦ Excellent ¦ बहुत बढ़िया ¦ Dára gan-an ¦ Mai kyau sosai
Fair ¦ Correct ¦ ठीक-ठाक ¦ Tó tọ́ ¦ Matsakaici
Poor ¦ Mauvais ¦ खराब ¦ Kò dára ¦ Mara kyau
Ideal ¦ Idéal ¦ आदर्श ¦ Tó péye ¦ Ya dace sosai
Okay ¦ Correct ¦ ठीक ¦ Ó tọ́ ¦ Yayi
Avoid ¦ À éviter ¦ बचें ¦ Yẹra fún ¦ A guji
Best ¦ Meilleur ¦ सर्वश्रेष्ठ ¦ Tó dára jù ¦ Mafi kyau
Gear & safety ¦ Équipement et sécurité ¦ सामान और सुरक्षा ¦ Ohun èlò àti ààbò ¦ Kayan aiki da tsaro
What to wear ¦ Que porter ¦ क्या पहनें ¦ Ohun tí o máa wọ̀ ¦ Abin da za a sa
Hydration ¦ Hydratation ¦ पानी पीना ¦ Mímu omi ¦ Shan ruwa
per hour ¦ par heure ¦ प्रति घंटा ¦ ní wákàtí kan ¦ a kowace awa
Safety ¦ Sécurité ¦ सुरक्षा ¦ Ààbò ¦ Tsaro
Your limits ¦ Vos limites ¦ आपकी सीमाएँ ¦ Ààlà rẹ ¦ Iyakokinka
Max temperature ¦ Température max ¦ अधिकतम तापमान ¦ Ooru tó pọ̀ jù ¦ Mafi yawan zafi
Max humidity ¦ Humidité max ¦ अधिकतम नमी ¦ Ọ̀rinrin tó pọ̀ jù ¦ Mafi yawan danshi
Max wind ¦ Vent max ¦ अधिकतम हवा ¦ Afẹ́fẹ́ tó pọ̀ jù ¦ Mafi yawan iska
Max UV index ¦ Indice UV max ¦ अधिकतम UV सूचकांक ¦ Ìwọ̀n UV tó pọ̀ jù ¦ Mafi yawan UV
Reset to defaults ¦ Rétablir par défaut ¦ डिफ़ॉल्ट पर लौटें ¦ Tún padà sí àtẹ̀jáde àkọ́kọ́ ¦ Koma kan asali
Humidity ¦ Humidité ¦ नमी ¦ Ọ̀rinrin ¦ Danshi
Wind ¦ Vent ¦ हवा ¦ Afẹ́fẹ́ ¦ Iska
UV index ¦ Indice UV ¦ UV सूचकांक ¦ Ìwọ̀n UV ¦ Ma'aunin UV
Temp ¦ Temp. ¦ तापमान ¦ Ooru ¦ Zafi
Target under {v} ¦ Objectif sous {v} ¦ लक्ष्य {v} से कम ¦ Ìfojúsùn lábẹ́ {v} ¦ Manufa ƙasa da {v}
Calm under {v} ¦ Calme sous {v} ¦ {v} से कम पर शांत ¦ Dákẹ́ lábẹ́ {v} ¦ Kwanciyar hankali ƙasa da {v}
Low under {v} ¦ Faible sous {v} ¦ {v} से कम पर कम ¦ Kéré lábẹ́ {v} ¦ Ƙasa da {v}
Under {v} ¦ Sous {v} ¦ {v} से कम ¦ Lábẹ́ {v} ¦ Ƙasa da {v}
Under {n} ideal ¦ Idéal sous {n} ¦ {n} से कम आदर्श ¦ Lábẹ́ {n} dára ¦ Ƙasa da {n} ya fi
{r} ideal ¦ {r} idéal ¦ {r} आदर्श ¦ {r} dára jù ¦ {r} ya fi dacewa
All four conditions are within your limits. ¦ Les quatre conditions sont dans vos limites. ¦ चारों स्थितियाँ आपकी सीमा में हैं। ¦ Gbogbo ipò mẹ́rin wà láàrín ààlà rẹ. ¦ Dukkan yanayi huɗun suna cikin iyakokinka.
Frost & heat watch ¦ Veille gel et chaleur ¦ पाला और गर्मी की निगरानी ¦ Ìṣọ́ òtútù àti ooru ¦ Sa ido kan sanyi da zafi
No frost or heat risk for {crop} in the next 3 days. ¦ Aucun risque de gel ou de chaleur pour {crop} dans les 3 prochains jours. ¦ अगले 3 दिनों में {crop} के लिए पाले या गर्मी का कोई खतरा नहीं। ¦ Kò sí ewu òtútù tàbí ooru fún {crop} láàrín ọjọ́ mẹ́ta tó ń bọ̀. ¦ Babu haɗarin sanyi ko zafi ga {crop} a kwanaki 3 masu zuwa.
Soil & rain ¦ Sol et pluie ¦ मिट्टी और बारिश ¦ Ilẹ̀ àti òjò ¦ Ƙasa da ruwan sama
Moisture ¦ Humidité du sol ¦ नमी ¦ Ọ̀rinrin ilẹ̀ ¦ Danshin ƙasa
Soil temp ¦ Temp. du sol ¦ मिट्टी का तापमान ¦ Ooru ilẹ̀ ¦ Zafin ƙasa
At {n} cm ¦ À {n} cm ¦ {n} सेमी पर ¦ Ní {n} cm ¦ A zurfin {n} cm
Rain 24h ¦ Pluie 24 h ¦ 24 घंटे में बारिश ¦ Òjò wákàtí 24 ¦ Ruwan sama na awa 24
From {t} ¦ À partir de {t} ¦ {t} से ¦ Láti {t} ¦ Daga {t}
None due ¦ Aucune prévue ¦ कोई नहीं ¦ Kò sí ¦ Babu
No data ¦ Pas de données ¦ डेटा नहीं ¦ Kò sí dátà ¦ Babu bayanai
Soil moisture is not available for this location. ¦ L'humidité du sol n'est pas disponible pour ce lieu. ¦ इस जगह के लिए मिट्टी की नमी उपलब्ध नहीं है। ¦ Ọ̀rinrin ilẹ̀ kò sí fún ibí yìí. ¦ Danshin ƙasa ba ya samuwa a wannan wuri.
Very dry ¦ Très sec ¦ बहुत सूखा ¦ Gbẹ gan-an ¦ Bushe sosai
Dry ¦ Sec ¦ सूखा ¦ Gbẹ ¦ Bushe
Moist ¦ Humide ¦ नम ¦ Tutù ¦ Mai danshi
Wet ¦ Détrempé ¦ गीला ¦ Tutù yọ̀ọ̀ ¦ Jike
Best planting window ¦ Meilleur créneau de plantation ¦ रोपाई का सबसे अच्छा समय ¦ Àkókò gbígbìn tó dára jù ¦ Mafi kyawun lokacin shuka
None today ¦ Aucun aujourd'hui ¦ आज कोई नहीं ¦ Kò sí lónìí ¦ Babu yau
Planting hours ¦ Heures de plantation ¦ रोपाई के घंटे ¦ Wákàtí gbígbìn ¦ Awannin shuka
What to sow ¦ Que semer ¦ क्या बोएँ ¦ Ohun tí a lè gbìn ¦ Abin da za a shuka
Crop calendar ¦ Calendrier cultural ¦ फ़सल कैलेंडर ¦ Kàlẹ́ńdà ohun ọ̀gbìn ¦ Kalandar amfanin gona
Loading climate for your location… ¦ Chargement du climat de votre région… ¦ आपकी जगह का जलवायु डेटा लोड हो रहा है… ¦ Ń gbé ojú-ọjọ́ ibi rẹ wá… ¦ Ana loda yanayin wurinka…
Climate data is not available for this location. ¦ Les données climatiques ne sont pas disponibles pour ce lieu. ¦ इस जगह के लिए जलवायु डेटा उपलब्ध नहीं है। ¦ Dátà ojú-ọjọ́ kò sí fún ibí yìí. ¦ Bayanan yanayi ba su samuwa a wannan wuri.
Best months to plant {crop}: {months} ¦ Meilleurs mois pour planter {crop} : {months} ¦ {crop} लगाने के सबसे अच्छे महीने: {months} ¦ Àwọn oṣù tó dára jù láti gbìn {crop}: {months} ¦ Mafi kyawun watanni don shuka {crop}: {months}
Good to plant this month ¦ À planter ce mois-ci ¦ इस महीने लगाने के लिए अच्छा ¦ Ó dára láti gbìn lóṣù yìí ¦ Mai kyau a shuka a wannan wata
General ¦ Général ¦ सामान्य ¦ Gbogbogbò ¦ Gaba ɗaya
Tomato ¦ Tomate ¦ टमाटर ¦ Tòmátì ¦ Tumatir
Pepper ¦ Piment ¦ मिर्च ¦ Ata ¦ Barkono
Maize ¦ Maïs ¦ मक्का ¦ Àgbàdo ¦ Masara
Beans ¦ Haricots ¦ बीन्स ¦ Ẹ̀wà ¦ Wake
Spinach ¦ Épinards ¦ पालक ¦ Ẹ̀fọ́ ¦ Alayyahu
Lettuce ¦ Laitue ¦ सलाद पत्ता ¦ Leṭúsì ¦ Latas
Carrot ¦ Carotte ¦ गाजर ¦ Karọ́ọ̀tì ¦ Karas
Cabbage ¦ Chou ¦ पत्ता गोभी ¦ Kábéèjì ¦ Kabeji
Cassava ¦ Manioc ¦ कसावा ¦ Gbágùúdá ¦ Rogo
Okra ¦ Gombo ¦ भिंडी ¦ Ilá ¦ Kubewa
most plants ¦ la plupart des plantes ¦ ज़्यादातर पौधे ¦ ọ̀pọ̀ ohun ọ̀gbìn ¦ yawancin tsirrai
Hardy plants ¦ Les plantes résistantes ¦ मज़बूत पौधे ¦ Àwọn ohun ọ̀gbìn alágbára ¦ Tsirrai masu juriya
tonight ¦ ce soir ¦ आज रात ¦ lálẹ́ òní ¦ yau da dare
today ¦ aujourd'hui ¦ आज ¦ lónìí ¦ yau
tomorrow ¦ demain ¦ कल ¦ lọ́la ¦ gobe
in 2 days ¦ dans 2 jours ¦ 2 दिन में ¦ ní ọjọ́ méjì ¦ nan da kwana 2
{label} sleep ¦ Sommeil : {label} ¦ नींद: {label} ¦ Oorun: {label} ¦ Barci: {label}
Great sleep ¦ Excellent sommeil ¦ बहुत बढ़िया नींद ¦ Oorun tó dára gan-an ¦ Barci mai kyau sosai
Good sleep ¦ Bon sommeil ¦ अच्छी नींद ¦ Oorun tó dára ¦ Barci mai kyau
Restless sleep ¦ Sommeil agité ¦ बेचैन नींद ¦ Oorun àìsinmi ¦ Barci mara natsuwa
Rough sleep ¦ Sommeil difficile ¦ मुश्किल नींद ¦ Oorun tó ṣòro ¦ Barci mai wahala
of 100 ¦ sur 100 ¦ 100 में से ¦ nínú 100 ¦ cikin 100
Best bedtime: ¦ Meilleure heure du coucher : ¦ सोने का सबसे अच्छा समय: ¦ Àkókò tó dára jù láti sùn: ¦ Mafi kyawun lokacin kwanciya:
Coolest at {t} ({v}) ¦ Le plus frais à {t} ({v}) ¦ सबसे ठंडा {t} पर ({v}) ¦ Tútù jù ní {t} ({v}) ¦ Mafi sanyi da {t} ({v})
Overnight temperature ¦ Température nocturne ¦ रात का तापमान ¦ Ìwọ̀n ooru òru ¦ Zafin yanayi na dare
What affects your sleep ¦ Ce qui influence votre sommeil ¦ आपकी नींद को क्या प्रभावित करता है ¦ Ohun tó ń kàn oorun rẹ ¦ Abin da ke shafar barcinka
Tips for tonight ¦ Conseils pour ce soir ¦ आज रात के लिए सुझाव ¦ Ìmọ̀ràn fún alẹ́ òní ¦ Shawarwari na daren yau
Not enough data for tonight yet. ¦ Pas encore assez de données pour ce soir. ¦ आज रात के लिए अभी पर्याप्त डेटा नहीं है। ¦ Dátà kò tíì tó fún alẹ́ òní. ¦ Babu isassun bayanai na daren yau tukuna.
Not enough hours left tonight for a chart. ¦ Pas assez d'heures restantes ce soir pour un graphique. ¦ आज रात ग्राफ़ के लिए पर्याप्त घंटे नहीं बचे। ¦ Wákàtí kò tó fún àwòrán lálẹ́ òní. ¦ Babu isassun awanni da suka rage don zane.
Live data ¦ Données en direct ¦ लाइव डेटा ¦ Dátà lásìkò yìí ¦ Bayanai kai tsaye
Partly demo data ¦ Données en partie de démo ¦ आंशिक डेमो डेटा ¦ Dátà àpẹẹrẹ díẹ̀ ¦ Wani ɓangare bayanan gwaji
Demo data ¦ Données de démo ¦ डेमो डेटा ¦ Dátà àpẹẹrẹ ¦ Bayanan gwaji
Could not load weather. Try again. ¦ Impossible de charger la météo. Réessayez. ¦ मौसम लोड नहीं हो सका। फिर कोशिश करें। ¦ Kò lè gbé ojú ọjọ́ wá. Tún gbìyànjú. ¦ Ba a iya loda yanayi ba. Sake gwadawa.
Could not load weather. ¦ Impossible de charger la météo. ¦ मौसम लोड नहीं हो सका। ¦ Kò lè gbé ojú ọjọ́ wá. ¦ Ba a iya loda yanayi ba.
Location is blocked. Search a city instead. ¦ La localisation est bloquée. Recherchez plutôt une ville. ¦ लोकेशन बंद है। इसके बजाय शहर खोजें। ¦ A ti dí ibùdó. Wá ìlú kan dípò. ¦ An toshe wuri. Maimakon haka, nemo birni.
Couldn't find "{q}". Check the spelling. ¦ Impossible de trouver « {q} ». Vérifiez l'orthographe. ¦ "{q}" नहीं मिला। वर्तनी जाँचें। ¦ Kò rí "{q}". Ṣàyẹ̀wò bí a ṣe kọ ọ́. ¦ Ba a samu "{q}" ba. Duba rubutun.
Search failed. Try again. ¦ La recherche a échoué. Réessayez. ¦ खोज विफल रही। फिर कोशिश करें। ¦ Ìwádìí kùnà. Tún gbìyànjú. ¦ Bincike ya kasa. Sake gwadawa.
Sound is not supported in this browser. ¦ Le son n'est pas pris en charge par ce navigateur. ¦ इस ब्राउज़र में आवाज़ समर्थित नहीं है। ¦ Ẹ̀rọ ìwádìí yìí kò ṣe àtìlẹ́yìn ohùn. ¦ Wannan burauzar ba ta goyon bayan sauti.
Could not make the picture. Try again. ¦ Impossible de créer l'image. Réessayez. ¦ तस्वीर नहीं बन सकी। फिर कोशिश करें। ¦ Kò lè ṣe àwòrán náà. Tún gbìyànjú. ¦ Ba a iya yin hoton ba. Sake gwadawa.
Hot ({v}) ¦ Chaud ({v}) ¦ गर्म ({v}) ¦ Gbóná ({v}) ¦ Zafi ({v})
Cold ({v}) ¦ Froid ({v}) ¦ ठंडा ({v}) ¦ Tútù ({v}) ¦ Sanyi ({v})
Humid ({v}) ¦ Humide ({v}) ¦ उमस ({v}) ¦ Ọ̀rinrin ({v}) ¦ Danshi ({v})
Very windy ({v}) ¦ Très venteux ({v}) ¦ बहुत तेज़ हवा ({v}) ¦ Afẹ́fẹ́ líle gan-an ({v}) ¦ Iska mai ƙarfi sosai ({v})
Breezy ({v}) ¦ Venteux ({v}) ¦ हवादार ({v}) ¦ Afẹ́fẹ́ díẹ̀ ({v}) ¦ Iska kaɗan ({v})
Very high UV ({v}) ¦ UV très élevé ({v}) ¦ बहुत ऊँचा UV ({v}) ¦ UV ga gan-an ({v}) ¦ UV mai tsanani sosai ({v})
High UV ({v}) ¦ UV élevé ({v}) ¦ ऊँचा UV ({v}) ¦ UV ga ({v}) ¦ UV mai yawa ({v})
Rain likely ¦ Pluie probable ¦ बारिश की संभावना ¦ Òjò lè rọ̀ ¦ Ana iya ruwan sama
Dark: wear reflective gear ¦ Nuit : portez du matériel réfléchissant ¦ अँधेरा: रिफ्लेक्टिव सामान पहनें ¦ Òkùnkùn: wọ aṣọ tó ń tàn ¦ Duhu: sa kayan da ke haskakawa
Too dark to work ¦ Trop sombre pour travailler ¦ काम के लिए बहुत अँधेरा ¦ Òkùnkùn pọ̀ jù láti ṣiṣẹ́ ¦ Duhu ya yi yawa don aiki
Cool ({v}) ¦ Frais ({v}) ¦ ठंडक ({v}) ¦ Tútù díẹ̀ ({v}) ¦ Sanyi kaɗan ({v})
Cold soil ({v}) ¦ Sol froid ({v}) ¦ ठंडी मिट्टी ({v}) ¦ Ilẹ̀ tútù ({v}) ¦ Ƙasa mai sanyi ({v})
Cool soil ({v}) ¦ Sol frais ({v}) ¦ ठंडक वाली मिट्टी ({v}) ¦ Ilẹ̀ tútù díẹ̀ ({v}) ¦ Ƙasa mai sanyi kaɗan ({v})
Warm soil ({v}) ¦ Sol tiède ({v}) ¦ गुनगुनी मिट्टी ({v}) ¦ Ilẹ̀ gbígbóná díẹ̀ ({v}) ¦ Ƙasa mai ɗumi ({v})
Hot soil ({v}) ¦ Sol chaud ({v}) ¦ गर्म मिट्टी ({v}) ¦ Ilẹ̀ gbígbóná ({v}) ¦ Ƙasa mai zafi ({v})
Soil temperature unknown ¦ Température du sol inconnue ¦ मिट्टी का तापमान अज्ञात ¦ A kò mọ ooru ilẹ̀ ¦ Ba a san zafin ƙasa ba
at {t} ¦ à {t} ¦ {t} पर ¦ ní {t} ¦ da {t}
tomorrow at {t} ¦ demain à {t} ¦ कल {t} पर ¦ lọ́la ní {t} ¦ gobe da {t}
Frost {when} ({v}) ¦ Gel {when} ({v}) ¦ पाला {when} ({v}) ¦ Òtútù yìnyín {when} ({v}) ¦ Sanyin ƙanƙara {when} ({v})
Cold {when} ({v}) ¦ Froid {when} ({v}) ¦ ठंड {when} ({v}) ¦ Òtútù {when} ({v}) ¦ Sanyi {when} ({v})
Light frost {when} ¦ Gelée légère {when} ¦ हल्का पाला {when} ¦ Òtútù yìnyín díẹ̀ {when} ¦ Ɗan sanyin ƙanƙara {when}
Heat {when} ({v}) ¦ Chaleur {when} ({v}) ¦ गर्मी {when} ({v}) ¦ Ooru {when} ({v}) ¦ Zafi {when} ({v})
Hot {when} ({v}) ¦ Chaud {when} ({v}) ¦ गर्म {when} ({v}) ¦ Gbóná {when} ({v}) ¦ Zafi {when} ({v})
Ideal {lo}–{hi} ¦ Idéal {lo}–{hi} ¦ आदर्श {lo}–{hi} ¦ Tó dára {lo}–{hi} ¦ Mafi kyau {lo}–{hi}
Ideal 30–70% ¦ Idéal 30–70 % ¦ आदर्श 30–70% ¦ Tó dára 30–70% ¦ Mafi kyau 30–70%
Stormy ¦ Orageux ¦ तूफ़ानी ¦ Ìjì ¦ Guguwa
Loud rain ¦ Pluie bruyante ¦ तेज़ आवाज़ वाली बारिश ¦ Òjò tó ń sán ¦ Ruwan sama mai ƙara
Very windy ¦ Très venteux ¦ बहुत तेज़ हवा ¦ Afẹ́fẹ́ líle gan-an ¦ Iska mai ƙarfi sosai
Breezy ¦ Venteux ¦ हवादार ¦ Afẹ́fẹ́ díẹ̀ ¦ Iska kaɗan
Soft rain ¦ Pluie douce ¦ हल्की बारिश ¦ Òjò rọ̀rùn ¦ Ruwan sama mai taushi
Calm ¦ Calme ¦ शांत ¦ Ìdákẹ́jẹ́ẹ́ ¦ Shiru
Noise ¦ Bruit ¦ शोर ¦ Ariwo ¦ Hayaniya
Wind up to {v} ¦ Vent jusqu'à {v} ¦ हवा {v} तक ¦ Afẹ́fẹ́ tó {v} ¦ Iska har {v}
Air quality ¦ Qualité de l'air ¦ हवा की गुणवत्ता ¦ Ìwọ̀n afẹ́fẹ́ ¦ Ingancin iska
Good ¦ Bon ¦ अच्छा ¦ Dára ¦ Mai kyau
Moderate ¦ Modéré ¦ मध्यम ¦ Àárín gbùngbùn ¦ Matsakaici
Unhealthy ¦ Malsain ¦ अस्वस्थ ¦ Kò dára fún ìlera ¦ Mara lafiya
Rain next 24h: {mm} mm ¦ Pluie sur 24 h : {mm} mm ¦ अगले 24 घंटे में बारिश: {mm} मिमी ¦ Òjò wákàtí 24: {mm} mm ¦ Ruwan sama na awa 24: {mm} mm
Soil moisture {pct}% ({label}) ¦ Humidité du sol {pct} % ({label}) ¦ मिट्टी की नमी {pct}% ({label}) ¦ Ọ̀rinrin ilẹ̀ {pct}% ({label}) ¦ Danshin ƙasa {pct}% ({label})
Skip watering today, rain expected {when}. ¦ Pas d'arrosage aujourd'hui, pluie prévue {when}. ¦ आज सिंचाई न करें, {when} बारिश की संभावना है। ¦ Má bomi lónìí, òjò yóò rọ̀ {when}. ¦ Kada ka yi ban ruwa yau, ana sa ran ruwan sama {when}.
Skip watering today. The soil is already wet. ¦ Pas d'arrosage aujourd'hui. Le sol est déjà humide. ¦ आज सिंचाई न करें। मिट्टी पहले से गीली है। ¦ Má bomi lónìí. Ilẹ̀ ti tutù tẹ́lẹ̀. ¦ Kada ka yi ban ruwa yau. Ƙasa ta riga ta jike.
Water {when}. The soil is dry and no heavy rain is due. ¦ Arrosez {when}. Le sol est sec et aucune forte pluie n'est prévue. ¦ {when} सिंचाई करें। मिट्टी सूखी है और तेज़ बारिश की संभावना नहीं। ¦ Bomi {when}. Ilẹ̀ gbẹ, kò sì sí òjò ńlá. ¦ Yi ban ruwa {when}. Ƙasa ta bushe kuma babu ruwan sama mai ƙarfi.
Soil moisture is fine. No watering needed today. ¦ L'humidité du sol est correcte. Pas d'arrosage nécessaire aujourd'hui. ¦ मिट्टी की नमी ठीक है। आज सिंचाई की ज़रूरत नहीं। ¦ Ọ̀rinrin ilẹ̀ dára. Kò nílò bíbomi lónìí. ¦ Danshin ƙasa yana da kyau. Ba a buƙatar ban ruwa yau.
`;

  const exact = {}, pats = {};
  ORDER.forEach(l => { exact[l] = {}; pats[l] = []; });
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  RAW.trim().split('\n').forEach(line => {
    const p = line.split(' ¦ ');
    if (p.length < 5) return;
    const from = p[0].trim(), parts = from.split(/\{(\w+)\}/);
    const names = parts.filter((_, i) => i % 2);
    const re = names.length ? new RegExp('^' + parts.map((s, i) => (i % 2 ? '(.+?)' : esc(s))).join('') + '$') : null;
    ORDER.forEach((l, i) => {
      const to = p[i + 1].trim();
      if (!re) exact[l][from] = to; else pats[l].push({ re, names, to, weight: from.replace(/\{\w+\}/g, '').length });
    });
  });
  ORDER.forEach(l => pats[l].sort((a, b) => b.weight - a.weight));   // most specific phrase first

  function tr(s, lang) {                         // one phrase, or null when unknown
    if (exact[lang][s] !== undefined) return exact[lang][s];
    for (const p of pats[lang]) {
      const m = s.match(p.re);
      if (m) return p.to.replace(/\{(\w+)\}/g, (x, n) => {
        const i = p.names.indexOf(n);
        if (i < 0) return x;
        const t = tr(m[i + 1].trim(), lang);
        return t === null ? m[i + 1] : t;
      });
    }
    return null;
  }
  const cache = {};
  function translateText(raw, lang) {
    if (lang === 'en' || !exact[lang]) return raw;
    const key = lang + '|' + raw;
    if (key in cache) return cache[key];
    const m = raw.match(/^([\s·]*)([^]*?)([\s·]*)$/);        // keep spaces and dots around the text
    const sym = m[2].match(/^[^\p{L}\p{N}]+/u);               // leading emoji or symbols
    const head = sym ? sym[0] : '', body = m[2].slice(head.length);
    let out = null;
    if (body) {
      let t = tr(body, lang);
      if (t === null && body.includes(' · ')) {                // "Great · 87", "Soil · Dry" ...
        let any = false;
        t = body.split(' · ').map(x => { const r = tr(x.trim(), lang); if (r !== null) any = true; return r === null ? x : r; }).join(' · ');
        if (!any) t = null;
      }
      if (t !== null) out = m[1] + head + t + m[3];
    }
    return (cache[key] = out === null ? raw : out);
  }
  return { LANGS, translateText };
})();

(function wireLanguages() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('skycast.lang')); } catch (e) { /* none */ }
  const guess = (navigator.language || 'en').slice(0, 2).toLowerCase();
  let lang = saved || (I18N.LANGS[guess] ? guess : 'en');

  const texts = new WeakMap(), attrs = new WeakMap(), SKIP = /^(SCRIPT|STYLE|SELECT|OPTION|TEXTAREA|INPUT)$/;
  function doText(n) {
    if (!n.parentNode || SKIP.test(n.parentNode.nodeName)) return;
    const rec = texts.get(n);
    const en = rec && n.nodeValue === rec.out ? rec.en : n.nodeValue;    // remember the English original
    const out = I18N.translateText(en, lang);
    texts.set(n, { en, out });
    if (out !== n.nodeValue) n.nodeValue = out;
  }
  function doAttrs(el) {
    ['aria-label', 'placeholder', 'title'].forEach(a => {
      if (!el.hasAttribute || !el.hasAttribute(a)) return;
      const rec = attrs.get(el) || {}, cur = el.getAttribute(a);
      const en = rec[a] && cur === rec[a].out ? rec[a].en : cur;
      const out = I18N.translateText(en, lang);
      rec[a] = { en, out }; attrs.set(el, rec);
      if (out !== cur) el.setAttribute(a, out);
    });
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  new MutationObserver(list => list.forEach(m => {
    if (m.type === 'characterData') doText(m.target);
    else if (m.type === 'attributes') doAttrs(m.target);
    else m.addedNodes.forEach(walk);
  })).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'placeholder', 'title'] });

  // weekday and month names follow the chosen language
  const origDate = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = function (loc, opts) { return origDate.call(this, lang === 'en' ? loc : lang, opts); };

  function setLang(l) {
    lang = I18N.LANGS[l] ? l : 'en';
    try { localStorage.setItem('skycast.lang', JSON.stringify(lang)); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    walk(document.body);
    if (typeof refresh === 'function') refresh();                         // redraw weekday and month names
  }

  // the language picker, added at the top of Settings
  const sheet = document.querySelector('#settings .sheetBody');
  if (sheet) {
    const h = document.createElement('h4'); h.textContent = 'Language';
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Language');
    sel.style.cssText = 'padding:9px 12px;border-radius:14px;border:0;background:var(--well);color:var(--ink);font-size:15px';
    Object.keys(I18N.LANGS).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = I18N.LANGS[k]; sel.appendChild(o); });
    sel.value = lang; sel.onchange = () => setLang(sel.value);
    const first = sheet.querySelector('h4'); sheet.insertBefore(h, first); sheet.insertBefore(sel, first);
  }
  document.documentElement.lang = lang;
  if (lang !== 'en') walk(document.body);
})();

/* =========================================================
   LOADING ANIMATIONS
   - first visit: a friendly animated loading screen instead of an empty page
   - next visits: the last weather shows instantly while fresh data loads
   - a thin shimmer bar at the top while updating, and a soft entrance when data arrives
   ========================================================= */
(function loadingAnimations() {
  const card = document.getElementById('card');
  if (!card) return;

  const css = document.createElement('style');
  css.textContent = `
    #boot { position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column; align-items: center;
            justify-content: center; gap: 14px; transition: opacity .6s; }
    #boot.off { opacity: 0; pointer-events: none; }
    #boot .bi { width: 190px; height: 190px; animation: bootFloat 3.2s ease-in-out infinite; filter: drop-shadow(0 14px 16px rgba(0,0,0,.3)); }
    #boot .bi svg { width: 100%; height: 100%; }
    #boot .bt { font-size: 15px; opacity: .85; min-height: 20px; }
    #boot .dots { display: flex; gap: 7px; }
    #boot .dots i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .35; animation: bootDot 1.2s infinite ease-in-out; }
    #boot .dots i:nth-child(2) { animation-delay: .18s; } #boot .dots i:nth-child(3) { animation-delay: .36s; }
    @keyframes bootFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    @keyframes bootDot { 0%,80%,100% { transform: scale(.7); opacity: .3; } 40% { transform: scale(1.15); opacity: 1; } }

    #bar { position: absolute; top: 0; left: 0; right: 0; height: 3px; z-index: 31; overflow: hidden; opacity: 0;
           transition: opacity .35s; pointer-events: none; }
    #bar.on { opacity: 1; }
    #bar i { position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: linear-gradient(90deg, transparent, #fff, transparent);
             animation: barRun 1.1s ease-in-out infinite; }
    @keyframes barRun { from { transform: translateX(-100%); } to { transform: translateX(260%); } }

    .reveal #big { animation: popIn .85s cubic-bezier(.2,.9,.3,1.2) both; }
    .reveal .temp { animation: riseIn .6s ease both; }
    .reveal .cap, .reveal .sun, .reveal .chips { animation: riseIn .7s .15s ease both; }
    .reveal .it { animation: riseIn .5s .45s ease both; }
    .reveal .it:nth-child(2) { animation-delay: .5s; } .reveal .it:nth-child(3) { animation-delay: .55s; }
    .reveal .it:nth-child(4) { animation-delay: .6s; } .reveal .it:nth-child(5) { animation-delay: .65s; }
    .reveal .it:nth-child(n+6) { animation-delay: .7s; }
    @keyframes popIn { from { opacity: 0; transform: scale(.6) translateY(24px); } to { opacity: 1; transform: none; } }
    @keyframes riseIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(css);

  const CK = 'skycast.cache';
  let boot = null, bootTimer = 0, revealed = false, restoring = false, busy = 0, firstDone = false;

  /* thin shimmer bar at the top of the screen */
  const bar = document.createElement('div');
  bar.id = 'bar'; bar.setAttribute('aria-hidden', 'true'); bar.innerHTML = '<i></i>';
  card.appendChild(bar);
  const syncBar = () => bar.classList.toggle('on', busy > 0 || !firstDone);

  /* full loading screen (first visit only) */
  function makeBoot() {
    const h = new Date().getHours(), day = h >= 6 && h < 19;
    boot = document.createElement('div');
    boot.id = 'boot'; boot.setAttribute('role', 'status');
    boot.style.background = day ? 'linear-gradient(180deg,#4f9ae4,#86bdf0 55%,#cfe5f8)' : 'linear-gradient(180deg,#1d2757,#27366f 55%,#34457f)';
    boot.style.color = day ? '#0f2340' : '#ffffff';
    boot.innerHTML = '<div class="bi">' + icon('partly', day, moonPhase(new Date())) + '</div>' +
      '<div class="bt" id="bootText">Finding your location…</div><div class="dots"><i></i><i></i><i></i></div>';
    card.appendChild(boot);
    const msgs = ['Finding your location…', 'Reading the sky…', 'Almost there…'];
    let i = 0;
    bootTimer = setInterval(() => {
      i = Math.min(i + 1, msgs.length - 1);
      const t = document.getElementById('bootText');
      if (t) t.textContent = msgs[i];
    }, 2200);
  }

  /* data arrived: fade the loading screen out and play the entrance */
  function reveal() {
    if (boot) {
      const b = boot; boot = null; clearInterval(bootTimer);
      b.classList.add('off'); setTimeout(() => b.remove(), 700);
    }
    if (!revealed) {
      revealed = true; card.classList.add('reveal');
      setTimeout(() => card.classList.remove('reveal'), 2200);
    }
  }

  /* remember the last weather so the next visit starts instantly */
  const origApply = window.applyData, origLoad = window.load;
  window.applyData = function (d) {
    origApply(d);
    if (!restoring && !/demo=/.test(location.search)) {
      try { localStorage.setItem(CK, JSON.stringify({ at: Date.now(), place: curPlace, data: d })); } catch (e) { /* storage full */ }
    }
    reveal();
  };
  window.load = function () {
    busy++; syncBar();
    return Promise.resolve(origLoad.apply(this, arguments)).finally(() => { busy = Math.max(0, busy - 1); firstDone = true; reveal(); syncBar(); });
  };

  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(CK)); } catch (e) { /* none */ }
  if (cached && cached.data && cached.place && Date.now() - cached.at < 86400000) {
    try {
      restoring = true;
      curPlace = cached.place; setCity(cached.place.name); Saved.render();
      window.applyData(cached.data);
      document.getElementById('stime').textContent = 'Updating…';
    } catch (e) { cached = null; } finally { restoring = false; }
  } else cached = null;
  if (!cached) makeBoot();
  syncBar();

  /* never animate forever */
  setTimeout(() => { firstDone = true; syncBar(); reveal(); }, 20000);
})();

/* =========================================================
   MORE ANIMATIONS
   - slow drifting clouds and a glowing sun (or moon) in the sky
   - shooting stars on clear nights
   - smooth slide between Weather, Garden, Run and Sleep
   - soft pop-up for Settings and the radar, and a press effect on buttons
   ========================================================= */
(function moreAnimations() {
  const card = document.getElementById('card');
  if (!card) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = document.createElement('style');
  css.textContent = `
    #sky, #shoot { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1; }
    #sky .cl { position: absolute; left: -45%; opacity: var(--co, .3); animation: cloudDrift linear infinite; will-change: left; }
    #sky .cl svg { display: block; width: 100%; height: auto; filter: drop-shadow(0 8px 10px rgba(0,0,0,.12)); }
    .dark #sky .cl { filter: brightness(.55); opacity: calc(var(--co, .3) * .55); }
    #card[data-view="sleep"] #sky .cl { opacity: .08; }
    @keyframes cloudDrift { from { left: -45%; } to { left: 115%; } }

    #sunglow { position: absolute; left: -110px; top: -110px; width: 360px; height: 360px; border-radius: 50%; opacity: 0;
               background: radial-gradient(circle, rgba(255,214,102,.6), rgba(255,214,102,0) 65%);
               transition: opacity 1.2s; animation: sunPulse 7s ease-in-out infinite; }
    .light #sunglow { opacity: 1; }
    .isnight.starry #sunglow { opacity: .75; background: radial-gradient(circle, rgba(196,208,255,.45), rgba(196,208,255,0) 65%); }
    #card[data-view="sleep"] #sunglow, #card.light:not([data-view="weather"]) #sunglow { opacity: 0; }
    @keyframes sunPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }

    .ss { position: absolute; width: 110px; height: 2px; border-radius: 2px; opacity: 0;
          background: linear-gradient(90deg, #fff, rgba(255,255,255,0));
          transform: rotate(-32deg); animation: shootStar 1.1s ease-out forwards; }
    @keyframes shootStar { 0% { opacity: 0; transform: translate(0,0) rotate(-32deg); } 12% { opacity: 1; }
                           100% { opacity: 0; transform: translate(-240px,150px) rotate(-32deg); } }

    .vin { animation: viewIn .38s cubic-bezier(.2,.8,.3,1) both; }
    @keyframes viewIn { from { opacity: 0; transform: translateX(var(--dx, 24px)); } to { opacity: 1; transform: none; } }
    .vin.pad > * { animation: cardIn .45s ease both; animation-delay: calc(var(--i, 0) * 45ms); }
    @keyframes cardIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

    .sheet:not([hidden]) .sheetBody { animation: sheetUp .35s cubic-bezier(.2,.8,.3,1); }
    .sheet:not([hidden]) .sheetBack { animation: fadeIn .3s ease; }
    .sheet:not([hidden]) .mapBox { animation: fadeIn .35s ease; }
    @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .dbtn, .sbtn, .crop, .bar, .half, .chipx { transition: transform .12s ease; }
    .dbtn:active, .sbtn:active, .crop:active, .bar:active, button.chipx:active { transform: scale(.92); }
  `;
  document.head.appendChild(css);

  /* drifting clouds + sun glow */
  const sky = document.createElement('div');
  sky.id = 'sky'; sky.setAttribute('aria-hidden', 'true');
  const clouds = [
    { w: 210, top: 6,  dur: 95,  delay: -20, o: .34 }, { w: 150, top: 20, dur: 70,  delay: -55, o: .28 },
    { w: 260, top: 32, dur: 120, delay: -90, o: .22 }, { w: 110, top: 12, dur: 60,  delay: -8,  o: .30 },
    { w: 180, top: 42, dur: 105, delay: -40, o: .20 }
  ];
  sky.innerHTML = '<div id="sunglow"></div>' + clouds.map(c =>
    `<div class="cl" style="width:${c.w}px;top:${c.top}%;animation-duration:${c.dur}s;animation-delay:${c.delay}s;--co:${c.o}">` +
    `<svg viewBox="0 0 120 120">${cloud('w', '')}</svg></div>`).join('');
  card.insertBefore(sky, card.firstChild);

  /* shooting stars (clear nights only) */
  const shoot = document.createElement('div');
  shoot.id = 'shoot'; shoot.setAttribute('aria-hidden', 'true');
  card.insertBefore(shoot, sky.nextSibling);
  (function spawn() {
    if (!still && !document.hidden && card.classList.contains('starry') && card.dataset.view !== 'sleep') {
      const s = document.createElement('div');
      s.className = 'ss';
      s.style.left = (45 + Math.random() * 50) + '%';
      s.style.top = (4 + Math.random() * 26) + '%';
      shoot.appendChild(s);
      setTimeout(() => s.remove(), 1400);
    }
    setTimeout(spawn, 5000 + Math.random() * 9000);
  })();

  /* slide between screens (left-to-right in the same order as the bottom buttons) */
  const ORDER = ['garden', 'run', 'weather', 'sleep'];
  const origShow = Tabs.show;
  Tabs.show = function (name) {
    const old = Tabs.active;
    origShow.call(Tabs, name);
    if (still || name === old) return;
    const el = document.getElementById('view-' + name);
    if (!el) return;
    el.style.setProperty('--dx', (ORDER.indexOf(name) > ORDER.indexOf(old) ? 28 : -28) + 'px');
    Array.prototype.forEach.call(el.children, (c, i) => c.style.setProperty('--i', Math.min(i, 8)));
    el.classList.remove('vin'); void el.offsetWidth; el.classList.add('vin');
    setTimeout(() => el.classList.remove('vin'), 900);
  };
})();

/* =========================================================
   DAILY EXTRAS
   - "today in one sentence" + a read-aloud button
   - checklist chips (umbrella, jacket, sunscreen, water, mask)
   - My cities: compare all saved cities at a glance
   - offline banner
   - tap the weather icon for a little wiggle (and lightning in a storm)
   ========================================================= */
(function dailyExtras() {
  const card = document.getElementById('card'), cap = document.getElementById('cap');
  if (!card || !cap) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const css = document.createElement('style');
  css.textContent = `
    .sumrow { display: flex; gap: 8px; align-items: center; justify-content: center; max-width: 330px; margin: 6px auto 0; }
    .sumrow p { font-size: 14px; line-height: 1.35; }
    .sumrow .sbtn { flex: none; }
    #need { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 8px; }
    #need:empty { display: none; }
    .wmode .sumrow, .wmode #need { display: none !important; }
    #big { cursor: pointer; }
    #big.wig { animation: wiggle .7s ease; }
    @keyframes wiggle { 0%,100% { transform: rotate(0) scale(1); } 20% { transform: rotate(-8deg) scale(1.06); }
                        40% { transform: rotate(7deg) scale(1.08); } 60% { transform: rotate(-4deg) scale(1.04); } 80% { transform: rotate(2deg); } }
    @keyframes tapFlash { 0% { opacity: 0; } 15% { opacity: .65; } 30% { opacity: .05; } 45% { opacity: .55; } 100% { opacity: 0; } }
    .crow { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 2px; border: 0; border-top: 1px solid var(--edge);
            background: none; color: var(--ink); text-align: left; cursor: pointer; font: inherit; }
    .crow:first-child { border-top: 0; }
    .crow .cic { width: 46px; height: 46px; flex: none; } .crow .cic svg { width: 100%; height: 100%; }
    .crow .cn { flex: 1; min-width: 0; } .crow .cn b { display: block; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .crow .cn small { color: var(--ink2); font-size: 12px; } .crow .ct { font-size: 24px; font-weight: 700; }
    #offline { position: absolute; top: calc(env(safe-area-inset-top) + 46px); left: 50%; transform: translateX(-50%); z-index: 32;
               padding: 6px 14px; border-radius: 16px; background: var(--mid); color: #08121f; font-size: 12px; font-weight: 700;
               white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  `;
  document.head.appendChild(css);

  /* ---------- today in one sentence + checklist ---------- */
  const row = document.createElement('div');
  row.className = 'sumrow';
  row.innerHTML = '<p id="sumText"></p><button type="button" class="sbtn" id="speakBtn" aria-label="Read the weather aloud">🗣</button>';
  const need = document.createElement('div');
  need.id = 'need';
  cap.insertAdjacentElement('afterend', row);
  row.insertAdjacentElement('afterend', need);
  const sumText = document.getElementById('sumText'), speakBtn = document.getElementById('speakBtn');
  if (!('speechSynthesis' in window)) speakBtn.hidden = true;

  function update() {
    if (!data || !R) return;
    const d = data, kind = kindOf(d.code);
    const hours = (typeof Ctx !== 'undefined' && Ctx && Ctx.hours) ? Ctx.hours : (d.hourly || []);
    const next = hours.slice(0, 12), nc = d.nowcast;
    const wet = c => RAIN.includes(c) || STORM.includes(c);
    const later = next.slice(1).find(h => wet(h.code) || (typeof h.pop === 'number' && h.pop >= 60));
    const rainNow = wet(d.code) || (nc && nc.state === 'ongoing');
    const feel = d.temp <= 0 ? 'Freezing' : d.temp <= 10 ? 'Cold' : d.temp <= 17 ? 'Cool' : d.temp <= 24 ? 'Mild' : d.temp <= 30 ? 'Warm' : d.temp <= 35 ? 'Hot' : 'Very hot';
    const sky = { clear: d.isDay ? 'sunny' : 'clear', partly: 'partly cloudy', cloud: 'cloudy', fog: 'foggy', rain: 'rainy', storm: 'stormy', snow: 'snowy' }[kind];
    let line;
    if (SNOW.includes(d.code)) line = 'Snow is falling.';
    else if (rainNow) line = 'It is raining now.';
    else if (nc && nc.state === 'starts') line = 'Rain starts around ' + R.fmtTime(nc.startT) + '.';
    else if (later) line = 'Rain expected around ' + R.fmtHour(later.t) + '.';
    else line = 'No rain expected for the next 12 hours.';
    sumText.textContent = `${feel} and ${sky}. ${line}`;

    const uv = Math.max(0, ...next.slice(0, 8).filter(h => h.isDay).map(h => h.uv || 0));
    const chips = [];
    if (rainNow || later || SNOW.includes(d.code) || (nc && nc.state === 'starts')) chips.push('☂ Umbrella');
    if (d.temp <= 5) chips.push('🧥 Warm coat'); else if (d.temp <= 15) chips.push('🧥 Jacket');
    if (uv >= 6) chips.push('🧴 Sunscreen');
    if (d.temp >= 30 || (d.temp >= 28 && hours[0] && (hours[0].humidity || 0) >= 70)) chips.push('💧 Drink water');
    if (d.aqi != null && d.aqi > 100) chips.push('😷 Mask');
    need.innerHTML = chips.map(t => `<span class="chipx">${t}</span>`).join('');
  }
  const prevApply = window.applyData, prevBadges = window.setBadges;
  window.applyData = function (d) { prevApply(d); update(); };
  window.setBadges = function (s) { prevBadges(s); update(); };      // runs once Run/Garden data is ready (adds UV)
  update();

  speakBtn.addEventListener('click', () => {
    const ss = window.speechSynthesis;
    if (ss.speaking) { ss.cancel(); return; }
    let lang = 'en';
    try { lang = JSON.parse(localStorage.getItem('skycast.lang')) || 'en'; } catch (e) { /* default */ }
    const a = new SpeechSynthesisUtterance(`${curPlace ? curPlace.name : ''}. ${fmtT(data.temp)}. ${cap.textContent}.`);
    a.lang = { en: 'en-US', fr: 'fr-FR', hi: 'hi-IN', yo: 'yo-NG', ha: 'ha-NG' }[lang] || 'en-US';
    const b = new SpeechSynthesisUtterance(sumText.textContent);
    b.lang = 'en-US';
    ss.speak(a); ss.speak(b);
  });

  /* ---------- tap the icon ---------- */
  const big = document.getElementById('big');
  big.addEventListener('click', () => {
    big.classList.remove('wig'); void big.offsetWidth; big.classList.add('wig');
    setTimeout(() => big.classList.remove('wig'), 800);
    if (navigator.vibrate) navigator.vibrate(15);
    if (data && kindOf(data.code) === 'storm') {
      const f = card.querySelector('.flash');
      if (f) { f.style.animation = 'none'; void f.offsetWidth; f.style.animation = 'tapFlash .7s'; setTimeout(() => { f.style.animation = ''; }, 800); }
    }
  });

  /* ---------- My cities ---------- */
  const sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.id = 'citiesSheet'; sheet.hidden = true;
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'citiesTitle');
  sheet.innerHTML = '<div class="sheetBack" data-cclose="1"></div><div class="sheetBody"><div class="row"><h2 id="citiesTitle">My cities</h2>' +
    '<button type="button" class="x" data-cclose="1" aria-label="Close">✕</button></div><div id="citiesList"></div></div>';
  card.appendChild(sheet);
  const listEl = document.getElementById('citiesList');

  async function openCities() {
    sheet.hidden = false;
    const cities = Saved.list.slice(0, 8);
    if (!cities.length) { listEl.innerHTML = '<p class="note">No saved cities yet. Tap the city name, then ☆ Save this city.</p>'; return; }
    listEl.innerHTML = '<p class="note">Loading…</p>';
    const res = await Promise.all(cities.map(p => fetch(`/api/weather?lat=${p.lat}&lon=${p.lon}`).then(r => r.json()).catch(() => null)));
    const ph = moonPhase(new Date());
    listEl.innerHTML = cities.map((p, i) => {
      const d = res[i];
      if (!d || d.error) return `<button type="button" class="crow" data-i="${i}"><span class="cn"><b>${esc(p.name)}</b><small>Could not load</small></span></button>`;
      const d0 = d.daily[0];
      return `<button type="button" class="crow" data-i="${i}"><span class="cic">${icon(kindOf(d.code), d.isDay, ph)}</span>` +
        `<span class="cn"><b>${esc(p.name)}</b><small>${NAMES[d.code] || 'Weather'} · H ${fmtT(d0.max)} L ${fmtT(d0.min)} · ${d.now.slice(11, 16)}</small></span>` +
        `<span class="ct">${fmtT(d.temp)}</span></button>`;
    }).join('');
  }
  listEl.addEventListener('click', e => {
    const b = e.target.closest('.crow');
    const p = b && Saved.list[+b.dataset.i];
    if (p) { sheet.hidden = true; openSearch(false); Tabs.show('weather'); load(p.lat, p.lon, p.name); }
  });
  sheet.addEventListener('click', e => { if (e.target.closest('[data-cclose]')) sheet.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) sheet.hidden = true; });

  const cbtn = document.createElement('button');
  cbtn.type = 'button'; cbtn.className = 'savebtn'; cbtn.id = 'citiesBtn'; cbtn.textContent = '🏙 Compare my cities';
  cbtn.addEventListener('click', () => { openSearch(false); openCities(); });
  document.getElementById('searchBox').appendChild(cbtn);

  /* ---------- offline banner ---------- */
  const off = document.createElement('div');
  off.id = 'offline'; off.hidden = true; off.setAttribute('role', 'status');
  card.appendChild(off);
  function net() {
    if (navigator.onLine === false) { off.textContent = 'Offline · showing your last saved weather'; off.hidden = false; }
    else if (!off.hidden) {
      off.textContent = 'Back online'; setTimeout(() => { off.hidden = true; }, 1800);
      if (curPlace) load(curPlace.lat, curPlace.lon, curPlace.name);
    }
  }
  window.addEventListener('offline', net); window.addEventListener('online', net);
  net();
})();

/* =========================================================
   MORE FEATURES
   - pull down to refresh
   - temperature graph (tap the big temperature)
   - first-time tour (and "Show the tour" in Settings)
   - run log (Run screen) and garden notes with due dates (Garden screen)
   - Auto / Light / Dark switch (Settings)
   ========================================================= */
(function moreFeatures() {
  const card = document.getElementById('card');
  if (!card) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const wmode = document.documentElement.classList.contains('wmode');

  const css = document.createElement('style');
  css.textContent = `
    html, body { overscroll-behavior-y: contain; }
    #ptr { position: absolute; top: calc(env(safe-area-inset-top) + 8px); left: 50%; width: 38px; height: 38px; border-radius: 50%;
           display: flex; align-items: center; justify-content: center; z-index: 33; opacity: 0; pointer-events: none;
           background: var(--glass); border: 1px solid var(--edge); color: var(--ink); transform: translate(-50%, -60px);
           backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    #ptr.spin svg { animation: ptrSpin .8s linear infinite; }
    @keyframes ptrSpin { to { transform: rotate(360deg); } }
    #temp { cursor: pointer; }
    .dbtn { position: relative; }
    .dbtn.hasdue::after { content: ""; position: absolute; top: 5px; right: 5px; width: 10px; height: 10px; border-radius: 50%;
                          background: var(--bad); border: 2px solid var(--dock); }

    #tour { position: absolute; inset: 0; z-index: 40; }
    #tourHole { position: absolute; border-radius: 18px; box-shadow: 0 0 0 100vmax rgba(5,10,30,.66); transition: all .3s ease; pointer-events: none; }
    #tourTip { position: absolute; left: 16px; right: 16px; background: var(--dock); color: var(--ink); border-radius: 20px;
               padding: 16px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
    #tourText { font-size: 15px; line-height: 1.4; margin-bottom: 12px; }
    #tourTip .tbar { display: flex; justify-content: space-between; align-items: center; }
    #tourDots i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--ink2); margin-right: 5px; opacity: .5; }
    #tourDots i.on { opacity: 1; background: var(--ink); }

    .lbars { display: flex; gap: 6px; height: 64px; align-items: flex-end; margin: 12px 0; }
    .lbars .lb { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
    .lbars .lb span { display: block; width: 100%; border-radius: 6px 6px 0 0; background: var(--good); min-height: 4px; }
    .lbars .lb small { font-size: 10px; color: var(--ink2); }
    .logform, .nform { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
    .logform input, .nform input { flex: 1; min-width: 70px; padding: 9px 12px; border-radius: 14px; border: 0; font-size: 15px;
                                   background: var(--well); color: var(--ink); }
    .nform #noteText { flex: 2 1 100%; }
    .nlist { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .nlist li { display: flex; align-items: center; gap: 10px; }
    .nlist li.done .ntx { opacity: .5; text-decoration: line-through; }
    .nlist .ntx { flex: 1; font-size: 14px; } .nlist .ntx small { display: block; font-size: 11px; color: var(--ink2); text-decoration: none; }
    .nchk { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--ink2); background: none; color: var(--ink); cursor: pointer; flex: none; font-size: 14px; }
    .nchk[aria-pressed="true"] { background: var(--good); border-color: var(--good); color: #08121f; }
  `;
  document.head.appendChild(css);

  /* small helper: a pop-up sheet like Settings */
  function makeSheet(id, title, inner) {
    const s = document.createElement('div');
    s.className = 'sheet'; s.id = id; s.hidden = true;
    s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', id + 'T');
    s.innerHTML = '<div class="sheetBack" data-x="1"></div><div class="sheetBody"><div class="row"><h2 id="' + id + 'T">' + title + '</h2>' +
      '<button type="button" class="x" data-x="1" aria-label="Close">✕</button></div>' + inner + '</div>';
    s.addEventListener('click', e => { if (e.target.closest('[data-x]')) s.hidden = true; });
    card.appendChild(s);
    return s;
  }

  /* ---------- pull down to refresh ---------- */
  const ptr = document.createElement('div');
  ptr.id = 'ptr'; ptr.setAttribute('aria-hidden', 'true');
  ptr.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>';
  card.appendChild(ptr);
  const views = document.getElementById('views');
  let y0 = null, x0 = 0, pull = 0, refreshing = false;
  views.addEventListener('touchstart', e => {
    if (views.scrollTop <= 0 && !refreshing) { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; pull = 0; } else y0 = null;
  }, { passive: true });
  views.addEventListener('touchmove', e => {
    if (y0 === null) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (dy <= 0 || Math.abs(dx) > dy) { ptr.style.opacity = 0; return; }
    pull = Math.min(dy * 0.55, 80);
    ptr.style.transition = 'none'; ptr.style.opacity = Math.min(1, pull / 50);
    ptr.style.transform = `translate(-50%, ${pull - 40}px) rotate(${pull * 4}deg)`;
  }, { passive: true });
  views.addEventListener('touchend', async () => {
    if (y0 === null) return;
    y0 = null; ptr.style.transition = 'transform .25s, opacity .25s';
    if (pull >= 55 && curPlace) {
      refreshing = true; ptr.classList.add('spin'); ptr.style.transform = 'translate(-50%, 28px)'; ptr.style.opacity = 1;
      try { await load(curPlace.lat, curPlace.lon, curPlace.name); } finally { refreshing = false; ptr.classList.remove('spin'); }
    }
    ptr.style.opacity = 0; ptr.style.transform = 'translate(-50%, -60px)'; pull = 0;
  });

  /* ---------- temperature graph ---------- */
  const graph = makeSheet('graphSheet', 'Temperature today', '<div id="graphBody"></div>');
  const graphBody = document.getElementById('graphBody');
  function openGraph() {
    if (wmode || !data || !data.hourly || data.hourly.length < 2) return;
    const hs = data.hourly, n = hs.length, Wd = 320, Ht = 130, px = 14, py = 20;
    const T = hs.map(h => h.temp), lo = Math.min(...T) - 1, hi = Math.max(...T) + 1;
    const X = i => px + (Wd - 2 * px) * i / (n - 1), Y = t => py + (Ht - 2 * py) * (1 - (t - lo) / (hi - lo || 1));
    let d = `M${X(0)},${Y(T[0])}`;
    for (let i = 1; i < n; i++) { const c = (X(i - 1) + X(i)) / 2; d += ` C${c},${Y(T[i - 1])} ${c},${Y(T[i])} ${X(i)},${Y(T[i])}`; }
    const iMax = T.indexOf(Math.max(...T)), iMin = T.indexOf(Math.min(...T));
    const mark = i => `<text x="${X(i)}" y="${Y(T[i]) - 9}" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">${fmtT(T[i])}</text>`;
    let ticks = '';
    hs.forEach((h, i) => { if (i % 4 === 0) ticks += `<text x="${X(i)}" y="${Ht + 14}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".65">${i === 0 ? 'Now' : R.fmtShort(h.t)}</text>`; });
    graphBody.innerHTML = `<svg class="chartsvg" viewBox="0 0 ${Wd} ${Ht + 20}" role="img" aria-label="Temperature over the next 24 hours">` +
      `<path d="${d} L${X(n - 1)},${Ht} L${X(0)},${Ht} Z" fill="url(#areaGrad)"/>` +
      `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>` +
      mark(iMax) + (iMin !== iMax ? mark(iMin) : '') +
      `<line id="gLine" y1="${py}" y2="${Ht}" stroke="currentColor" stroke-opacity=".4" stroke-dasharray="3 3"/>` +
      `<circle id="gDot" r="6" fill="#fff" stroke="currentColor" stroke-width="3"/>${ticks}</svg>` +
      `<input type="range" class="scrub" id="gScrub" min="0" max="${n - 1}" value="0" aria-label="Pick an hour">` +
      `<p class="at" id="gAt"></p>`;
    const upd = () => {
      const i = +document.getElementById('gScrub').value, h = hs[i], x = X(i), y = Y(h.temp);
      const l = document.getElementById('gLine'), o = document.getElementById('gDot');
      l.setAttribute('x1', x); l.setAttribute('x2', x); o.setAttribute('cx', x); o.setAttribute('cy', y);
      document.getElementById('gAt').innerHTML = `<b>${i === 0 ? 'Now' : R.fmtHour(h.t)}</b> · ${fmtT(h.temp)} · ${NAMES[h.code] || ''}` +
        (typeof h.pop === 'number' && h.pop > 0 ? ` · ${h.pop}% rain` : '');
    };
    document.getElementById('gScrub').oninput = upd; upd();
    graph.hidden = false;
  }
  document.getElementById('temp').addEventListener('click', openGraph);

  /* ---------- first-time tour ---------- */
  const STEPS = [
    ['#temp', 'Tap the big temperature to see today\'s graph.'],
    ['.dock .dgroup:first-child', 'Garden planner and Run planner: plan your planting, watering and runs.'],
    ['#toggle', 'Switch the forecast between the next hours and the week.'],
    ['.dock .dgroup:last-child', 'Sleep forecast, and Settings for language, units and dark mode.'],
    ['#city', 'Tap the city to search, save cities and compare them.'],
    ['.sright', 'Rain radar, share a picture of the weather, and weather sounds.']
  ];
  const tour = document.createElement('div');
  tour.id = 'tour'; tour.hidden = true;
  tour.innerHTML = '<div id="tourHole"></div><div id="tourTip"><p id="tourText"></p><div class="tbar"><span id="tourDots"></span>' +
    '<span><button type="button" class="linkbtn" id="tourSkip">Skip</button> <button type="button" class="primary" id="tourNext">Next</button></span></div></div>';
  card.appendChild(tour);
  const hole = document.getElementById('tourHole'), tip = document.getElementById('tourTip');
  let ti = 0;
  function place() {
    const el = document.querySelector(STEPS[ti][0]);
    if (!el) { step(); return; }
    const c = card.getBoundingClientRect(), r = el.getBoundingClientRect(), pad = 8;
    hole.style.left = (r.left - c.left - pad) + 'px'; hole.style.top = (r.top - c.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px'; hole.style.height = (r.height + pad * 2) + 'px';
    document.getElementById('tourText').textContent = STEPS[ti][1];
    document.getElementById('tourDots').innerHTML = STEPS.map((_, i) => `<i class="${i === ti ? 'on' : ''}"></i>`).join('');
    document.getElementById('tourNext').textContent = ti === STEPS.length - 1 ? 'Done' : 'Next';
    const below = r.top - c.top < c.height * 0.5;
    tip.style.top = below ? (r.bottom - c.top + 18) + 'px' : 'auto';
    tip.style.bottom = below ? 'auto' : (c.bottom - r.top + 18) + 'px';
  }
  function endTour() { tour.hidden = true; Store.set('tour', 1); }
  function step() { ti++; if (ti >= STEPS.length) endTour(); else place(); }
  function startTour() { if (wmode) return; ti = 0; Tabs.show('weather'); tour.hidden = false; place(); }
  document.getElementById('tourNext').addEventListener('click', step);
  document.getElementById('tourSkip').addEventListener('click', endTour);
  window.addEventListener('resize', () => { if (!tour.hidden) place(); });
  if (!wmode && !Store.get('tour', 0)) {
    const wait = setInterval(() => { if (data && !document.getElementById('boot')) { clearInterval(wait); setTimeout(startTour, 1200); } }, 400);
    setTimeout(() => clearInterval(wait), 60000);
  }

  /* ---------- run log (Run screen) ---------- */
  const logCard = document.createElement('article');
  logCard.className = 'glass'; logCard.id = 'logCard';
  document.getElementById('view-run').appendChild(logCard);
  const getLog = () => Store.get('runlog', []);
  function paintLog() {
    const log = getLog(), now = new Date();
    const days = [...Array(7)].map((_, i) => { const d = new Date(now); d.setDate(d.getDate() - (6 - i)); return ymd(d); });
    const recent = log.filter(x => days.includes(x.d));
    const km = days.map(d => log.filter(x => x.d === d).reduce((s, x) => s + x.km, 0));
    const dist = recent.reduce((s, x) => s + x.km, 0), mins = recent.reduce((s, x) => s + x.min, 0), max = Math.max(...km, 1);
    const sec = dist > 0 ? Math.round(mins / dist * 60) : 0;
    logCard.innerHTML = `<h3>Run log</h3><div class="tiles">` +
      `<div class="tile"><small>Last 7 days</small><b>${dist.toFixed(1)} km</b><em>${recent.length} run${recent.length === 1 ? '' : 's'}</em></div>` +
      `<div class="tile"><small>Average pace</small><b>${sec ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : '--'}</b><em>min per km</em></div></div>` +
      `<div class="lbars">${days.map((d, i) => `<div class="lb"><span style="height:${Math.max(4, km[i] / max * 100)}%"></span>` +
        `<small>${new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</small></div>`).join('')}</div>` +
      `<div class="logform"><input id="logKm" type="number" inputmode="decimal" min="0" step="0.1" placeholder="km" aria-label="Distance in kilometres">` +
      `<input id="logMin" type="number" inputmode="numeric" min="0" step="1" placeholder="minutes" aria-label="Time in minutes">` +
      `<button type="button" class="primary" id="logAdd">Add run</button></div>` +
      (log.length ? `<ul class="list">${log.slice(-5).reverse().map(x => `<li>${x.d.slice(5)} · ${x.km.toFixed(1)} km · ${x.min} min ` +
        `<button type="button" class="linkbtn" data-del="${x.id}">remove</button></li>`).join('')}</ul>` : '');
  }
  logCard.addEventListener('click', e => {
    if (e.target.closest('#logAdd')) {
      const km = parseFloat(document.getElementById('logKm').value), min = parseFloat(document.getElementById('logMin').value);
      if (!(km > 0) || !(min > 0)) return;
      const log = getLog(); log.push({ id: Date.now(), d: ymd(new Date()), km, min });
      Store.set('runlog', log.slice(-200)); paintLog();
    } else {
      const del = e.target.closest('[data-del]');
      if (del) { Store.set('runlog', getLog().filter(x => String(x.id) !== del.dataset.del)); paintLog(); }
    }
  });
  paintLog();

  /* ---------- garden notes (Garden screen) ---------- */
  const notesCard = document.createElement('article');
  notesCard.className = 'glass'; notesCard.id = 'notesCard';
  document.getElementById('view-garden').appendChild(notesCard);
  const getNotes = () => Store.get('notes', []);
  function paintNotes() {
    const notes = getNotes(), t = ymd(new Date());
    const sorted = notes.slice().sort((a, b) => (!!a.done - !!b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : 1));
    notesCard.innerHTML = '<h3>Garden notes</h3>' + (sorted.length
      ? `<ul class="nlist">${sorted.map(n => {
          const late = !n.done && n.due && n.due < t, today = !n.done && n.due === t;
          return `<li class="${n.done ? 'done' : ''}"><button type="button" class="nchk" data-id="${n.id}" aria-label="Mark done" aria-pressed="${!!n.done}">${n.done ? '✓' : ''}</button>` +
            `<span class="ntx">${esc(n.text)}<small>${n.crop ? esc(n.crop) + ' · ' : ''}${n.due ? (late ? 'Overdue · ' : today ? 'Due today · ' : 'Due ') + n.due : 'No date'}</small></span>` +
            `<button type="button" class="linkbtn" data-del="${n.id}" aria-label="Delete note">✕</button></li>`;
        }).join('')}</ul>`
      : '<p class="note">Write what you planted or need to do, and pick a date to be reminded.</p>') +
      `<div class="nform"><input id="noteText" maxlength="120" placeholder="e.g. Water the tomatoes" aria-label="Note">` +
      `<input id="noteDue" type="date" aria-label="Due date"><button type="button" class="primary" id="noteAdd">Add</button></div>`;
    const dot = document.querySelector('.dock [data-go="garden"]');
    if (dot) dot.classList.toggle('hasdue', notes.some(n => !n.done && n.due && n.due <= t));
  }
  notesCard.addEventListener('click', e => {
    const notes = getNotes();
    if (e.target.closest('#noteAdd')) {
      const text = document.getElementById('noteText').value.trim();
      if (!text) return;
      const crop = Prefs.crop && Prefs.crop !== 'general' && R.CROPS[Prefs.crop] ? R.CROPS[Prefs.crop].name : '';
      notes.push({ id: Date.now(), text, crop, due: document.getElementById('noteDue').value || '', done: false });
      Store.set('notes', notes.slice(-100));
    } else if (e.target.closest('[data-id]')) {
      const n = notes.find(x => String(x.id) === e.target.closest('[data-id]').dataset.id);
      if (n) { n.done = !n.done; Store.set('notes', notes); }
    } else if (e.target.closest('[data-del]')) {
      Store.set('notes', notes.filter(x => String(x.id) !== e.target.closest('[data-del]').dataset.del));
    } else return;
    paintNotes();
  });
  paintNotes();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) paintNotes(); });

  /* ---------- Auto / Light / Dark ---------- */
  Prefs.theme = Prefs.theme || 'auto';
  function applyTheme() {
    let c = card.className;
    if (Prefs.theme === 'dark') c = c.replace(/\blight\b/, 'dark');
    else if (Prefs.theme === 'light') c = c.replace(/\bdark\b/, 'light').replace(/\bstarry\b/, '');
    c = c.replace(/\s+/g, ' ').trim();
    if (c !== card.className) card.className = c;
  }
  const prevApply = window.applyData, prevRefresh = window.refresh;
  window.applyData = function (d) { prevApply(d); applyTheme(); };
  window.refresh = function () { prevRefresh(); applyTheme(); };

  const sheetBody = document.querySelector('#settings .sheetBody');
  if (sheetBody) {
    const h = document.createElement('h4'); h.textContent = 'Appearance';
    const seg = document.createElement('div');
    seg.className = 'seg2'; seg.dataset.pref = 'theme';
    seg.innerHTML = '<button data-v="auto">Auto</button><button data-v="light">Light</button><button data-v="dark">Dark</button>';
    const h2 = document.createElement('h4'); h2.textContent = 'Help';
    const tb = document.createElement('button');
    tb.type = 'button'; tb.className = 'primary'; tb.textContent = 'Show the tour';
    tb.addEventListener('click', () => { openSettings(false); startTour(); });
    [h, seg, h2, tb].forEach(x => sheetBody.appendChild(x));
  }
  if (typeof paintSeg === 'function') paintSeg();
  applyTheme();

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { graph.hidden = true; if (!tour.hidden) endTour(); } });
})();

/* =========================================================
   GLASS LOOK + RAIN AND THUNDER FALLING FROM THE CLOUD
   - the forecast sheet, bottom bar and buttons become frosted glass
   - in rain, streaks fall straight out from under the big cloud
   - in a thunderstorm, lightning strikes below the cloud, the cloud lights up and the screen flashes
   ========================================================= */
(function glassAndStorm() {
  const card = document.getElementById('card'), big = document.getElementById('big'), panel = document.getElementById('panel');
  if (!card || !big || !panel) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = document.createElement('style');
  css.textContent = `
    /* ---------- glass ---------- */
    .panel { position: relative; }
    #glass { position: absolute; inset: 0; z-index: 0; pointer-events: none;
             background: linear-gradient(180deg, rgba(255,255,255,.26), rgba(255,255,255,.07));
             backdrop-filter: blur(18px) saturate(160%); -webkit-backdrop-filter: blur(18px) saturate(160%); }
    .panel #hillBox, .panel .panelBody { position: relative; z-index: 1; }
    .hill .fillp { fill: transparent; }
    .hill > path:nth-child(2) { stroke: rgba(255,255,255,.55); stroke-width: 1.6; }
    .panelBody { background: transparent; }
    .dock { background: rgba(255,255,255,.10); backdrop-filter: blur(18px) saturate(160%); -webkit-backdrop-filter: blur(18px) saturate(160%);
            border-top: 1px solid rgba(255,255,255,.28); }
    .chip, .dbtn { position: relative; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        background: radial-gradient(circle at 30% 18%, rgba(255,255,255,.5), rgba(255,255,255,.1) 58%), rgba(255,255,255,.07);
        box-shadow: inset 0 1px 1px rgba(255,255,255,.6), inset 0 -7px 12px rgba(0,0,0,.16), 0 9px 18px rgba(0,0,0,.24); }
    .chip::before, .dbtn::before { content: ""; position: absolute; top: 4px; left: 9px; width: 40%; height: 20%; border-radius: 50%;
        background: linear-gradient(180deg, rgba(255,255,255,.7), rgba(255,255,255,0)); transform: rotate(-18deg); pointer-events: none; }
    .sbtn { background: rgba(255,255,255,.2); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: inset 0 1px 1px rgba(255,255,255,.5); }
    @supports (background: color-mix(in srgb, red 50%, transparent)) {
      #glass { background: linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,.05)), color-mix(in srgb, var(--panel) 42%, transparent); }
      .dock { background: color-mix(in srgb, var(--dock) 46%, transparent); }
    }
    .light .dock { background: rgba(255,255,255,.28); }
    .rainy .fx { opacity: .65; }

    /* ---------- rain under the cloud ---------- */
    #big { position: relative; }
    #big .ic { position: relative; z-index: 1; }
    #big.hascurtain .drop { display: none; }
    #rainCurtain, #bolt { position: absolute; left: 50%; top: 61%; width: 126px; margin-left: -63px; height: var(--rh, 180px); pointer-events: none; z-index: 0; }
    #rainCurtain { overflow: hidden;
                   -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 10%, #000 78%, transparent);
                   mask-image: linear-gradient(180deg, transparent 0, #000 10%, #000 78%, transparent); }
    #rainCurtain i { position: absolute; top: -30px; width: 2px; border-radius: 2px; opacity: 0;
                     background: linear-gradient(180deg, rgba(200,230,255,0), rgba(200,230,255,.95));
                     animation: rcFall var(--d, .9s) linear var(--dl, 0s) infinite; }
    @keyframes rcFall { 0% { transform: translate(0,0) skewX(-8deg); opacity: 0; } 12% { opacity: .95; }
                        100% { transform: translate(-10px, var(--rh, 180px)) skewX(-8deg); opacity: .85; } }

    /* ---------- thunder under the cloud ---------- */
    #bolt { opacity: 0; }
    #bolt svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0 6px #9fd0ff) drop-shadow(0 0 16px #5aa9ff); }
    #bolt.on { animation: boltFlash .55s steps(1, end); }
    @keyframes boltFlash { 0% { opacity: 1; } 18% { opacity: .15; } 30% { opacity: 1; } 55% { opacity: .35; } 70% { opacity: 1; } 100% { opacity: 0; } }
    #cloudGlow { position: absolute; left: 50%; top: 6%; width: 230px; height: 130px; margin-left: -115px; border-radius: 50%;
                 z-index: 0; pointer-events: none; opacity: 0;
                 background: radial-gradient(ellipse, rgba(160,205,255,.75), rgba(160,205,255,0) 68%); }
    #cloudGlow.on { animation: glowPulse .8s ease-out; }
    @keyframes glowPulse { 0% { opacity: 0; } 12% { opacity: 1; } 28% { opacity: .35; } 42% { opacity: .9; } 100% { opacity: 0; } }
    #big.strike .bolt { filter: drop-shadow(0 0 16px #bfe0ff) brightness(1.8); }
    @keyframes thunderFlash { 0% { opacity: 0; } 14% { opacity: .55; } 26% { opacity: .05; } 40% { opacity: .5; } 100% { opacity: 0; } }
  `;
  document.head.appendChild(css);

  /* ---------- frosted-glass sheet shaped like the hill ---------- */
  const glass = document.createElement('div');
  glass.id = 'glass'; glass.setAttribute('aria-hidden', 'true');
  const hillY = x => 26 + 9 * Math.sin(x / 380 * Math.PI * 1.8 + .4) + 4 * Math.sin(x / 380 * Math.PI * 4.6 + 1.3);
  const pts = [];
  for (let x = 0; x <= 380; x += 6) pts.push(`${(x / 380 * 100).toFixed(2)}% ${(hillY(x) * 60 / 70).toFixed(1)}px`);
  const poly = `polygon(${pts.join(',')},100% 100%,0% 100%)`;
  glass.style.clipPath = poly; glass.style.webkitClipPath = poly;
  panel.insertBefore(glass, panel.firstChild);

  /* ---------- a little gloss on the big rain, storm and snow clouds ---------- */
  const origIcon = window.icon;
  window.icon = function (kind, isDay, p) {
    const s = origIcon(kind, isDay, p);
    return ['rain', 'storm', 'snow'].includes(kind)
      ? s.replace('</svg>', '<ellipse cx="45" cy="25" rx="15" ry="5" fill="#fff" opacity=".4" transform="rotate(-24 45 25)"/></svg>') : s;
  };

  /* ---------- rain curtain + lightning ---------- */
  let kind = '', rh = 180, curtain = null, bolt = null, glow = null, stTimer = 0;
  const mk = id => { const e = document.createElement('div'); e.id = id; e.setAttribute('aria-hidden', 'true'); return e; };

  function fit() {                                    // how far the rain falls: from the cloud down to the hill
    if (!curtain || !big.offsetHeight) return;
    let h = (panel.offsetTop || 0) - (big.offsetTop || 0) - big.offsetHeight * 0.61 + 6;
    if (!isFinite(h) || h <= 0) h = 170;
    rh = Math.round(Math.max(90, Math.min(300, h)));
    big.style.setProperty('--rh', rh + 'px');
  }

  function strike() {
    if (!bolt || kind !== 'storm') return;
    const pts2 = []; let x = 34 + Math.random() * 58, y = 0;
    pts2.push([x, 0]);
    while (y < rh * 0.92) { y += 16 + Math.random() * 16; x = Math.max(10, Math.min(116, x + (Math.random() - 0.5) * 30)); pts2.push([x, Math.min(y, rh)]); }
    const d = 'M' + pts2.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
    const b = pts2[Math.floor(pts2.length / 2)];
    const br = `M${b[0].toFixed(1)},${b[1].toFixed(1)} l${(Math.random() < .5 ? -1 : 1) * 22},26 l${(Math.random() < .5 ? -1 : 1) * 8},22`;
    const line = (p, w, c) => `<path d="${p}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
    bolt.innerHTML = `<svg viewBox="0 0 126 ${rh}" preserveAspectRatio="none">${line(d, 7, 'rgba(130,185,255,.7)')}${line(d, 2.6, '#ffffff')}${line(br, 1.8, '#dcecff')}</svg>`;
    [bolt, glow].forEach(e => { e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); });
    big.classList.add('strike');
    const f = card.querySelector('.flash');
    if (f) { f.style.animation = 'none'; void f.offsetWidth; f.style.animation = 'thunderFlash .7s'; }
    setTimeout(() => { big.classList.remove('strike'); if (f) f.style.animation = ''; }, 800);
    if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  }
  function loop(first) {
    clearTimeout(stTimer);
    if (kind !== 'storm' || still) return;
    stTimer = setTimeout(() => { if (!document.hidden && Tabs.active === 'weather') strike(); loop(false); }, first ? 1200 : 3500 + Math.random() * 4500);
  }

  function rebuild() {                                // runs after every redraw of the big icon
    clearTimeout(stTimer);
    curtain = bolt = glow = null;
    if (!data) return;
    kind = kindOf(data.code);
    const wet = kind === 'rain' || kind === 'storm';
    big.classList.toggle('hascurtain', wet);
    if (!wet) return;
    const c = data.code;
    const n = kind === 'storm' ? 38 : [65, 82, 66, 67].includes(c) ? 34 : [55, 57, 63, 81].includes(c) ? 24 : 14;
    glow = mk('cloudGlow'); curtain = mk('rainCurtain'); bolt = mk('bolt');
    curtain.innerHTML = Array.from({ length: n }, () =>
      `<i style="left:${(Math.random() * 98).toFixed(1)}%;height:${(12 + Math.random() * 16).toFixed(0)}px;` +
      `--d:${(0.7 + Math.random() * 0.5).toFixed(2)}s;--dl:-${(Math.random() * 1.2).toFixed(2)}s"></i>`).join('');
    [glow, curtain, bolt].forEach(e => big.appendChild(e));
    requestAnimationFrame(fit); setTimeout(fit, 500);
    loop(true);
  }
  const prevPaint = window.paintWeather;
  window.paintWeather = function () { prevPaint(); rebuild(); };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(panel);
  window.addEventListener('resize', fit);

  /* the background rain across the whole screen becomes a softer backdrop */
  const prevFx = window.setFx;
  window.setFx = function (m, n) { return prevFx(m, m === 'rain' ? Math.round(n * 0.55) : n); };

  rebuild();
})();
