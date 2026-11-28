"""Council local-law areas added to data/zones/access.geojson (re-run after editing).

1. City of Cockburn - no spearguns on a beach or foreshore, which the local law defines to include the water
   200 m seaward of low water mark next to the district (Local Laws 2000 cl 3.3(w); the City's fishing page:
   "Spearfishing ... is prohibited in Cockburn waterways and beaches. Fines will apply").
   Built as the OSM coastline inside the City's mainland boundary (ABS ASGS 2021 LGA), widened 200 m each side
   with flat ends so it doesn't spill into Fremantle or Kwinana. Rottnest, Carnac and Garden Island excluded.
3. DPIRD year-round area closures not in the order layers (West Coast bioregion page, checked 29 Nov 2026):
   Lake Clifton (no fishing), Yallingup Reef observation area (400 m radius of the Yallingup Brook mouth: only squid,
   cuttlefish, rock lobster and blue swimmer crab may be taken), Heirisson Island lakes (no fishing), Hamelin Bay
   (rays and skates protected). Shapes from OpenStreetMap via Nominatim (pipeline/oneoff/osm_places.geojson).
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

osm = {f['properties']['name']: shape(f['geometry']) for f in json.load(open('pipeline/oneoff/osm_places.geojson'))['features']}
DP = "https://www.dpird.wa.gov.au/individuals/recreational-fishing/recreational-fishing-rules/west-coast-bioregion/"
mouth = osm['Yallingup Brook'].coords[-1] if osm['Yallingup Brook'].coords[-1][0] < osm['Yallingup Brook'].coords[0][0] else osm['Yallingup Brook'].coords[0]
yal = transform(to_ll, transform(to_m, __import__('shapely.geometry', fromlist=['Point']).Point(mouth)).buffer(400, 32))
closed = closures = json.load(open('data/zones/closures.geojson'))['features']
hamelin = [shape(f['geometry']) for f in closures if f['properties'].get('name', '').startswith('Hamelin Bay Recreation Zone')]
EXTRA = [
  ({"local_law_id": "lake-clifton", "name": "Lake Clifton (closed to all fishing)", "zone_type": "sanctuary", "prohibits": ["shore", "spear"],
    "note": "Lake Clifton is closed to all fishing (DPIRD year-round closure). It protects the living thrombolites.",
    "details": ["\u2717 No fishing of any kind"], "link": DP, "source": "DPIRD West Coast bioregion rules; lake outline OpenStreetMap"}, osm['Lake Clifton']),
  ({"local_law_id": "yallingup-reef-oa", "name": "Yallingup Reef observation area (400 m around Yallingup Brook mouth)", "zone_type": "restricted", "prohibits": ["shore", "spear"],
    "note": "Within 400 m of the Yallingup Brook mouth you may only take squid, cuttlefish, rock lobster and blue swimmer crabs. No finfish by line or spear; all shellfish, reef-top animals, seahorses and sea plants are protected.",
    "details": ["\u2713 Squid, cuttlefish, rock lobster and blue swimmer crabs only", "\u2717 No finfish (line or spear)", "\u2717 Shellfish, reef-top animals, crustaceans, seahorses and sea plants are protected"],
    "link": DP, "source": "DPIRD West Coast bioregion rules (Yallingup Reef observation area); brook mouth from OpenStreetMap", "approx": True}, yal),
  ({"local_law_id": "heirisson-lakes", "name": "Heirisson Island (lakes closed to fishing)", "zone_type": "restricted", "prohibits": [],
    "note": "The lakes on Heirisson Island downstream of the Causeway are closed to all fishing. Fishing in the Swan River around the island follows the normal river rules (no spearfishing in rivers).",
    "details": ["\u2717 No fishing in the lakes on the island", "\u2713 Line fishing in the river around the island (normal rules)", "\u2717 Spearfishing (all rivers and estuaries)"],
    "link": DP, "source": "DPIRD West Coast bioregion rules; island outline OpenStreetMap"}, osm['Heirisson Island']),
] + [({"local_law_id": "hamelin-rays", "name": "Hamelin Bay — rays and skates protected", "zone_type": "species", "prohibits": [],
      "note": "All ray and skate species are protected in Hamelin Bay.", "details": ["\u2717 Rays and skates (all species)"], "link": DP,
      "source": "DPIRD West Coast bioregion rules"}, g) for g in hamelin]

path = 'data/zones/access.geojson'
d = json.load(open(path))
d['features'] = [f for f in d['features'] if not f['properties'].get('local_law_id')]
d['features'] += [{"type": "Feature", "properties": COCKBURN, "geometry": mapping(strip)},
                  {"type": "Feature", "properties": JETTY, "geometry": mapping(jetty)}]
d['features'] += [{"type": "Feature", "properties": p, "geometry": mapping(g)} for p, g in EXTRA]
json.dump(d, open(path, 'w'), separators=(',', ':'))
print('features', len(d['features']))
