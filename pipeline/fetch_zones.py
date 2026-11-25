"""Weekly: WA marine park zones (incl. sanctuary zones) for Perth→Esperance from the WA Government's
public ArcGIS services (SLIP / Landgate). Writes data/zones/marine-parks.geojson for the app's legal check.

The script discovers layers whose names mention marine park zoning, queries them for the app's area
and keeps polygons with their zone type. If nothing suitable is found it leaves the old file untouched.
"""
import json, re, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

SERVICES = [
    "https://services.slip.wa.gov.au/public/rest/services/Landgate_Public_Maps/Marine_Map_WA_3/MapServer",
    "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Environment/MapServer",
    "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Property_and_Planning/MapServer",
]
BBOX = "114.5,-35.6,123.5,-31.3"  # xmin,ymin,xmax,ymax (WGS84)
NAME_OK = re.compile(r"marine.*(zone|zoning)|zon.*marine|sanctuary", re.I)
UA = {"User-Agent": "wa-fishing-intelligence/0.4 (weekly marine zones)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return json.load(r)


def zone_type(props):
    text = " ".join(str(v) for v in props.values() if isinstance(v, str)).lower()
    for t in ("sanctuary", "recreation", "special purpose", "general use", "marine nature reserve", "marine management area"):
        if t in text:
            return t.replace(" ", "_")
    return None


def query(layer_url):
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"where": "1=1", "geometry": BBOX, "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                                    "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "true",
                                    "outSR": 4326, "maxAllowableOffset": 0.0003, "geometryPrecision": 5,
                                    "resultOffset": offset, "resultRecordCount": 500, "f": "geojson"})
        d = get(f"{layer_url}/query?{q}")
        batch = d.get("features", [])
        feats += batch
        if len(batch) < 500:
            return feats
        offset += 500


def main(out="data/zones/marine-parks.geojson"):
    found = []
    for svc in SERVICES:
        try:
            layers = get(f"{svc}?f=json").get("layers", [])
        except Exception as ex:
            print("skip service", svc, ex); continue
        for lyr in layers:
            if NAME_OK.search(lyr.get("name", "")):
                print("candidate", svc, lyr["id"], lyr["name"])
                try:
                    for f in query(f"{svc}/{lyr['id']}"):
                        p = f.get("properties") or {}
                        zt = zone_type(p) or ("sanctuary" if "sanctuary" in lyr["name"].lower() else None)
                        name = next((p[k] for k in p if re.search(r"name", k, re.I) and isinstance(p[k], str) and p[k].strip()), lyr["name"])
                        f["properties"] = {"name": name, "zone_type": zt, "layer": lyr["name"],
                                           "prohibits": ["shore", "spear"] if zt in ("sanctuary", "marine_nature_reserve") else []}
                        found.append(f)
                except Exception as ex:
                    print("query failed", lyr["name"], ex)
    if not found:
        print("No zone layers found — keeping existing file"); return
    data = {"type": "FeatureCollection", "loaded": True, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "WA Government (DBCA / Landgate) via SLIP public map services", "features": found}
    with open(out, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print("wrote", len(found), "zone polygons; sanctuary:", sum(1 for f in found if f["properties"]["zone_type"] == "sanctuary"))


if __name__ == "__main__":
    main(*sys.argv[1:])
