"""Official DPIRD fishing prohibition areas (Fish Resources Management Act orders) for Perth -> Esperance.

Source: Landgate SLIP public ArcGIS service 'DPIRD_Fisheries_Guide' (Fisheries Guide - CEO Notices &
Consolidated Notices and Orders). Each feature links to the legal order PDF on wa.gov.au.
Writes data/zones/closures.geojson. Never overwrites a good file with an empty/partial result.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
BASE = "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/DPIRD_Fisheries_Guide/MapServer"
BBOX = "114.5,-35.6,123.5,-31.3"
OUT = "data/zones/closures.geojson"
LAYERS = {130: "burswood", 133: "esperance_jetty", 134: "greens_pool", 140: "ngari", 141: "rottnest", 144: "marmion",
          148: "shoalwater", 149: "walpole", 152: "wreck", 153: "wreck", 155: "wreck", 156: "wreck", 157: "wreck", 158: "wreck",
          244: "fhpa", 213: "lobster", 249: "wire"}
BOTH = ["shore", "spear"]

def get(url, **p):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url + "?" + urllib.parse.urlencode(p), headers={"User-Agent": "wa-fishing-app (github.com/punfai10000-glitch/wa-fishing-app)"}), timeout=90) as r:
                return json.load(r)
        except Exception as e:
            print("  retry", attempt + 1, e); time.sleep(5 * (attempt + 1))
    raise RuntimeError("failed " + url)

def classify(kind, a):
    legal, desc, name = a.get("legal") or "", a.get("descript") or "", a.get("name") or ""
    order = f"{name}" + (f" ({a['ord_notice']})" if a.get("ord_notice") else "")
    base = {"order": order, "link": a.get("link"), "verified": True, "authority": "DPIRD", "source": "DPIRD fishing order (SLIP)"}
    def z(zone_type, title, prohibits, note):
        return {**base, "name": title, "zone_type": zone_type, "prohibits": prohibits, "note": note}
    if kind in ("ngari", "marmion", "shoalwater"):
        park = {"ngari": "Ngari Capes Marine Park", "marmion": "Marmion Marine Park", "shoalwater": "Shoalwater Islands Marine Park"}[kind]
        title = re.sub(r"^Schedule \d+ - ", "", desc) or legal
        if re.search(r"sanctuary", legal + desc, re.I):
            return z("sanctuary", f"{title} ({park})", BOTH, "Sanctuary zone — no fishing or collecting of any kind.")
        return z("restricted", f"{title} ({park})", [], f"{re.sub(r'^Schedule \\d+ - ', '', legal)}: extra fishing rules apply here — read the order.")
    if kind == "rottnest":
        t = re.sub(r"^Schedule \d+ - ", "", desc or legal)
        if re.search(r"Green Island|Parker Point|Kingston", t, re.I):
            return z("sanctuary", f"{t} (Rottnest Island)", BOTH, "Rottnest sanctuary zone — all fishing and collecting prohibited.")
        if re.search(r"Armstrong", t, re.I):
            return z("restricted", f"{t} (Rottnest Island)", ["spear"], "Only shore fishing with a rod or handline, in signposted areas. No spearfishing.")
        if re.search(r"West End", t, re.I):
            return z("restricted", f"{t} (Rottnest Island)", ["spear"], "No demersal (bottom) fishing. No spearfishing at Rottnest.")
        return z("restricted", f"{t} (Rottnest Island)", ["spear"], "Rottnest Island Reserve — spearfishing prohibited; other restrictions apply.")
    if kind == "wreck":
        return z("sanctuary", desc or name, BOTH, "Protected wreck — no fishing.")
    if kind in ("burswood", "greens_pool"):
        return z("sanctuary", "Burswood Lake" if kind == "burswood" else "Greens Pool (Denmark)", BOTH, "Fishing prohibited by order.")
    if kind == "walpole":
        return z("restricted", "Walpole / Nornalup estuary", [], "Recreational fishing activity restrictions apply — read the order.")
    if kind == "esperance_jetty":
        return z("restricted", "Esperance jetty area", [], "A fishing order covers the old Tanker Jetty site — read the order.")
    if kind == "fhpa":
        return z("restricted", "Cottesloe Reef Fish Habitat Protection Area", [], "Fish Habitat Protection Area — special rules apply; read the order.")
    if kind == "lobster":
        return z("species", f"{desc} — rock lobster closure", [], "No fishing for rock lobster here.")
    if kind == "wire":
        return z("gear", f"Wire trace ban — {desc}", [], "Wire trace is prohibited here.")
    return None

feats = []
for lid, kind in LAYERS.items():
    gj = get(f"{BASE}/{lid}/query", where="1=1", geometry=BBOX, geometryType="esriGeometryEnvelope", inSR=4326,
             spatialRel="esriSpatialRelIntersects", outFields="*", outSR=4326, f="geojson", maxAllowableOffset="0.00003")
    n = 0
    for f in gj.get("features", []):
        if not f.get("geometry"): continue
        props = classify(kind, f.get("properties") or {})
        if not props: continue
        g = f["geometry"]
        def rnd(c): return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [rnd(x) for x in c]
        g["coordinates"] = rnd(g["coordinates"])
        feats.append({"type": "Feature", "properties": props, "geometry": g}); n += 1
    print(f"layer {lid:>3} {kind:<15} {n} features")

sanct = sum(1 for f in feats if f["properties"]["zone_type"] == "sanctuary")
if sanct < 10:
    print("Too few sanctuary areas returned — keeping the existing file."); sys.exit(0)
os.makedirs("data/zones", exist_ok=True)
json.dump({"type": "FeatureCollection", "loaded": True, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "source": "DPIRD fishing prohibition orders via Landgate SLIP (DPIRD_Fisheries_Guide). Each area links to its order.",
           "covers_parks": ["Marmion", "Shoalwater Islands", "Ngari Capes", "Rottnest"], "features": feats},
          open(OUT, "w"), separators=(",", ":"))
print("wrote", OUT, len(feats), "features,", sanct, "no-fishing areas")
