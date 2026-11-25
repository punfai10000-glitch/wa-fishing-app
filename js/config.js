// App configuration. Safe to commit — contains NO secrets.
export const CONFIG = {
  // Esri World Imagery via a free ArcGIS Location Platform account.
  // Paste a REFERRER-RESTRICTED public API key here (locked to your GitHub Pages domain).
  // Leave empty to fall back to the OpenStreetMap standard map.
  ESRI_API_KEY: '',

  // Refresh forecasts when cached data is older than this.
  REFRESH_MINUTES: 60,
  // Show the "data out of date" banner after this age.
  STALE_HOURS: 3,

  OPEN_METEO_FORECAST: 'https://api.open-meteo.com/v1/forecast',
  OPEN_METEO_MARINE: 'https://marine-api.open-meteo.com/v1/marine',

  MAP_START: { lat: -33.6, lng: 117.2, zoom: 6 }
};

export const REGIONS = {
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
