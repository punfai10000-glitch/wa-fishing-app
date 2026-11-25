"""Weekly: coordinate-based fishing spot candidates from OpenStreetMap (ODbL), Perth→Esperance.
Groynes, breakwaters, piers/jetties, reefs, capes/headlands, rocky shores, named beaches, and
anything tagged leisure=fishing or fishing=yes. Output: data/osm-spots.geojson (points + tags).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overpass, osm_local
from datetime import datetime, timezone

def query(s, w, n, e):
    b = f"({s},{w},{n},{e})"
    return f"""
[out:json][timeout:120];
(
  nwr["leisure"="fishing"]{b};
  nwr["fishing"="yes"]{b};
  nwr["man_made"~"^(pier|groyne|breakwater|jetty)$"]{b};
  nwr["natural"~"^(reef|cape)$"]{b};
  nwr["natural"="bare_rock"]["name"]{b};
  nwr["natural"="beach"]["name"]{b};
);
out center tags;
"""


KEEP = ("name", "leisure", "fishing", "man_made", "natural", "access")


def main():
    if osm_local.available():
        raw = {"elements": osm_local.elements(["nwr/leisure=fishing", "nwr/fishing=yes", "nwr/man_made=pier,groyne,breakwater,jetty",
                                                "nwr/natural=reef,cape,bare_rock,beach"])}
    else:
        raw = {"elements": overpass.run(query)}
    feats = []
    for el in raw.get("elements", []):
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None:
            continue
        t = el.get("tags", {})
        if t.get("access") in ("private", "no"):
            continue
        if t.get("natural") in ("bare_rock", "beach") and not t.get("name") and t.get("leisure") != "fishing" and t.get("fishing") != "yes":
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                      "properties": {k: t[k] for k in KEEP if k in t} | {"osm": f"{el['type']}/{el['id']}"}})
    feats = overpass.keep_old_in_failed_tiles(feats, "data/osm-spots.geojson")
    if len(feats) < 10:
        raise SystemExit(f"only {len(feats)} features — keeping old file")
    with open("data/osm-spots.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "source": "© OpenStreetMap contributors, ODbL", "features": feats}, f, separators=(",", ":"))
    print("wrote", len(feats))


if __name__ == "__main__":
    main()
