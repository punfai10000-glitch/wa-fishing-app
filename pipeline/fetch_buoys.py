"""Hourly: latest MEASURED wave parameters from WA Department of Transport waverider buoys.

Source: AODN THREDDS (near real-time, NOT quality controlled). DoT wave data licence: CC BY.
Output: buoys.json  ->  pushed by the workflow to the `live-data` branch (no history growth).
Usage: python pipeline/fetch_buoys.py OUTPUT_DIR
"""
import json, os, re, sys, tempfile, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

BASE = "https://thredds.aodn.org.au/thredds"
ROOT = "Department_of_Transport-Western_Australia/WAVE-BUOYS/REALTIME/WAVE-PARAMETERS"
NS = {"t": "http://www.unidata.ucar.edu/namespaces/thredds/InvCatalog/v1.0", "x": "http://www.w3.org/1999/xlink"}
UA = {"User-Agent": "wa-fishing-intelligence/0.3 (hourly buoy fetch)"}
# Perth to Esperance only
BOX = dict(lat_min=-35.5, lat_max=-28.3, lon_min=113.4, lon_max=124.5)
VARS = {  # IMOS wave parameter names; first match wins
    "hs": ["WSSH", "WHTH", "VAVH"], "tp": ["WPPE", "WPFM"], "dir": ["WPDI", "SSWMD", "WMDS"],
    "swell_h": ["SWSH"], "swell_p": ["SWPP"], "swell_dir": ["SWPD"],
    "sea_h": ["WWSH"], "sst": ["TEMP", "SST"],
}


def get(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read() if binary else r.read().decode()


def site_key(url_path):
    """Buoy identity from a dataset path. Folders are like .../<SITE>/<YEAR>/<file>.nc (or .../<YEAR>/<file>),
    so drop year/month folders and, if no site folder is left, strip dates/timestamps from the file name."""
    parts = url_path.split("/")
    fname = parts[-1]
    folders = [p for p in parts[:-1] if p and not re.fullmatch(r"\d{2,6}", p)]
    root_depth = len([p for p in ROOT.split("/") if p])
    if len(folders) > root_depth:
        return "/".join(folders[root_depth:])
    stem = re.sub(r"\.nc$", "", fname)
    stem = re.sub(r"\d{8}(T\d{4,6}Z?)?", "", stem)       # 20261124T180000Z
    stem = re.sub(r"(END|C)-?\d+", "", stem)              # END-..., C-20261125
    stem = re.sub(r"_?END-?$", "", re.sub(r"_+", "_", stem).strip("_"))
    return re.sub(r"_FV0\d", "", stem)  # FV00 / FV01 versions of the same buoy


def crawl(path, depth=0):
    """Yield (urlPath, name) of .nc datasets under a catalog path."""
    xml = ET.fromstring(get(f"{BASE}/catalog/{path}/catalog.xml"))
    for ds in xml.iter(f"{{{NS['t']}}}dataset"):
        up = ds.get("urlPath")
        if up and up.endswith(".nc"):
            yield up, ds.get("name", "")
    if depth < 3:
        for ref in xml.iter(f"{{{NS['t']}}}catalogRef"):
            href = ref.get(f"{{{NS['x']}}}href", "")
            if href.endswith("catalog.xml"):
                sub = href.rsplit("/catalog.xml", 1)[0]
                sub = sub if sub.startswith(ROOT) else f"{path}/{sub}"
                try:
                    yield from crawl(sub.strip("/"), depth + 1)
                except Exception as ex:
                    print("skip", sub, ex)


def latest_values(nc_path):
    from netCDF4 import Dataset, num2date
    with Dataset(nc_path) as ds:
        v = ds.variables
        tname = "TIME" if "TIME" in v else "time"
        times = v[tname]
        n = len(times)
        if n == 0:
            return None
        def last(names, i):
            for nm in names:
                if nm in v:
                    try:
                        val = v[nm][i]
                        val = float(val)
                        if val != val or abs(val) > 1e6:
                            return None
                        return round(val, 2)
                    except Exception:
                        return None
            return None
        # walk back to the newest row with a wave height
        for i in range(n - 1, max(-1, n - 48), -1):
            hs = last(VARS["hs"], i)
            if hs is not None:
                break
        t = num2date(times[i], times.units, only_use_cftime_datetimes=False, only_use_python_datetimes=True)
        t = t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t
        lat = float(v["LATITUDE"][i] if v["LATITUDE"].ndim else v["LATITUDE"][:]) if "LATITUDE" in v else None
        lon = float(v["LONGITUDE"][i] if v["LONGITUDE"].ndim else v["LONGITUDE"][:]) if "LONGITUDE" in v else None
        out = {k: last(names, i) for k, names in VARS.items()}
        out.update(time=t.isoformat(), lat=lat, lon=lon, site=getattr(ds, "site_name", None) or getattr(ds, "site_code", None))
        return out


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    files = list(crawl(ROOT))
    print("found", len(files), "files")
    # group by parent folder (site). A site has many files and the newest-sounding file name is not always the one
    # with the newest readings (that left some buoys a day old), so read the newest few and keep the latest reading.
    by_site = {}
    for up, name in files:
        by_site.setdefault(site_key(up), []).append((name, up))
    print("buoy sites:", len(by_site), sorted(by_site)[:40])
    buoys, cutoff = [], datetime.now(timezone.utc) - timedelta(days=3)
    for site, cands in sorted(by_site.items()):
        vals = None
        print(site, len(cands), "files, newest names:", [n for n, _ in sorted(cands, reverse=True)[:4]])
        for name, up in sorted(cands, reverse=True)[:4]:
            try:
                with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as tmp:
                    tmp.write(get(f"{BASE}/fileServer/{up}", binary=True))
                v = latest_values(tmp.name)
                os.unlink(tmp.name)
            except Exception as ex:
                print("fail", site, name, ex); continue
            if v and v["lat"] is not None and (vals is None or v["time"] > vals["time"]):
                vals = v
        if not vals or vals["lat"] is None:
            continue
        if not (BOX["lat_min"] <= vals["lat"] <= BOX["lat_max"] and BOX["lon_min"] <= vals["lon"] <= BOX["lon_max"]):
            continue
        if datetime.fromisoformat(vals["time"]) < cutoff:
            print("stale", site, vals["time"]); continue
        vals["site"] = vals["site"] or site.replace("_", " ")
        vals["lat"], vals["lon"] = round(vals["lat"], 4), round(vals["lon"], 4)
        buoys.append(vals)
        print("ok", site, vals)
    # same buoy can appear under two names: keep the newest reading per location
    best = {}
    for b in buoys:
        k = (round(b["lat"], 2), round(b["lon"], 2))
        if k not in best or b["time"] > best[k]["time"]:
            best[k] = b
    buoys = sorted(best.values(), key=lambda b: -b["lat"])
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "source": "WA Department of Transport wave buoys via AODN (near real-time, not quality controlled). CC BY.",
           "type": "measured", "buoys": buoys}
    if not buoys:   # keep last hour's file rather than publishing an empty one
        print("WARNING: no buoys this run — keeping the previous file"); return
    with open(os.path.join(outdir, "buoys.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", len(buoys), "buoys")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
