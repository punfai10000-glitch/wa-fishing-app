"""Hourly: latest MEASURED weather observations (wind, gusts) from BOM automatic weather stations
in WA, via the Bureau's anonymous FTP product IDW60920 (state observations XML).
Only coastal stations between Perth and Esperance are kept. © Bureau of Meteorology.
Usage: python pipeline/fetch_bom_obs.py OUTPUT_DIR   (never fails the workflow)
"""
import ftplib, io, json, os, sys, xml.etree.ElementTree as ET
from datetime import datetime, timezone

BOX = dict(lat_min=-35.5, lat_max=-28.3, lon_min=113.4, lon_max=124.5)


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    buf = io.BytesIO()
    try:
        with ftplib.FTP("ftp.bom.gov.au", timeout=60) as ftp:
            ftp.login()
            ftp.retrbinary("RETR /anon/gen/fwo/IDW60920.xml", buf.write)
    except Exception as ex:
        print("BOM FTP failed:", ex); return
    root = ET.fromstring(buf.getvalue())
    out = []
    for st in root.iter("station"):
        try:
            lat, lon = float(st.get("lat")), float(st.get("lon"))
        except (TypeError, ValueError):
            continue
        if not (BOX["lat_min"] <= lat <= BOX["lat_max"] and BOX["lon_min"] <= lon <= BOX["lon_max"]):
            continue
        per = st.find("period")
        if per is None:
            continue
        vals = {}
        for el in per.iter("element"):
            vals[el.get("type")] = el.text
        def num(k):
            try:
                return float(vals[k])
            except (KeyError, TypeError, ValueError):
                return None
        rec = {"site": (st.get("description") or st.get("stn-name") or "").title(), "lat": lat, "lon": lon,
               "time": per.get("time-utc"), "wind_kmh": num("wind_spd_kmh"), "wind_dir": vals.get("wind_dir"),
               "wind_dir_deg": num("wind_dir_deg"), "gust_kmh": num("gust_kmh"), "air_temp": num("air_temperature")}
        if rec["wind_kmh"] is None and rec["gust_kmh"] is None:
            continue
        out.append(rec)
    res = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "source": "Bureau of Meteorology automatic weather stations (IDW60920). © Bureau of Meteorology.",
           "type": "measured", "stations": out}
    with open(os.path.join(outdir, "bom_obs.json"), "w") as f:
        json.dump(res, f, separators=(",", ":"))
    print("wrote", len(out), "BOM stations")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
