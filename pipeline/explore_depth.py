"""One-off: which free depth services can tell the depth at a tapped point (and allow browser CORS)?"""
import json, urllib.request, urllib.parse
PTS = {"Cottesloe 100 m out": (-31.9957, 115.7495), "Cottesloe 1 km out": (-31.9957, 115.7380), "Busselton jetty middle": (-33.6370, 115.3420), "Cottesloe 300 m out": (-31.9955, 115.7480), "Busselton jetty end": (-33.6300, 115.3385), "Albany Middleton 500 m out": (-35.0150, 117.9300), "Rottnest Thomson Bay": (-31.9960, 115.5460), "Esperance 1 km out": (-33.8600, 121.9100), "On land (Perth CBD)": (-31.9523, 115.8613)}
def get(u, **p):
    p.setdefault("f", "json")
    req = urllib.request.Request(u + "?" + urllib.parse.urlencode(p), headers={"User-Agent": "wa-fishing-app", "Origin": "https://punfai10000-glitch.github.io"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r), r.headers.get("Access-Control-Allow-Origin")
SERVICES = [
  "https://public-services.slip.wa.gov.au/public/rest/services/Landgate_Public_Maps/WA_Bathymetry/MapServer",
]
for s in SERVICES:
    try:
        info, cors = get(s)
        print("\n==", s, "| CORS:", cors)
        for lid in (24, 32, 36):
            li, _ = get(f"{s}/{lid}")
            print("   layer", lid, {k: li.get(k) for k in ("name", "description", "drawingInfo", "copyrightText")} )
        for name, (lat, lng) in PTS.items():
            d = 0.01
            res, _ = get(s + "/identify", geometry=f"{lng},{lat}", geometryType="esriGeometryPoint", sr=4326, layers="all", tolerance=1,
                         mapExtent=f"{lng-d},{lat-d},{lng+d},{lat+d}", imageDisplay="400,400,96", returnGeometry="false")
            for r in res.get("results", []):
                if "Image" in (r.get("layerName") or "") or "Bathymetry_and" in (r.get("layerName") or ""):
                    print("   ", name, "->", r.get("layerName"), json.dumps(r.get("attributes"))[:300])
    except Exception as e:
        print("\n==", s, "ERROR", e)
# GA ImageServers (AusBathyTopo)
try:
    root, cors = get("https://services.ga.gov.au/gis/rest/services")
    print("\nGA folders:", root.get("folders"))
    for svc in root.get("services", []):
        if "bathy" in svc["name"].lower() or "topo" in svc["name"].lower(): print("   GA svc", svc)
    for f in root.get("folders", []):
        if any(k in f.lower() for k in ("bathy", "marine", "seabed", "elev", "dem")):
            d, _ = get(f"https://services.ga.gov.au/gis/rest/services/{f}")
            for svc in d.get("services", []): print("   GA", f, svc)
except Exception as e:
    print("GA list error", e)
