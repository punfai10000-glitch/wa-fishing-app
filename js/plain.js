// Plain words next to the technical ones, so anyone can follow a card: "offshore (blowing out to sea)".
// Only the first time each term appears in a block, and never inside HTML tags or links.
const TERMS = [
  [/\boffshore wind\b|\boffshore\b(?![-\w])/i, 'blowing out to sea — calmer water at the shore'],
  [/\bonshore\b/i, 'towards the shore'],
  [/\bgusts\b/i, 'strongest bursts of wind'],
  [/\bswell\b/i, 'waves rolling in from far away'],
  [/@ \d+ s\b/, 'seconds between waves — longer = more powerful'],
  [/\bsanctuary zone\b/i, 'no-fishing area'],
  [/\bdemersal\b/i, 'bottom-living fish'],
  [/\bpelagic\b/i, 'open-water fish'],
  [/\bmean sea level\b/i, 'average sea height'],
  [/\bvisibility\b/i, 'how far you can see underwater'],
  [/\bcarapace\b/i, 'shell'],
  [/\bbag limit\b/i, 'how many you can keep'],
  [/\bslack\b/i, 'tide turning, little water movement'],
  [/\bconfidence\b/i, 'how sure the app is'],
  [/\bbreath-hold\b/i, 'free-diving, no tank'],
  [/\bwire trace\b/i, 'metal leader used for sharks']
];
export function plainify(html) {
  if (!html) return html;
  const used = new Set();
  return html.split(/(<[^>]+>)/).map((part, i, arr) => {
    if (part.startsWith('<')) return part;
    // skip text inside links and the glossary itself
    const open = arr.slice(0, i).filter(p => /^<a\b/i.test(p)).length - arr.slice(0, i).filter(p => /^<\/a>/i.test(p)).length;
    if (open > 0) return part;
    for (const [re, plain] of TERMS) {
      if (used.has(plain)) continue;
      const m = part.match(re);
      if (!m) continue;
      const before = part.slice(0, m.index);
      if ((before.match(/\(/g) || []).length > (before.match(/\)/g) || []).length) continue;
      if (part[m.index + m[0].length] === '/') continue;   // "offshore/sheltered": a note would split the pair   // already inside "( … )": would garble it
      used.add(plain);
      part = part.slice(0, m.index) + `${m[0]} <span class="plain-word">(${plain})</span>` + part.slice(m.index + m[0].length);
    }
    return part;
  }).join('');
}
