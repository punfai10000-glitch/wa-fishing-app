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
          244: "fhpa", 213: "lobster", 249: "wire", 150: "heirisson", 204: "bsc", 131: "snapper", 206: "crab_geo", 207: "crab_peel"}
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
        if re.search(r"General Use", title + legal, re.I) or title.strip() == park:
            return z("general_use", f"General use area ({park})", [], "General use — normal fishing rules apply.")
        if re.search(r"pointed instrument", title + legal, re.I):
            return z("restricted", f"Spearfishing restriction area ({park})", [], "Spearfishing (pointed instruments) is restricted here — read the order.")
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
        return z("restricted", "Rottnest Island Reserve (fishing rules area)", ["spear"], "Rottnest Island Reserve — spearfishing prohibited; other fishing restrictions apply in parts — read the order.")
    if kind == "wreck":
        return z("sanctuary", desc or name, BOTH, "Protected wreck — no fishing.")
    if kind in ("burswood", "greens_pool", "heirisson"):
        return z("sanctuary", {"burswood": "Burswood Lake", "greens_pool": "Greens Pool (Denmark)", "heirisson": "Heirisson Island (Swan River)"}[kind], BOTH, "Fishing prohibited by order.")
    if kind == "walpole":
        return z("restricted", "Walpole / Nornalup estuary", [], "Recreational fishing activity restrictions apply — read the order.")
    if kind == "esperance_jetty":
        return z("restricted", "Esperance jetty area", [], "A fishing order covers the old Tanker Jetty site — read the order.")
    if kind == "fhpa":
        return z("restricted", "Cottesloe Reef Fish Habitat Protection Area", [], "Fish Habitat Protection Area — special rules apply; read the order.")
    if kind == "lobster":
        return z("species", f"{desc} — rock lobster closure", [], "No fishing for rock lobster here.")
    # Species closures: the app uses 'species_id' + 'months' (1-12; empty = all year) to mark target fish as closed
    if kind == "bsc":
        return {**z("species", "Blue swimmer crab seasonal closure (Swan River to Minninup)", [], "No blue swimmer crabs 1 September – 30 November."), "species_id": "blue_swimmer_crab", "months": [9, 10, 11]}
    if kind == "snapper":
        return {**z("species", "Cockburn & Warnbro Sound pink snapper closure", [], "Pink snapper spawning closure in these waters (about 1 October – 31 January) — read the order for exact dates."), "species_id": "pink_snapper", "months": [10, 11, 12, 1]}
    if kind in ("crab_geo", "crab_peel"):
        return z("species", ("Geographe Bay" if kind == "crab_geo" else "Peel Inlet & Harvey Estuary") + " crab rules", [], "Extra rules for crabbing apply here (gear and/or times) — read the order.")
    if kind == "wire":
        return z("gear", f"Wire trace ban — {desc}", [], "Wire trace is prohibited here.")  # renamed by location below
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
        if kind == "wire":  # the source labels Busselton/Esperance the wrong way round — name by where the polygon is
            x0 = (g["coordinates"][0][0][0] if g["type"] == "Polygon" else g["coordinates"][0][0][0][0])
            props["name"] = "Wire trace ban — " + ("Esperance Jetty" if x0 > 120 else "Busselton Jetty" if x0 < 115.5 and props["name"].endswith("Jetty") else "Perth metropolitan waters")
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
