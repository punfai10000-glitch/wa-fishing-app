// Free place search (OpenStreetMap Nominatim, WA only). Shared by the map search and the Forecast page.
export async function findPlaces(q) {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=au&viewbox=112.5,-13.5,129.1,-35.4&bounded=1&accept-language=en&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(u, { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : []));
    return res.map(r => {
      const parts = String(r.display_name || '').split(',').map(x => x.trim());
      return { kind: 'place', name: r.name || parts[0], sub: parts.slice(1, 3).join(', '), lat: +r.lat, lng: +r.lon };
    }).filter(p => Number.isFinite(p.lat));
  } catch { return []; }
}
export const kmBetween = (lat1, lng1, lat2, lng2) => Math.hypot((lng2 - lng1) * Math.cos(lat1 * Math.PI / 180), lat2 - lat1) * 111;
