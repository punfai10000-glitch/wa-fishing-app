"""Official DPIRD fishing prohibition areas (Fish Resources Management Act orders) for Perth -> Esperance.

Source: Landgate SLIP public ArcGIS service 'DPIRD_Fisheries_Guide' (Fisheries Guide - CEO Notices &
Consolidated Notices and Orders). Each feature links to the legal order PDF on wa.gov.au.
Writes data/zones/closures.geojson. Never overwrites a good file with an empty/partial result.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
BASE = "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/DPIRD_Fisheries_Guide/MapServer"
BBOX = "113.4,-35.6,124.5,-28.3"
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

# Plain rules per zone, read from each order (Nov 2026). "details" lines start with ✓ (allowed) or ✗ (not allowed).
# prohibits: activities the app rates that are banned here ('shore' = line fishing from the shore, 'spear').
# permits:   activities explicitly allowed here that a wider zone of the same park bans (Marmion spearfishing area).
NGARI = "Prohibition on Fishing (Ngari Capes Marine Park) Order 2018, cl. 3"
def classify(kind, a):
    legal, desc, name = a.get("legal") or "", a.get("descript") or "", a.get("name") or ""
    order = f"{name}" + (f" ({a['ord_notice']})" if a.get("ord_notice") else "")
    base = {"order": order, "link": a.get("link"), "verified": True, "authority": "DPIRD", "source": "DPIRD fishing order (SLIP)"}
    def z(zone_type, title, prohibits, note, details=None, **extra):
        return {**base, "name": title, "zone_type": zone_type, "prohibits": prohibits, "note": note, "details": details or [], **extra}
    NO_ALL = ["✗ No fishing or collecting of any kind — line, spear, crabs, lobster, shells, bait"]
    if kind == "ngari":
        park = "Ngari Capes Marine Park"
        title = re.sub(r"^Schedule \d+ - ", "", desc) or legal
        t = title + " " + legal
        if re.search(r"General Use", t, re.I) or title.strip() == park:
            return z("general_use", f"General use area ({park})", [], "General use — normal fishing rules apply.",
                     ["✓ Line fishing, spearfishing, crabbing and lobster diving under normal rules"])
        if re.search(r"sanctuary", legal + desc, re.I):
            return z("sanctuary", f"{title} ({park})", BOTH, "Sanctuary zone — no fishing or collecting of any kind.", NO_ALL)
        if re.search(r"Cowaramup", t, re.I):
            return z("restricted", f"{title} ({park})", [], "Recreation zone: line fishing and spearfishing OK, some species banned.",
                     ["✓ Line fishing and spearfishing", "✗ Crabs other than blue manna crabs", "✗ Octopus", "✗ Shells (specimen shells)", "✗ Fishing from a charter boat"])
        if re.search(r"Hamelin", t, re.I):
            return z("restricted", f"{title} ({park})", [], "Recreation zone: line fishing and spearfishing OK.",
                     ["✓ Line fishing, spearfishing, crabbing, lobster", "✗ Live shells (specimen shells)", "✗ Fishing from a charter boat"])
        if re.search(r"Surfing", t, re.I):
            mr = re.search(r"Margaret River", t, re.I)
            return z("restricted", f"{title} ({park})", [], "Surfing zone: line fishing and spearfishing OK; no lobster or octopus pots.",
                     ["✓ Line fishing and spearfishing", "✓ Diving for rock lobster by hand (with a licence)" if not mr else "✓ Rock lobster (pots or diving, with a licence)",
                      *([] if mr else ["✗ Rock lobster pots"]), "✗ Octopus pots or traps", "✗ Live shells (specimen shells)"])
        if re.search(r"Shore", t, re.I):
            return z("restricted", f"{title} ({park})", ["spear"], "Shore-based activities zone: line fishing from the shore only — no spearfishing.",
                     ["✓ Line fishing from the shore", "✗ Spearfishing (spearguns, gidgies, Hawaiian slings)", "✗ Fishing from a boat (line, net, crabs, lobster, abalone)",
                      "✗ Octopus pots or traps", "✗ Live shells (specimen shells)"])
        return z("restricted", f"{title} ({park})", [], "Special rules apply — read the order.", ["⚠ Special rules — read the order"])
    if kind == "marmion":
        park = "Marmion Marine Park"
        title = re.sub(r"^Schedule \d+ - ", "", desc) or legal
        t = title + " " + legal
        if re.search(r"pointed instrument", t, re.I):
            # the polygon is the water 1.8 km+ from the mainland shore, where spearfishing IS allowed
            return z("permit", f"Spearfishing area 1.8 km+ offshore ({park})", [], "Spearfishing allowed here (1.8 km or more from the mainland shore) — breath-hold only, no scuba.",
                     ["✓ Spearfishing — breath-hold only, no scuba or hookah"], permits=["spear"])
        if re.search(r"Waterman", t, re.I):
            return z("restricted", f"Waterman Recreation Area ({park})", ["spear"], "Only line fishing from the shore is allowed here.",
                     ["✓ Line fishing from the shore", "✗ Spearfishing", "✗ Fishing from a boat", "✗ Crabs, lobster, abalone, octopus or any collecting"])
        if re.search(r"sanctuary", legal + desc, re.I):
            return z("sanctuary", f"{title} ({park})", BOTH, "Sanctuary zone — no fishing or collecting of any kind.", NO_ALL)
        return z("general_use", f"General use area ({park})", ["spear"], "Line fishing OK. Spearfishing only 1.8 km or more from the mainland shore — not from the beach.",
                 ["✓ Line fishing", "✗ Spearfishing within 1.8 km of the mainland shore (allowed further out, breath-hold only)",
                  "✓ Rock lobster and Roe's abalone (licence), blue manna and sand crabs, octopus pots", "✗ Nets and any other collecting (shells, urchins, bait)"])
    if kind == "shoalwater":
        park = "Shoalwater Islands Marine Park"
        title = re.sub(r"^Schedule \d+ - ", "", desc) or legal
        t = title + " " + legal
        if re.search(r"sanctuary", t, re.I):
            return z("sanctuary", f"{title} ({park})", BOTH, "Sanctuary zone — no fishing or collecting of any kind.", NO_ALL)
        if re.search(r"Murray Reef", t, re.I):
            return z("restricted", f"{title} ({park})", BOTH, "Scientific reference area — no line fishing or spearfishing. Only rock lobster.",
                     ["✗ Line fishing", "✗ Spearfishing", "✓ Rock lobster only (with a licence)", "✗ Crabs, abalone, octopus, collecting"])
        if re.search(r"Saxon", t, re.I):
            return z("sanctuary", f"{title} ({park})", BOTH, "Wreck site — no fishing of any kind.", NO_ALL)
        if re.search(r"Wildlife|Shoalwater Bay", t, re.I):
            return z("restricted", f"{title} ({park})", ["spear"], "Wildlife area: line fishing OK, no spearfishing.",
                     ["✓ Line fishing", "✗ Spearfishing", "✓ Abalone, crabs, mussels, rock lobster, octopus pots", "✗ Nets and other collecting"])
        return z("general_use", f"General use area ({park})", [], "General use — line fishing and spearfishing (breath-hold only) allowed.",
                 ["✓ Line fishing", "✓ Spearfishing — breath-hold only, no scuba", "✓ Abalone, crabs, mussels, rock lobster, octopus pots, haul/throw nets", "✗ Any other collecting (shells, urchins)"])
    if kind == "rottnest":
        t = re.sub(r"^Schedule \d+ - ", "", desc or legal)
        common = ["✗ Spearfishing anywhere at Rottnest", "✗ Nets within 800 m of the island", "✗ Taking live shells, urchins, starfish, sea cucumbers, corals or seahorses within 800 m"]
        if re.search(r"Green Island", t, re.I):
            return z("sanctuary", f"{t} (Rottnest Island)", BOTH, "Protected area — no fishing, except line fishing from the Green Island jetty.",
                     ["✗ All fishing and collecting", "✓ Exception: rod or handline from the Green Island jetty only"])
        if re.search(r"Parker Point|Kingston", t, re.I):
            return z("sanctuary", f"{t} (Rottnest Island)", BOTH, "Rottnest sanctuary — no fishing or collecting of any kind.", NO_ALL)
        if re.search(r"Armstrong", t, re.I):
            return z("restricted", f"{t} (Rottnest Island)", ["spear"], "Only rod or handline from the shore or reef top. No spearfishing.",
                     ["✓ Rod or handline from the shore or reef top", "✗ Fishing from a boat", "✗ Spearfishing", "✗ Crabs, lobster, collecting"])
        if re.search(r"West End", t, re.I):
            return z("restricted", f"{t} (Rottnest Island)", ["spear"], "No bottom fishing from boats. Shore line fishing and trolling for pelagics only.",
                     ["✓ Rod or handline from the shore", "✓ Trolling from a boat for pelagic fish", "✗ Bottom (demersal) fishing from a boat", "✗ Spearfishing"])
        return z("restricted", "Rottnest Island Reserve", ["spear"], "No spearfishing anywhere at Rottnest. Line fishing allowed outside the protected areas.",
                 ["✓ Line fishing (outside sanctuary and protected areas)", *common])
    if kind == "wreck":
        return z("sanctuary", desc or name, BOTH, "Protected wreck — no fishing.", NO_ALL)
    if kind in ("burswood", "greens_pool", "heirisson"):
        return z("sanctuary", {"burswood": "Burswood Lake", "greens_pool": "Greens Pool (Denmark)", "heirisson": "Heirisson Island (Swan River)"}[kind], BOTH, "Fishing prohibited by order.", NO_ALL)
    if kind == "walpole":
        return z("restricted", "Walpole / Nornalup estuary", ["spear"], "Only rod and line or handline, plus crabs, prawns and marron.",
                 ["✓ Rod and line or handline", "✓ Crabs, prawns and marron", "✗ Spearfishing", "✗ Nets, traps and any other method"])
    if kind == "esperance_jetty":
        return z("sanctuary", "Former Esperance Tanker Jetty end", BOTH, "No fishing at any time in this small area at the old seaward end of the Tanker Jetty.", ["✗ No fishing at any time"])
    if kind == "fhpa":
        return z("restricted", "Cottesloe Reef Fish Habitat Protection Area", [], "Protected reef: line fishing and spearfishing OK; no abalone, urchins or other shellfish.",
                 ["✓ Line fishing and spearfishing under normal rules", "✗ Abalone, sea urchins and other shellfish", "✗ Fishing for sharks"])
    if kind == "lobster":
        num = int(re.match(r"\s*(\d+)", desc).group(1)) if re.match(r"\s*\d+", desc) else 0
        if num in (9, 13, 15):
            return None   # recreational fishers are exempt here (order cl. 3(2)) — commercial-only rule
        place = re.sub(r"^\s*\d+\s*\.\s*", "", desc)
        return z("gear", f"No rock lobster pots — {place}", [], "Rock lobster pots are banned here (diving for lobster by hand is OK).",
                 ["✗ Rock lobster pots", "✓ Diving for rock lobster by hand (with a licence)"])
    if kind == "bsc":
        return {**z("species", "Blue swimmer crab season closed 1 Sep – 30 Nov (Swan River to Minninup)", [], "No blue swimmer crabs 1 September – 30 November.",
                    ["✗ Blue swimmer crabs 1 September – 30 November"]), "species_id": "blue_swimmer_crab", "months": [9, 10, 11]}
    if kind == "snapper":
        return {**z("species", "Pink snapper closed 1 Aug – 31 Jan (Cockburn & Warnbro Sounds)", [], "No fishing for pink snapper 1 August – 31 January.",
                    ["✗ Pink snapper 1 August – 31 January", "✗ Line fishing from a boat with a pink snapper on board (same dates)"]),
                "species_id": "pink_snapper", "months": [8, 9, 10, 11, 12, 1]}
    if kind == "crab_geo":
        return None   # commercial-only order — no effect on recreational fishers
    if kind == "crab_peel":
        return {**z("species", "Crabbing closed 1 Sep – 31 Oct (Peel Inlet & Harvey Estuary)", [], "No crabbing 1 September – 31 October in the Peel-Harvey estuary, Dawesville Cut and its canals.",
                    ["✗ All crabs 1 September – 31 October"]), "species_id": "blue_swimmer_crab", "months": [9, 10]}
    if kind == "wire":
        return z("gear", f"Wire trace ban — {desc}", [], "Wire trace is prohibited here.", ["✗ Wire trace (shark fishing gear)"])  # renamed by location below
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
        def ring_simplify(r):   # Douglas-Peucker, ~2 m tolerance: same legal line, fewer points to download
            if len(r) < 5: return r
            keep = [False] * len(r); keep[0] = keep[-1] = True; stack = [(0, len(r) - 1)]
            while stack:
                a, b = stack.pop(); ax, ay = r[a]; bx, by = r[b]; dx, dy = bx - ax, by - ay; L = (dx * dx + dy * dy) ** 0.5 or 1e-12
                i, dm = -1, 0
                for k in range(a + 1, b):
                    d = abs(dy * (r[k][0] - ax) - dx * (r[k][1] - ay)) / L
                    if d > dm: i, dm = k, d
                if dm > 0.00002: keep[i] = True; stack += [(a, i), (i, b)]
            out = [p for p, k in zip(r, keep) if k]
            return out if len(out) >= 4 else r
        def simp(c): return ring_simplify(c) if isinstance(c[0][0], (int, float)) else [simp(x) for x in c]
        g["coordinates"] = simp(rnd(g["coordinates"]))
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
