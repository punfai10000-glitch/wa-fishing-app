"""Fill the gaps in the Seamap seabed habitat map within ~1 km of the shore, Perth -> Esperance.

Seamap (data/habitat) only covers surveyed areas. Where it has no data, this estimates the bottom type from the
EOxCloudless 2024 Sentinel-2 photo mosaic: a small classifier is trained on the pixels where Seamap DOES know the answer
(sand / seagrass / reef & weed) and applied to the unmapped water within 1 km of the shore. Only confident pixels are
kept, and only where the bottom can plausibly be seen (not surf, not deep water when depth is known).

Output: data/habitat-est/{z}/{x}/{y}.png (z14 + z13 overview) + index.json (tile list, accuracy on held-out tiles).
Licence: derived from EOxCloudless 2024 (CC BY-NC-SA 4.0, contains modified Copernicus Sentinel data) and Seamap
Australia (CC BY 4.0) — so this layer is CC BY-NC-SA 4.0.
"""
import concurrent.futures as cf, io, json, math, os, random, shutil, sys, time, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

Z = 14
REGION = (113.4, -35.6, 124.5, -28.3)
MAX_M = 1000
OUT = "data/habitat-est"
S2 = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"
CLASSES = ["sand", "seagrass", "reef"]
COLORS = {0: (255, 249, 165), 1: (2, 220, 0), 2: (140, 40, 20)}   # same family as the Seamap legend (sand, seagrass, reef)
SEAMAP = {(255, 249, 165): 0, (2, 220, 0): 1, (45, 150, 36): 2, (100, 0, 0): 2, (204, 102, 0): 2}


def tile_xy(lon, lat, z):
    n = 2 ** z
    return ((lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def px_lonlat(x, y, z, size=256):
    n = 2 ** z
    j, i = np.meshgrid(np.arange(size) + 0.5, np.arange(size) + 0.5)
    lon = (x + j / size) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + i / size) / n))))
    return lon, lat


def coast_points():
    c = json.load(open("data/coastline.json"))
    pts, dirs = [], []
    for ln in c["lines"]:
        for (x1, y1), (x2, y2) in zip(ln, ln[1:]):
            if not (REGION[0] - .1 < x1 < REGION[2] + .1 and REGION[1] - .1 < y1 < REGION[3] + .1):
                continue
            k = math.cos(math.radians(y1))
            L = math.hypot((x2 - x1) * k, y2 - y1) * 111320
            n = max(1, int(L / 60))
            for t in np.linspace(0, 1, n, endpoint=False):
                pts.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)); dirs.append(((x2 - x1) * k, y2 - y1))
    return np.array(pts), np.array(dirs)


def candidate_tiles(P, D):
    # points ~0, 500 and 1000 m to the sea side (land is on the left of the line direction)
    tiles = set()
    nrm = np.c_[D[:, 1], -D[:, 0]]
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-12
    for m in (0, 500, 1000):
        k = np.cos(np.radians(P[:, 1]))
        lon = P[:, 0] + nrm[:, 0] * m / 111320 / k
        lat = P[:, 1] + nrm[:, 1] * m / 111320
        for a, b in zip(lon[::3], lat[::3]):
            x, y = tile_xy(a, b, Z); tiles.add((int(x), int(y)))
    return sorted(tiles)


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "wa-fishing-app (github.com/punfai10000-glitch/wa-fishing-app)"}), timeout=60) as r:
                return r.read()
        except Exception as e:
            if getattr(e, "code", None) == 404:
                return None
            time.sleep(2 * (i + 1))
    return None


def seamap_labels(x, y):
    """Seamap class per z14 pixel from the repo's z13 habitat tile (-1 = unknown)."""
    f = f"data/habitat/13/{x // 2}/{y // 2}.png"
    if not os.path.exists(f):
        return None
    im = np.asarray(Image.open(f).convert("RGBA"))
    sub = im[(y % 2) * 128:(y % 2) * 128 + 128, (x % 2) * 128:(x % 2) * 128 + 128]
    sub = sub.repeat(2, 0).repeat(2, 1)
    lab = np.full((256, 256), -1, np.int8)
    rgb = sub[..., :3].astype(int); a = sub[..., 3]
    for col, c in SEAMAP.items():
        lab[(np.abs(rgb - np.array(col)).sum(2) < 30) & (a > 128)] = c
    known = (a > 128)
    return lab, known


def depth_m(x, y):
    f = f"data/depth/{Z}/{x}/{y}.png"
    if not os.path.exists(f):
        return None
    d = np.asarray(Image.open(f).convert("RGBA")).astype(float)
    v = d[..., 0] * 256 + d[..., 1] + d[..., 2] / 256 - 32768
    v[d[..., 3] < 128] = np.nan
    return -v   # positive = depth below datum


def features(rgb, dist, dep):
    R, G, B = [rgb[..., i].astype(float) for i in range(3)]
    L = (R + G + B) / 3
    f = [R, G, B, L, G - B, B - R, R - G]
    for s in (5, 15, 31):
        m = ndimage.uniform_filter(L, s); f.append(m); f.append(L - m)
        f.append(np.sqrt(np.maximum(ndimage.uniform_filter(L * L, s) - m * m, 0)))
    for ch in (G - B, B - R):
        f.append(ndimage.uniform_filter(ch, 15))
    f.append(dist)
    f.append(dep if dep is not None else np.full(L.shape, np.nan))
    return np.stack(f, -1).reshape(-1, len(f))


def prep(t, tree, P, D):
    x, y = t
    raw = get(S2.format(z=Z, x=x, y=y))
    if not raw:
        return None
    rgb = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
    lon, lat = px_lonlat(x, y, Z)
    k = np.cos(np.radians(lat))
    q = np.c_[(lon * k).ravel(), lat.ravel()]
    d, i = tree.query(q)
    dist = (d * 111320).reshape(256, 256)
    cp = P[i]; dr = D[i]
    vx = (lon.ravel() - cp[:, 0]) * k.ravel(); vy = lat.ravel() - cp[:, 1]
    sea = ((dr[:, 0] * vy - dr[:, 1] * vx) < 0).reshape(256, 256)   # right of the line = sea
    sea &= dist <= MAX_M
    L = rgb.mean(2)
    sea &= L < 225   # breaking waves / glare: can't see the bottom
    if sea.sum() < 50:
        return None
    dep = depth_m(x, y)
    sm = seamap_labels(x, y)
    return dict(t=t, rgb=rgb, sea=sea, dist=dist, dep=dep, sm=sm)


def main():
    t0 = time.time()
    P, D = coast_points()
    tree = cKDTree(np.c_[P[:, 0] * np.cos(np.radians(P[:, 1])), P[:, 1]])
    tiles = candidate_tiles(P, D)
    limit = int(os.environ.get("LIMIT", "0") or 0)
    if limit: random.seed(1); tiles = random.sample(tiles, min(limit, len(tiles)))
    print(f"{len(tiles)} candidate z{Z} tiles, coast points {len(P)}", flush=True)
    data = []
    with cf.ThreadPoolExecutor(12) as ex:
        for n, r in enumerate(ex.map(lambda t: prep(t, tree, P, D), tiles)):
            if r: data.append(r)
            if n % 500 == 0: print(f"  fetched {n}/{len(tiles)} ({time.time() - t0:.0f}s)", flush=True)
    print(f"{len(data)} tiles with sea within {MAX_M} m", flush=True)

    # ---- training data from pixels Seamap already knows (eroded so edges/misregistration don't count)
    rng = np.random.default_rng(0)
    Xs, ys, gs = [], [], []
    for gi, r in enumerate(data):
        if r["sm"] is None: continue
        lab, known = r["sm"]
        F = None
        for c in range(3):
            m = ndimage.binary_erosion(lab == c, iterations=3) & r["sea"]
            idx = np.flatnonzero(m.ravel())
            if len(idx) < 20: continue
            if F is None: F = features(r["rgb"], r["dist"], r["dep"])
            pick = rng.choice(idx, min(300, len(idx)), replace=False)
            Xs.append(F[pick]); ys.append(np.full(len(pick), c)); gs.append(np.full(len(pick), gi))
    if not Xs:
        print("no training data"); return
    X = np.concatenate(Xs); y = np.concatenate(ys); g = np.concatenate(gs)
    print("training pixels per class:", {CLASSES[c]: int((y == c).sum()) for c in range(3)}, flush=True)
    from sklearn.ensemble import HistGradientBoostingClassifier
    groups = np.unique(g); rng.shuffle(groups)
    test_g = set(groups[: max(1, len(groups) // 5)].tolist())
    te = np.array([v in test_g for v in g])
    clf = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, max_leaf_nodes=31, class_weight="balanced")
    clf.fit(X[~te], y[~te])
    pr = clf.predict_proba(X[te]); pred = pr.argmax(1); conf = pr.max(1) >= 0.7
    acc_all = float((pred == y[te]).mean()); acc_conf = float((pred[conf] == y[te][conf]).mean()) if conf.any() else 0
    cm = np.zeros((3, 3), int)
    for a, b in zip(y[te][conf], pred[conf]): cm[a, b] += 1
    print(f"held-out tiles: accuracy {acc_all:.2f} (all), {acc_conf:.2f} on the {conf.mean():.0%} kept as confident", flush=True)
    print("confusion (rows = Seamap, cols = estimate) sand/seagrass/reef:\n", cm, flush=True)
    # light vs dark bottom is what matters most for fishing/diving
    lt = (y[te][conf] == 0); lp = (pred[conf] == 0)
    acc_ld = float((lt == lp).mean()) if conf.any() else 0
    print(f"sand vs not-sand on confident pixels: {acc_ld:.2f}", flush=True)
    clf.fit(X, y)

    # ---- predict the unmapped water and write tiles
    if os.path.exists(OUT): shutil.rmtree(OUT)
    written = {Z: [], Z - 1: []}
    z13 = {}
    for r in data:
        x, yy = r["t"]
        need = r["sea"].copy()
        if r["sm"] is not None: need &= ~ndimage.binary_dilation(r["sm"][1], iterations=2)
        if r["dep"] is not None: need &= ~(r["dep"] > 20)   # deeper than ~20 m: the photo can't see the bottom
        if need.sum() < 30: continue
        F = features(r["rgb"], r["dist"], r["dep"])
        idx = np.flatnonzero(need.ravel())
        pr = clf.predict_proba(F[idx])
        cls = np.full(256 * 256, -1, np.int8)
        ok = pr.max(1) >= 0.7
        cls[idx[ok]] = pr.argmax(1)[ok]
        cls = cls.reshape(256, 256)
        # tidy: majority filter, drop specks
        out = np.full((256, 256), -1, np.int8)
        for c in range(3):
            m = ndimage.uniform_filter((cls == c).astype(float), 5) > 0.45
            m = ndimage.binary_opening(m, iterations=1)
            lab, n = ndimage.label(m)
            if n:
                sizes = ndimage.sum(m, lab, range(1, n + 1))
                m &= np.isin(lab, np.flatnonzero(sizes >= 40) + 1)
            out[m & (out < 0) & need] = c
        if (out >= 0).sum() < 30: continue
        img = np.zeros((256, 256, 4), np.uint8)
        jj, ii = np.meshgrid(np.arange(256), np.arange(256))
        dots = ((ii // 2 + jj // 2) % 2 == 0)   # checker texture = "estimated"
        for c, col in COLORS.items():
            m = out == c
            img[m, :3] = col
            img[m, 3] = np.where(dots[m], 215, 110)
        os.makedirs(f"{OUT}/{Z}/{x}", exist_ok=True)
        Image.fromarray(img, "RGBA").quantize(16, method=Image.FASTOCTREE).save(f"{OUT}/{Z}/{x}/{yy}.png", optimize=True)
        written[Z].append(f"{x}/{yy}")
        k = (x // 2, yy // 2)
        z13.setdefault(k, np.zeros((512, 512, 4), np.uint8))[(yy % 2) * 256:(yy % 2) * 256 + 256, (x % 2) * 256:(x % 2) * 256 + 256] = img
    for (x, yy), big in z13.items():
        small = np.asarray(Image.fromarray(big, "RGBA").resize((256, 256), Image.NEAREST))
        os.makedirs(f"{OUT}/{Z - 1}/{x}", exist_ok=True)
        Image.fromarray(small, "RGBA").quantize(16, method=Image.FASTOCTREE).save(f"{OUT}/{Z - 1}/{x}/{yy}.png", optimize=True)
        written[Z - 1].append(f"{x}/{yy}")
    json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "z": Z, "max_m": MAX_M,
               "tiles": {str(k): v for k, v in written.items()},
               "accuracy": {"held_out_all": round(acc_all, 3), "held_out_confident": round(acc_conf, 3), "sand_vs_not": round(acc_ld, 3), "kept_share": round(float(conf.mean()), 3)},
               "classes": CLASSES,
               "source": "Estimated from EOxCloudless 2024 (Sentinel-2) with a classifier trained on Seamap Australia; CC BY-NC-SA 4.0"},
              open(f"{OUT}/index.json", "w"), separators=(",", ":"))
    print(f"wrote {len(written[Z])} z{Z} + {len(written[Z - 1])} z{Z - 1} tiles in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
