"""Seabed habitat map tiles (Seamap Australia national benthic habitat layer, CC BY 4.0) pre-rendered for the
Perth -> Esperance coast so the app loads them from GitHub Pages instead of a slow map server in Tasmania.
Output: data/habitat/{z}/{x}/{y}.png (z8-z13, only tiles near the coast that contain habitat) + index.json.
"""
import concurrent.futures as cf, io, json, math, os, shutil, sys, time, urllib.request
from PIL import Image

WMS = ("https://geoserver.imas.utas.edu.au/geoserver/seamap/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png"
       "&TRANSPARENT=true&LAYERS=seamap:SeamapAus_National_Benthic_Habitat_Layer&STYLES=&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX=")
OUT = "data/habitat"
LEVELS = [(8, 40), (9, 40), (10, 35), (11, 30), (12, 25), (13, 12)]   # zoom, km either side of the coast
R = 6378137.0

def tile(lon, lat, z):
    n = 2 ** z; x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y
def bbox(x, y, z):
    n = 2 ** z; s = 2 * math.pi * R / n; o = math.pi * R
    return f"{x*s-o:.2f},{o-(y+1)*s:.2f},{(x+1)*s-o:.2f},{o-y*s:.2f}"

def fetch(job):
    z, x, y = job
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(WMS + bbox(x, y, z), headers={"User-Agent": "wa-fishing-app"}), timeout=90) as r:
                data = r.read()
            im = Image.open(io.BytesIO(data)).convert("RGBA")
            if im.getextrema()[3][1] == 0: return job, None          # fully transparent: no habitat mapped here
            buf = io.BytesIO(); im.quantize(colors=64, method=Image.Quantize.FASTOCTREE).save(buf, "PNG", optimize=True)
            return job, buf.getvalue()
        except Exception as e:
            time.sleep(3 * (a + 1))
    return job, "fail"

def main():
    pts = json.load(open("data/coast.json"))["points"]
    jobs = []
    for z, km in LEVELS:
        s = set()
        for p in pts:
            la, lo = p["lat"], p["lng"]; d = km / 111; dl = km / (111 * math.cos(math.radians(la)))
            x0, y0 = tile(lo - dl, la + d, z); x1, y1 = tile(lo + dl, la - d, z)
            for x in range(int(x0), int(x1) + 1):
                for y in range(int(y0), int(y1) + 1): s.add((z, x, y))
        jobs += sorted(s)
    print(len(jobs), "tiles to check")
    tmp = OUT + "_new"; shutil.rmtree(tmp, ignore_errors=True)
    have, fails = {}, 0
    with cf.ThreadPoolExecutor(10) as ex:
        for i, (job, data) in enumerate(ex.map(fetch, jobs)):
            if data == "fail": fails += 1; continue
            if data is None: continue
            z, x, y = job
            os.makedirs(f"{tmp}/{z}/{x}", exist_ok=True)
            open(f"{tmp}/{z}/{x}/{y}.png", "wb").write(data)
            have.setdefault(z, []).append(f"{x}/{y}")
            if i % 500 == 0: print(i, "done", flush=True)
    n = sum(len(v) for v in have.values())
    print("tiles with habitat:", n, "failed:", fails)
    if n < 200 or fails > len(jobs) * 0.05:
        print("Too many failures — keeping the existing tiles."); sys.exit(1)
    json.dump({"tiles": {str(z): sorted(v) for z, v in have.items()}, "max_zoom": max(have), "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "source": "Seamap Australia National Benthic Habitat Layer (IMAS, University of Tasmania), CC BY 4.0"}, open(f"{tmp}/index.json", "w"), separators=(",", ":"))
    shutil.rmtree(OUT, ignore_errors=True); os.rename(tmp, OUT)
    tot = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print(f"wrote {n} tiles, {tot/1e6:.1f} MB")

main()
