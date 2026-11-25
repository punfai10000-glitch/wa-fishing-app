"""Read OpenStreetMap data from a local extract instead of the public Overpass servers.

The weekly workflow downloads Geofabrik's Australia extract once, cuts it to Perth->Esperance with
osmium, and sets OSM_PBF to that file. This avoids Overpass entirely (its public servers time out from
GitHub Actions). Returns elements shaped like Overpass JSON so the fetch_* scripts work unchanged:
  {"type": "node"|"way"|"relation", "id": int, "tags": {...}, "lat"/"lon" or "center": {...},
   "geometry": [{"lat","lon"}, ...] (lines and polygon outer rings)}
Data © OpenStreetMap contributors, ODbL.
"""
import json, os, subprocess, tempfile

PBF = os.environ.get("OSM_PBF", "")


def available():
    return bool(PBF) and os.path.exists(PBF)


def _export(filters, geometry_types):
    with tempfile.TemporaryDirectory() as tmp:
        sub = os.path.join(tmp, "f.osm.pbf")
        out = os.path.join(tmp, "f.geojsonseq")
        subprocess.run(["osmium", "tags-filter", PBF, *filters, "-o", sub, "--overwrite"], check=True)
        cmd = ["osmium", "export", sub, "-f", "geojsonseq", "--add-unique-id=type_id", "-o", out, "--overwrite"]
        if geometry_types:
            cmd.insert(3, f"--geometry-types={geometry_types}")
        subprocess.run(cmd, check=True)
        with open(out, encoding="utf-8") as f:
            for line in f:
                line = line.strip().lstrip("\x1e")
                if line:
                    yield json.loads(line)


def _rings(geom):
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        return [[c]]
    if t == "LineString":
        return [c]
    if t == "Polygon":
        return [c[0]]
    if t == "MultiPolygon":
        return [p[0] for p in c]
    if t == "MultiLineString":
        return c
    return []


def elements(filters, geometry_types=None, split_parts=False):
    """filters: osmium tags-filter expressions, e.g. ["nwr/amenity=fuel,toilets"]."""
    kind = {"n": "node", "w": "way", "r": "relation", "a": "way"}
    out = []
    for f in _export(filters, geometry_types):
        uid = str(f.get("id", "x0"))
        typ, num = kind.get(uid[0], "way"), int("".join(ch for ch in uid[1:] if ch.isdigit()) or 0)
        tags = f.get("properties") or {}
        g = f.get("geometry")
        if not g:
            continue
        parts = _rings(g)
        if not parts:
            continue
        if g["type"] == "Point":
            lon, lat = g["coordinates"]
            out.append({"type": typ, "id": num, "tags": tags, "lat": lat, "lon": lon})
            continue
        pieces = parts if split_parts else [max(parts, key=len)]
        for ring in pieces:
            pts = [{"lat": y, "lon": x} for x, y in ring]
            cy = sum(p["lat"] for p in pts) / len(pts)
            cx = sum(p["lon"] for p in pts) / len(pts)
            out.append({"type": typ, "id": num, "tags": tags, "center": {"lat": cy, "lon": cx}, "geometry": pts})
    print(f"  local OSM extract: {len(out)} elements for {filters}")
    return out
