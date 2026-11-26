import json, urllib.request
u = "https://geoserver.imas.utas.edu.au/geoserver/seamap/wms?REQUEST=GetLegendGraphic&VERSION=1.0.0&FORMAT=application/json&LAYER=seamap:SeamapAus_National_Benthic_Habitat_Layer"
with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "wa-fishing-app"}), timeout=60) as r:
    j = json.load(r)
for leg in j.get("Legend", []):
    for rule in leg.get("rules", []):
        sym = rule.get("symbolizers", [{}])[0]
        poly = sym.get("Polygon") or sym.get("Line") or {}
        print("RULE", json.dumps({"title": rule.get("title") or rule.get("name"), "filter": rule.get("filter"), "fill": poly.get("fill"), "stroke": poly.get("stroke"), "opacity": poly.get("fill-opacity")}))
