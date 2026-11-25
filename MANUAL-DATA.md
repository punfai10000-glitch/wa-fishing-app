# Manual data downloads (when GitHub Actions can't run, or you want data now)

Each download takes 1–3 minutes. Save each file with the **exact name** shown, put it in the folder shown, then upload it to GitHub (**Add file → Upload files**, or drag it into that folder in the repo) and click **Commit changes**.

## 1. Shops, servos, toilets, 24/7 food, car parks → `data/amenities.geojson`
1. Open: [Overpass Turbo — facilities query](https://overpass-turbo.eu/?Q=%5Bout%3Ajson%5D%5Btimeout%3A240%5D%3B%0Away%5B%22natural%22%3D%22coastline%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29-%3E.coast%3B%0A%28%0A%20%20nwr%5B%22shop%22~%22%5E%28fishing%7Cbait%29%24%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22amenity%22%3D%22fuel%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22amenity%22%3D%22toilets%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22amenity%22~%22%5E%28restaurant%7Cfast_food%7Ccafe%29%24%22%5D%5B%22opening_hours%22%3D%2224/7%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22amenity%22%3D%22parking%22%5D%5B%22access%22%21~%22%5E%28private%7Ccustomers%7Cno%29%24%22%5D%28around.coast%3A2000%29%3B%0A%29%3B%0Aout%20center%20tags%3B&R)
2. Wait until the map fills (the query runs automatically; if not, press **Run**).
3. Click **Export** → **GeoJSON** → **download**.
4. Rename the file to `amenities.geojson` and upload it into the `data` folder.

## 2. Extra fishing spots (coordinates, not just famous jetties) → `data/osm-spots.geojson`
1. Open: [Overpass Turbo — fishing spots query](https://overpass-turbo.eu/?Q=%5Bout%3Ajson%5D%5Btimeout%3A180%5D%3B%0A%28%0A%20%20nwr%5B%22leisure%22%3D%22fishing%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22fishing%22%3D%22yes%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22man_made%22~%22%5E%28pier%7Cgroyne%7Cbreakwater%7Cjetty%29%24%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22natural%22~%22%5E%28reef%7Ccape%29%24%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22natural%22%3D%22bare_rock%22%5D%5B%22name%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%20%20nwr%5B%22natural%22%3D%22beach%22%5D%5B%22name%22%5D%28-35.3%2C114.9%2C-31.5%2C122.4%29%3B%0A%29%3B%0Aout%20center%20tags%3B&R)
2. **Export → GeoJSON → download**, rename it to `osm-spots.geojson`, and upload it into `data`.

These spots are groynes, breakwaters, jetties, piers, reefs, headlands, named rocky shores, named beaches, and anything mappers tagged as a fishing spot. In the app they're labelled "from OpenStreetMap — not yet checked".

## 3. Marine park zones (legal check)
The weekly job tries to find these automatically. If it fails:
1. Open https://services.slip.wa.gov.au/public/rest/services/Landgate_Public_Maps/Marine_Map_WA_3/MapServer
2. Copy the whole **Layers:** list (all the names and numbers) and paste it to Claude. Claude will then hard-code the right layer.

## Things that cannot be done by hand
- **Live wind (BOM) and live swell (buoys)** change every hour, so only the hourly GitHub job can keep them current. Run **Actions → Live data → Run workflow**.
- **Reddit posts** need the free Reddit key (see README). Facebook can't be used at all.
