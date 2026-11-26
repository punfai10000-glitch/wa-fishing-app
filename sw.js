// Offline support: cache the app shell; network-first for data and forecasts.
// Map tiles are deliberately NOT cached (Esri terms prohibit offline tile export).
const VERSION = 'wafi-v38';
// depth and seabed tiles never change between monthly data updates: serve them from the phone instantly
const TILES = 'wafi-tiles-' + new Date().toISOString().slice(0, 7);
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'assets/icon.svg',
  'js/app.js', 'js/config.js', 'js/data.js', 'js/engine.js', 'js/map.js', 'js/storage.js', 'js/ui.js', 'js/units.js',
  'js/scoring/score.js', 'js/scoring/blocks.js', 'js/scoring/confidence.js', 'js/scoring/window.js', 'js/scoring/geo.js',
  'js/amenities.js', 'js/coast.js', 'js/coastmap.js', 'js/flow.js', 'js/shore.js', 'js/views/key.js', 'data/coastline.json', 'js/buoys.js', 'js/zones.js', 'js/osm.js', 'js/osmspots.js', 'js/views/community.js', 'data/coast.json', 'data/incidents.json', 'js/wiki.js', 'js/views/live.js', 'js/views/fish.js', 'js/views/spots.js', 'js/views/location.js', 'js/views/rules.js', 'js/views/fishid.js', 'js/views/more.js',
  'js/vendor/leaflet.js', 'js/vendor/leaflet.css', 'js/vendor/suncalc.js',
  'js/sheet.js', 'js/depth.js', 'js/checks.js', 'js/targets.js', 'data/targets.json', 'data/zones/closures.geojson', 'data/zones/south-coast.geojson',
  'js/verdict.js', 'js/plain.js', 'js/places.js', 'js/views/measure.js', 'js/ocean.js', 'js/diary.js', 'js/views/diary.js', 'js/views/guides.js',
  'data/locations.json', 'data/species.json', 'data/rules.json', 'data/thresholds.json', 'data/sources.json', 'data/zones/marine-parks.geojson'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isTile = url => /tile\.openstreetmap\.org|arcgis\.com|arcgisonline\.com|eox\.at|gebco\.net|imas\.utas\.edu\.au|wikimedia\.org|windy\.com|githubusercontent\.com|inaturalist\.org|static\.inaturalist\.org|nominatim\.openstreetmap\.org|services\.ga\.gov\.au|slip\.wa\.gov\.au/.test(url.hostname);
const isNetworkFirst = url => url.pathname.includes('/data/') || /open-meteo\.com$|wikipedia\.org$/.test(url.hostname);

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || isTile(url)) return;
  if (url.origin === location.origin && /\/data\/(depth|habitat|habitat-est)\/\d+\//.test(url.pathname)) {
    e.respondWith(caches.open(TILES).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (isNetworkFirst(url)) {
    e.respondWith(fetch(url.origin === location.origin ? new Request(e.request, { cache: 'no-cache' }) : e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // App files: network first, and always re-check with the server (cache: 'no-cache') so the page and
  // its scripts can never be a mix of an old and a new version; cached copy only when offline
  const req = url.origin === location.origin ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(fetch(req).then(res => {
    if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
