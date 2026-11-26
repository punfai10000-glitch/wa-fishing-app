"""Satellite water clarity (Kd490, light attenuation at 490 nm; lower = clearer) for the live-data branch.
Source: NOAA CoastWatch ERDDAP — gap-filled (DINEOF) multi-sensor VIIRS/OLCI Kd490, ~2 km, daily; falls back to
the VIIRS near-real-time product. Public domain (US Government). Output: out/clarity.json, a coarse grid
(every 2nd cell, ~4 km) for Perth -> Esperance.
"""
import json, os, sys, time, urllib.request
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
BOX = (-35.6, -31.0, 114.4, 124.5)   # lat min/max, lon min/max
DATASETS = [("https://coastwatch.noaa.gov/erddap", "noaacwNPPN20S3AkdSCIDINEOF2kmDaily"),
            ("https://coastwatch.pfeg.noaa.gov/erddap", "nesdisVHNkd490Daily")]

def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "wa-fishing-app"}), timeout=timeout) as r:
        return json.load(r)

def main():
    os.makedirs(OUT, exist_ok=True)
    for base, ds in DATASETS:
        try:
            info = get(f"{base}/info/{ds}/index.json")
            rows = info["table"]["rows"]
            dims = [r[1] for r in rows if r[0] == "dimension"]
            var = next(r[1] for r in rows if r[0] == "variable" and "kd" in r[1].lower())
            lat_desc = next((r[4] for r in rows if r[0] == "attribute" and r[1] == "latitude" and r[2] == "actual_range"), "")
            lo, hi = [float(v) for v in lat_desc.split(",")] if lat_desc else (-90, 90)
            latsel = f"({BOX[1]}):2:({BOX[0]})" if True else ""
            # ERDDAP wants the latitude range in the dataset's stored order (often north -> south)
            parts = []
            for d in dims:
                if d == "time": parts.append("[(last)]")
                elif d in ("altitude", "depth", "zlev", "level"): parts.append("[0]")
                elif d == "latitude": parts.append(f"[({BOX[1]}):2:({BOX[0]})]")
                elif d == "longitude": parts.append(f"[({BOX[2]}):2:({BOX[3]})]")
                else: parts.append("[0]")
            q = f"{base}/griddap/{ds}.json?{var}{''.join(parts)}"
            try:
                d = get(q, 240)
            except Exception:   # latitude stored south -> north
                q = q.replace(f"({BOX[1]}):2:({BOX[0]})", f"({BOX[0]}):2:({BOX[1]})"); d = get(q, 240)
            cols = d["table"]["columnNames"]; R = d["table"]["rows"]
            it, ila, ilo, iv = cols.index("time"), cols.index("latitude"), cols.index("longitude"), cols.index(var)
            lats = sorted({r[ila] for r in R}); lons = sorted({r[ilo] for r in R})
            li = {v: i for i, v in enumerate(lats)}; lj = {v: i for i, v in enumerate(lons)}
            grid = [None] * (len(lats) * len(lons))
            for r in R:
                v = r[iv]
                if v is None or not (0 < v < 10): continue
                grid[li[r[ila]] * len(lons) + lj[r[ilo]]] = round(v, 3)
            n = sum(1 for g in grid if g is not None)
            print(ds, R[0][it], len(lats), "x", len(lons), "valid", n)
            if n < 200: continue
            json.dump({"generated_at": int(time.time() * 1000), "date": R[0][it], "dataset": ds, "source": f"NOAA CoastWatch ERDDAP {ds}",
                       "lat0": lats[0], "lon0": lons[0], "dlat": (lats[-1] - lats[0]) / (len(lats) - 1), "dlon": (lons[-1] - lons[0]) / (len(lons) - 1),
                       "ny": len(lats), "nx": len(lons), "kd490": grid}, open(f"{OUT}/clarity.json", "w"), separators=(",", ":"))
            return
        except Exception as e:
            print(ds, "failed:", e)
    sys.exit(1)

main()
