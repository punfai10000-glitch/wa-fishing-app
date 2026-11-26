"""One-off: add conditions sample points (~8 km apart) along the mainland coast from Hillarys north to Geraldton,
from the precise OSM coastline (data/coastline.json, land on the left). Appends to data/coast.json."""
import json, math
C = json.load(open("data/coastline.json")); D = json.load(open("data/coast.json"))
LAT_N, LAT_S, STEP = -28.55, -31.81, 8000
TOWNS = {"Geraldton": (-28.774, 114.615), "Dongara": (-29.252, 114.932), "Leeman": (-29.95, 114.98), "Green Head": (-30.07, 114.97),
         "Jurien Bay": (-30.305, 115.04), "Cervantes": (-30.50, 115.065), "Wedge Island": (-30.83, 115.20), "Lancelin": (-31.02, 115.33),
         "Ledge Point": (-31.10, 115.37), "Seabird": (-31.28, 115.44), "Guilderton": (-31.35, 115.50), "Two Rocks": (-31.50, 115.58),
         "Yanchep": (-31.55, 115.63), "Mindarie": (-31.69, 115.70), "Hillarys": (-31.82, 115.74)}
DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
def m(a, b):
    k = math.cos(math.radians(a[1])); return math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320
def length(l): return sum(m(a, b) for a, b in zip(l, l[1:]))
lines = [l for l in C["lines"] if any(LAT_S <= p[1] <= LAT_N for p in l) and length(l) > 3000 and m(l[0], l[-1]) > 1500]
print(len(lines), "mainland lines")
pts = []
for l in lines:
    d, nxt = 0, 0
    for a, b in zip(l, l[1:]):
        seg = m(a, b)
        while nxt <= d + seg:
            t = (nxt - d) / seg if seg else 0
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            if LAT_S <= p[1] <= LAT_N:
                # smoothed direction of the coast over ~±2 km
                i = l.index(a); j0, j1 = i, i + 1
                while j0 > 0 and m(l[j0], p) < 2000: j0 -= 1
                while j1 < len(l) - 1 and m(l[j1], p) < 2000: j1 += 1
                k = math.cos(math.radians(p[1]))
                dx, dy = (l[j1][0] - l[j0][0]) * k, l[j1][1] - l[j0][1]
                nx, ny = dy, -dx                          # right of travel = sea
                n = math.hypot(nx, ny) or 1; nx, ny = nx / n, ny / n
                facing = (math.degrees(math.atan2(nx, ny)) + 360) % 360
                pts.append((p, facing, nx, ny))
            nxt += STEP
        d += seg
pts.sort(key=lambda q: q[0][1], reverse=True)
kept = []   # lines are split into many OSM ways: drop points closer than 5 km to one already kept
for q in pts:
    if all(m(q[0], r[0]) > 5000 for r in kept): kept.append(q)
pts = kept
new = []
for i, (p, facing, nx, ny) in enumerate(pts):
    k = math.cos(math.radians(p[1]))
    sea = [round(p[1] + ny * 3000 / 111320, 4), round(p[0] + nx * 3000 / 111320 / k, 4)]
    order = sorted(range(16), key=lambda j: abs((j * 22.5 - facing + 540) % 360 - 180))
    on = sorted(order[:5]); opp = sorted(range(16), key=lambda j: abs((j * 22.5 - (facing + 180) + 540) % 360 - 180))[:5]
    town = min(TOWNS, key=lambda t: m((TOWNS[t][1], TOWNS[t][0]), p))
    new.append({"id": f"coast-n{i}", "lat": round(p[1], 4), "lng": round(p[0], 4), "sea": sea, "facing": round(facing),
                "onshore_dirs": [DIRS[j] for j in on], "sheltered_dirs": [DIRS[j] for j in sorted(opp)],
                "near": town, "near_km": round(m((TOWNS[town][1], TOWNS[town][0]), p) / 1000, 1), "bioregion": "west_coast"})
D["points"] = [q for q in D["points"] if not q["id"].startswith("coast-n")] + new
D["_note"] = D["_note"] + " Points north of Hillarys (ids coast-n*) were added from the precise OSM coastline."
json.dump(D, open("data/coast.json", "w"), indent=1)
print(len(new), "new points; total", len(D["points"]))
for q in new[::6]: print(q["id"], q["lat"], q["lng"], q["facing"], q["near"], q["onshore_dirs"])
