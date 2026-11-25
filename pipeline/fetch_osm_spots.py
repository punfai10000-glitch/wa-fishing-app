"""Weekly: coordinate-based fishing spot candidates from OpenStreetMap (ODbL), Perth→Esperance.
Groynes, breakwaters, piers/jetties, reefs, capes/headlands, rocky shores, named beaches, and
anything tagged leisure=fishing or fishing=yes. Output: data/osm-spots.geojson (points + tags).
"""
import json, time, urllib.parse, urllib.request
from datetime import datetime, timezone

S, W, N, E = -35.3, 114.9, -31.5, 122.4
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
QUERY = f"""
[out:json][timeout:180];
(
  nwr["leisure"="fishing"]({S},{W},{N},{E});
  nwr["fishing"="yes"]({S},{W},{N},{E});
  nwr["man_made"~"^(pier|groyne|breakwater|jetty)$"]({S},{W},{N},{E});
  nwr["natural"~"^(reef|cape)$"]({S},{W},{N},{E});
  nwr["natural"="bare_rock"]["name"]({S},{W},{N},{E});
  nwr["natural"="beach"]["name"]({S},{W},{N},{E});
);
out center tags;
"""
KEEP = ("name", "leisure", "fishing", "man_made", "natural", "access")


def main():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    raw = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "wa-fishing-intelligence/0.5 (weekly spot extract)"})
            with urllib.request.urlopen(req, timeout=240) as r:
                raw = json.load(r); break
        except Exception as ex:
            print("failed", url, ex); time.sleep(5)
    if not raw:
        raise SystemExit("Overpass unavailable")
    feats = []
    for el in raw.get("elements", []):
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None:
            continue
        t = el.get("tags", {})
        if t.get("access") in ("private", "no"):
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                      "properties": {k: t[k] for k in KEEP if k in t} | {"osm": f"{el['type']}/{el['id']}"}})
    if len(feats) < 10:
        raise SystemExit(f"only {len(feats)} features — keeping old file")
    with open("data/osm-spots.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "source": "© OpenStreetMap contributors, ODbL", "features": feats}, f, separators=(",", ":"))
    print("wrote", len(feats))


if __name__ == "__main__":
    main()
