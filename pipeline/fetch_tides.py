"""Measured sea level (tide gauges) for the live-data branch.
Source: IOC Sea Level Station Monitoring Facility (UNESCO/IOC, data from the Bureau of Meteorology gauges at
Geraldton, Hillarys and Esperance), 1- or 3-minute data, free and public. Output: out/tides.json with hourly means for 36 h.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
STATIONS = {"gpab": ("Geraldton", -28.7631, 114.5647), "hill": ("Hillarys", -31.8255, 115.7386), "espe": ("Esperance", -33.8709, 121.8954)}

def main():
    os.makedirs(OUT, exist_ok=True)
    start = (datetime.now(timezone.utc) - timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M")
    res = []
    for code, (name, lat, lng) in STATIONS.items():
        try:
            url = f"https://www.ioc-sealevelmonitoring.org/service.php?query=data&code={code}&timestart={start}&format=json"
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "wa-fishing-app"}), timeout=60) as r:
                rows = json.load(r)
        except Exception as e:
            print(name, "failed", e); continue
        hours = {}
        for x in rows:
            try:
                t = datetime.strptime(x["stime"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                v = float(x["slevel"])
            except Exception:
                continue
            if not (-5 < v < 10): continue
            k = int(t.timestamp() // 3600 * 3600 * 1000)
            hours.setdefault(k, []).append(v)
        series = [[k, round(sum(v) / len(v), 3)] for k, v in sorted(hours.items()) if len(v) >= 3]   # 1-min gauges give ~60 a reading an hour; Geraldton reports less often
        if len(series) < 6: print(name, "too little data"); continue
        res.append({"code": code, "name": name, "lat": lat, "lng": lng, "hourly": series})
        print(name, len(series), "hours, last", series[-1])
    if not res: sys.exit(1)
    json.dump({"generated_at": int(time.time() * 1000), "source": "IOC Sea Level Monitoring Facility (BOM tide gauges)", "stations": res},
              open(f"{OUT}/tides.json", "w"), separators=(",", ":"))

main()
