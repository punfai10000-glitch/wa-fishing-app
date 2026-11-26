"""Satellite water clarity (Kd490, light attenuation at 490 nm; lower = clearer) for the live-data branch.
Source: NOAA CoastWatch ERDDAP, public domain (US Government). Takes the last 6 days of the near-real-time
VIIRS products and keeps the most recent cloud-free value per cell (~4 km grid), Perth -> Esperance.
The gap-filled DINEOF product is used only if it is recent. Output: out/clarity.json.
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timezone
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
BOX = (-35.6, -31.0, 114.4, 124.5)   # lat min/max, lon min/max
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

def main():
    os.makedirs(OUT, exist_ok=True)
    best = None
    for base, ds, days in DATASETS:
        try:
            r = fetch(base, ds, days)
        except Exception as e:
            print(ds, "failed:", e); continue
        if not r: print(ds, "no usable data"); continue
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(r["newest"].replace("Z", "+00:00"))).days
        print(ds, "median date", r["date"], "newest", r["newest"], "valid", r["valid"], "age days", age)
        if age <= 4 and (not best or r["valid"] > best["valid"] * 0.7 and r["newest"] >= best["newest"]): best = r
        if best and age <= 2: break
    if not best: sys.exit(1)
    best["generated_at"] = int(time.time() * 1000)
    json.dump(best, open(f"{OUT}/clarity.json", "w"), separators=(",", ":"))

main()
