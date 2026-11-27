"""Satellite water clarity (Kd490, light attenuation at 490 nm; lower = clearer) for the live-data branch.
Source: NOAA CoastWatch ERDDAP, public domain (US Government). Takes the last 6 days of the near-real-time
VIIRS products and keeps the most recent cloud-free value per cell (~4 km grid), Perth -> Esperance.
The gap-filled DINEOF product is used only if it is recent. Output: out/clarity.json.
If the GitHub secrets EARTHDATA_USER / EARTHDATA_PASS are set, NASA OB.DAAC's near-real-time VIIRS (NOAA-20 and
NOAA-21) Kd490 4 km daily maps are tried too (usually 1-2 days old instead of NOAA ERDDAP's 1-3 weeks); NASA data
are free to use with credit to NASA OB.DAAC. The freshest source wins.
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timezone
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
BOX = (-35.6, -28.3, 113.4, 124.5)   # lat min/max, lon min/max
STEP = 0.04
DATASETS = [("https://coastwatch.noaa.gov/erddap", "noaacwNPPN20VIIRSkd490Daily", 6),
            ("https://coastwatch.pfeg.noaa.gov/erddap", "nesdisVHNkd490Daily", 6),
            ("https://coastwatch.noaa.gov/erddap", "noaacwNPPN20S3AkdSCIDINEOF2kmDaily", 1)]

def get(url, timeout=180):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "wa-fishing-app"}), timeout=timeout) as r:
        return json.load(r)

def fetch(base, ds, days):
    info = get(f"{base}/info/{ds}/index.json")["table"]["rows"]
    dims = [r[1] for r in info if r[0] == "dimension"]
    var = next(r[1] for r in info if r[0] == "variable" and "kd" in r[1].lower())
    def spacing(name):
        row = next((r for r in info if r[0] == "dimension" and r[1] == name), None)
        m = re.search(r"averageSpacing=(-?[\d.eE+-]+)", row[4] if row else "")
        return float(m.group(1)) if m else STEP
    out = None
    for lat_order in ((BOX[1], BOX[0]), (BOX[0], BOX[1])):
        parts = []
        for d in dims:
            if d == "time": parts.append(f"[last-{days - 1}:1:last]" if days > 1 else "[last]")
            elif d == "latitude": parts.append(f"[({lat_order[0]}):{max(1, round(STEP / abs(spacing('latitude'))))}:({lat_order[1]})]")
            elif d == "longitude": parts.append(f"[({BOX[2]}):{max(1, round(STEP / abs(spacing('longitude'))))}:({BOX[3]})]")
            else: parts.append("[0]")
        try:
            out = get(f"{base}/griddap/{ds}.json?{var}{''.join(parts)}"); break
        except Exception as e:
            print("  try other latitude order:", e)
    if not out: return None
    cols = out["table"]["columnNames"]; rows = out["table"]["rows"]
    it, ila, ilo, iv = cols.index("time"), cols.index("latitude"), cols.index("longitude"), cols.index(var)
    lats = sorted({r[ila] for r in rows}); lons = sorted({r[ilo] for r in rows})
    li = {v: i for i, v in enumerate(lats)}; lj = {v: i for i, v in enumerate(lons)}
    grid, when = [None] * (len(lats) * len(lons)), [None] * (len(lats) * len(lons))
    for r in sorted(rows, key=lambda r: r[it]):   # later days overwrite earlier ones
        v = r[iv]
        if v is None or not (0 < v < 10): continue
        k = li[r[ila]] * len(lons) + lj[r[ilo]]
        grid[k] = round(v, 3); when[k] = r[it]
    valid = [w for w in when if w]
    if len(valid) < 300: return None
    newest = max(valid); valid.sort()
    return {"date": valid[len(valid) // 2], "newest": newest, "dataset": ds, "source": f"NOAA CoastWatch ERDDAP {ds}",
            "lat0": lats[0], "lon0": lons[0], "dlat": (lats[-1] - lats[0]) / (len(lats) - 1), "dlon": (lons[-1] - lons[0]) / (len(lons) - 1),
            "ny": len(lats), "nx": len(lons), "kd490": grid, "valid": len(valid)}

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"

def fetch_nasa(days=5):
    user, pw = os.environ.get("EARTHDATA_USER"), os.environ.get("EARTHDATA_PASS")
    if not user or not pw:
        print("NASA: EARTHDATA_USER / EARTHDATA_PASS not set - skipped"); return None
    import requests, netCDF4, numpy as np, tempfile
    # .netrc lets requests log in again on each redirect host (urs.earthdata.nasa.gov) without leaking the password elsewhere
    netrc = os.path.expanduser("~/.netrc")
    with open(netrc, "w") as f: f.write(f"machine urs.earthdata.nasa.gov login {user} password {pw}\n")
    os.chmod(netrc, 0o600)
    since = datetime.fromtimestamp(time.time() - days * 86400, timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    files = []
    for sn in ("VIIRSJ1_L3m_KD_NRT", "VIIRSJ2_L3m_KD_NRT"):
        r = requests.get(CMR, params={"short_name": sn, "temporal": f"{since},", "page_size": 50, "sort_key": "start_date"}, timeout=60).json()
        for e in r["feed"]["entry"]:
            gid = e.get("producer_granule_id", "")
            if ".DAY." in gid and ".4km." in gid:
                href = next((l["href"] for l in e["links"] if l["href"].endswith(".nc") and l["href"].startswith("https")), None)
                if href: files.append((e["time_start"], gid, href))
    files.sort()
    print("NASA granules:", [g for _, g, _ in files])
    if not files: return None
    lat_ax = lon_ax = grid = when = None
    s = requests.Session()
    for t0, gid, href in files:                      # oldest first: later days overwrite earlier ones
        try:
            resp = s.get(href, timeout=300)
            if resp.status_code != 200 or resp.content[:4] not in (b"\x89HDF", b"CDF\x01", b"CDF\x02"):
                print("  ", gid, "download failed", resp.status_code, resp.url[:80]); continue
            with tempfile.NamedTemporaryFile(suffix=".nc") as tmp:
                tmp.write(resp.content); tmp.flush()
                nc = netCDF4.Dataset(tmp.name)
                lat, lon = nc["lat"][:], nc["lon"][:]
                ia = np.where((lat >= BOX[0]) & (lat <= BOX[1]))[0]; io = np.where((lon >= BOX[2]) & (lon <= BOX[3]))[0]
                kd = nc["Kd_490"][ia.min():ia.max() + 1, io.min():io.max() + 1]
                la, lo = lat[ia.min():ia.max() + 1], lon[io.min():io.max() + 1]
                nc.close()
            if la[0] > la[-1]: kd, la = kd[::-1], la[::-1]
            kd = np.ma.filled(kd.astype("f4"), np.nan)
            if grid is None:
                lat_ax, lon_ax = la, lo
                grid = np.full(kd.shape, np.nan, "f4"); when = np.full(kd.shape, "", object)
            ok = np.isfinite(kd) & (kd > 0) & (kd < 10)
            grid[ok] = kd[ok]; when[ok] = t0
            print("  ", gid, "cells", int(ok.sum()))
        except Exception as ex:
            print("  ", gid, "failed:", ex)
    os.remove(netrc)
    if grid is None: return None
    valid = sorted(w for w in when.ravel() if w)
    if len(valid) < 300: return None
    vals = [None if not np.isfinite(v) else round(float(v), 3) for v in grid.ravel()]
    return {"date": valid[len(valid) // 2], "newest": valid[-1], "dataset": "NASA VIIRS NOAA-20/21 L3m Kd490 4km NRT",
            "source": "NASA OB.DAAC VIIRS NOAA-20/NOAA-21 near-real-time Kd490 (4 km daily)",
            "lat0": float(lat_ax[0]), "lon0": float(lon_ax[0]), "dlat": float((lat_ax[-1] - lat_ax[0]) / (len(lat_ax) - 1)),
            "dlon": float((lon_ax[-1] - lon_ax[0]) / (len(lon_ax) - 1)), "ny": len(lat_ax), "nx": len(lon_ax), "kd490": vals, "valid": len(valid)}

FINE_D = 0.01            # ~1 km cells (VIIRS level-2 pixels are ~750 m)
FINE_KM = 12             # only near the coast (offshore water isn't useful from the shore)
BAD_FLAGS = {"ATMFAIL", "LAND", "HIGLINT", "HILT", "HISATZEN", "CLDICE", "HISOLZEN", "NAVFAIL", "MAXAERITER", "LOWLW", "ATMWARN"}

def coast_mask(lat0, lon0, ny, nx):
    import numpy as np
    pts = json.load(open(os.path.join(os.path.dirname(__file__), "..", "data", "coast.json")))["points"]
    m = np.zeros((ny, nx), bool)
    ri = int(FINE_KM / 111 / FINE_D) + 1
    for p in pts:
        i0, j0 = int((p["lat"] - lat0) / FINE_D), int((p["lng"] - lon0) / FINE_D)
        k = np.cos(np.radians(p["lat"]))
        rj = int(ri / max(k, 0.5)) + 1
        ii, jj = np.mgrid[max(0, i0 - ri):min(ny, i0 + ri + 1), max(0, j0 - rj):min(nx, j0 + rj + 1)]
        d = np.hypot((ii - i0) * FINE_D * 111, (jj - j0) * FINE_D * 111 * k)
        m[ii[d <= FINE_KM], jj[d <= FINE_KM]] = True
    return m

def fetch_fine(days=3):
    """~1 km Kd490 near the coast from NASA's VIIRS level-2 swaths (NOAA-20 and NOAA-21), newest clear pixel per cell."""
    user, pw = os.environ.get("EARTHDATA_USER"), os.environ.get("EARTHDATA_PASS")
    if not user or not pw: return None
    import requests, netCDF4, numpy as np, tempfile
    netrc = os.path.expanduser("~/.netrc")
    with open(netrc, "w") as f: f.write(f"machine urs.earthdata.nasa.gov login {user} password {pw}\n")
    os.chmod(netrc, 0o600)
    since = datetime.fromtimestamp(time.time() - days * 86400, timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    files = []
    for sn in ("VIIRSJ1_L2_OC_NRT", "VIIRSJ2_L2_OC_NRT"):
        r = requests.get(CMR, params={"short_name": sn, "temporal": f"{since},", "bounding_box": f"{BOX[2]},{BOX[0]},{BOX[3]},{BOX[1]}",
                                      "page_size": 50, "sort_key": "start_date"}, timeout=60).json()
        for e in r["feed"]["entry"]:
            href = next((l["href"] for l in e["links"] if l["href"].endswith(".nc") and l["href"].startswith("https")), None)
            if href: files.append((e["time_start"], e["producer_granule_id"], href))
    files.sort()
    print("NASA L2 granules:", len(files))
    lat0, lon0 = BOX[0], BOX[2]
    ny, nx = int((BOX[1] - BOX[0]) / FINE_D) + 1, int((BOX[3] - BOX[2]) / FINE_D) + 1
    mask = coast_mask(lat0, lon0, ny, nx)
    kd = np.full(ny * nx, np.nan, "f4"); when = np.zeros(ny * nx, "f8")
    s = requests.Session()
    for t0, gid, href in files:                      # oldest first: newer passes overwrite
        try:
            resp = s.get(href, timeout=600)
            if resp.status_code != 200 or resp.content[:4] != b"\x89HDF":
                print("  ", gid, "download failed", resp.status_code); continue
            with tempfile.NamedTemporaryFile(suffix=".nc") as tmp:
                tmp.write(resp.content); tmp.flush()
                nc = netCDF4.Dataset(tmp.name)
                g, nav = nc["geophysical_data"], nc["navigation_data"]
                fl = g["l2_flags"]
                names, masks = fl.flag_meanings.split(), np.atleast_1d(fl.flag_masks)
                bad = 0
                for n, mk in zip(names, masks):
                    if n in BAD_FLAGS: bad |= int(mk)
                v = np.ma.filled(g["Kd_490"][:].astype("f4"), np.nan)
                ok = np.isfinite(v) & (v > 0) & (v < 10) & ((np.asarray(fl[:]).astype("i8") & bad) == 0)
                la, lo = nav["latitude"][:][ok], nav["longitude"][:][ok]; v = v[ok]
                nc.close()
            i = ((la - lat0) / FINE_D).astype(int); j = ((lo - lon0) / FINE_D).astype(int)
            inb = (i >= 0) & (i < ny) & (j >= 0) & (j < nx)
            i, j, v = i[inb], j[inb], v[inb]
            keep = mask[i, j]; idx = (i * nx + j)[keep]; v = v[keep]
            if not idx.size: print("  ", gid, "no coastal cells"); continue
            sums = np.bincount(idx, v, ny * nx); cnt = np.bincount(idx, None, ny * nx)
            got = cnt > 0
            kd[got] = sums[got] / cnt[got]; when[got] = datetime.fromisoformat(t0.replace("Z", "+00:00")).timestamp()
            print("  ", gid, "coastal cells", int(got.sum()))
        except Exception as ex:
            print("  ", gid, "failed:", ex)
    try: os.remove(netrc)
    except OSError: pass
    have = np.where(np.isfinite(kd))[0]
    if have.size < 500: return None
    newest = when[have].max()
    return {"lat0": lat0, "lon0": lon0, "d": FINE_D, "ny": ny, "nx": nx, "idx": have.tolist(),
            "kd": [round(float(x), 3) for x in kd[have]], "age_h": [int(round((newest - w) / 3600)) for w in when[have]],
            "newest": datetime.fromtimestamp(newest, timezone.utc).isoformat(timespec="seconds"),
            "source": "NASA OB.DAAC VIIRS NOAA-20/NOAA-21 level-2 near-real-time Kd490 (~750 m pixels, binned to ~1 km)"}

def main():
    os.makedirs(OUT, exist_ok=True)
    # NASA maps change once a day: if the published file is NASA's and under 6 h old, keep it (saves ~150 MB of downloads an hour)
    try:
        prev = json.load(open(f"{OUT}/clarity.json"))
        if prev.get("dataset", "").startswith("NASA") and prev.get("fine") and time.time() * 1000 - prev.get("generated_at", 0) < 6 * 3600e3:
            print("clarity: NASA file from", prev["newest"], "is recent - kept"); return
    except Exception:
        pass
    best = None
    try:
        r = fetch_nasa()
        if r: print("NASA median date", r["date"], "newest", r["newest"], "valid", r["valid"]); best = r
    except Exception as e:
        print("NASA failed:", e)
    for base, ds, days in DATASETS:
        try:
            r = fetch(base, ds, days)
        except Exception as e:
            print(ds, "failed:", e); continue
        if not r: print(ds, "no usable data"); continue
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(r["newest"].replace("Z", "+00:00"))).days
        print(ds, "median date", r["date"], "newest", r["newest"], "valid", r["valid"], "age days", age)
        # the satellite services sometimes lag by a week or two: keep the freshest one up to 30 days old
        if age <= 30 and (not best or r["newest"] > best["newest"]): best = r
    if not best: sys.exit(1)
    try:
        fine = fetch_fine()
        if fine: best["fine"] = fine; print("fine cells", len(fine["idx"]), "newest", fine["newest"])
    except Exception as e:
        print("NASA level-2 failed:", e)
    best["generated_at"] = int(time.time() * 1000)
    json.dump(best, open(f"{OUT}/clarity.json", "w"), separators=(",", ":"))

main()
