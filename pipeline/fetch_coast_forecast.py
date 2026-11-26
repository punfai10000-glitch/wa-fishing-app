"""Hourly: Open-Meteo forecast + marine data for every coast conditions point (data/coast.json), in one compact file.

Why: with ~230 points, every phone loading the map used to send ~700 weighted Open-Meteo calls in a few seconds, which
trips Open-Meteo's free limits (600 a minute, 5,000 an hour, 10,000 a day per device) — then the whole map shows "?".
Now the map reads this one file from the live-data branch and only asks Open-Meteo itself for a point you tap.

Output: out/coast_forecast.json
  { generated_at, time: [unix seconds...], f_vars, m_vars,
    points: { id: { sea: [lat, lng], f: [[values per f_var]], m: [[values per m_var]] } } }
Same variables and window (2 days back, 3 ahead) as js/coast.js, so the app's normalise() reads it unchanged.
"""
import json, os, sys, time, urllib.request

F_VARS = ["wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "precipitation", "weather_code"]
M_VARS = ["wave_height", "wave_direction", "wave_period", "swell_wave_height", "swell_wave_direction", "swell_wave_period",
          "wind_wave_height", "sea_surface_temperature", "sea_level_height_msl", "ocean_current_velocity", "ocean_current_direction"]
F_URL = "https://api.open-meteo.com/v1/forecast"
M_URL = "https://marine-api.open-meteo.com/v1/marine"
CHUNK = 40          # 40 points = 40 forecast + 80 marine weighted calls
PAUSE = 16          # seconds between chunks: stays well under 600 weighted calls a minute


def url(base, vars_, pts, sea):
    lat = ",".join(f"{(p['sea'][0] if sea else p['lat']):.3f}" for p in pts)
    lng = ",".join(f"{(p['sea'][1] if sea else p['lng']):.3f}" for p in pts)
    return (f"{base}?latitude={lat}&longitude={lng}&hourly={','.join(vars_)}&forecast_days=3&past_days=2"
            "&timeformat=unixtime&timezone=Australia%2FPerth&wind_speed_unit=kmh")


def get(u, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "wa-fishing-app (github.com/punfai10000-glitch/wa-fishing-app)"}), timeout=90) as r:
                j = json.load(r)
                return j if isinstance(j, list) else [j]
        except Exception as e:
            print("  retry", i + 1, getattr(e, "code", ""), str(e)[:80], flush=True)
            time.sleep(30 * (i + 1))
    return None


def rnd(v, k):
    return None if v is None else round(v, k)


def main(out):
    pts = json.load(open("data/coast.json"))["points"]
    res, times = {}, None
    for i in range(0, len(pts), CHUNK):
        chunk = pts[i:i + CHUNK]
        f = get(url(F_URL, F_VARS, chunk, False))
        m = get(url(M_URL, M_VARS, chunk, True))
        for k, p in enumerate(chunk):
            fe = f[k] if f and k < len(f) else None
            me = m[k] if m and k < len(m) else None
            t = (fe or me or {}).get("hourly", {}).get("time")
            if t and times is None: times = t
            if not t: continue
            def take(e, vars_):
                if not e: return None
                h = e["hourly"]
                if h.get("time") != times: return None
                return [[rnd(v, 2 if n in ("sea_level_height_msl", "wave_height", "swell_wave_height", "wind_wave_height") else 1) for v in h.get(n, [])] for n in vars_]
            res[p["id"]] = {"sea": p["sea"], "ll": [p["lat"], p["lng"]], "f": take(fe, F_VARS), "m": take(me, M_VARS)}
        print(f"chunk {i // CHUNK + 1}: forecast {'ok' if f else 'FAILED'}, marine {'ok' if m else 'FAILED'}", flush=True)
        if i + CHUNK < len(pts): time.sleep(PAUSE)
    ok = sum(1 for v in res.values() if v["f"] and v["m"])
    print(f"{ok}/{len(pts)} points complete")
    if ok < len(pts) * 0.8:
        print("too many failures — not publishing (the app falls back to asking Open-Meteo itself)"); return
    os.makedirs(out, exist_ok=True)
    json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "time": times, "f_vars": F_VARS, "m_vars": M_VARS, "points": res},
              open(f"{out}/coast_forecast.json", "w"), separators=(",", ":"))
    print("wrote", os.path.getsize(f"{out}/coast_forecast.json") // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
