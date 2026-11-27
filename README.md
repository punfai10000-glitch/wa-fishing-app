# WA Fishing Intelligence

A free, non-commercial, mobile-first web app for **land-based shore fishing and shore-entry spearfishing from Geraldton to Esperance**. It ranks fishing spots by environmental suitability for the next 24 hours, with separate shore and spearfishing scores. Safety and legal hard blocks override every score.

> Scores rate environmental conditions only. They are **not** a guarantee of fish or of safety. Official DPIRD rules always prevail.

## Status: v0.16 (27 Nov 2026) — limited testing only

The table that used to be here was the v0.5 checklist (24–25 Nov) and is long out of date. Current state:

| Area | State |
|---|---|
| Map, spot cards (Good / OK / Take care / Not safe / Not allowed), 48 h time slider, Forecast page with place search | ✅ Working |
| Coverage | ✅ Geraldton & Abrolhos → Esperance (extended 27 Nov; northern data fills in as the workflows re-run) |
| Forecasts (Open-Meteo wind, waves, swell, currents, sea temp, tide) | ✅ Working. Tide timing corrected against the official AHO tables |
| Measured data, hourly (DoT buoys, BOM stations, Hillarys/Esperance/Geraldton tide gauges, satellite water clarity) | ✅ Running. Clarity is 1–3 weeks old because NOAA's free feed lags |
| Marine park zones and DPIRD fishing orders | ✅ Loaded weekly. South Coast parks traced from DBCA maps (±100 m near shore). ❌ Western Bight & Mirning zones not in the app |
| Seabed habitat | ✅ Seamap + a dotted satellite estimate within 1 km of shore (~80% right for sand vs reef/weed) |
| Depth | ✅ DoT surveys at z14 where surveyed; GEBCO elsewhere |
| Satellite map | ✅ Sentinel-2 + Landgate aerial photos from zoom 12 ("Sharp aerial photos" switch). Esri key optional (adds a "Satellite HD" choice) |
| Fish library (331 species) + How-to guides | ⚠️ 101 species have no size/bag limit in the app yet (they link to rules.fish.wa.gov.au) |
| Facilities, OSM spots, shoreline | ✅ Weekly from OpenStreetMap |
| Diary, catch measuring, offline cache | ✅ Working (stored on the phone only) |
| Unit tests (`npm test`) | ✅ 11 passing |
| **Hand-checked spots** | ⚠️ The 10 starter spots are still `demo` — need checking on site |
| **Safety thresholds** | ⚠️ Calibrated against forecasts, not yet against real trips — needs diary reality-checks |
| Reddit links | ⚠️ Need a free Reddit key (optional) |

**Do not promote the app publicly** until the starter spots and safety limits have been checked against real conditions.

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
`.github/workflows/live-data.yml` runs twice an hour (GitHub often delays scheduled runs) and fetches buoys, BOM weather stations, tide gauges, satellite water clarity and the coast forecast. It reads the latest DoT buoy readings from AODN and force-pushes a single small `buoys.json` to a branch called `live-data`, so the repo history doesn't grow. The app reads it from `raw.githubusercontent.com/<owner>/<repo>/live-data/buoys.json`. Set `GITHUB_REPO` in `js/config.js` if you rename the repo.

To start it: **Actions → Live data (measured buoys) → Run workflow**. If it fails, open the run log and send it to Claude. The script was tested on sample files but not yet against the live AODN server.

## Update facilities: shops, servos, toilets (free, weekly)
The app never queries OpenStreetMap from people's phones, because that would break the Overpass usage policy. Instead, a GitHub Action downloads the data once a week into `data/amenities.geojson`.

1. Make sure `.github/workflows/amenities.yml` and `pipeline/fetch_amenities.py` are in the repo. On a Mac, press **Cmd + Shift + .** in Finder to show the hidden `.github` folder before you drag files in.
2. In the repo, open **Actions** → **Update shops, servos and toilets** → **Run workflow**.
3. It commits `data/amenities.geojson`, and the site updates about a minute later. After that it runs every Monday, which also keeps scheduled jobs from being switched off.

OpenStreetMap doesn't record which servos sell bait, so the app says "bait not confirmed".

## Optional: Esri imagery
Sharp aerial photos work with no setup: the "Sharp aerial photos" switch adds Landgate's free WA aerial photos from zoom 12. If you also want Esri imagery (shown as a "Satellite HD" choice):
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
