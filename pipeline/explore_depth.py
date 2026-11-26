import json, urllib.request, urllib.parse
S = "https://public-services.slip.wa.gov.au/public/rest/services/Landgate_Public_Maps/WA_Bathymetry/MapServer"
def get(u, **p):
    p.setdefault("f", "json")
    with urllib.request.urlopen(urllib.request.Request(u + "?" + urllib.parse.urlencode(p), headers={"User-Agent": "wa-fishing-app"}), timeout=60) as r:
        return json.load(r)
for lid in (1, 0):
    r = get(f"{S}/{lid}/query", where="1=1", geometry="114.5,-35.6,123.5,-31.3", geometryType="esriGeometryEnvelope", inSR=4326, outFields="*", returnGeometry="false", resultRecordCount=200)
    feats = r.get("features", [])
    print(f"layer {lid}: {len(feats)} features; fields: {[f['name'] for f in r.get('fields', [])]}")
    for f in feats[:40]:
        a = {k: v for k, v in f["attributes"].items() if v not in (None, "", " ")}
        print("   ", json.dumps(a)[:420])
# try a HEAD on any URL found
import re
urls = set()
for lid in (1,):
    r = get(f"{S}/{lid}/query", where="1=1", geometry="114.5,-35.6,123.5,-31.3", geometryType="esriGeometryEnvelope", inSR=4326, outFields="*", returnGeometry="false", resultRecordCount=200)
    for f in r.get("features", []):
        for v in f["attributes"].values():
            if isinstance(v, str) and v.startswith("http"): urls.add(v)
print("URLs:", len(urls)); 
for u in list(urls)[:8]:
    try:
        req = urllib.request.Request(u, method="HEAD", headers={"User-Agent": "wa-fishing-app"})
        with urllib.request.urlopen(req, timeout=40) as rr: print("  OK", rr.status, rr.headers.get("Content-Length"), rr.headers.get("Content-Type"), u)
    except Exception as e: print("  FAIL", e, u)
