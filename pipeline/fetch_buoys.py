"""Hourly: latest MEASURED wave parameters from WA Department of Transport waverider buoys.

Source: AODN THREDDS (near real-time, NOT quality controlled). DoT wave data licence: CC BY.
Output: buoys.json  ->  pushed by the workflow to the `live-data` branch (no history growth).
Usage: python pipeline/fetch_buoys.py OUTPUT_DIR
"""
import json, os, sys, tempfile, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

BASE = "https://thredds.aodn.org.au/thredds"
ROOT = "Department_of_Transport-Western_Australia/WAVE-BUOYS/REALTIME/WAVE-PARAMETERS"
NS = {"t": "http://www.unidata.ucar.edu/namespaces/thredds/InvCatalog/v1.0", "x": "http://www.w3.org/1999/xlink"}
UA = {"User-Agent": "wa-fishing-intelligence/0.3 (hourly buoy fetch)"}
# Perth to Esperance only
BOX = dict(lat_min=-35.5, lat_max=-31.3, lon_min=114.5, lon_max=123.0)
VARS = {  # IMOS wave parameter names; first match wins
    "hs": ["WSSH", "WHTH", "VAVH"], "tp": ["WPPE", "WPFM"], "dir": ["WPDI", "SSWMD", "WMDS"],
    "swell_h": ["SWSH"], "swell_p": ["SWPP"], "swell_dir": ["SWPD"],
    "sea_h": ["WWSH"], "sst": ["TEMP", "SST"],
}


def get(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read() if binary else r.read().decode()


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
    # group by parent folder (site) and keep the newest file name per site
    by_site = {}
    for up, name in files:
        site = up.split("/")[-2]
        if site not in by_site or name > by_site[site][1]:
            by_site[site] = (up, name)
    buoys, cutoff = [], datetime.now(timezone.utc) - timedelta(days=3)
    for site, (up, name) in sorted(by_site.items()):
        try:
            with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as tmp:
                tmp.write(get(f"{BASE}/fileServer/{up}", binary=True))
            vals = latest_values(tmp.name)
            os.unlink(tmp.name)
        except Exception as ex:
            print("fail", site, ex); continue
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
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "source": "WA Department of Transport wave buoys via AODN (near real-time, not quality controlled). CC BY.",
           "type": "measured", "buoys": buoys}
    with open(os.path.join(outdir, "buoys.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", len(buoys), "buoys")
    if not buoys:
        print("WARNING: no buoys written")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
