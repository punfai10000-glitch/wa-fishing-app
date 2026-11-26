"""Weekly: marine park zones (incl. sanctuary zones) for Perth -> Esperance.

Source: Collaborative Australian Protected Areas Database (CAPAD), Marine Protected Areas layer,
Australian Government DCCEEW, CC BY 4.0. It contains WA state marine parks (supplied by DBCA) with a
ZONE_TYPE per polygon, plus Commonwealth marine parks.
Writes data/zones/marine-parks.geojson for the app's legal check. Leaves the old file alone on failure.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import osm_local
from collections import Counter
from datetime import datetime, timezone

LAYER = "https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/CAPAD/FeatureServer/1"
BBOX = "114.5,-35.6,123.5,-31.3"  # xmin,ymin,xmax,ymax (WGS84) Perth -> Esperance
UA = {"User-Agent": "wa-fishing-intelligence/0.6 (weekly marine zones; github.com)"}
FIELDS = "NAME,TYPE,TYPE_ABBR,ZONE_TYPE,IUCN,STATE,AUTHORITY"


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return json.load(r)
        except Exception as ex:
            print("  retry", i + 1, ex)
            time.sleep(10 * (i + 1))
    raise SystemExit("CAPAD service unreachable")


def fetch_all():
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({
            "where": "1=1", "geometry": BBOX, "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects", "outFields": FIELDS, "returnGeometry": "true",
            "outSR": 4326, "maxAllowableOffset": 0.0002, "geometryPrecision": 5,
            "resultOffset": offset, "resultRecordCount": 1000, "f": "geojson"})
        d = get(f"{LAYER}/query?{q}")
        if "error" in d:
            raise SystemExit(f"query error: {d['error']}")
        batch = d.get("features", [])
        feats += batch
        print(f"  got {len(batch)} (offset {offset})")
        if len(batch) < 1000 and not d.get("exceededTransferLimit"):
            return feats
        offset += len(batch)


def classify(p):
    """Return (zone_type, prohibits). Conservative: anything that says sanctuary / nature reserve blocks."""
    zt = (p.get("ZONE_TYPE") or "").lower()
    typ = (p.get("TYPE") or "").lower()
    name = (p.get("NAME") or "").lower()
    text = f"{zt} | {typ} | {name}"
    if "sanctuary" in text or "national park zone" in text or "no take" in text or "no-take" in text:
        return "sanctuary", ["shore", "spear"]
    if "marine nature reserve" in text:
        return "marine_nature_reserve", ["shore", "spear"]
    if "special purpose" in zt:
        return "special_purpose", []
    if "recreation" in zt or "recreational use" in zt:
        return "recreation", []
    if "general use" in zt or "multiple use" in zt or "habitat protection" in zt:
        return "general_use", []
    if zt:
        return zt.replace(" ", "_")[:40], []
    return "marine_park", []   # whole-park outline, zone unknown at this point


def osm_sanctuaries():
    if not osm_local.available():
        return []
    out = []
    els = osm_local.elements(["nwr/boundary=protected_area", "nwr/leisure=nature_reserve", "nwr/protect_class"],
                             geometry_types="polygon", split_parts=True)
    for el in els:
        name = el["tags"].get("name", "")
        if not re.search(r"sanctuary", name, re.I) or re.search(r"bird|wildlife|fauna|flora", name, re.I) or not el.get("geometry"):
            continue
        ring = [[p["lon"], p["lat"]] for p in el["geometry"]]
        out.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
                    "properties": {"name": name, "zone_type": "sanctuary", "prohibits": ["shore", "spear"],
                                   "source": "OpenStreetMap - check against the DBCA zoning map", "verified": False}})
    print("OSM sanctuary zones:", len(out), sorted({f["properties"]["name"] for f in out})[:30])
    return out


def centroid(f):
    ring = f["geometry"]["coordinates"][0]
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def _in_ring(x, y, ring):
    c = False
    for i in range(len(ring)):
        (xi, yi), (xj, yj) = ring[i][:2], ring[i - 1][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            c = not c
    return c


def inside_any(pt, parks):
    x, y = pt
    for f in parks:
        g = f.get("geometry") or {}
        polys = g.get("coordinates", []) if g.get("type") == "MultiPolygon" else [g.get("coordinates", [])]
        if any(p and _in_ring(x, y, p[0]) for p in polys):
            return True
    return False


def main(out="data/zones/marine-parks.geojson"):
    raw = fetch_all()
    print("CAPAD polygons in area:", len(raw))
    print("ZONE_TYPE values:", Counter((f.get("properties") or {}).get("ZONE_TYPE") for f in raw).most_common(30))
    print("TYPE values:", Counter((f.get("properties") or {}).get("TYPE") for f in raw).most_common(15))
    found = []
    for f in raw:
        p = f.get("properties") or {}
        if not f.get("geometry"):
            continue
        zt, prohibits = classify(p)
        f["properties"] = {"name": p.get("NAME") or "Marine park", "zone_type": zt, "prohibits": prohibits,
                           "park_type": p.get("TYPE"), "authority": p.get("AUTHORITY"), "state": p.get("STATE")}
        found.append(f)
    # Marine parks newer than CAPAD 2024 (e.g. the South Coast Marine Park: Mamang Maambakoort, Wudjari,
    # created Dec 2024): outlines from DBCA Legislated Lands and Waters (DBCA-011, via SLIP)
    have = {re.sub(r"[^a-z]", "", (f["properties"]["name"] or "").lower())[:8] for f in found}
    try:
        q = urllib.parse.urlencode({"where": "leg_category='Marine Park'", "geometry": BBOX.replace("123.5", "124.5"), "geometryType": "esriGeometryEnvelope",
                                    "inSR": 4326, "outFields": "leg_name", "returnGeometry": "true", "outSR": 4326, "maxAllowableOffset": 0.0003,
                                    "geometryPrecision": 5, "f": "geojson"})
        d = get(f"https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Property_and_Planning/MapServer/15/query?{q}")
        added = []
        for f in d.get("features", []):
            nm = (f.get("properties") or {}).get("leg_name") or ""
            nm = nm.replace("Maambacoort", "Maambakoort").replace(" Marine Park", "")
            if not f.get("geometry") or re.sub(r"[^a-z]", "", nm.lower())[:8] in have:
                continue
            f["properties"] = {"name": nm, "zone_type": "marine_park", "prohibits": [], "park_type": "Marine Park",
                               "authority": "WA DBCA", "state": "WA", "zones_pending": True}
            found.append(f); added.append(nm)
        print("DBCA-011 marine parks added:", sorted(set(added)))
    except SystemExit as ex:
        print("DBCA-011 skipped:", ex)
    # CAPAD has only whole-park outlines for WA (no ZONE_TYPE, checked 25 Nov 2026). Add sanctuary zones that
    # volunteers have mapped in OpenStreetMap, clearly marked as needing a check against DBCA's zoning maps.
    parks = [f for f in found if f["properties"]["zone_type"] == "marine_park"]
    osm_sz = [f for f in osm_sanctuaries() if inside_any(centroid(f), parks)]
    print("OSM sanctuary zones inside marine parks:", len(osm_sz), [f["properties"]["name"] for f in osm_sz][:30])
    found += osm_sz
    n_sanct = sum(1 for f in found if f["properties"]["prohibits"])
    print("no-take polygons:", n_sanct, [f["properties"]["name"] for f in found if f["properties"]["prohibits"]][:40])
    if len(found) < 5:
        raise SystemExit("Too little zone data - keeping existing file")
    data = {"type": "FeatureCollection", "loaded": True,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "Park outlines: CAPAD 2024 (Australian Government DCCEEW, CC BY 4.0). Sanctuary zones: OpenStreetMap (ODbL) - not yet checked against DBCA zoning maps.",
            "note": "Rottnest Island Reserve sanctuary zones and Fish Habitat Protection Areas may not be included.",
            "sanctuaries_mapped": n_sanct > 0,
            "features": found}
    with open(out, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print("wrote", len(found), "zone polygons; no-take:", n_sanct)


if __name__ == "__main__":
    main(*sys.argv[1:])
