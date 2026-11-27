// Map key: every colour, marker and symbol on the map, drawn with the same styles the map uses.
import { CLARITY_BANDS } from '../ocean.js';
import { chanceIcon, blockPill } from '../ui.js';
import { DEPTH_BANDS } from '../depth.js';

const line = (color, dashed) => `<svg width="44" height="12" aria-hidden="true"><line x1="3" y1="6" x2="41" y2="6" stroke="${color}" stroke-width="7" stroke-linecap="round" ${dashed ? 'stroke-dasharray="4 8"' : ''}/></svg>`;
const sw = hex => `<span class="key-swatch" style="background:${hex}"></span>`;
const row = (sym, title, text) => `<div class="key-row"><div class="key-sym">${sym}</div><div><strong>${title}</strong><div class="small muted">${text}</div></div></div>`;

export function renderKey(view) {
  view.innerHTML = `
  <div>
        <h1>Learn · map key</h1>
    <p class="small muted">What everything on the map means, in plain words. New to fishing apps? Start with the first two boxes.</p>

    <div class="card"><h2>New here? Start like this</h2>
      <ol class="small steps">
        <li><strong>Pick what you're doing</strong> at the top of the map: <em>Fishing</em> (from the beach, rocks or a jetty) or <em>Spear</em> (spearfishing).</li>
        <li><strong>Look for green numbers</strong> on the map. Each is a fishing spot; the number is how good the weather and sea are there, out of 100. Green = good, orange = OK, red = poor.</li>
        <li><strong>Tap a spot</strong> to see why, what fish might be around, whether fishing is allowed, and directions. Drag the card up for more.</li>
        <li><strong>Drag the time slider</strong> at the bottom to see later today or the next few days. Press ▶ to play it.</li>
        <li><strong>Search</strong> a beach, town or your campsite to jump there. Tap the water anywhere for its depth and conditions.</li>
        <li><strong>Always look at the water yourself.</strong> The app is a guide, not a guarantee.</li>
      </ol>
    </div>

    <div class="card"><h2>Waves, wind and tide — what the numbers mean</h2>
      ${row('<strong style="font-size:1.2rem">1.7 m</strong>', 'Wave height', 'How tall the waves are, from the low point (trough) to the top (crest). <strong>1.7 m is about as tall as an adult.</strong> It\'s the average of the bigger waves — every so often one comes through <strong>up to twice as big</strong>. Rough guide for shore fishing: under 1 m = calm, 1–2 m = moderate, over 2 m = big (stay off rocks).')}
      ${row('<strong style="font-size:1.2rem">12 s</strong>', 'Wave period (seconds)', 'Time between one wave and the next. Short (under 8 s) = choppy local waves from the wind. Long (12 s or more) = powerful ocean swell that surges much further up beaches and rocks than its height suggests.')}
      ${row('<strong style="font-size:1.2rem">20 km/h</strong>', 'Wind', 'Under 10 km/h = calm, easy casting. 10–20 = breezy, fine. 20–30 = whitecaps, hard to cast light lines. 30–40 = strong, unpleasant. Over 45 = dangerous on jetties and rocks. <strong>Onshore</strong> wind blows from the sea onto the beach (choppy); <strong>offshore</strong> blows from the land (smooth water, but drifts you out if you\'re in the water).')}
      ${row('<strong style="font-size:1.2rem">↑↓</strong>', 'Tide', 'The sea slowly rising and falling. Perth\'s tide is small (often under 1 m). Fish often feed more while the water is moving (rising or falling) than at the turn. The tide comes from a computer model; we checked it against the official Australian tide tables and shift it 30–60 minutes later so highs and lows land at the right time.')}
    </div>

    <p class="small muted">Turn things on and off on the map with the <strong>layers</strong> button (stacked squares, bottom right).</p>

    <div class="card"><h2>Map views &amp; filter</h2>
      <p class="small"><strong>Fishing</strong> and <strong>Spear</strong> show spots and conditions for that activity. <strong>Weather</strong> shows only wind, swell and buoys.</p>
      <p class="small">The <strong>layers button</strong> (bottom right) chooses the background (satellite or street) and what is on the map: spots, coast colour, rules, buoys, wind and swell, seabed, shark history and facilities. The <strong>+ and −</strong> buttons zoom, <strong>⌖</strong> goes to your location, <strong>[ ]</strong> shows the whole coast, and <strong>🎯</strong> at the top picks a target species. Tap a spot to open its card; drag the card up for more, or press Back to close it.</p>
    </div>
    <div class="card"><h2>Four checks (in each spot)</h2>
      <p class="small"><strong>Conditions</strong> rates wind, waves, tide and light only. <strong>Fish</strong> lists species likely for this kind of spot at this time of year and day (a seasonal guide, not catch reports). <strong>Safety</strong> says Not safe when wind or waves pass the safety limits (listed under More); otherwise Not verified, because only you can judge it on site. <strong>Rules</strong> checks marine park zones. <strong>Data</strong> is how complete and fresh the information is.</p>
    </div>
    <div class="card"><h2>Scores</h2>
      <p class="small muted">Every score is out of 100 and rates the <em>conditions</em> (wind, waves, tide, light, visibility for spearfishing) at the time on the slider. It does not mean fish are there. Switch between <strong>Fishing</strong>, <strong>Spear</strong> and <strong>Weather</strong> at the top of the map.</p>
      ${row('<span class="pill good">Good 70+</span>', 'Good (70 to 100)', 'Light wind, manageable waves, moving tide — a nice day to be out. Higher is better.')}
      ${row('<span class="pill fair">Fair 40–69</span>', 'Fair (40 to 69)', 'You can fish, but something isn\'t ideal — e.g. a bit windy or choppy.')}
      ${row('<span class="pill poor">Poor &lt;40</span>', 'Poor (under 40)', 'Rough, windy or messy. Probably not worth the trip — try another spot or time.')}
      ${row(blockPill('legal'), 'Not allowed', 'Against the rules here: a sanctuary zone, spearfishing in a river or estuary, or a closed season.')}
      ${row(blockPill('safety'), 'Not safe', 'Wind or swell over the safety limit for this kind of spot, or a thunderstorm forecast.')}
      ${row(blockPill('dark'), 'Too dark', 'Spearfishing is only rated in daylight. At night, Spear mode jumps the time slider to the next morning.')}
      ${row('<span class="pill unknown">?</span>', 'Unknown', 'Forecast not loaded yet.')}
    </div>

    <div class="card"><h2>Coastline colour</h2>
      ${row(line('#009e73'), 'Green / orange / red line along the shore', 'Conditions along the coast at the chosen time, every ~8 km. Tap anywhere for a report on that exact point.')}
      ${row(line('#a855f7'), 'Purple line', 'Not allowed along this stretch (e.g. sanctuary zone).')}
      ${row(line('#6b7280', true), 'Grey dashed line', 'Not safe right now (too windy or rough).')}
    </div>

    <div class="card"><h2>Fishing spots</h2>
      ${row(`<div class="mk good" style="width:34px;height:34px">86</div>`, 'Spot pin with score', 'A fishing spot. The number is its score at the time on the slider — it changes as you drag the slider or press ▶. ⛔ / ⚠ / 🌙 = not allowed / not safe / too dark.')}
      ${row(`<div class="mk good conf-medium" style="width:34px;height:34px">86</div>`, 'Dashed white border', 'Medium confidence: e.g. found on OpenStreetMap but not yet checked by us.')}
      ${row(`<div class="mk fair conf-low" style="width:34px;height:34px">70</div>`, 'Dashed yellow border', 'Low confidence: only a little data, so treat the score with care.')}
      ${row(`<div class="key-pin"><div class="mk blocked blk-safety conf-medium" style="width:30px;height:30px;font-size:15px">⚠</div><span class="mk-sub">20.4 °C</span></div>`, 'Grey pin with ⚠ and a temperature under it', '<strong>Not safe right now</strong> at this spot: the wind or waves at the time on the slider are over the safety limit for this kind of spot (beach, jetty, rocks). The dashed white border means it\'s a spot found on OpenStreetMap, not yet checked by us. <strong>20.4 °C</strong> under a pin is the <strong>sea temperature</strong> there (shown when the Sea temperature layer is on — always in Spear and Weather). Tap the pin to see why it\'s not safe and the next safer time.')}
      ${row(`<div class="mk good care" style="width:34px;height:34px">74</div>`, 'Orange ring around a pin', '<strong>Take care</strong>: allowed and inside the limits, but close to one (e.g. waves just under the limit). Fine for experienced people — check it on site.')}
      ${row(`<div class="mk blocked blk-legal" style="width:34px;height:34px">⛔</div>`, 'Purple pin with ⛔', '<strong>Not allowed</strong> for the chosen activity here (sanctuary zone, closed season, or no spearfishing in rivers and estuaries).')}
      ${row(`<div class="mk blocked blk-dark" style="width:34px;height:34px">🌙</div>`, 'Dark pin with 🌙', '<strong>Too dark</strong>: spearfishing is only rated in daylight.')}
      ${row('<span class="best-pin"><span>★ Best for fishing 88</span></span>', 'Best for fishing / Best for spearfishing', 'The best-scoring ~8 km stretches of coast at the time on the slider — only where that activity is allowed (no spearfishing labels in rivers, estuaries, sanctuaries or Rottnest). Tap it to see the actual spots along that stretch.')}
      ${row('<div class="tap-dot" style="display:inline-block"></div>', 'Where you tapped', 'Tap anywhere: the card shows the water depth, conditions, whether fishing is allowed, the nearest spots, toilets and servos, and directions.')}
      ${row('<span style="font-size:24px">📍</span>', 'A place you searched', 'Your campsite, town or beach. The card shows how far the sea is and the nearest fishing spots.')}
    </div>

    <div class="card"><h2>Score now vs best time</h2>
      <p class="small">When you open a spot, the top line is the score <strong>right now</strong> (or at the time on the slider): e.g. <span class="pill good">Good 84</span>. The line under it, ⏱ <strong>Best time in the next 24 h: tomorrow 4–6 am (about 88)</strong>, is a different, later time. The two numbers are never mixed: drag the time slider to that time to see its own score.</p>
    </div>

    <div class="card"><h2>Condition icons (when you open a spot)</h2>
      <p class="small muted">The map stays clean — this icon appears in the pop-up when you tap a spot or anywhere on the coast. It's based on the conditions score, not on fish. Which fish are likely is the separate "Fish" line.</p>
      ${row(chanceIcon(90, 'shore', false, false), '80–100', 'Big fish: great conditions.')}
      ${row(chanceIcon(70, 'shore', false, false), '60–80', 'Medium fish: good conditions.')}
      ${row(chanceIcon(50, 'shore', false, false), '40–60', 'Small fish: so-so conditions.')}
      ${row(chanceIcon(20, 'shore', false, false), '0–40', 'Feather: poor conditions — probably not worth the trip.')}
      ${row(chanceIcon(90, 'spear', false, false), 'Spear mode', 'Same sizes, with a spear through the fish.')}
      <p class="small muted">No icon is shown when the spot is Not allowed, Not safe or Too dark — the status label says it instead.</p>
    </div>

    <div class="card"><h2>Warning symbols</h2>
      <p class="small muted">Every warning sign the app uses, in one place.</p>
      ${row('<span style="font-size:1.4rem">⛔</span>', 'Not allowed', 'Against the rules for the activity you picked (e.g. spearfishing in a river). The box below it says which activity — line fishing may still be fine.')}
      ${row('<span style="font-size:1.4rem">⚠</span>', 'Not safe / take care / special rules', 'On a grey <strong>Not safe</strong> label: wind or waves are over the safety limit right now. On an orange line: allowed, but take care (close to a limit) or extra rules apply here (read the box).')}
      ${row('<span style="font-size:1.4rem">🌙</span>', 'Too dark', 'Spearfishing is only rated in daylight.')}
      ${row('<span style="font-size:1.4rem">🚫</span>', 'Not safe at this time', 'Shown on the spot card with the next safer time underneath.')}
      ${row('<div class="incident injured">!</div>', 'Orange ! on the map', 'A recorded shark incident with injury (shark history layer).')}
      ${row('<span class="tag measured">live measured</span>', 'Live measured', 'A real reading from a wave buoy, weather station or tide gauge, updated about hourly.')}
      ${row('<span class="tag forecast">forecast</span>', 'Forecast', 'From a weather/ocean computer model (Open-Meteo), refreshed about hourly.')}
      ${row('<span class="tag na">not applicable</span>', 'Not applicable', 'Doesn\'t apply here — e.g. ocean waves and swell inside a river or estuary.')}
      ${row('<span class="tag unknown">unknown</span>', 'Unknown', 'The data source has no value for this place or hour.')}
    </div>

    <div class="card"><h2>Wind &amp; waves</h2>
      ${row('<span class="key-wind"><i style="background:rgba(255,255,255,.7)"></i><i style="background:rgba(190,240,255,.9)"></i><i style="background:rgba(255,225,120,.95)"></i><i style="background:rgba(255,140,110,1)"></i></span>', 'Moving streaks', 'Wind flow (forecast). White = light (&lt;10 km/h), blue = moderate, yellow = fresh (20–30), red = strong (30+). They move the way the wind blows.')}
      ${row('<svg width="44" height="24" aria-hidden="true"><path d="M4 18 Q14 8 24 18" stroke="#a3e635" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M20 18 Q30 6 40 18" stroke="#fb923c" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>', 'Swell lines', 'Forecast ocean swell rolling toward the shore. Colour = swell height, same colours as the wave labels (green under 1 m, yellow 1–1.5 m, orange 1.5–2.5 m, red over 2.5 m). Thicker = bigger. Wider gaps between lines = longer period (more powerful swell). Zoom in to see them.')}
      ${row('<span class="swell-lbl" style="position:static;color:#fb923c">〰 1.8 m · 13 s SW</span>', 'Swell label', 'Swell height · seconds between waves (period) · the direction it comes FROM (SW = from the south-west). From zoom 9 when Swell lines are on.')}
      ${row('<div class="buoy" style="width:36px;height:36px">1.7<small>m</small></div>', 'Square with a number = wave buoy', 'A real floating sensor out at sea that measures the waves (this is a measurement, not a forecast). <strong>1.7 m means the waves out there are about as tall as an adult.</strong> The buoy sits in deep water a few kilometres out, so waves at the beach are usually smaller — but rock ledges facing the open sea can get the full size.')}
      ${row('<div class="buoy fresh" style="width:36px;height:42px">1.7<small>m</small><em>40 min</em></div>', 'Green buoy', 'Fresh: measured less than 1 hour ago. The small number at the bottom says how long ago (here 40 minutes).')}
      ${row('<div class="buoy aging" style="width:36px;height:42px">1.7<small>m</small><em>2 h</em></div>', 'Orange buoy', 'Measured 1–3 hours ago — still a useful guide.')}
      ${row('<div class="buoy old" style="width:36px;height:42px">1.7<small>m</small><em>9 h</em></div>', 'Red dashed buoy', 'Old: measured more than 3 hours ago (here 9 hours). Conditions may have changed — use the forecast instead.')}
      ${row('<span class="small" style="padding:2px 4px;border-radius:4px;background:rgba(11,18,32,.8);color:#fff">➤ 18</span>', 'Small arrows with numbers (zoomed in)', 'White = wind speed in km/h, blue = wave height in metres. The arrow points the way the wind or waves are going.')}
    </div>

    <div class="card"><h2>Water movement (currents) — for divers</h2>
      <p class="small">Coloured streaks moving over the sea show which way the water is flowing and how fast (forecast). They're on by default in <strong>Spear</strong>; switch them on or off in Layers. Think of the speed against how fast you can swim: a fit diver with fins can hold about 2–3 km/h for a short time.</p>
      ${row('<span class="key-wind"><i style="background:rgba(150,255,220,.85)"></i></span>', 'Green — slow (under 1 km/h)', 'Easy to swim against. Good for diving.')}
      ${row('<span class="key-wind"><i style="background:rgba(255,230,100,.95)"></i></span>', 'Yellow — moderate (1–2 km/h)', 'You will drift. Start your dive up-current, so the water carries you back towards your way out, and stay close to it.')}
      ${row('<span class="key-wind"><i style="background:rgba(255,150,60,1)"></i></span>', 'Orange — strong (2–3 km/h)', 'Hard to swim against; it can carry you away from where you got in. Use a float and buddy, or pick a sheltered spot.')}
      ${row('<span class="key-wind"><i style="background:rgba(255,70,90,1)"></i></span>', 'Red — very strong (3+ km/h)', 'Too strong to dive. The app marks spearfishing as Not safe.')}
      <p class="small"><strong>Rip currents are not shown.</strong> The forecast grid is about 8 km wide, so it shows the drift offshore, not the small, fast rips near the beach or in gaps between reefs. Look for rips yourself: a darker, calmer-looking gap between breaking waves, rippled or foamy water, or sand and weed moving out to sea. If caught in one, don't fight it — float, raise an arm, or swim sideways out of it.</p>
    </div>

    <div class="card"><h2>Safe, take care, or not safe?</h2>
      <p class="small">The app compares the forecast with safety limits for each activity (Learn more under My Fishing → Safety limits):</p>
      ${row('<b style="color:#5be08a">✓</b>', 'Within limits', 'Waves, wind and current are below the limits. Still look at the water yourself.')}
      ${row('<b style="color:#ffc04d">⚠</b>', 'Take care', 'Allowed, but close to a limit — e.g. spearfishing with 1–1.5 m of swell reaching the spot. For experienced people, with a buddy and a float; pick a calm entry and exit.')}
      ${row('<b style="color:#ff7b7b">🚫</b>', 'Not safe', 'Over a limit (e.g. spearfishing: swell over 1.5 m reaching the spot, wind over 30 km/h, gusts over 50, current over 3 km/h). The card tells you the next safer time.')}
      <p class="small muted">Why is the south coast often "Not safe" for spearfishing? It faces the Southern Ocean, where 2–3 m swell is normal. Look for bays and the sheltered side of headlands and islands (e.g. King George Sound, Esperance Bay) — the app counts how sheltered each spot is from the swell direction, so they often show as safe when the open beaches don't.</p>
    </div>

    <div class="card"><h2>Safety</h2>
      ${row('<div class="incident fatal">☠</div>', 'Red skull', 'Recorded fatal shark incident.')}
      ${row('<div class="incident injured">!</div>', 'Orange !', 'Recorded shark incident with injury.')}
      ${row('<div class="incident uninjured">·</div>', 'Grey dot', 'Recorded shark incident, no injury.')}
      <p class="small muted">From the Australian Shark-Incident Database (Taronga), Geraldton to Esperance, records to 2022. Exact spots weren't recorded, so pins are shown just offshore from the reported place. Check <a href="https://www.sharksmart.com.au" target="_blank" rel="noopener">SharkSmart WA</a> for current sightings.</p>
    </div>

    <div class="card"><h2>Water depth colours</h2>
      <p class="small muted">Layers button → "Water depth (colour bands)". Light = shallow, dark = deep, measured from mean sea level. Detailed near shore where Transport WA has surveyed (zoom in); a general depth map when zoomed out. Tap the water for the depth in metres or centimetres. Not for navigation.</p>
      ${DEPTH_BANDS.map(([max, c], i) => row(sw(`rgb(${c.join(',')})`), `${i ? DEPTH_BANDS[i - 1][0] : 0}${max === Infinity ? ' m and deeper' : '–' + max + ' m'}`, i === 0 ? 'Very shallow — wading depth, sand bars and the edge of the beach.' : i === 1 ? 'Shallow — waist to head height.' : max <= 5 ? 'Snorkel and shallow spearfishing depth.' : max <= 12 ? 'Deeper water — drop-offs and reef edges often start here.' : 'Deep water — out past most shore casts.')).join('')}
    </div>

    <div class="card"><h2>Water clarity (satellite)</h2>
      <p class="small">Layers → "Water clarity (satellite)". Satellites measure how quickly light fades in the water (called Kd490). The app turns that into a rough diving visibility. The legend shows the date of the satellite pass — the services sometimes run a week or two behind, and the app leans less on old passes.</p>
      ${CLARITY_BANDS.map(b => row(sw(b.color), `${b.label} — about ${b.vis}`, { vclear: 'Blue-water days: great for spearfishing and sight-fishing.', clear: 'Good diving visibility.', ok: 'Fine for most diving; fish shy less.', murky: 'Short visibility — stay close to your buddy; sharks are harder to see.', vmurky: 'River plumes and stirred-up water after storms.' }[b.key])).join('')}
      <p class="small muted">The squares are 2–4 km wide, so right at the shore it can be different. Big swell, strong onshore wind or rain since the satellite pass make the water murkier — the card's "Visibility" line already allows for that.</p>
    </div>

    <div class="card"><h2>Measured tide</h2>
      <p class="small">Near Perth and Esperance the card also shows the real tide from the Hillarys and Esperance tide gauges (updated hourly): whether it's rising or falling, and how far it is from the forecast. If it differs by 5 cm or more, the "water now" depth uses the measured difference.</p>
    </div>

    <div class="card"><h2>Seabed (habitat) colours</h2>
      <p class="small muted">Layers button → "Seabed habitat". Colours come from Seamap Australia (University of Tasmania), who combined many surveys. On the map they look a bit paler because the layer is see-through. <strong>No colour means "not mapped", not "no reef".</strong> Mapping near the shore is patchy and some areas are old surveys.</p>
      ${row(sw('#02DC00'), 'Seagrass (bright green)', 'Underwater meadows of seagrass ("weed beds"). Nursery for many fish. Squid, King George whiting, garfish and herring feed along the edges; blue swimmer crabs live on the sand patches in between.')}
      ${row(sw('#2D9624'), 'Macroalgae (mid green)', 'Kelp and other seaweed, usually growing on rocky reef. Home to drummer, buffalo bream, sweep, wrasse and rock lobster. Spearos work the edges and gutters.')}
      ${row(sw('#D8F263'), 'Mixed macrophytes (lime yellow-green)', 'A mix of seagrass and seaweed. Fish it like seagrass and reef together — edges and sand holes are best.')}
      ${row(sw('#016300'), 'Vegetation (very dark green)', 'Plants recorded but not split into seagrass or seaweed.')}
      ${row(sw('#CCFF99'), 'Biota present (pale lime)', 'Something living covers the seabed, but the survey did not say what.')}
      ${row(sw('#1AA3FF'), 'Mixed biota (bright blue)', 'A mix of living cover — weed, sponges and invertebrates together. Usually patchy reef: good for a look.')}
      ${row(sw('#FFF9A5'), 'Sand (pale yellow)', 'Open sand. Whiting, flathead, tailor and salmon move over it; little shelter for reef fish. Gutters and the sand next to reef or weed are the productive parts.')}
      ${row(sw('#FFD480'), 'Soft seabed (light orange)', 'Sand, silt or mud, not split further. Same fishing as sand.')}
      ${row(sw('#F9F075'), 'Fine sediment (yellow)', 'Fine sand and silt, often in sheltered bays and estuaries — crabs, whiting and flathead.')}
      ${row(sw('#DCCEA3'), 'Mixed soft seabed (beige)', 'A mix of sand, shell and silt.')}
      ${row(sw('#ADAD85'), 'Shelled biota (olive grey)', 'Seabed covered in shells and shellfish (e.g. scallop or razor-clam beds).')}
      ${row(sw('#640000'), 'Reef rock (dark red-brown)', 'Solid rocky reef (limestone or granite). Holds dhufish, snapper, wrasse, harlequin and rock lobster — and snags tackle. Check the zone rules: many sanctuary zones are on reef.')}
      ${row(sw('#8A5C5C'), 'Hard seabed (brown)', 'Rock or reef, type not recorded.')}
      ${row(sw('#CCCC00'), 'Pavement reef (mustard)', 'Flat, low rock platform under water with a thin cover of weed.')}
      ${row(sw('#994D00'), 'Boulders (rust brown)', 'Large loose rocks — caves and ledges for lobster and reef fish.')}
      ${row(sw('#CC6600'), 'Mixed reef and sand (orange-brown)', 'Patchy reef with sand between. The edges are often the most productive fishing ground.')}
      ${row(sw('#FF99E6'), 'Sponges and filter feeders (pink)', 'Sponge gardens, usually in deeper water.')}
      ${row(sw('#4B0066'), 'Urchin barren (deep purple)', 'Reef stripped bare by sea urchins — few fish.')}
      ${row(sw('#C0C0D8'), 'Nothing living (grey-lilac)', 'Bare seabed recorded.')}
      ${row(sw('#26734B'), 'Mangrove / saltmarsh / wetland (dark green, orange)', 'Estuary and river edges — bream, crabs and mullet country.')}
      <p class="small muted">Lines and shapes on top of the colours are other layers: red = no-fishing zone, orange dashed = special rules, blue dashed = marine park boundary.</p>
    </div>

    <div class="card"><h2>Rules on the map</h2>
      <p class="small">Every area comes from the official DPIRD fishing orders. <strong>Tap inside any area</strong> and the card shows, line by line, what's allowed (✓) and what isn't (✗), with a link to the order. Zoom in to see each zone's name on the water.</p>
      ${row('<span class="key-zone sanct"></span>', 'Red area — no fishing', 'Sanctuary zones (Marmion, Shoalwater, Ngari Capes, Rottnest, and the South Coast parks from Bremer Bay to Cape Arid), protected wrecks, Burswood Lake, Greens Pool, the old Esperance Tanker Jetty end. No line fishing, no spearfishing, no collecting. Red dashed = South Coast wildlife zones (Red Island, Cape Arid): no line or spear, hand collection only.')}
      ${row('<span class="key-zone restr"></span>', 'Orange dashed — special rules', 'Fishing is allowed but something is banned. Examples: Ngari Capes shore-based zones at Eagle Bay and Cosy Corner (no spearfishing), surfing zones (no lobster or octopus pots), Rottnest (no spearfishing anywhere), Cottesloe Reef (no shellfish), Shoalwater Bay (no spearfishing).')}
      ${row('<span class="key-zone permit"></span>', 'Green dashed — spearfishing area', 'Marmion Marine Park: spearfishing is only allowed 1.8 km or more from the mainland shore (breath-hold, no scuba). Closer in — including from the beach — it\'s banned.')}
      ${row('<span class="key-zone spz"></span>', 'Purple dashed — special purpose zone', 'South Coast whale-calving bays (Doubtful Island Bay, Thomas River–Yokinup Bay) and Aboriginal cultural areas (e.g. Point Hood). Fishing and spearfishing are allowed under the normal rules — keep 100 m from whales and respect the site.')}
      ${row('<span class="key-zone gear"></span>', 'Purple dotted — gear or species rules', 'For example no rock lobster pots, no wire trace, or a seasonal crab or snapper closure. The card says whether it is closed right now.')}
      ${row('<span class="key-zone park"></span>', 'Blue dashed outline', 'Marine park edge.')}
      ${row('<span style="font-size:20px">🔱</span>', 'Spearfishing in rivers and estuaries', 'Banned everywhere in WA (rivers, estuaries, creeks, inland waters) — the app never rates spearfishing there.')}
      <p class="small"><strong>South Coast lines are traced.</strong> Mamang Maambakoort and Wudjari zones (Bremer Bay → Cape Arid) aren't published as data, so the app traced them from the official DBCA zoning maps. Lines at the printed coordinates are exact; coast-side edges can be out by ~100 m, so the app warns you when a spot is within 250 m of a sanctuary.</p>
      <p class="small muted">Bag and size limits, licences and statewide closures still apply everywhere. Signs on site and newer orders win — check the linked order or the Recfishwest app if unsure.</p>
    </div>

    <div class="card"><h2>Keep your distance — seals and whales</h2>
      <p class="small">WA law sets minimum distances (DBCA). Seals and sea lions also draw sharks — another reason to move away if one turns up while you're spearing.</p>
      ${row('<span style="font-size:20px">🦭</span>', 'Seals & sea lions', '50 m when you are in the water · 100 m in a boat, kayak or other craft · on land at least 10 m (30 m recommended). Don\'t approach them in the water.')}
      ${row('<span style="font-size:20px">🐋</span>', 'Whales', 'Swimmers: don\'t swim with, feed or touch whales; if one comes to you, try to keep 100 m away. Boats: 100 m minimum, slow down within 300 m. Drones: 60 m. Southern rights calve in South Coast bays from about June to October.')}
    </div>

    <div class="card"><h2>Facilities</h2>
      <p class="small muted">Nothing is shown until you choose: tap the layers button (stacked squares, bottom right) and tick what you want. Toilets, servos and 24/7 food are shown only within 10 km of the coast; zoom in to see them.</p>
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
