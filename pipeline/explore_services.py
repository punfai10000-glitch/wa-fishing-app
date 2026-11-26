"""One-off: list public SLIP / DBCA / DPIRD ArcGIS layers that look like marine zones or fishing closures."""
import json, re, sys, urllib.request
ROOTS = [
  "https://public-services.slip.wa.gov.au/public/rest/services",
  "https://services.slip.wa.gov.au/public/rest/services",
]
KW = re.compile(r"(zone|sanctuar|marine park|marine reserve|fish habitat|FHPA|closure|closed|prohibit|reef observation|DBCA-0|DPIRD-0)", re.I)
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u + ("&" if "?" in u else "?") + "f=json", headers={"User-Agent": "wa-fishing-app"}), timeout=40) as r:
            return json.load(r)
    except Exception as e:
        print("  ! ", u, e); return None
for root in ROOTS:
    top = get(root)
    if not top: continue
    folders = top.get("folders", [])
    print("ROOT", root, "folders:", folders)
    for f in folders:
        d = get(f"{root}/{f}")
        for s in (d or {}).get("services", []):
            name, typ = s["name"], s["type"]
            url = f"{root}/{name}/{typ}"
            info = get(url)
            if not info: continue
            for lyr in info.get("layers", []) + info.get("tables", []):
                if KW.search(lyr.get("name", "")) or KW.search(name):
                    print(f"{url}/{lyr['id']}  |  {lyr.get('name')}  ({name})")
    break
