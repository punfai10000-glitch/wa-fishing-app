# WA Fishing Intelligence

A free, non-commercial, mobile-first web app for **land-based shore fishing and shore-entry spearfishing from Perth to Esperance**. It ranks fishing spots by environmental suitability for the next 24 hours, with separate shore and spearfishing scores. Safety and legal hard blocks override every score.

> Scores rate environmental conditions only. They are **not** a guarantee of fish or of safety. Official DPIRD rules always prevail.

## Status: v0.5 prototype

Can't run GitHub Actions or want data now? See **MANUAL-DATA.md** for one-click downloads you can upload yourself.

| Area | State |
|---|---|
| Map, spots ranking, location detail, rules, Fish ID helper, settings | ✅ Built |
| Forecast wind, waves, swell, modelled tide trend and sea temperature (Open-Meteo, loaded in the browser) | ✅ Built |
| Separate shore/spear scores, hard blocks, confidence, best 24 h window, 7-day outlook | ✅ Built + unit tested |
| Offline (last data cached on device) | ✅ Built |
| **Live tab** for one chosen spot: score now, next 12 hours and nearby facilities | ✅ Built |
| **Fish library**: photos (Wikipedia/Commons), keep vs protected, size and bag limits | ⚠️ Built. Limits were copied from DPIRD's 2026 guide and need spot-checking |
| **Spearfishing map**: free Sentinel-2 satellite, seabed habitat (Seamap), general depth (GEBCO), visibility *estimate* | ✅ Built. Habitat coverage near shore is patchy, and the Seamap licence is still to be confirmed |
| **Coastline colour**: conditions every ~8 km from Perth to Esperance; tap anywhere on the coast for a score, conditions, moon and nearby facilities | ✅ Built (Open-Meteo forecast, updated hourly) |
| **Animated wind/wave arrows + 48 h time slider with play**, plus the Windy.com animated map (official embed) | ✅ Built |
| **Measured wave buoys** (DoT via AODN), updated hourly | ⚠️ Built. Needs the "Live data" Action enabled; first run untested |
| **"Can I keep it?" checker** (fish + place → size, bag, protected) | ✅ Built (uses the app's copy of DPIRD rules) |
| **Waves/tide at spots**: read ~3 km offshore so the marine model has data (was showing Unknown) | ✅ Fixed in v0.4 |
| **Live wind** from BOM weather stations + **live swell** from DoT buoys (hourly) | ⚠️ Built. Needs the Live data Action enabled |
| **Legal check** against WA marine park zones (weekly download) | ⚠️ Built. Needs the Weekly data Action |
| **Getting there**: drive/walk directions + nearest public car park | ✅ Built |
| **What's caught/seen here**: iNaturalist records by month + Reddit discussion links | ✅ iNaturalist live. Reddit needs a free key |
| **Rules inside the app** (licences, gear, spearfishing, possession, bioregions, crabs, lobster) | ✅ Built |
| **Past shark incidents** map (Taronga ASID, to 2022) | ✅ Built |
| **Tackle shops, servos, toilets, 24/7 food, car parks** | ⚠️ Needs the weekly GitHub Action to run once (see below) |
| **Locations** | ⚠️ 10 pilot spots, all `status: "demo"`. Coordinates and exposure **must be verified** |
| **Safety thresholds** | ⚠️ All `draft`. Must be reviewed before public launch |
| **Marine park / sanctuary zones** | ❌ Not loaded. Legal status shows "Not yet checked" |
| **Measured buoys, tide gauges, BOM warnings** | ❌ Need the hourly data pipeline (next stage) |
| **Species rules** | ⚠️ Only one DPIRD rule entered. Every other species links to the official rules |
| Satellite base map | ⚠️ Needs a free Esri key in `js/config.js`. Falls back to OpenStreetMap until then |

**Do not promote the app publicly** while any location is `demo`, any threshold is `draft`, or zone data is missing.

## Run locally
No build step is needed:
```
python3 -m http.server 8000
# open http://localhost:8000
```
Run the tests with `npm test` (requires Node 18+).

## Publish on GitHub Pages (free)
1. Create a **public** repo and push these files to `main`.
2. Go to repo **Settings → Pages → Source: GitHub Actions**.
3. The `Test and deploy` workflow runs on every push. The site appears at `https://<user>.github.io/<repo>/`.

## Deploy / update (all versions combined)
1. Unzip the newest `wa-fishing-app` zip. On a Mac, press **Cmd + Shift + .** in Finder so the hidden `.github` folder shows.
2. In GitHub, open the repo → **Add file → Upload files**. Drag in **everything inside** the folder, including `.github`, then click **Commit changes**. Same-named files are replaced. This zip contains every version so far.
3. **Settings → Pages**: Source = *Deploy from a branch*, branch `main`, folder `/ (root)`. This only needs doing once.
4. **Settings → Actions → General → Workflow permissions**: choose **Read and write permissions** → Save. This lets the data jobs save their files.
5. **Actions** tab: if asked, click *I understand my workflows, go ahead and enable them*. Then run each of these once:
   - **Weekly data (shops, servos, toilets, community posts, marine zones)** → Run workflow
   - **Live data (measured buoys + weather stations)** → Run workflow
6. Optional, for Reddit posts: create a free *script* app at https://www.reddit.com/prefs/apps. Then in the repo go to **Settings → Secrets and variables → Actions → New repository secret** and add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`. Re-run the Weekly data job.
7. Open the site and reload (Cmd + Shift + R). From v0.4 on, updates appear on the next normal reload.

If a job fails, open it in the Actions tab, copy the red error lines and send them to Claude.

## Live data: measured wave buoys + BOM weather stations (free, hourly)
`.github/workflows/live-data.yml` runs `pipeline/fetch_buoys.py` every hour. It reads the latest DoT buoy readings from AODN and force-pushes a single small `buoys.json` to a branch called `live-data`, so the repo history doesn't grow. The app reads it from `raw.githubusercontent.com/<owner>/<repo>/live-data/buoys.json`. Set `GITHUB_REPO` in `js/config.js` if you rename the repo.

To start it: **Actions → Live data (measured buoys) → Run workflow**. If it fails, open the run log and send it to Claude. The script was tested on sample files but not yet against the live AODN server.

## Update facilities: shops, servos, toilets (free, weekly)
The app never queries OpenStreetMap from people's phones, because that would break the Overpass usage policy. Instead, a GitHub Action downloads the data once a week into `data/amenities.geojson`.

1. Make sure `.github/workflows/amenities.yml` and `pipeline/fetch_amenities.py` are in the repo. On a Mac, press **Cmd + Shift + .** in Finder to show the hidden `.github` folder before you drag files in.
2. In the repo, open **Actions** → **Update shops, servos and toilets** → **Run workflow**.
3. It commits `data/amenities.geojson`, and the site updates about a minute later. After that it runs every Monday, which also keeps scheduled jobs from being switched off.

OpenStreetMap doesn't record which servos sell bait, so the app says "bait not confirmed".

## Optional: sharper satellite map
The free Sentinel-2 map (10 m) works without any setup. For sharper imagery:
1. Create a free ArcGIS Location Platform account at https://location.arcgis.com. Leave pay-as-you-go **off**, so you can never be billed.
2. Create an API key with the basemap privilege, and **restrict its referrer** to `https://<user>.github.io/*`.
3. Paste the key into `ESRI_API_KEY` in `js/config.js`. This key is a public, restricted key, not a secret.

## Curating locations (for you and helpers)
Edit `data/locations.json` through a pull request. Every location needs:
- coordinates checked against OpenStreetMap or satellite imagery
- `exposure` directions
- `access`
- `sources`
- `last_verified` (today's date)

Change `status` from `demo` to `active` only once all of these are verified. Re-check every location yearly. The app flags any location not re-checked in 12 months.

Never copy text or spot lists from fishing websites or forums. Use them only as leads to check.

## Data sources & licences
- Open-Meteo: CC BY 4.0, free for non-commercial use only. **This app must stay free with no ads.**
- OpenStreetMap: ODbL.
- Esri World Imagery: Esri terms. Tiles are never cached offline.
- DPIRD rules: © State of WA, restated in our own words with links.
- SunCalc: BSD-2.

The `/data` folder is published under ODbL.

## Project structure
```
index.html, css/, js/ (app, map, data, engine, scoring/, views/), data/, sw.js, tests/
```
The full requirements and architecture are kept in the Claude project docs:
- `product-requirements-v1.md`
- `stage-6-architecture-and-data-model.md`
