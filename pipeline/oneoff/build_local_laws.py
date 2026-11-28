"""Council local-law areas added to data/zones/access.geojson (re-run after editing).

1. City of Cockburn - no spearguns on a beach or foreshore, which the local law defines to include the water
   200 m seaward of low water mark next to the district (Local Laws 2000 cl 3.3(w); the City's fishing page:
   "Spearfishing ... is prohibited in Cockburn waterways and beaches. Fines will apply").
   Built as the OSM coastline inside the City's mainland boundary (ABS ASGS 2021 LGA), widened 200 m each side
   with flat ends so it doesn't spill into Fremantle or Kwinana. Rottnest, Carnac and Garden Island excluded.
2. Woodman Point Ammo Jetty - closed to the public while it is rebuilt (approximate corridor; jetty geometry
   was not available, ~250 m west from the shore, 40 m wide).
"""
import json, math
from shapely.geometry import shape, mapping, LineString, MultiLineString, box
import warnings; warnings.filterwarnings("ignore")
from shapely.ops import transform, unary_union

LAT0, LON0 = -32.12, 115.76
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110574
to_m = lambda x, y, z=None: ((x - LON0) * KX, (y - LAT0) * KY)
to_ll = lambda x, y, z=None: (x / KX + LON0, y / KY + LAT0)

lga = shape(json.load(open('pipeline/oneoff/lga_cockburn.geojson'))['features'][0]['geometry'])
coast = json.load(open('data/coastline.json'))
lines = [LineString(l) for l in coast['lines'] if len(l) > 1]
near = unary_union([l for l in lines if l.intersects(lga.buffer(0.01))])
# The ABS outline is generalised (the OSM coastline can sit 100 m+ outside it at groynes and points), so take the
# coastline within ~300 m of the City, then cut it at the latitudes where the City's boundary meets the coast so
# the strip doesn't spill into Fremantle (north) or Kwinana (south).
tight = near.intersection(lga.buffer(0.0003))
ys = [y for g in getattr(tight, 'geoms', [tight]) for _, y in g.coords]
inside = near.intersection(lga.buffer(0.003)).intersection(box(115.70, min(ys), 115.80, max(ys)))
print('coast cut at', round(min(ys), 5), round(max(ys), 5))
strip_m = transform(to_m, inside).buffer(200, cap_style=2, join_style=1)
strip = transform(to_ll, strip_m).simplify(0.00003)
print('strip bounds', [round(v, 4) for v in strip.bounds], 'area km2', round(strip_m.area / 1e6, 2))

COCKBURN = {
  "local_law_id": "cockburn-spear",
  "name": "City of Cockburn beaches and foreshore (no spearguns, local law)",
  "zone_type": "restricted",
  "prohibits": ["spear"],
  "note": "City of Cockburn local law: no carrying or firing a speargun on a beach or foreshore, which includes the water up to 200 m out from low tide. The City says spearfishing is prohibited at Cockburn beaches and waterways and fines apply.",
  "details": [
    "✗ No spearfishing (no carrying or firing a speargun) on Cockburn beaches or within 200 m of the shore",
    "✓ Line fishing is allowed under the normal rules, except where signposted",
    "✗ No fishing at all in the Coogee Maritime Trail / Omeo Wreck area, the Port Coogee waterways or the Coogee Beach shark barrier",
    "✗ No fishing for sharks",
    "⚠ Beyond 200 m from shore, state rules apply (spearfishing allowed, e.g. from a boat)"
  ],
  "link": "https://www.cockburn.wa.gov.au/Recreation-and-Attractions/Marina,-Beaches-and-Fishing/Fishing-General",
  "source": "City of Cockburn Local Laws 2000 cl 3.3(w) and 'beach'/'foreshore' definitions; City of Cockburn Fishing General page (checked 28 Nov 2026). Boundary: ABS ASGS 2021 LGA; coastline: OpenStreetMap.",
  "approx": False
}
jx0 = 115.75922
JETTY = {
  "local_law_id": "ammo-jetty-closed",
  "name": "Woodman Point Ammo Jetty (closed for rebuilding)",
  "zone_type": "restricted",
  "prohibits": ["shore", "spear"],
  "note": "The jetty is closed to the public after storm damage (June 2026) while a new one is built, expected to reopen around summer 2027. Parts of John Graham Reserve are closed until late 2027.",
  "details": [
    "✗ No access to the jetty until the new jetty opens",
    "✓ Transport WA suggests Woodman Point Groyne or Sue’s Groyne instead (spearfishing is still not allowed within 200 m of Cockburn beaches)"
  ],
  "link": "https://www.transport.wa.gov.au/marine/projects-coastal-management/maritime-coastal-infrastructure-projects/new-woodman-point-ammo-jetty",
  "source": "Department of Transport WA (checked 28 Nov 2026). Jetty outline approximate.",
  "approx": False,
  "until": "2027-12-31"
}
jetty = box(jx0 - 250 / KX, -32.12425 - 20 / KY, jx0 + 10 / KX, -32.12425 + 20 / KY)

path = 'data/zones/access.geojson'
d = json.load(open(path))
d['features'] = [f for f in d['features'] if not f['properties'].get('local_law_id')]
d['features'] += [{"type": "Feature", "properties": COCKBURN, "geometry": mapping(strip)},
                  {"type": "Feature", "properties": JETTY, "geometry": mapping(jetty)}]
json.dump(d, open(path, 'w'), separators=(',', ':'))
print('features', len(d['features']))
