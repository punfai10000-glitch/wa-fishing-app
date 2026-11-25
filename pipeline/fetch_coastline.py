"""Weekly: precise coastline + river/estuary water areas (OpenStreetMap natural=coastline, ODbL) for Perth -> Esperance.

OSM coastline ways always have LAND ON THE LEFT, which the app uses to tell land from sea
(shark-incident placement, tap reports) and to draw the coloured conditions line along the real shore.
Also fetches tidal rivers, estuaries and inlets (natural=water + water=river/estuary/lagoon/tidal, or tidal=yes)
so the app can recognise the Swan/Canning, Peel-Harvey, Leschenault, Hardy, Walpole-Nornalup, Wilson Inlet etc.
Output: data/coastline.json  {land_side:"left", precise:true, lines:[...], water:[{name, rings:[[[lon,lat],...]]}]}
"""
import json, os, sys
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overpass

TOL = 0.00008  # ~8 m simplification


def query(s, w, n, e):
    return f'[out:json][timeout:120];way["natural"="coastline"]({s},{w},{n},{e});out geom;'


def water_query(s, w, n, e):
    b = f"({s},{w},{n},{e})"
    return f"""[out:json][timeout:120];
(
  way["natural"="water"]["water"~"^(river|estuary|lagoon|tidal|canal)$"]{b};
  relation["natural"="water"]["water"~"^(river|estuary|lagoon|tidal)$"]{b};
  way["natural"="water"]["tidal"="yes"]{b};
  relation["natural"="water"]["tidal"="yes"]{b};
  way["waterway"="riverbank"]{b};
);
out geom;"""


def stitch(segments):
    """Join open way pieces (lists of points) into closed rings."""
    rings, segs = [], [list(s) for s in segments if len(s) > 1]
    while segs:
        ring = segs.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]
                elif s[-1] == ring[-1]: ring += s[::-1][1:]
                elif s[-1] == ring[0]: ring = s[:-1] + ring
                elif s[0] == ring[0]: ring = s[::-1][:-1] + ring
                else: continue
                segs.pop(i); changed = True; break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def ring_area_km2(r):
    import math
    lat0 = sum(p[1] for p in r) / len(r)
    k = math.cos(math.radians(lat0)) * 111.32
    a = 0
    for (x1, y1), (x2, y2) in zip(r, r[1:]):
        a += (x1 * k) * (y2 * 110.57) - (x2 * k) * (y1 * 110.57)
    return abs(a) / 2


def fetch_water():
    out = []
    for el in overpass.run(water_query):
        t = el.get("tags", {})
        if el["type"] == "way":
            g = el.get("geometry") or []
            pieces = [[(round(p["lon"], 5), round(p["lat"], 5)) for p in g]]
        else:
            pieces = [[(round(p["lon"], 5), round(p["lat"], 5)) for p in m.get("geometry") or []]
                      for m in el.get("members", []) if m.get("type") == "way" and m.get("role", "outer") in ("outer", "")]
        for r in stitch(pieces):
            if ring_area_km2(r) < 0.02:   # skip ponds/drains
                continue
            r = simplify(r, TOL)
            if len(r) >= 4:
                out.append({"name": t.get("name") or "", "kind": t.get("water") or ("tidal" if t.get("tidal") == "yes" else "river"),
                            "rings": [[list(p) for p in r]]})
    print("water areas:", len(out), sorted({w["name"] for w in out if w["name"]})[:40])
    return out


def simplify(pts, tol):
    """Douglas-Peucker on lon/lat."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = (dx * dx + dy * dy) or 1e-18
        best, idx = 0, None
        for i in range(a + 1, b):
            px, py = pts[i]
            t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
            d = ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def main(out="data/coastline.json"):
    els = overpass.run(query)
    lines, n = [], 0
    for el in els:
        g = el.get("geometry")
        if el.get("type") != "way" or not g or len(g) < 2:
            continue
        pts = simplify([(round(p["lon"], 5), round(p["lat"], 5)) for p in g], TOL)
        lines.append([list(p) for p in pts])
        n += len(pts)
    print("coastline ways:", len(lines), "points:", n)
    if n < 2000:
        raise SystemExit("too few coastline points - keeping existing file")
    try:
        water = fetch_water()
    except SystemExit as ex:
        print("water failed:", ex); water = []
    with open(out, "w") as f:
        json.dump({"source": "© OpenStreetMap contributors, ODbL (natural=coastline)", "land_side": "left", "precise": True,
                   "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "lines": lines, "water": water},
                  f, separators=(",", ":"))


if __name__ == "__main__":
    main(*sys.argv[1:])
