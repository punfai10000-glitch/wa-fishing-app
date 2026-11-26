"""Shared Overpass helper for the weekly GitHub Action (never called from phones).

Big Perth-to-Esperance queries time out (HTTP 504) when the public servers are busy, so we
split the area into tiles, ask for one tile at a time, rotate between mirrors, and split a
tile into four smaller ones if it still times out.
"""
import json, os, time, urllib.parse, urllib.request

# Hard time budget per script run so a busy server can't hang the weekly job (seconds).
BUDGET = int(os.environ.get("OVERPASS_BUDGET", "900"))
_start = time.time()

FAILED = []   # tiles that could not be fetched in this run


def _left():
    return BUDGET - (time.time() - _start)

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
UA = {"User-Agent": "wa-fishing-intelligence/0.6 (weekly extract via GitHub Actions)"}

# Geraldton -> Esperance, split so the dense Perth/Mandurah/Bunbury area gets smaller tiles.
TILES = [
    # (south, west, north, east)
    (-29.40, 113.40, -28.30, 115.20),   # Geraldton / Abrolhos / Dongara
    (-30.60, 114.80, -29.40, 115.40),   # Leeman / Green Head / Jurien / Cervantes
    (-31.50, 115.00, -30.60, 115.90),   # Lancelin / Guilderton / Two Rocks
    (-32.10, 115.40, -31.50, 116.20),   # Perth north
    (-32.60, 115.40, -32.10, 116.20),   # Perth south / Rockingham / Mandurah
    (-33.40, 115.30, -32.60, 116.20),   # Peel / Bunbury
    (-34.40, 114.90, -33.40, 115.60),   # Busselton / Margaret River
    (-35.30, 114.90, -34.40, 116.20),   # Augusta / Walpole west
    (-35.30, 116.20, -34.00, 118.50),   # Walpole / Denmark / Albany
    (-34.60, 118.50, -33.30, 120.50),   # Bremer Bay / Hopetoun
    (-34.20, 120.50, -33.30, 122.40),   # Esperance
]


def _post(url, query, timeout):
    body = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(url, data=body, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def run(query_for_bbox, tiles=TILES, depth=0):
    """query_for_bbox(s, w, n, e) -> Overpass QL string. Returns de-duplicated elements."""
    seen, out = set(), []
    for t in tiles:
        els = _tile(query_for_bbox, t, depth)
        for el in els:
            key = (el["type"], el["id"])
            if key not in seen:
                seen.add(key)
                out.append(el)
        time.sleep(3)  # be polite between tiles
    return out


def _tile(query_for_bbox, t, depth):
    q = query_for_bbox(*t)
    last = None
    for attempt in range(len(ENDPOINTS)):          # each mirror once
        if _left() < 60:
            print(f"  time budget used up - skipping tile {t}")
            FAILED.append(t)
            return []
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            data = _post(url, q, timeout=min(120, max(30, _left() - 30)))
            if data.get("remark", "").lower().startswith("runtime error"):
                raise RuntimeError(data["remark"][:120])
            print(f"  tile {t} via {url.split('/')[2]}: {len(data.get('elements', []))} elements")
            return data.get("elements", [])
        except Exception as ex:
            last = ex
            print(f"  tile {t} via {url.split('/')[2]} failed: {ex}")
            time.sleep(5)
    if depth < 1 and _left() > 300:
        s, w, n, e = t
        ms, mw = (s + n) / 2, (w + e) / 2
        print(f"  splitting tile {t}")
        quads = [(s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)]
        return run(query_for_bbox, quads, depth + 1)
    print(f"  GIVING UP on tile {t}: {last}")
    FAILED.append(t)
    return []


def keep_old_in_failed_tiles(new_features, path):
    """Never let a partial download wipe good data: for tiles that failed this run, keep the previous
    file's features that fall inside them."""
    if not FAILED:
        return new_features
    import json
    try:
        old = json.load(open(path)).get("features", [])
    except Exception:
        return new_features
    def inside(f):
        x, y = f["geometry"]["coordinates"][:2]
        return any(s <= y <= n and w <= x <= e for (s, w, n, e) in FAILED)
    kept = [f for f in old if f.get("geometry", {}).get("type") == "Point" and inside(f)]
    print(f"  {len(FAILED)} tile(s) failed - kept {len(kept)} previous features there")
    return new_features + kept
