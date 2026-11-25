"""Shared Overpass helper for the weekly GitHub Action (never called from phones).

Big Perth-to-Esperance queries time out (HTTP 504) when the public servers are busy, so we
split the area into tiles, ask for one tile at a time, rotate between mirrors, and split a
tile into four smaller ones if it still times out.
"""
import json, time, urllib.parse, urllib.request

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
UA = {"User-Agent": "wa-fishing-intelligence/0.6 (weekly extract via GitHub Actions)"}

# Perth -> Esperance, split so the dense Perth/Mandurah/Bunbury area gets smaller tiles.
TILES = [
    # (south, west, north, east)
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
    for attempt in range(len(ENDPOINTS) * 2):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            data = _post(url, q, timeout=150)
            if data.get("remark", "").lower().startswith("runtime error"):
                raise RuntimeError(data["remark"][:120])
            print(f"  tile {t} via {url.split('/')[2]}: {len(data.get('elements', []))} elements")
            return data.get("elements", [])
        except Exception as ex:
            last = ex
            print(f"  tile {t} via {url.split('/')[2]} failed: {ex}")
            time.sleep(10 + 5 * attempt)
    if depth < 2:
        s, w, n, e = t
        ms, mw = (s + n) / 2, (w + e) / 2
        print(f"  splitting tile {t}")
        quads = [(s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)]
        return run(query_for_bbox, quads, depth + 1)
    print(f"  GIVING UP on tile {t}: {last}")
    return []
