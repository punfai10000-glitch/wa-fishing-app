"""Nearshore depth tiles from Transport WA bathymetric LiDAR / multibeam composite surfaces (5 m grids).

Source: WA Department of Transport, 'Composite Surfaces - Multibeam LIDAR Laser (DOT-022)', CC BY 3.0 AU.
Output: data/depth/14/{x}/{y}.png — Web Mercator z14 tiles (~8 m pixels in Perth) plus averaged overviews at z13-z11,
'Terrarium' encoded: value_m = (R*256 + G + B/256) - 32768; transparent where there is no survey.
Values are heights relative to the survey's vertical datum (negative = below; see data/depth/index.json).
"""
import io, json, math, os, sys, time, urllib.request
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.transform import from_bounds
from PIL import Image

INDEX = ("https://public-services.slip.wa.gov.au/public/rest/services/Landgate_Public_Maps/WA_Bathymetry/MapServer/1/query"
         "?where=1%3D1&outFields=location,url&returnGeometry=false&f=json")
Z, TS, R = 14, 256, 6378137.0
REGION = (114.4, -35.6, 124.5, -31.0)   # app coverage (Perth to Esperance) — skip surveys outside it
OVERVIEWS = (13, 12, 11)
OUT = "data/depth"

def tile_bounds_3857(x, y, z):
    n = 2 ** z; size = 2 * math.pi * R / n; o = math.pi * R
    return (x * size - o, o - (y + 1) * size, (x + 1) * size - o, o - y * size)
def lonlat_to_tile(lon, lat, z):
    n = 2 ** z; x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return int(x), int(y)

def main():
    with urllib.request.urlopen(urllib.request.Request(INDEX, headers={"User-Agent": "wa-fishing-app"}), timeout=60) as r:
        feats = json.load(r)["features"]
    sources = [(f["attributes"]["location"], f["attributes"]["url"]) for f in feats]
    print(len(sources), "survey areas")
    os.makedirs("/tmp/depth_src", exist_ok=True)
    tiles = {}   # (x,y) -> float32 array (nan = no data)
    meta = []
    for name, url in sources:
        fn = "/tmp/depth_src/" + url.rsplit("/", 1)[1]
        if not os.path.exists(fn):
            for a in range(3):
                try: urllib.request.urlretrieve(url, fn); break
                except Exception as e: print("  retry", name, e); time.sleep(5)
        with rasterio.open(fn) as src:
            arr_info = dict(name=name, url=url, crs=str(src.crs), res=src.res, dtype=src.dtypes[0], nodata=src.nodata,
                            tags={k: v for k, v in src.tags().items() if len(str(v)) < 200})
            sample = src.read(1, out_shape=(max(1, src.height // 20), max(1, src.width // 20)))
            valid = sample[(sample != src.nodata) & np.isfinite(sample)] if src.nodata is not None else sample[np.isfinite(sample)]
            arr_info["range"] = [float(valid.min()), float(valid.max())] if valid.size else None
            print(" ", json.dumps(arr_info)[:400])
            meta.append({"name": name, "source_url": url, "crs": arr_info["crs"], "range_m": arr_info["range"], "tags": arr_info["tags"]})
            w, s, e, n = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
            if e < REGION[0] or w > REGION[2] or n < REGION[1] or s > REGION[3]:
                meta.pop(); print("   outside app region — skipped"); continue
            x0, y0 = lonlat_to_tile(w, n, Z); x1, y1 = lonlat_to_tile(e, s, Z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    dst = np.full((TS, TS), np.nan, dtype=np.float32)
                    reproject(source=rasterio.band(src, 1), destination=dst, src_nodata=src.nodata, dst_nodata=np.nan,
                              dst_transform=from_bounds(*tile_bounds_3857(x, y, Z), TS, TS), dst_crs="EPSG:3857",
                              resampling=Resampling.average)
                    if not np.isfinite(dst).any(): continue
                    if (x, y) in tiles:
                        cur = tiles[(x, y)]; m = ~np.isfinite(cur); cur[m] = dst[m]
                    else:
                        tiles[(x, y)] = dst
    if len(tiles) < 50:
        print("Too few tiles — not writing."); sys.exit(1)
    import shutil
    for d in os.listdir(OUT) if os.path.isdir(OUT) else []:
        if d.isdigit(): shutil.rmtree(f"{OUT}/{d}", ignore_errors=True)
    for (x, y), a in tiles.items():
        v = np.where(np.isfinite(a), a, 0).astype(np.float64) + 32768
        r = np.floor(v / 256); g = np.floor(v - r * 256); b = np.floor((v - np.floor(v)) * 256)
        rgba = np.dstack([r, g, b, np.where(np.isfinite(a), 255, 0)]).astype(np.uint8)
        os.makedirs(f"{OUT}/{Z}/{x}", exist_ok=True)
        Image.fromarray(rgba, "RGBA").save(f"{OUT}/{Z}/{x}/{y}.png", optimize=True)
    # overview zooms (2x2 averages, repeated) so zoomed-out views need one small file per tile
    def enc(a):
        v = np.where(np.isfinite(a), a, 0).astype(np.float64) + 32768
        r = np.floor(v / 256); g = np.floor(v - r * 256); b = np.floor((v - np.floor(v)) * 256)
        return np.dstack([r, g, b, np.where(np.isfinite(a), 255, 0)]).astype(np.uint8)
    levels = {Z: tiles}
    for zz in OVERVIEWS:
        child = levels[zz + 1]; parent = {}
        for (x, y), a in child.items():
            px, py = x // 2, y // 2
            P = parent.setdefault((px, py), np.full((TS, TS), np.nan, dtype=np.float32))
            with np.errstate(all="ignore"):
                small = np.nanmean(a.reshape(TS // 2, 2, TS // 2, 2), axis=(1, 3))
            ox, oy = (x % 2) * (TS // 2), (y % 2) * (TS // 2)
            P[oy:oy + TS // 2, ox:ox + TS // 2] = small
        levels[zz] = parent
        shutil.rmtree(f"{OUT}/{zz}", ignore_errors=True)
        for (x, y), a in parent.items():
            os.makedirs(f"{OUT}/{zz}/{x}", exist_ok=True)
            Image.fromarray(enc(a), "RGBA").save(f"{OUT}/{zz}/{x}/{y}.png", optimize=True)
    json.dump({"z": Z, "tiles": sorted([f"{x}/{y}" for x, y in tiles]), "encoding": "terrarium",
               "overviews": {str(zz): sorted([f"{x}/{y}" for x, y in levels[zz]]) for zz in OVERVIEWS},
               "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "source": "WA Department of Transport — Composite Surfaces (Multibeam, LiDAR, Laser), DOT-022, CC BY 3.0 AU",
               "areas": meta}, open(f"{OUT}/index.json", "w"), separators=(",", ":"))
    tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(f"{OUT}/{Z}") for f in fs)
    print(f"wrote {len(tiles)} tiles, {tot/1e6:.1f} MB")

main()
