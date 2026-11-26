// Fish → How-to: plain-language summaries of DPIRD's recreational fishing guides (paraphrased; the official guides win).
const SRC = 'https://www.dpird.wa.gov.au/individuals/recreational-fishing/';

const card = (id, title, intro, items, foot = '') => `
  <details class="card guide" id="g-${id}">
    <summary><h2 style="display:inline">${title}</h2></summary>
    ${intro ? `<p class="small">${intro}</p>` : ''}
    <ul class="small guide-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>
    ${foot ? `<p class="small muted">${foot}</p>` : ''}
  </details>`;

export function renderGuides(el) {
  el.innerHTML = `
    <h1>How-to guides</h1>
    <p class="notice small">Short versions of DPIRD's guides: catch care (handling, releasing and keeping fish), rock lobster 2026, blue swimmer crabs (Nov 2025), crabbing code of conduct, flathead ID (Oct 2026) and marine protected species (2025). The official guides and <a href="https://rules.fish.wa.gov.au" target="_blank" rel="noopener">rules.fish.wa.gov.au</a> always win.</p>

    ${card('release', '🐟 Releasing a fish so it survives', 'Undersize, protected or not wanted? These steps give it the best chance.', [
      'Keep it in the water while you unhook it if you can. If you must lift it, use a soft knotless net.',
      'Wet hands or a wet cloth; hold it flat and support the belly. Never hang it by the tail, jaw or gills, and don\'t touch the eyes or gills.',
      'Lay it on a wet towel or brag mat, never on hot dry boards or rocks. Keep photos quick.',
      'Swallowed the hook? Don\'t dig — cut the line as close to the hook as you can.',
      'If it lies on its side or sinks, hold it upright in the water facing into the current until it kicks away.',
      'Deep-water (demersal) fish like dhufish, snapper and baldchin get <strong>barotrauma</strong> — bulging eyes, stomach out of the mouth. Send them back down on a <strong>release weight</strong> (you must carry one when line fishing for demersals from a boat). Venting is not recommended.',
      'Don\'t catch-and-release demersal fish for fun, and don\'t swap a smaller fish for a bigger one (high-grading) — many released deep fish die. Once you have your demersal bag, switch to herring, whiting or other nearshore fish.'
    ], 'Gear that helps: circle or long-shank hooks, barbless hooks (crush the barb with pliers), single hooks on lures instead of trebles.')}

    ${card('keep', '🔪 Keeping fish fresh', '', [
      'Kill it quickly and humanely: a firm blow to the head to stun, then spike the brain (iki jime). It also gives better eating.',
      'Get it cold straight away — an ice slurry (ice plus a little seawater) chills fish fastest.',
      'Fillet cleanly and keep fillets cold and dry; freeze what you won\'t eat within a couple of days.',
      'Some fish must stay whole or with skin on until you get home so they can be measured and identified — check the rules for your catch.',
      'Sharks taking your fish? Move spots straight away; report shark sightings to Water Police on 08 9442 8600 or the SharkSmart WA app.'
    ])}

    ${card('lobster', '🦞 Rock lobster (crays) — the rules that catch people out', 'You need a rock lobster licence for any lobster, from the shore, by diving or with pots.', [
      'Minimum carapace: western 76 mm, southern 98.5 mm, tropical 76 mm. Bag 8 a day (all lobsters combined; max 4 tropical). Boat limit 8 per licensed fisher up to 24 (3+ licence holders). Possession limit 24.',
      'Totally protected: any berried (egg-carrying) lobster, and western rock lobsters with a tarspot (sperm packet between the back legs) from Windy Harbour to North West Cape. Put them back before the next pot or the next grab.',
      'Night ban south of North West Cape — no pulling pots or diving for lobster: 7:30 pm–4:30 am (15 Oct–31 Mar), 6 pm–6 am (1 Apr–14 Oct).',
      'Diving: by hand, a hand-held snare or a blunt crook only. Spears and nets are illegal for lobster. Measure underwater and release undersize ones before taking the next.',
      'Clip or punch the tail fan of every lobster you keep within 5 minutes (at least the lower half of the middle flap, or a 10 mm hole).',
      'Pots: max 2 per licence, 6 carried per boat, one entrance, escape gaps (3 between North West Cape and Cape Leeuwin, 1 south and east of it), max 2 floats with your gear ID, weighted rope 1 Apr–31 Oct so whales don\'t get tangled. Never pull someone else\'s pot, even with permission.',
      'Sea lion exclusion devices are required in pots between South Rocks (Wedge Island) and Freshwater Point, and at the Abrolhos Easter and Pelsaert groups.',
      'No plastic bait bands on boats. Don\'t use lobster or abalone as bait; demersal fish can\'t be used as bait in the West Coast bioregion.',
      'Closed: Rottnest\'s conservation areas, marine park sanctuary zones, and wreck exclusion zones (e.g. HMAS Swan 200 m, HMAS Perth 250 m).',
      'Release unwanted lobsters fast, over reef or weed where you caught them. Caught a tagged one? Note tag number, size, sex, place and depth and report it to DPIRD.'
    ], 'Fines for undersize lobster or going over your possession limit can reach $5,000 plus 10× the value of the catch.')}

    ${card('crab', '🦀 Blue swimmer crabs', '', [
      '<strong>Closed 1 Sep – 30 Nov</strong> from the Swan and Canning rivers south to Minninup Beach (15 km south of Bunbury), including Cockburn Sound and all rivers and estuaries in that stretch.',
      'Minimum 127 mm across the shell, spike tip to spike tip — use a crab gauge, not a can or ruler. Measure and count each crab as soon as it\'s in your bag or bucket.',
      'Daily bag: 5 in the Swan–Canning and Cockburn Sound; 10 in Geographe Bay (no more than 5 females); 10 elsewhere on the West Coast; 20 on the South Coast. You can\'t catch for someone else.',
      'Boat limit: 20 on the West Coast (Swan–Canning and Cockburn need 4+ licence holders aboard; elsewhere 2+); 40 on the South Coast. A powered boat needs at least one person with a Recreational Fishing from Boat Licence.',
      'Put back undersize and berried (egg-carrying) crabs gently and straight away — before pulling the next drop net. Don\'t throw them.',
      'Legal gear: hand, rigid scoop net (≤375 mm wide, ≤210 mm deep), up to 10 drop nets (≤1.5 m) per person or per boat, blunt wire hook, or diving. Rakes, landing nets, fishing nets and dip nets are illegal.',
      'Males: bigger, bright blue claws, narrow pointed flap underneath. Females: mottled brown, broad rounded flap.',
      'Health: in the Swan–Canning and Cockburn Sound remove the top shell, mustard (guts) and gills before cooking or freezing — an algal toxin (Alexandrium) can build up and cooking doesn\'t destroy it. Keep crabs whole until you get home unless eating them straight away.'
    ])}

    ${card('flathead', '🐊 Which flathead is it? Look at the tail', 'WA has about 36 kinds of flathead. The tail fin is usually the giveaway. All flathead have sharp gill-cover spines.', [
      '<strong>Yellowtail flathead</strong> (the Swan–Canning "bartail"): whitish tail, bright yellow stripe along the top edge, 3–4 dark horizontal bars below.',
      '<strong>Southern bluespotted</strong>: scattered blue spots on the back; 3–5 big round black spots ringed in white along the tail\'s rear edge.',
      '<strong>Rock flathead</strong>: dense dark spots on a yellow tail; upper gill spine longer than the lower.',
      '<strong>Southern sand flathead</strong>: big blackish blotches on the lower tail, brownish ones above.',
      '<strong>Bartail flathead (southern)</strong>: 2–3 black bars with a yellow stripe through the middle of the tail and a dark blotch inside the gill cover.',
      '<strong>Longspine flathead</strong>: tail yellow on top, blackish below with no distinct spots; very long lower gill spine.',
      '<strong>WA flathead</strong>: blackish tail with a white rear edge and short dark bars. <strong>Longhead</strong>: long head, dark spots on the tail. <strong>Bigtooth</strong>: reddish-brown back and tail. <strong>Fringe-eye</strong>: banded back and fleshy fringes over the eyes.'
    ], 'Limits: 300 mm minimum, bag 8 per species (nearshore/estuarine fish max 16 a day in total). Open each species in the Library for photos.')}

    ${card('protected', '🛡 Protected animals — what to do', 'All marine mammals, turtles, sea snakes, seahorses, seadragons, pipefish, seabirds and shorebirds are protected, plus many sharks and rays.', [
      'Hooked or tangled a protected animal? Cut the line as close as you safely can or untangle it, keep it in the water, and let it go.',
      'Report every interaction (catch, tangle or boat strike) to the DBCA Wildcare Helpline <a href="tel:0894749055">08 9474 9055</a>: time, place (GPS if you can), species, what happened and how it swam away. Outside state waters, report to DCCEEW (1800 920 528) within 7 days.',
      'Protected fish you might see Geraldton → Esperance: white shark, grey nurse shark, whale shark, all seahorses, leafy and weedy seadragons, pipefish, smooth and black stingrays (some areas).',
      '<strong>Whaler sharks</strong> (bronze, dusky) longer than 700 mm interdorsal — front of the first dorsal fin to the front of the second — are protected on the West and South Coasts. Bronze whalers have no ridge between the dorsal fins and narrow hooked teeth; duskies have a ridge and broad teeth.',
      'Keep your distance: seals 50 m in the water, 100 m by boat; whales 100 m. See Learn for details.',
      'Seen whales, dolphins, turtles, seals or sea snakes? Log them in the Marine Fauna Sightings app to help DPIRD track them.'
    ])}

    ${card('code', '🤝 Good habits (crabbing and fishing codes of conduct)', '', [
      'Take only what you need, even under the bag limit, and stop when you have enough.',
      'Use the right gear, check nets and lines often so nothing is left to die, and never leave gear unattended.',
      'Take your rubbish and old line home — line and bait bags kill birds, seals and turtles.',
      'Don\'t feed or throw scraps to seabirds, pelicans or dolphins; cast away from birds that are diving on your bait.',
      'Never move live fish, crabs or water between rivers or dams. Report pests like redfin and redclaw.',
      'Report illegal fishing to FishWatch 1800 815 507.'
    ])}
    <p class="small muted">Source: <a href="${SRC}" target="_blank" rel="noopener">DPIRD recreational fishing guides</a> (© State of Western Australia), summarised in our own words.</p>`;
}
