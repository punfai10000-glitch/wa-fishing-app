// App configuration. Safe to commit — contains NO secrets.
export const CONFIG = {
  // Esri World Imagery via a free ArcGIS Location Platform account.
  // Paste a REFERRER-RESTRICTED public API key here (locked to your GitHub Pages domain).
  // Leave empty to fall back to the OpenStreetMap standard map.
  ESRI_API_KEY: 'AAPTaHkTJ8oIBfcrklGSim4UbdQ..z6jalGOOiT9sa8aBlN2H5xbXU0S2FWcVxJ05bfQ_lenkOMSexHGzmOWCLSCecHSj2L1cGXHQlvyASDkG4jCnNN2nWQXvgbnb5DTneUe02p-PwK3sezuwrLN3isXC8SiTJYmg4aXs-kKsiaivdXf_5WIYajc7IX_5Shjvh-qRlGPQ94jVy9fEV-JV0wZVECz49D53XvCjSoFpsvMucBUYitSjNntwHoj3-zdV9ZhU7V1IBpZ5JlHVXBM.AT1_2I9lTig6',   // public key, Basemaps only, referrer-locked to punfai10000-glitch.github.io, expires ~Nov 2027

  // Refresh forecasts when cached data is older than this.
  REFRESH_MINUTES: 60,
  // Show the "data out of date" banner after this age.
  STALE_HOURS: 3,

  OPEN_METEO_FORECAST: 'https://api.open-meteo.com/v1/forecast',
  OPEN_METEO_MARINE: 'https://marine-api.open-meteo.com/v1/marine',

  MAP_START: { lat: -33.6, lng: 117.2, zoom: 6 },

  // owner/repo — used to read measured buoy data from the repo's live-data branch
  GITHUB_REPO: 'punfai10000-glitch/wa-fishing-app'
};

export const REGIONS = {
  'geraldton': { name: 'Geraldton', bioregion: 'west_coast' },
  'jurien': { name: 'Jurien Bay', bioregion: 'west_coast' },
  'lancelin': { name: 'Lancelin', bioregion: 'west_coast' },
  'perth': { name: 'Perth', bioregion: 'west_coast' },
  'rockingham': { name: 'Rockingham', bioregion: 'west_coast' },
  'mandurah': { name: 'Mandurah', bioregion: 'west_coast' },
  'bunbury': { name: 'Bunbury', bioregion: 'west_coast' },
  'busselton': { name: 'Busselton', bioregion: 'west_coast' },
  'margaret-river': { name: 'Margaret River', bioregion: 'west_coast' },
  'augusta': { name: 'Augusta', bioregion: 'west_coast' },
  'denmark': { name: 'Denmark', bioregion: 'south_coast' },
  'albany': { name: 'Albany', bioregion: 'south_coast' },
  'esperance': { name: 'Esperance', bioregion: 'south_coast' }
};

export const TYPE_LABELS = {
  beach: 'Beach', rock_platform: 'Rock platform', jetty: 'Jetty', groyne: 'Groyne',
  headland: 'Headland', bay: 'Bay', estuary: 'Estuary / river mouth', shore_reef: 'Reef (from shore)'
};
