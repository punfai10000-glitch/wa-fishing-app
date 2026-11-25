# WA Fishing Intelligence

A free, non-commercial, mobile-first web app for **land-based shore fishing and shore-entry spearfishing from Perth to Esperance**. It ranks fishing spots by environmental suitability for the next 24 hours, with separate shore and spearfishing scores. Safety and legal hard blocks override every score.

> Scores rate environmental conditions only. They are **not** a guarantee of fish or of safety. Official DPIRD rules always prevail.

## Status: v0.1 prototype

| Area | State |
|---|---|
| Map, spots ranking, location detail, rules, Fish ID helper, settings | ✅ Built |
| Forecast wind, waves, swell, modelled tide trend and sea temperature (Open-Meteo, loaded in the browser) | ✅ Built |
| Separate shore/spear scores, hard blocks, confidence, best 24 h window, 7-day outlook | ✅ Built + unit tested |
| Offline (last data cached on device) | ✅ Built |
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

## Turn on the satellite map (free)
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
