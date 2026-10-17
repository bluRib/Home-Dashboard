// Room rectangles and entity to room resolution.
//
// Coordinates are Sweet Home 3D centimeters, the same space as model/model.json:
//   x = plan x, east positive
//   z = plan y, south positive, so the house runs from z 0 at the front
//       to about z -2137 at the back
//   level 0 = first floor, level 1 = second floor
//
// Used for room glow, motion pulses, labels, and click to zoom on the house
// widget, and to tag each dashboard message with the room it came from.
//
// ACCURACY: rooms marked est:true are estimated from the label point in
// models/labels.json, not measured. They are good enough to light up the
// right part of the house and wrong enough that you should not quote them.
// The level 1 rectangles are exact, taken from the W1() wall calls in
// tools/viewer-template.html. Level 0 rooms without est:true come from the
// table in BUILD.md section 6.

// Names and positions confirmed by Jovan, 2026-10-15. Three label positions
// were corrected after seeing them on the model: Master Bath and Laundry were
// on each other's rectangles, so were "Room" and Master Closet, and Jovan's
// Closet was sitting inside AK's Room instead of beside the stairs.
// Only these rectangles moved. No wall or furniture geometry was touched.
// Names confirmed by Jovan, 2026-10-15. This replaces the guessed labels in
// models/labels.json ("Room", "Mudroom", "Office" twice) that BUILD.md open
// item 1 asked about. labels.json itself is unchanged, so the viewer pages
// still show the old text; this file is what the dashboard uses.
export const ROOMS = [
  // ---- Level 0 ----------------------------------------------------------
  { key: 'master_bed',   name: 'Master Bedroom', level: 0, x: [6, 450],     z: [-1975, -1470] },
  { key: 'kitchen',      name: 'Kitchen',        level: 0, x: [450, 760],   z: [-1420, -1090] },
  { key: 'dining',       name: 'Dining',         level: 0, x: [677, 1275],  z: [-1676, -1400] },
  { key: 'living',       name: 'Living',         level: 0, x: [760, 1275],  z: [-1400, -950] },
  { key: 'office',       name: 'Office',         level: 0, x: [960, 1275],  z: [-900, -680] },
  { key: 'office2',      name: 'Office 2',       level: 0, x: [960, 1275],  z: [-670, -460] },
  { key: 'hall_bath',    name: 'Hall Bath',      level: 0, x: [1000, 1275], z: [-430, -235] },
  { key: 'apis_room',    name: "Api's Room",     level: 0, x: [950, 1275],  z: [-200, 150] },
  { key: 'garage',       name: 'Garage',         level: 0, x: [10, 665],    z: [-575, -5] },
  // Measured by Jovan from the OBJ walls. Carved out of the hall, so it sits
  // before hall0 and wins the overlap. Its door is on the z -371 side, into
  // the small entry hall that leads to Api's Room and the Hall Bath.
  { key: 'server_room',  name: 'Server Room',    level: 0, x: [851, 970],   z: [-438, -371] },
  { key: 'hall0',        name: 'Hall',           level: 0, x: [720, 950],   z: [-620, -10] },

  // Labeled in models/labels.json but absent from the BUILD.md table.
  // Estimated so these spaces are not dead on the dashboard. Confirm before
  // wiring anything that matters to them.
  //
  // The master closet and master bath split the strip between the master
  // bedroom (west), the kitchen (north) and dining (east). The split is placed
  // so each rectangle actually contains its own label point from labels.json:
  // Closet at z -1930, Bath at z -1630.
  { key: 'master_closet', name: 'Master Closet', level: 0, x: [6, 410],     z: [-1000, -700],  est: true },
  { key: 'master_bath',   name: 'Master Bath',   level: 0, x: [180, 410],   z: [-1360, -1140], est: true },
  { key: 'patio',        name: 'Patio',          level: 0, x: [760, 1275],  z: [-1975, -1700], est: true },
  { key: 'wc',           name: 'WC',             level: 0, x: [6, 180],     z: [-1360, -1200], est: true },
  // Labeled "Bath" in the export, actually the laundry beside the kitchen.
  { key: 'laundry',      name: 'Laundry',        level: 0, x: [455, 670],   z: [-1750, -1470], est: true },
  { key: 'room0',        name: 'Room',           level: 0, x: [455, 670],   z: [-1975, -1750], est: true },
  { key: 'pantry',       name: 'Pantry',         level: 0, x: [420, 640],   z: [-1060, -860], est: true },
  { key: 'mudroom',      name: 'Mudroom',        level: 0, x: [6, 410],     z: [-700, -590], est: true },
  { key: 'porch',        name: 'Porch',          level: 0, x: [680, 950],   z: [-10, 160],    est: true },

  // ---- Level 1 (exact, derived from the W1() wall calls) ----------------
  { key: 'stair_hall',   name: 'Stair hall',     level: 1, x: [6, 405],     z: [-797, -697] },
  { key: 'stairwell',    name: 'Stairs',         level: 1, x: [6, 525],     z: [-697, -583] },
  { key: 'closet_south', name: 'Closet',         level: 1, x: [856, 1037],  z: [-1563, -1474] },
  { key: 'loft',         name: 'Loft',           level: 1, x: [405, 1037],  z: [-1324, -697] },
  { key: 'bath1',        name: 'Bath',           level: 1, x: [405, 663],   z: [-1563, -1324] },
  { key: 'hall1',        name: 'Hall',           level: 1, x: [663, 856],   z: [-1563, -1324] },
  { key: 'amanda_closet', name: "Amanda's Closet", level: 1, x: [856, 1037], z: [-1474, -1324] },
  { key: 'jovan_closet', name: "Jovan's Closet", level: 1, x: [525, 1037],  z: [-697, -533] },
  { key: 'aks_room',     name: "AK's Room",      level: 1, x: [405, 1037],  z: [-1973, -1563] },
];

// Rooms Jovan named that have no rectangle yet, because nothing in the OBJ
// export or the labels marks them:
//   Closet 2       a closet inside the master bedroom
// Add them to ROOMS once their corners are known. Until then any entity in
// them resolves to the enclosing room, or to nothing.
//
// The server closet is now in the list above as server_room, with an
// estimated rectangle that still needs measuring.

// Overall footprint, for camera fitting and for mapping rooms onto the globe.
export const BOUNDS = { x: [0, 1280], z: [-2137, 160] };

// Level 1 floor elevation in cm. Matches E1 in tools/viewer-template.html.
export const LEVEL1_ELEVATION = 262;

const BY_KEY = new Map(ROOMS.map((r) => [r.key, r]));

export function room(key) {
  return BY_KEY.get(key) || null;
}

export function center(r) {
  return {
    x: (r.x[0] + r.x[1]) / 2,
    z: (r.z[0] + r.z[1]) / 2,
    y: r.level === 1 ? LEVEL1_ELEVATION : 0,
  };
}

export function contains(r, x, z) {
  return x >= r.x[0] && x <= r.x[1] && z >= r.z[0] && z <= r.z[1];
}

export function roomAt(x, z, level) {
  for (const r of ROOMS) {
    if (level !== undefined && r.level !== level) continue;
    if (contains(r, x, z)) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entity to room resolution
// ---------------------------------------------------------------------------
// Home Assistant has no area registry in Jovan's export (BUILD.md section 9),
// so rooms are resolved from the entity name. Two passes:
//   1. OVERRIDES, for anything whose name does not say where it is
//   2. keyword match against the room name and its aliases
//
// Fill OVERRIDES in as you confirm entities. It wins over keyword matching,
// so it is also how you fix a wrong guess.

export const OVERRIDES = {
  // 'light.hue_bloom_1': 'living',
  // 'binary_sensor.front_door': 'porch',
};

// Phrases that point at a room. Longest match wins, so "stair hall" beats
// "hall" and "loft closet" beats "closet".
//
// Matching is on whole words, not substrings. That matters: with substring
// matching "Bathroom Light" contains both "bath" and "room", the two needles
// are the same length, and which one won came down to sort order. Whole word
// matching makes it deterministic, at the cost of needing "bathroom" spelled
// out as its own alias.
const ALIASES = {
  master_bed:     ['master', 'master bedroom', 'master bed', 'primary', 'primary bedroom'],
  master_bath:    ['master bath', 'masterbath', 'master bathroom', 'primary bath'],
  master_closet:  ['master closet', 'mastercloset'],
  kitchen:        ['kitchen'],
  dining:         ['dining', 'dining room'],
  living:         ['living', 'living room', 'lounge', 'family room', 'front room', 'den'],
  office:         ['office'],
  office2:        ['office 2', 'office2', 'second office', 'study'],
  // Apostrophes are stripped before matching, so "Api's" becomes "api s".
  // Both that and the bare "apis" spelling are listed, because entity ids
  // tend to use one and friendly names the other.
  hall_bath:      ['hall bath', 'hallway bath', 'guest bath', 'shared bath', 'bathroom 1',
                   'bath 1', 'api s bath', 'apis bath', 'api s bathroom', 'apis bathroom'],
  apis_room:      ['api s room', 'apis room', 'api s bedroom', 'apis bedroom',
                   'oscar s room', 'oscars room', 'oscar s bedroom', 'oscars bedroom'],
  garage:         ['garage'],
  hall0:          ['downstairs hall', 'main hall', 'hallway', 'hall'],
  patio:          ['patio', 'deck', 'back porch', 'backyard', 'back yard'],
  wc:             ['wc', 'powder', 'powder room', 'half bath'],
  laundry:        ['laundry', 'laundry room', 'washer', 'dryer'],
  pantry:         ['pantry'],
  mudroom:        ['mudroom', 'mud room', 'utility'],
  porch:          ['porch', 'front porch', 'front door', 'entry', 'entryway', 'foyer'],
  stair_hall:     ['stair hall', 'upstairs hall'],
  stairwell:      ['stairs', 'stairwell', 'staircase'],
  closet_south:   ['south closet'],
  loft:           ['loft', 'bedroom 2', 'upstairs bedroom'],
  bath1:          ['upstairs bath', 'bath up', 'loft bath', 'bathroom 2', 'bath 2'],
  hall1:          ['upstairs hallway'],
  amanda_closet:  ['amanda s closet', 'amandas closet', 'loft closet'],
  jovan_closet:   ['jovan s closet', 'jovans closet', 'bedroom 3 closet'],
  aks_room:       ['ak s room', 'aks room', 'ak s bedroom', 'aks bedroom',
                   'back bedroom', 'bedroom 3', 'rear bedroom'],

  server_room:    ['server room', 'server closet'],
  // Home Assistant calls Api's area "Oscar's Bedroom". Same person, same
  // room, so both spellings resolve here.
  room0:          [],   // the label is literally "Room", too generic to match on
};

// A bare first name is deliberately NOT an alias. Home Assistant names
// person and device_tracker entities after people, so a needle of "jovan"
// would file "Jovan's Phone" into his closet. A room only matches when the
// name says a room: "Jovan's Closet", not "Jovan".
//
// There is deliberately no generic "bath" or "bathroom" fallback. The house
// has a master bath, Api's bath, the upstairs bath and a WC, so a bare
// "Bathroom Light" is genuinely ambiguous. It lands in the unassigned bucket,
// where the link check counts it, rather than being silently filed wrong.

// ROOMS names that are too generic to auto-derive a needle from. Without this
// the label "Room" would match every "Living Room" and "Bedroom" in the house.
const TOO_GENERIC = new Set(['room', 'bath', 'closet', 'hall']);

// Build a longest first list of [regex, roomKey] so specific phrases win.
const NEEDLES = (() => {
  const seen = new Set();
  const out = [];

  // Normalise a needle exactly the way haystackFor normalises what it is
  // matched against. Without this, any room name containing punctuation
  // ("Api's Room", "Office 2") could never match, because the haystack has
  // already had that punctuation turned into a space.
  const push = (phrase, key) => {
    const p = phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push([p, key]);
  };

  for (const [key, words] of Object.entries(ALIASES)) {
    for (const w of words) push(w, key);
  }
  // Room names themselves, minus the generic ones already handled above.
  for (const r of ROOMS) {
    const name = r.name.toLowerCase();
    if (!TOO_GENERIC.has(name)) push(name, r.key);
  }

  out.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));

  // Whole word match. \b works here because the haystack is normalised to
  // lowercase letters, digits and single spaces before matching.
  return out.map(([phrase, key]) => [
    new RegExp('\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'),
    key,
  ]);
})();

// Normalise an entity id and friendly name into a space separated haystack.
function haystackFor(id, friendly) {
  return (friendly + ' ' + id.split('.').pop())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Resolve a room from an HA state object or a bare entity_id.
// Returns a room, or null when nothing matches.
export function roomForEntity(entityOrId) {
  const id = typeof entityOrId === 'string' ? entityOrId : entityOrId.entity_id;
  if (!id) return null;

  if (OVERRIDES[id]) return room(OVERRIDES[id]);

  const friendly =
    typeof entityOrId === 'object' && entityOrId.attributes
      ? entityOrId.attributes.friendly_name || ''
      : '';

  const haystack = haystackFor(id, friendly);

  for (const [re, key] of NEEDLES) {
    if (re.test(haystack)) return room(key);
  }
  return null;
}

// Group every entity in a Map (entity_id -> state) by room. Returns
// { roomKey: [state, ...], _unassigned: [state, ...] }. Handy for building the
// per room entity table that BUILD.md section 9 asks for.
export function groupByRoom(states) {
  const out = { _unassigned: [] };
  for (const r of ROOMS) out[r.key] = [];
  for (const state of states.values()) {
    const r = roomForEntity(state);
    if (r) out[r.key].push(state);
    else out._unassigned.push(state);
  }
  return out;
}
