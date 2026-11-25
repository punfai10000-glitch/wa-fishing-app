// Map key: every colour, marker and symbol on the map, drawn with the same styles the map uses.
import { FISH_SVG, SPEAR_SVG } from '../map.js';

const fish = (w, cls = '') => `<span class="key-ico ${cls}">${FISH_SVG.replace('width="26" height="16"', `width="${w}" height="${Math.round(w * 0.62)}"`)}</span>`;
const spear = w => `<span class="key-ico">${SPEAR_SVG.replace('width="26" height="16"', `width="${w}" height="${Math.round(w * 0.62)}"`)}</span>`;
const line = (color, dashed) => `<svg width="44" height="12" aria-hidden="true"><line x1="3" y1="6" x2="41" y2="6" stroke="${color}" stroke-width="7" stroke-linecap="round" ${dashed ? 'stroke-dasharray="4 8"' : ''}/></svg>`;
const row = (sym, title, text) => `<div class="key-row"><div class="key-sym">${sym}</div><div><strong>${title}</strong><div class="small muted">${text}</div></div></div>`;

export function renderKey(view) {
  view.innerHTML = `
  <div>
    <p><a href="#/map">← Back to map</a></p>
    <h1>Map key</h1>
    <p class="small muted">What every colour, pin and symbol on the map means. Turn layers on and off with the <strong>layers</strong> button (stacked squares, bottom right of the map).</p>

    <div class="card"><h2>Scores</h2>
      <p class="small muted">Every score is out of 100 and rates the <em>conditions</em> (wind, waves, tide, light, visibility for spearfishing) at the time on the slider. It does not mean fish are there. Switch between <strong>Shore</strong> and <strong>Spear</strong> at the top of the map.</p>
      ${row('<span class="pill good">Good 70+</span>', 'Good', 'Conditions suit this activity.')}
      ${row('<span class="pill fair">Fair 40–69</span>', 'Fair', 'Fishable, but something isn\'t ideal (e.g. some wind or swell).')}
      ${row('<span class="pill poor">Poor &lt;40</span>', 'Poor', 'Rough, windy or otherwise unpleasant.')}
      ${row('<span class="pill blocked">✕ Blocked</span>', 'Blocked', 'Not allowed or not safe: sanctuary zone, swell or wind over the safety limit, storm warning, or spearfishing at night.')}
      ${row('<span class="pill unknown">?</span>', 'Unknown', 'Forecast not loaded yet.')}
    </div>

    <div class="card"><h2>Coastline colour</h2>
      ${row(line('#009e73'), 'Green / orange / red line along the shore', 'Conditions along the coast at the chosen time, every ~8 km. Tap anywhere for a report on that exact point.')}
      ${row(line('#6b7280', true), 'Grey dashed line', 'Blocked stretch (see above).')}
    </div>

    <div class="card"><h2>Fishing spots</h2>
      ${row(`<div class="mk good" style="width:34px;height:34px">86</div>`, 'Spot pin with score', 'A fishing spot. The number is its score right now. Colour = Good / Fair / Poor.')}
      ${row(`<div class="mk good conf-medium" style="width:34px;height:34px">86</div>`, 'Dashed white border', 'Medium confidence: e.g. found on OpenStreetMap but not yet checked by us.')}
      ${row(`<div class="mk fair conf-low" style="width:34px;height:34px">70</div>`, 'Dashed yellow border', 'Low confidence: only a little data, so treat the score with care.')}
      ${row(`${fish(14, 'dim')} ${fish(28)} ${fish(44, 'top')}`, 'Fish size = score (Shore mode)', 'Small faded fish = poor conditions. Big glowing fish = the best conditions.')}
      ${row(`${spear(16)} ${spear(30)} ${spear(44)}`, 'Spear size = score (Spear mode)', 'Same idea for spearfishing.')}
      ${row(`<span class="best-now" style="display:inline-grid">${FISH_SVG}<span>Best fishing 88</span></span>`, 'Best right now', 'The top 3 stretches of coast at the chosen time (at least 40 km apart).')}
      ${row('<div class="tap-dot" style="display:inline-block"></div>', 'Your tapped point', 'Where you tapped. The pop-up shows conditions, legal status, facilities and directions for that exact point.')}
    </div>

    <div class="card"><h2>Wind &amp; waves</h2>
      ${row('<span class="key-wind"><i style="background:rgba(255,255,255,.7)"></i><i style="background:rgba(190,240,255,.9)"></i><i style="background:rgba(255,225,120,.95)"></i><i style="background:rgba(255,140,110,1)"></i></span>', 'Moving streaks', 'Wind flow (forecast). White = light (&lt;10 km/h), blue = moderate, yellow = fresh (20–30), red = strong (30+). They move the way the wind blows.')}
      ${row('<svg width="44" height="24" aria-hidden="true"><path d="M6 18 Q22 6 38 18" stroke="rgb(120,220,255)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>', 'Blue rolling lines', 'Swell (forecast) rolling toward the shore. Thicker = bigger swell, slower = longer period. Zoom in to see them.')}
      ${row('<div class="buoy" style="width:36px;height:36px">1.7<small>m</small></div>', 'Square with a number', 'Measured wave buoy (real reading, not a forecast). The number is wave height. Buoys sit 30–60 m deep offshore, so waves at the beach are usually smaller.')}
      ${row('<span class="small" style="padding:2px 4px;border-radius:4px;background:rgba(11,18,32,.8);color:#fff">➤ 18</span>', 'Small labels (zoomed in)', 'Wind speed (white, km/h) and wave height (blue, m) with direction arrows.')}
    </div>

    <div class="card"><h2>Safety</h2>
      ${row('<div class="incident fatal">☠</div>', 'Red skull', 'Recorded fatal shark incident.')}
      ${row('<div class="incident injured">!</div>', 'Orange !', 'Recorded shark incident with injury.')}
      ${row('<div class="incident uninjured">·</div>', 'Grey dot', 'Recorded shark incident, no injury.')}
      <p class="small muted">From the Australian Shark-Incident Database (Taronga), Perth to Esperance, records to 2022. Exact spots weren't recorded, so pins are shown just offshore from the reported place. Check <a href="https://www.sharksmart.com.au" target="_blank" rel="noopener">SharkSmart WA</a> for current sightings.</p>
    </div>

    <div class="card"><h2>Legal</h2>
      ${row('<span class="key-zone sanct"></span>', 'Red area', 'Sanctuary zone (or similar no-take zone): no fishing, spearing or collecting.')}
      ${row('<span class="key-zone other"></span>', 'Blue area', 'Other marine park zone: fishing allowed under the normal rules, but special-purpose zones can have extra limits.')}
    </div>

    <div class="card"><h2>Facilities</h2>
      ${row('<div class="am am-tackle">B</div>', 'B', 'Tackle &amp; bait shop.')}
      ${row('<div class="am am-fuel">F</div>', 'F', 'Servo. Many sell bait, but the map data doesn\'t say which, so call ahead.')}
      ${row('<div class="am am-toilets">WC</div>', 'WC', 'Public toilet.')}
      ${row('<div class="am am-food24">24</div>', '24', 'Food open 24/7.')}
      ${row('<div class="am am-parking">P</div>', 'P', 'Public car park near the coast.')}
    </div>

    <div class="card"><h2>Data labels</h2>
      ${row('<span class="tag">measured</span>', 'Measured', 'A real sensor reading (wave buoys, BOM weather stations).')}
      ${row('<span class="tag">forecast</span>', 'Forecast', 'From weather and ocean forecast models, updated hourly.')}
      ${row('<span class="tag">estimate</span>', 'Estimate', 'Our rule of thumb (e.g. underwater visibility). Never measured.')}
    </div>
  </div>`;
}
