# BUILD.md: Home Dashboard (Encom Boardroom fork + Home Assistant + 3D house)

This file is the single reference for the project. It is written so a person or an AI assistant can pick up the work without the original conversation. Read it top to bottom before changing anything.

Owner: Jovan
Last updated: 2026-10-16

---

## 1. What we are building

A full screen, Tron: Legacy style home dashboard for Home Assistant, built as a **fork of Encom Boardroom** (plain HTML5 + JavaScript + three.js, no framework).

- **Launcher first.** The opening screen is Encom's "Light Table": folders, a fake terminal, an on screen keyboard. Each folder is one home system. Picking a folder types `cd <system>` / `run <system>.exe` in the terminal, shows a big splash word, then loads that system's screen.
- **One screen per system.** Each system gets its own boardroom style screen with its own widgets.
- **The 3D house is one widget, not the centerpiece.** It lives on the House screen (and can appear as a small widget elsewhere).
- **Live data from Home Assistant.** Every HA `state_changed` event flows through one pipe and is fanned out to whichever widgets care about it.

Planned system folders: `CLIMATE`, `SECURITY`, `CAMERAS`, `ENERGY`, `HOUSE` (3D model), `NETWORK` / `HOMELAB`.

---

## 2. Links (everything referenced in this project)

### Encom Boardroom (the base we fork)
- Repo: https://github.com/arscan/encom-boardroom
- Live demo: https://www.robscanlon.com/encom-boardroom/
- Encom Globe (standalone globe library from the same author): https://github.com/arscan/encom-globe
- Hexasphere.js (used by the globe): http://www.robscanlon.com/hexasphere/
- pleaserotate.js (mobile rotate prompt it uses): https://github.com/arscan/pleaserotate.js
- Original film boardroom design reference (GMUNK): http://work.gmunk.com/TRON-Board-Room
- License: MIT (keep their `LICENSE` text / copyright notice in the fork)

### Home Assistant
- WebSocket API docs: https://developers.home-assistant.io/docs/api/websocket/
- REST API docs: https://developers.home-assistant.io/docs/api/rest/
- Official JS WebSocket client (optional): https://github.com/home-assistant/home-assistant-js-websocket
- Long lived access tokens: create in HA under your user Profile, Security tab, "Long-lived access tokens"
- Serving static files from HA (`/config/www` is served at `/local/`): https://www.home-assistant.io/integrations/http/#hosting-files

### 3D / tooling
- three.js r128 (version used by the house viewer): https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
- three.js docs: https://threejs.org/docs/
- esbuild (replaces Encom's old Grunt + Browserify build): https://esbuild.github.io/
- Sweet Home 3D (where the house was drawn and exported): https://www.sweethome3d.com/
- Google Fonts used: Rajdhani https://fonts.google.com/specimen/Rajdhani , Share Tech Mono https://fonts.google.com/specimen/Share+Tech+Mono , Inconsolata https://fonts.google.com/specimen/Inconsolata

### Our published pages (private to Jovan's claude.ai account until shared)
- Level 0 (first floor, exact from OBJ): https://claude.ai/artifact/BvqcEi9s3Te4hUYVTVEJrE
- Level 1 (second floor, built from screenshot): https://claude.ai/artifact/JApM6qnLmH66X9jJAmwonx
- Both floors stacked: https://claude.ai/artifact/Sw4y3MfiBWMeeRqaj9boFt
- Sample control dashboard (first concept): https://claude.ai/artifact/WQUzuRWtUEZgovz9xgjBP2
- Encom style monitor (second concept, house as centerpiece; superseded by the launcher plan): https://claude.ai/artifact/NqJoU1qvr4XGm4GkTJvAJB

### Our files
- `home-3d.zip` (download from the conversation): all pages, the model, extracted furniture models, templates, and scripts. Layout in section 6.

---

## 3. Project rules (do not break these)

1. **Never use em dashes** anywhere: code, comments, docs, UI text. Use commas, periods, semicolons, or parentheses.
2. **Plain HTML5.** No Next.js, no React, no framework. ES modules or the existing bundle only.
3. **Fork, do not rewrite.** Start from `arscan/encom-boardroom`. Keep its look, flow, and timing.
4. **Launcher is the entry point.** The 3D house is a widget on the House screen, not the center of the app.
5. **The house model is exact.** Level 0 comes from Jovan's Sweet Home 3D OBJ. Do not hand adjust level 0 geometry; re-export instead.
6. **Walls are full height (8 ft / 244 cm).** No cutaway that chops walls. No ceilings ("second level flooring") shown.
7. **Exterior walls are solid with no outline lines.** Interior walls keep thin cyan edges.
8. **Upstairs uses the same models as downstairs** (doors, windows, toilet, tub, TVs, desk, beds, nightstands, etc.).
9. **Floors line up on the stairs.** The staircase is the anchor between levels.
10. **Orange means a problem.** Cyan is normal. Green is motion. Do not use orange decoratively.

---

## 4. Colors

### Palette used in the house model and dashboard
| Role | Hex | Notes |
|---|---|---|
| Background | `#03060a` / `#04070b` | near black, slight blue |
| Primary line / glow (cyan) | `#3fe0ff` | edges, active UI, glass, normal state |
| Soft text cyan | `#bff4ff` | labels, secondary text |
| Bright text | `#e6fbff` | numbers, values |
| Dim cyan (edges, furniture lines) | `#2aa3bb` | ~35 to 60% opacity |
| Deep dim cyan | `#1d7d91` | grid, inactive |
| Grid floor | `#0f3a44`, `#0a2830` | GridHelper colors |
| Interior wall fill | `#15404d` / `#16424f`, emissive `#061c24` | Lambert material |
| Exterior wall fill | `#1b4d5b`, emissive `#072630` | solid, no edges |
| Door leaf | `#1f6170`, emissive `#0a3440` | |
| Window / door frames | `#2b6f80`, emissive `#0c3a46` | |
| Furniture | `#10303a`, emissive `#041419` | |
| Floor | `#0a1d26` | |
| Level 1 floor slab | `#0b2029`, emissive `#041218` | |
| Glass | `#3fe0ff` at 32% opacity | |
| Alert / open / problem | `#ff8a1f` | garage open, faults, low battery |
| Motion / OK | `#4dffb0` | motion pulses, healthy |

### Encom's native colors (for widgets copied from the fork)
| Role | Hex |
|---|---|
| Encom cyan | `#00eeee` |
| Encom yellow / highlight | `#ffcc00` |
| White | `#ffffff` |
| Black | `#000000` |

The second concept page used a lighter variant: `#9ef6ff` (text), `#00e5ff` (glow), `#ffb347` (alert), `#7dffc4` (motion). Either set works; pick one and keep it consistent across the fork.

### Type
- Encom ships its own font: `css/terminator.woff`. Use it for headers to stay on brand.
- Mono for numbers: Share Tech Mono or Inconsolata.
- Labels: Rajdhani 600 with wide letter spacing, uppercase.

---

## 5. How Encom Boardroom is built (reviewed from source)

This section describes **upstream's** repo as it ships, so the names below are
theirs. In this fork the bundle is `build/kaiyami.js` and the folder art is
`kaiyami_folder_big.png` / `_small.png` / `_xl.png`.

Repo layout:
```
index.html                  loads js/globe-grid.js, js/github-2013.js, build/encom-boardroom.js
build/encom-boardroom.js    prebuilt bundle (runs as is, no build step needed)
css/                        boardroom-styles.css, light-table-styles.css, global.css, terminator.woff
images/                     folder art (encom_folder_big.png, encom_folder_small.png), etc.
src/                        source modules (bundled into build/)
  main.js                   entry: EventSource, screen switching, main animation loop
  LightTable.js             launcher screen: folders, terminal, keyboard, WebGL test box
  Boardroom.js              data screen: wires all widgets, routes messages
  Box.js, SatBar.js, StockChart.js, StockChartSmall.js, Swirls.js, TimerTrees.js, SimpleClock.js, Logo.js, Utils.js
stream-server.js            Node + Express server, pushes GitHub/Wikipedia events over SSE at /events.js
Gruntfile.js                old build (browserify src/main.js -> build/encom-boardroom.js)
```

Key mechanics:
- **Two screens, one loop.** `main.js` holds `active = "lt"` (Light Table) or `"br"` (Boardroom). One `requestAnimationFrame` loop calls `LightTable.animate()` or `Boardroom.animate()`. Resize is routed the same way.
- **Folders are divs.** In `index.html`: `#lt-launch-github`, `#lt-launch-test`, `#lt-launch-wikipedia`, `#lt-launch-bitcoin`, `#lt-launch-unknown`, each a `.folder-container` with `.folder-big` or `.folder-small`. Click handlers in `LightTable.init()` call `simulateCommand("|cd github$")`, `simulateCommand("ls$")`, `simulateCommand("run github.exe$")`.
- **Switching.** `onSwitch(view)` in `main.js`: shows `#screensaver` with the stream name, hides the Light Table, calls `Boardroom.init(view)`, and 3 seconds later sets `active = "br"` and calls `Boardroom.show()`.
- **Widget contract.** Each widget exposes `init`, `animate`, `message`, `resize`. `Boardroom.message(msg)` fans every event out to the widgets.
- **Data pipe.** `main.js` opens `new EventSource("/events.js")` (overridable with `window._esPath`). Messages are JSON and go to `LightTable.message` or `Boardroom.message`.
- **Message shape** (from the test stream in `main.js`):
  ```js
  { stream: "test", latlon: {lat, lon}, location: "Test 12", type: "Type 3",
    picSmall: "images/not_available_small.png", picLarge: "images/not_available_large.png",
    username: "user", userurl: "http://...", title: "Test 41", url: "http://...",
    size: 1234, popularity: 5678 }
  ```
- **Test stream.** The `test` folder generates a random message every 800 ms. Use it to develop without Home Assistant.

---

## 6. The house (what we built)

### Source data
- Drawn in Sweet Home 3D by Jovan. Level 0 exported as `My_Home.obj` (Sweet Home 3D, Wed Oct 14 2026).
- Units: **centimeters**. Axes: x = plan x (east positive), y = up, z = plan y (south positive, north negative).
- Footprint about 1280 cm (42 ft) wide by about 2137 cm (70 ft) deep.
- Walls 244 cm (8 ft). Doors 96 in. Interior walls 7.6 cm thick in the export.
- Furniture dimensions in the export match the Sweet Home 3D furniture list (doors 32 to 45 in wide, double hung windows 36 to 41 in, beds, tub 70 x 30 in, etc.).

### Level 0 (exact)
- Converted from the OBJ by `tools/obj_to_model.py` into `model/model.json`, grouped by category:
  `ground`, `wall` (interior), `wallx` (exterior), `floor`, `door`, `doorx`, `frame`, `framex`, `glass`, `glassx`, `furn`.
- **Exterior detection:** a wall is exterior if a ray from either long side hits no other wall. Doors, frames, and glass within 20 cm of an exterior wall get the `x` category.
- **Ceilings removed:** room surfaces above 5 cm are dropped (the export includes ceilings at 244 cm).
- **Wall edges:** custom edge builder (`wallEdges`) draws only real edges (tops, bottoms, corners, openings) so segmented exports read as one continuous wall. Exterior walls draw no edges at all.
- **Staircase** (in the OBJ): x 101 to 525, z -693 to -593, rises toward the west; top step at x about 101 to 140, height 242 cm. Railing to 335 cm.

### Level 1 (built in code from Jovan's screenshots and corrections)
- No Sweet Home 3D plan exists for upstairs. It is defined in `tools/viewer-template.html` with `W1(...)` (walls) and `put(...)` (real furniture models from level 0).
- Floor elevation `E1 = 262` cm (top of stairs plus slab). Wall height 244 cm. Slab 18 cm.
- Stair hole in the slab: x 101 to 519, z -593 to -693, with a glass railing along the north edge.
- Scale/placement was derived from the screenshot using the real staircase as the anchor (about 1.84 cm per screenshot pixel).

Rooms (cm):
| Room | x range | z range | Notes |
|---|---|---|---|
| Stair hall | 6 to 405 | -697 to -797 | runs beside the stairwell into the loft; **double window** on west wall |
| Stairwell | 6 to 525 | -583 to -697 | open to level 0 |
| Closet (south, behind loft door) | 525 to 1037 | -533 to -697 | door on loft south wall x 683 to 782 |
| Loft / bedroom 2 | 405 to 1037 | -697 to -1324 | bed head on east wall; dresser + TV on west wall **centered on bed**; desk against bath wall **facing the bathroom** |
| Bath | 405 to 663 | -1324 to -1563 | **tub/shower combo** on north wall; vanity and toilet on west wall; door on east wall **near the loft** (z -1336 to -1435) |
| Hall | 663 to 856 | -1324 to -1563 | opening from loft is full height, **no header** |
| Loft closet (larger) | 856 to 1037 | -1324 to -1474 | **door faces the hallway** (x 856, z -1350 to -1449) |
| Bedroom 3 closet (smaller) | 856 to 1037 | -1474 to -1563 | door into bedroom 3 (x 880 to 979) |
| Bedroom 3 (back) | 405 to 1037 | -1563 to -1973 | bed head on west wall; chest + TV on east wall centered on bed; **double window** on north (back) wall |

Exact upstairs code (copy of what is in `tools/viewer-template.html`):
```js
// W1(x1, z1, x2, z2, exterior?, [[a, b, type], ...])  type: 'w' window, 'd' door, 'x' open no header, 'o' open with header
W1(6,-583,525,-583,1);W1(525,-533,525,-583,1);W1(525,-583,525,-697,0);W1(6,-583,6,-797,1,[[-794,-690,'w'],[-690,-586,'w']]);W1(6,-797,405,-797,1);W1(525,-533,1037,-533,1);
W1(525,-697,1037,-697,0,[[683,782,'d']]);W1(1037,-533,1037,-1973,1);W1(405,-1973,1037,-1973,1,[[617,721,'w'],[721,825,'w']]);W1(405,-797,405,-1973,1);
W1(405,-1324,1037,-1324,0,[[663,856,'x']]);W1(663,-1324,663,-1563,0,[[-1435,-1336,'d']]);W1(856,-1324,856,-1563,0,[[-1449,-1350,'d']]);W1(856,-1474,1037,-1474,0);
W1(405,-1563,1037,-1563,0,[[709,808,'d'],[880,979,'d']]);
// put(model, x, z, rotationY)
put('bed',911.6,-1038,0);put('nightstand',1005.6,-917,0);put('nightstand',1005.6,-1159,0);
put('dresser',432.6,-1038,-P2);put('tv',422.5,-1038,P2);put('desk',552,-1285.5,0);put('chair',552,-1230,P2);
put('tub',500,-1520.4,P2);put('showerfix',440,-1520.4,P2);put('basin',439,-1375,P2);put('toilet',451,-1445,P2);
put('bed',530.4,-1768,PI);put('nightstand',436.4,-1647,PI);put('nightstand',436.4,-1889,PI);put('chest',1000.5,-1768,0);put('tv',1019.5,-1768,-P2);
```

Reused level 0 models (`model/objects.json`, extracted by `tools/extract_objects.py` from OBJ group index ranges):
| Name | OBJ group range | Size (cm) |
|---|---|---|
| door | 556 to 564 | 99 x 15 |
| window (double hung) | 610 to 615 | 104 x 8 |
| toilet | 851 to 855 | 40 x 80 |
| tub | 861 to 868 | 76 x 178 |
| showerfix | 913 to 928 | 40 x 58 |
| basin (vanity) | 869 to 882 | 71 x 56 |
| bed | 1469 to 1474 | 239 x 170 |
| nightstand | 1475 to 1481 | 51 x 71 |
| tv | 1489 to 1495 | 137 x 23 |
| desk (+ laptop) | 1273 to 1281, 1303 to 1314 | 140 x 68 |
| chair | 1183 to 1191 | 42 x 40 |
| dresser | 1261 to 1272 | 183 x 43 |
| chest | 935 to 952 | 61 x 252 |

There are no lamps in the level 0 export, so none are placed upstairs.

### Room list for widgets (approximate rectangles, cm)
Used for room glow, motion pulses, labels, and click to zoom.
| Room | Level | x | z |
|---|---|---|---|
| Primary | 0 | 6 to 450 | -1975 to -1470 |
| Kitchen | 0 | 450 to 760 | -1420 to -1090 |
| Dining | 0 | 677 to 1275 | -1676 to -1400 |
| Living | 0 | 760 to 1275 | -1400 to -950 |
| Office | 0 | 960 to 1275 | -900 to -680 |
| Office 2 | 0 | 960 to 1275 | -670 to -460 |
| Bath | 0 | 1000 to 1275 | -430 to -235 |
| Bedroom (front) | 0 | 950 to 1275 | -200 to 150 |
| Garage | 0 | 10 to 665 | -575 to -5 |
| Hall | 0 | 720 to 950 | -620 to -10 |
| Loft | 1 | 411 to 1031 | -1320 to -701 |
| Bath up | 1 | 411 to 659 | -1559 to -1328 |
| Bedroom up | 1 | 411 to 1031 | -1967 to -1567 |
| Closet (south) | 1 | 529 to 1031 | -693 to -537 |
| Stair hall | 1 | 10 to 401 | -793 to -701 |

Level 0 label names in `model/labels.json` are partly guessed ("Room", "Mudroom", "Office" twice). Confirm real names with Jovan before wiring entities.

### Files in `home-3d.zip`
```
home-3d/
  BUILD.md               this file
  README.md
  model/                 THE HOUSE DATA (what the fork needs)
    My_Home.obj          original Sweet Home 3D export (level 0)
    model.json           level 0 geometry by category (cm)
    objects.json         reusable door/window/furniture models from level 0
    labels.json          room labels: [name, x_cm, z_cm, level]
  viewer/                THE HOUSE VIEWER
    home-level0.html     built page: first floor only (open in a browser)
    home-level1.html     built page: second floor only
    home-both.html       built page: both floors with level buttons
  concepts/              EARLIER DASHBOARD MOCKUPS (reference only, not the plan)
    dashboard/home-dashboard.html   concept 1 (open in a browser)
    monitor/home-monitor.html       concept 2 (open in a browser); its last <script> block holds the
                                    room glow, alert glow, motion pulses, and event light beams
  tools/                 Python scripts that rebuild model/ and viewer/
    obj_to_model.py      OBJ -> model.json (exterior detection, ceilings removed)
    extract_objects.py   OBJ -> objects.json
    viewer-template.html viewer source code (edit this, then run build_page.py)
    build_page.py        template + model + labels -> viewer page (MODE 0 both, 1 level 0, 2 level 1)
```
The built pages in `viewer/` and `concepts/` are large because the house data is baked into each one so they open with a double click. In the fork, load `model/*.json` as separate static files instead.

Rebuild commands (from `tools/`):
```
python obj_to_model.py ../model/My_Home.obj ../model/model.json
python extract_objects.py ../model/objects.json ../model/My_Home.obj
python build_page.py viewer-template.html ../model/model.json ../model/labels.json ../viewer/home-level0.html 1 "Home, level 0"
python build_page.py viewer-template.html none ../model/labels.json ../viewer/home-level1.html 2 "Home, level 1"
python build_page.py viewer-template.html ../model/model.json ../model/labels.json ../viewer/home-both.html 0 "Home, both floors"
```
Only the Python standard library is needed.

### Viewer behavior worth keeping
- Camera orbits around the house center; drag to rotate, wheel or pinch to zoom; "3D" and "Top" presets.
- Level buttons: Both floors / Level 0 / Level 1. Level 1 view recenters on the upstairs.
- Room glow (lights on), orange glow (alert), green ring pulse (motion), event light beams rising from rooms (concept 2).
- Click a room: camera flies in, switches to that room's floor, opens a room panel; Back or Escape returns.

---

## 7. Build plan (fork + Home Assistant)

### Step 1. Fork and run
1. Fork https://github.com/arscan/encom-boardroom on GitHub, then clone your fork.
2. From the repo folder: `python3 -m http.server 8000`, open http://localhost:8000
3. Click TEST STREAM to confirm it runs (no server needed for test data).

### Step 2. Replace the build (curated install, not `npm install`)
- Do **not** run a plain `npm install`. The upstream `package.json` mixes 2014 era server deps with the client code.
- Install only the client side requires that `src/` bundles:
  `three@0.66.2`, `jquery@~2.1`, `jquery-ui@~1.10.5`, `moment@~2.6`, `moment-timezone@0.0.6`, `pusher.color@~0.2.4`, `pleaserotate.js`, `encom-globe` (pin it to a release from the same era as three r66; upstream pins `*`, which resolves to whatever is current).
- Skip the server only deps (`express@~4.3`, `request`, `event-source`, `map-stream`, `serve-favicon`, `github-timeline-stream`, `wikipedia-stream`). They exist only for `stream-server.js`, which the Home Assistant WebSocket replaces. Skipping them avoids most Node 22 install failures (`request` is deprecated, Express 4.3 is from 2014).
- Note: `src/main.js` requires `event-source`. Either keep that one small dep, or remove the `EventSource` block when the HA connection replaces it.
- Build: `npx esbuild src/main.js --bundle --outfile=build/kaiyami.js`. Grunt and Browserify are no longer needed.
- Step 1 needs none of this: the prebuilt `build/kaiyami.js` runs from any static server today.

### Step 3. Folders become systems
- `index.html`: rename `#lt-launch-github`, `#lt-launch-test`, `#lt-launch-wikipedia`, `#lt-launch-bitcoin`, `#lt-launch-unknown` and their `.folder-label` text to the systems in section 1.
- `src/LightTable.js` `init()`: update the click handlers and `simulateCommand` strings (`cd climate`, `run climate.exe`, etc.).
- `src/main.js` `onSwitch(view)`: one branch per system; set the splash text and call that system's screen init.

### Step 4. One screen per system
- Either parameterize `Boardroom.js` per system or add one module per screen (`ClimateScreen.js`, `SecurityScreen.js`, `HouseScreen.js`, ...), each with `init`, `show`, `hide`, `animate`, `message`, `resize`.
- Add the screen to the `active` switch in `main.js` so the main loop animates the right one.

### Step 5. Home Assistant data
Replace (or add beside) the `EventSource` in `src/main.js` with an HA WebSocket connection. Minimal flow:
```js
// LAN only: token in the browser is acceptable on the home network.
// If exposed to the internet, put a small proxy in front and keep the token server side.
const HA_URL = "ws://HA_IP:8123/api/websocket";
const TOKEN = "LONG_LIVED_TOKEN";
const ws = new WebSocket(HA_URL);
let id = 1;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: TOKEN }));
  else if (m.type === "auth_ok") {
    ws.send(JSON.stringify({ id: id++, type: "get_states" }));
    ws.send(JSON.stringify({ id: id++, type: "subscribe_events", event_type: "state_changed" }));
  } else if (m.type === "event") {
    const d = m.event.data; // { entity_id, old_state, new_state }
    route(toMessage(d));
  } else if (m.type === "result" && Array.isArray(m.result)) {
    // initial states: seed widgets
  }
};
```
- `toMessage()` converts an HA state change into the Encom message shape (section 5): `stream` = system name, `location` = room, `type` = domain (`light`, `binary_sensor`, `sensor`, `lock`, `cover`), `title` = friendly name, `size` = numeric state if any. For the globe, `latlon` can be a fixed point per room; for the house widget use the room rectangles in section 6.
- `route()` sends the message to the active screen's `message()` (same pattern as `Boardroom.message`).
- Keep the test stream for development.

### Step 6. House widget
- Port `tools/viewer-template.html` logic (model loading, level 1 builder, wall edges, materials, room glow, click to zoom) into `src/HouseWidget.js` with the widget contract. Load `model.json`, `objects.json`, `labels.json` as static files instead of inlining them.
- **Decided:** the house widget gets its own three.js r128 renderer and canvas. Do not upgrade the fork's three.js: r125 removed `THREE.Geometry`, so an upgrade breaks Box, SatBar, StockChart, Swirls, TimerTrees, Logo, and encom-globe at once. Load r128 for the house widget only (Encom widgets already each run their own renderer, so this fits the pattern). Keep the two builds isolated (r128 via its own script scope or module) so the fork's bundled r66 `THREE` is not overwritten.

### Step 7. Host it
- Any static web server on the homelab (Nginx, Caddy, a container), or copy the built fork into Home Assistant's `/config/www/` and open `http://HA_IP:8123/local/<folder>/index.html`.

---

## 8. Decision log (corrections from Jovan, in order)
- Wanted a Tron style, retro, non "bubbly" look; picked Tron vector style.
- Wireframe look rejected; wanted solid walls with doors and windows, traced exactly.
- Used Sweet Home 3D OBJ for an exact level 0.
- Exterior walls: must read as one wall, solid, no lines, same height as the rest.
- No cutaway; walls full height; no ceilings or "second level flooring".
- Upstairs: aligned on the stairs; same models as level 0; tub/shower combo; bath door near the loft; desk faces the bathroom; stair hall beside the stairwell (not covered by the stairs); no invented closet by the stair hall; the closet is behind the south loft door and is narrow; bedroom 3 closet smaller, loft closet larger; loft closet door faces the hallway; hall and back windows are double windows; no header over the loft to hall opening; TV and dresser centered on the bed.
- Delivered as separate pages: level 0, level 1, both.
- Dashboard direction: like Encom Boardroom. Launcher with folders for systems; 3D house is a widget, not the centerpiece.
- Approach: fork Encom Boardroom (plain HTML5), not Next.js.

---

## 9. Open items
- Real names for level 0 rooms labeled "Room", "Mudroom", and the two "Office" rooms.
- Level 1 measurements are estimated from a screenshot; tape measurements (overall upstairs length and width, each bedroom) would make it exact. Drawing Level 1 in Sweet Home 3D and re-exporting with all levels visible would replace the hand built version.
- Entity list per room: an `ha-entities.json` state export exists one directory above `mother-dashboard` (late September; 1528 entities incl. 20 lights, 6 cameras, 154 binary sensors, 2 climate, 1 alarm panel; friendly names, no area registry). Build a per room table from name prefixes for Jovan to confirm; this also helps settle the room names above.
- Camera feeds: which cameras and stream type (MJPEG, HLS, WebRTC via go2rtc).
- Pick one palette (section 4) and apply it across the forked CSS.
