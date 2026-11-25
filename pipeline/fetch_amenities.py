"""Weekly extract of tackle/bait shops, fuel stations and public toilets from OpenStreetMap.

Runs in GitHub Actions (never from users' phones) so phones never hit Overpass; one run (8 small tiles)
per week, well inside the Overpass usage policy. Output: data/amenities.geojson (ODbL).
Usage: python pipeline/fetch_amenities.py
"""
import json, sys
from datetime import datetime, timezone

import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overpass


def query(s, w, n, e):
    b = f"({s},{w},{n},{e})"
    return f"""
[out:json][timeout:120];
(
  nwr["shop"~"^(fishing|bait)$"]{b};
  nwr["amenity"="fuel"]{b};
  nwr["amenity"="toilets"]{b};
  nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["opening_hours"="24/7"]{b};
  nwr["amenity"="parking"]["access"!~"^(private|customers|no)$"]{b};
);
out center tags;
"""


def kind(tags):
    if tags.get("shop") in ("fishing", "bait"):
        return "tackle"
    if tags.get("amenity") == "parking":
        return "parking"
    if tags.get("amenity") in ("restaurant", "fast_food", "cafe") and tags.get("opening_hours") == "24/7":
        return "food24"
    if tags.get("amenity") == "fuel":
        return "fuel"
    if tags.get("amenity") == "toilets":
        if tags.get("access") in ("private", "no", "customers"):
            return None
        return "toilets"
    return None


def fetch():
    return {"elements": overpass.run(query)}


def near_coast_filter():
    """Keep car parks only if within ~2 km of the coast (data/coast.json sample points)."""
    try:
        pts = [(p["lat"], p["lng"]) for p in json.load(open("data/coast.json"))["points"]]
    except Exception:
        return lambda lat, lon: True
    import math
    def ok(lat, lon):
        return any(math.hypot((lon - x) * math.cos(math.radians(lat)), lat - y) * 111 < 2.5 for y, x in pts)
    return ok


def main():
    raw = fetch()
    near_coast = near_coast_filter()
    feats = []
    for el in raw.get("elements", []):
        tags = el.get("tags", {})
        k = kind(tags)
        if not k:
            continue
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None or lon is None:
            continue
        if k == "parking" and not near_coast(lat, lon):
            continue
        props = {"kind": k, "osm": f"{el['type']}/{el['id']}"}
        for t in ("name", "brand", "opening_hours", "access", "wheelchair", "fee"):
            if t in tags:
                props[t] = tags[t]
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}, "properties": props})
    if len(feats) < 20:
        raise SystemExit(f"Only {len(feats)} features returned — refusing to overwrite good data")
    out = {"type": "FeatureCollection", "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "source": "© OpenStreetMap contributors, ODbL 1.0", "features": feats}
    with open("data/amenities.geojson", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    counts = {k: sum(1 for x in feats if x["properties"]["kind"] == k) for k in ("tackle", "fuel", "toilets", "food24", "parking")}
    print("Wrote", len(feats), "features", counts)


if __name__ == "__main__":
    main()
