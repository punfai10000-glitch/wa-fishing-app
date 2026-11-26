"""One-off #2: for DPIRD fishing prohibition layers, show feature counts inside Perth–Esperance and sample attributes."""
import json, re, urllib.request, urllib.parse
BASE = "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/DPIRD_Fisheries_Guide/MapServer"
BBOX = "114.5,-35.6,123.5,-31.3"
def get(u, **p):
    p.setdefault("f", "json")
    with urllib.request.urlopen(urllib.request.Request(u + "?" + urllib.parse.urlencode(p), headers={"User-Agent": "wa-fishing-app"}), timeout=60) as r:
        return json.load(r)
info = get(BASE)
KEEP = re.compile(r"Prohibition on (Recreational )?Fishing|Fish Habitat Protection|Wreck Site|Reef Observation|Crabs|Blue Swimmer|Garfish|Rock Lobster|Abalone|Demersal Scalefish Order|Wire Trace|Pointed Instruments|Closed Waters / Marine", re.I)
for l in info["layers"]:
    if not KEEP.search(l["name"]) or re.search(r"Commercial", l["name"]): continue
    if l.get("subLayerIds"): print(f"[group {l['id']}] {l['name']} -> {l['subLayerIds']}"); continue
    try:
        c = get(f"{BASE}/{l['id']}/query", where="1=1", geometry=BBOX, geometryType="esriGeometryEnvelope", inSR=4326, spatialRel="esriSpatialRelIntersects", returnCountOnly="true")
        n = c.get("count", 0)
    except Exception as e:
        print(f"{l['id']:>4} ERR {l['name']}: {e}"); continue
    if not n: continue
    s = get(f"{BASE}/{l['id']}/query", where="1=1", geometry=BBOX, geometryType="esriGeometryEnvelope", inSR=4326, spatialRel="esriSpatialRelIntersects", outFields="*", returnGeometry="false", resultRecordCount=3)
    print(f"{l['id']:>4} n={n:<4} {l['name']}")
    for f in s.get("features", [])[:3]:
        a = {k: v for k, v in f["attributes"].items() if v not in (None, "", " ") and not re.search(r"shape|objectid|globalid|st_area|st_length", k, re.I)}
        print("       ", json.dumps(a, ensure_ascii=False)[:400])
m = get("https://public-services.slip.wa.gov.au/public/rest/services/Landgate_Public_Maps/Marine_Map_WA_3/MapServer")
for l in m["layers"]:
    if 40 <= l["id"] <= 60: print("MarineMap", l["id"], l["name"], l.get("subLayerIds"))
