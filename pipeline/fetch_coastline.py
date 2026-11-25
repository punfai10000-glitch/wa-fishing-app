"""Weekly: precise coastline (OpenStreetMap natural=coastline, ODbL) for Perth -> Esperance.

OSM coastline ways always have LAND ON THE LEFT, which the app uses to tell land from sea
(shark-incident placement, tap reports) and to draw the coloured conditions line along the real shore.
Output: data/coastline.json  {land_side:"left", lines:[[[lon,lat],...],...]}
"""
import json, os, sys
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overpass

TOL = 0.00008  # ~8 m simplification


def query(s, w, n, e):
    return f'[out:json][timeout:120];way["natural"="coastline"]({s},{w},{n},{e});out geom;'


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
    with open(out, "w") as f:
        json.dump({"source": "© OpenStreetMap contributors, ODbL (natural=coastline)", "land_side": "left", "precise": True,
                   "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "lines": lines},
                  f, separators=(",", ":"))


if __name__ == "__main__":
    main(*sys.argv[1:])
