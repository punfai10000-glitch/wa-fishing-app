"""Weekly extract of tackle/bait shops, fuel stations and public toilets from OpenStreetMap.

Runs in GitHub Actions (never from users' phones) so the app makes ONE Overpass request
per week, well inside the Overpass usage policy. Output: data/amenities.geojson (ODbL).
Usage: python pipeline/fetch_amenities.py
"""
import json, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

# Perth to Esperance coastal strip: south, west, north, east
BBOX = (-35.3, 114.9, -31.5, 122.4)
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
QUERY = """
[out:json][timeout:180];
(
  nwr["shop"~"^(fishing|bait)$"]({s},{w},{n},{e});
  nwr["amenity"="fuel"]({s},{w},{n},{e});
  nwr["amenity"="toilets"]({s},{w},{n},{e});
  nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["opening_hours"="24/7"]({s},{w},{n},{e});
  nwr["amenity"="parking"]["access"!~"^(private|customers|no)$"]({s},{w},{n},{e});
);
out center tags;
""".format(s=BBOX[0], w=BBOX[1], n=BBOX[2], e=BBOX[3])


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
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    last = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "wa-fishing-intelligence/0.2 (weekly amenities extract; github.com)"})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r)
        except Exception as ex:  # try the next mirror
            last = ex
            time.sleep(5)
    raise SystemExit(f"Overpass failed: {last}")


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
