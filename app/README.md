# app/

The dashboard itself. Right now it contains the Home Assistant data layer and a
link check screen that proves the pipe works. The Encom Boardroom fork drops in
on top of this (BUILD.md steps 1 through 4).

## Setup

1. Put your token in `.env`:

   ```
   HA_HOST=192.168.1.50
   HA_TOKEN=eyJhbGciOi...
   ```

   Create the token in Home Assistant under Profile, Security tab,
   "Long-lived access tokens".

2. Generate the config module the browser loads. A browser cannot read `.env`,
   so this step copies the settings into `js/config.js`. Run it again after
   every edit to `.env`:

   ```
   python tools/gen_config.py
   ```

   No Python on the machine? Use the PowerShell twin instead, which produces
   the same file:

   ```
   powershell -ExecutionPolicy Bypass -File tools/gen_config.ps1
   ```

3. Serve the folder. These are ES modules, so `file://` will not work; the
   browser blocks module loading over that scheme.

   Serve the **project root**, not `app/`, because the house screen loads the
   model from `../models/`:

   ```
   python -m http.server 8000
   ```

   - http://localhost:8000/app/ is the link check
   - http://localhost:8000/app/house.html is the 3D house

## What the link check tells you

| Reading | What it means |
|---|---|
| Status goes to `ready` | Auth worked and `state_changed` is subscribed |
| Entities | How many HA knows about. Should be near 1528 per BUILD.md section 9 |
| Events / min | The pipe is live, not just connected |
| Alerts now | Things `message.js` classes as a problem, per project rule 10 |
| No room | Entities whose name did not resolve to a room. This is the number to drive down |

"Download room table" writes `room-entities.json`, a per room list of every
entity with its friendly name and current state. That is the table BUILD.md
open item 3 asks for. Go through it, correct the room names, and add anything
misfiled to `OVERRIDES` in `js/rooms.js`.

## The house screen

`house.html` mounts `js/screens/house.js`, the 3D model as a widget driven by
live Home Assistant data. Nothing in it is simulated.

| What you see | What drives it |
|---|---|
| Room glows cyan | One or more lights or switches in that room are on |
| Room glows orange | Something in that room is in alert (rule 10) |
| Green ring pulse | A motion or occupancy sensor fired |
| Beam rising from a room | Any state change, colored by severity |
| Temperature on the tag | A sensor in that room with `device_class: temperature` |

Click a room, or its tag, to fly in and open the room panel. Escape or the
close button backs out. The level buttons switch between both floors, level 0
and level 1.

When a room's rectangle is estimated rather than measured, the panel says so,
so an odd looking highlight has an explanation on screen.

### Ported from

- `tools/viewer-template.html`: geometry, materials, the `wallEdges` builder,
  the whole level 1 construction, camera feel
- the last script block of `concepts/monitor/home-monitor.html`: room glow,
  event beams, leader tags, click to zoom

### three.js

The house gets its own r128 renderer, loaded as an ES module so it never sets
`window.THREE`. That keeps it away from the fork's bundled r66, which cannot be
upgraded because r125 removed `THREE.Geometry` and that would break Box,
SatBar, StockChart, Swirls, TimerTrees, Logo and encom-globe at once.

## Files

```
.env             your token. gitignored, never commit it
.env.example     template, safe to commit
index.html       link check screen
house.html       3D house screen
css/link.css     palette and layout for the link check
css/house.css    palette and layout for the house
js/
  config.js      GENERATED from .env, gitignored
  ha.js          the one HA WebSocket connection: auth, states, events, reconnect
  bus.js         screen registry and message fan-out (Encom's widget contract)
  message.js     HA state_changed to Encom message shape, plus severity
  rooms.js       room rectangles in model centimeters, entity to room matching
  screens/
    house.js     the 3D house widget
```

## Notes

- `rooms.js` holds the only copy of the room geometry. The house widget, the
  globe, and the room panels all read it from there, so a corrected rectangle
  fixes every screen at once.
- Rooms marked `est: true` are estimated from the label point in
  `models/labels.json`, not measured. They are flagged in the link check table.
- The token sits in a file the browser can fetch. On the LAN that is a
  reasonable trade. Do not put this folder in Home Assistant's `/config/www/`,
  which is served at `/local/` with no authentication at all, meaning anything
  on the network could read the token. See the note in BUILD.md step 7.
