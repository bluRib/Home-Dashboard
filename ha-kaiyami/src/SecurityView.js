/* The Security screen.
 *
 * Full viewport grid, same approach as House and Climate. The 3D house is the
 * hero and carries the markers; the panels around it are the same data in
 * list form, because a marker is quick to read and a list is quick to scan.
 *
 * Rooms come from Home Assistant areas through Areas.js. Nothing here guesses
 * a room from a friendly name.
 */

import { SecurityFeeds, roomCentre } from "./SecurityFeeds.js";

var CYAN = 0x3fe0ff;
var ALERT = 0xff8a1f;
var MOTION = 0x4dffb0;

function $id(id) {
    return document.getElementById(id);
}

var SecurityView = {};

var feeds = null;
var areas = null;
var active = false;
var dirty = true;
var lastRender = 0;
var resizeTimer = null;
var observer = null;
var built = false;
var selected = null;       // marker detail popover
var keypad = { open: false, service: null, code: "" };
var activityCanvas = null, activityCtx = null;
var lastCamera = null;

SecurityView.init = function (ha, areasRef) {
    var root = $id("security-screen");
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;
    areas = areasRef;

    activityCanvas = $id("sc-activity-canvas");
    activityCtx = activityCanvas ? activityCanvas.getContext("2d") : null;

    if (!feeds && ha) {
        feeds = new SecurityFeeds(ha, areas, function () { dirty = true; });
        feeds.start();
    }

    if (!built) {
        built = true;
        bindControls();
    }

    if (window.HouseSecurity) {
        window.HouseSecurity.mount(onMarkerPick);
    }

    requestAnimationFrame(function () {
        requestAnimationFrame(function () { SecurityView.resize(); });
    });

    watchPanels();
    dirty = true;
};

SecurityView.show = function () {
    active = true;
    var root = $id("security-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
    SecurityView.resize();
};

SecurityView.hide = function () {
    active = false;
    $id("security-screen").style.display = "none";
    if (window.HouseSecurity) {
        window.HouseSecurity.unmount();
    }
};

SecurityView.message = function (m) {
    if (feeds && feeds.note(m)) {
        dirty = true;
    }
    if (window.HouseSecurity) {
        window.HouseSecurity.message(m);
    }
};

SecurityView.seed = function () {
    dirty = true;
};

SecurityView.animate = function () {
    if (!active) {
        return;
    }
    if (window.HouseSecurity) {
        window.HouseSecurity.animate();
        window.HouseSecurity.markerState(markerState());
    }
    renderClock();
    drawActivity();

    var now = Date.now();
    if (dirty && now - lastRender > 1000) {
        lastRender = now;
        dirty = false;
        placeMarkers();
        renderEntryList();
        renderAlarm();
        renderLocks();
        renderCamera();
        renderLog();
        renderDetail();
        paintRooms();
    }
};

SecurityView.resize = function () {
    if (!active) {
        return;
    }
    if (window.HouseSecurity) {
        window.HouseSecurity.resize();
    }
    if (activityCanvas && activityCtx) {
        var w = activityCanvas.clientWidth, h = activityCanvas.clientHeight;
        if (w && h) {
            var dpr = Math.min(window.devicePixelRatio || 1, 2);
            activityCanvas.width = Math.floor(w * dpr);
            activityCanvas.height = Math.floor(h * dpr);
            activityCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }
    dirty = true;
};

SecurityView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        SecurityView.resize();
    }, 150);
};

function watchPanels() {
    if (observer || typeof ResizeObserver === "undefined") {
        return;
    }
    observer = new ResizeObserver(function () { SecurityView.resizeDebounced(); });
    ["sc-house", "sc-activity", "sc-camera"].forEach(function (id) {
        var el = $id(id);
        if (el) { observer.observe(el); }
    });
}

function say(text, isError) {
    var el = $id("sc-log-line");
    if (!el) {
        return;
    }
    el.textContent = "muther: " + text;
    el.className = isError ? "alert" : "";
    clearTimeout(say._t);
    say._t = setTimeout(function () { el.textContent = ""; el.className = ""; }, 6000);
}

/* ---- duration ------------------------------------------------------------- */

function since(ms) {
    if (ms === null || ms === undefined) {
        return "";
    }
    var s = Math.round(ms / 1000);
    if (s < 60) { return s + " sec"; }
    var m = Math.round(s / 60);
    if (m < 60) { return m + " min"; }
    var h = Math.floor(m / 60);
    if (h < 48) { return h + " hr"; }
    return Math.floor(h / 24) + " days";
}

/* ---- the 3D map ------------------------------------------------------------ */

function placeMarkers() {
    if (!window.HouseSecurity || !feeds) {
        return;
    }
    var list = [];

    feeds.doors().forEach(function (d) {
        if (d.spot) {
            list.push({ id: d.id, kind: "door", x: d.spot.x, z: d.spot.z,
                        level: d.spot.level, axis: d.spot.axis, label: d.spot.label });
        }
    });

    feeds.leaks().forEach(function (l) {
        var c = l.room ? roomCentre(l.room) : null;
        if (c) {
            list.push({ id: l.id, kind: "leak", x: c.x, z: c.z,
                        level: l.room && c.y ? 1 : 0, label: l.name });
        }
    });

    feeds.cameras().forEach(function (cam) {
        if (cam.spot) {
            list.push({ id: cam.id, kind: "camera", x: cam.spot.x, z: cam.spot.z,
                        level: cam.spot.level, heading: cam.spot.heading, label: cam.spot.label });
        }
    });

    window.HouseSecurity.markers(list);
}

/* Colour and blink for every marker, recomputed each frame. */
function markerState() {
    var out = {};
    if (!feeds) {
        return out;
    }
    feeds.doors().forEach(function (d) {
        out[d.id] = { color: d.open ? ALERT : CYAN, blink: d.open };
    });
    feeds.leaks().forEach(function (l) {
        out[l.id] = { color: l.wet ? ALERT : CYAN, blink: l.wet };
    });
    feeds.cameras().forEach(function (c) {
        out[c.id] = { color: CYAN, blink: false };
    });
    return out;
}

/* Rooms with a wet sensor flood orange. Everything else stays neutral so the
   flood is the only thing shouting. */
function paintRooms() {
    if (!window.HouseSecurity || !feeds) {
        return;
    }
    var tints = {};
    feeds.leaks().forEach(function (l) {
        if (l.wet && l.room) {
            tints[l.room] = { color: ALERT, opacity: 0.42 };
        }
    });
    window.HouseSecurity.tint(tints);
}

function onMarkerPick(marker) {
    selected = marker ? marker.id : null;
    dirty = true;
    renderDetail();
}

function renderDetail() {
    var box = $id("sc-detail");
    if (!box) {
        return;
    }
    if (!selected || !feeds) {
        box.style.display = "none";
        return;
    }
    var all = feeds.doors().concat(feeds.leaks(), feeds.cameras());
    var item = null;
    for (var i = 0; i < all.length; i++) {
        if (all[i].id === selected) { item = all[i]; }
    }
    if (!item) {
        box.style.display = "none";
        return;
    }
    var bad = item.open || item.wet;
    box.style.display = "block";
    box.className = bad ? "alert" : "";
    box.innerHTML = '<b>' + item.name + '</b>' +
        '<span>' + (item.area || "") + '</span>' +
        '<span>' + stateWord(item) + ' for ' + since(item.held) + '</span>' +
        '<button id="sc-detail-close">close</button>';
}

function stateWord(item) {
    if (item.wet !== undefined) { return item.wet ? "WET" : "dry"; }
    if (item.open !== undefined) { return item.open ? "OPEN" : "closed"; }
    return item.state;
}

/* ---- entry points list ------------------------------------------------------ */

function group(title, items, word) {
    if (!items.length) {
        return "";
    }
    var html = '<div class="sc-group"><div class="sc-group-head">' + title + '</div>';
    items.forEach(function (it) {
        var bad = it.open || it.wet || it.active;
        html += '<div class="sc-row' + (bad ? " bad" : "") + '" data-id="' + it.id + '">' +
            '<span class="sc-row-name">' + it.name + '</span>' +
            '<span class="sc-row-state">' + (bad ? word.on : word.off) + '</span>' +
            '<span class="sc-row-age">' + since(it.held) + '</span>' +
            '</div>';
    });
    return html + '</div>';
}

function renderEntryList() {
    var box = $id("sc-entry");
    if (!box || !feeds) {
        return;
    }
    var doors = feeds.doors();
    var html = "";
    html += group("Doors", doors.filter(function (d) { return !d.garage; }),
                  { on: "OPEN", off: "closed" });
    html += group("Garage", doors.filter(function (d) { return d.garage; }),
                  { on: "OPEN", off: "closed" });
    html += group("Leaks", feeds.leaks(), { on: "WET", off: "dry" });
    html += group("Motion", feeds.motion(), { on: "ACTIVE", off: "clear" });
    box.innerHTML = html || '<span class="sc-wait">Waiting</span>';
}

/* ---- alarm ------------------------------------------------------------------- */

var STATE_LABEL = {
    disarmed: "Disarmed", armed_home: "Armed Home", armed_away: "Armed Away",
    armed_night: "Armed Night", arming: "Arming", pending: "Pending",
    triggered: "TRIGGERED"
};

function renderAlarm() {
    var box = $id("sc-alarm");
    if (!box || !feeds) {
        return;
    }
    var a = feeds.alarm();

    if (!a.configured) {
        box.innerHTML = '<div class="sc-alarm-state alert">ALARM NOT CONFIGURED</div>' +
            '<div class="sc-alarm-note">Alarmo reports "' + a.state + '". ' +
            'The controls stay disabled until it has usable modes.</div>';
        $id("security-screen").classList.remove("triggered");
        return;
    }

    var triggered = a.state === "triggered";
    $id("security-screen").classList.toggle("triggered", triggered);

    var cls = triggered ? "alert" : a.state === "disarmed" ? "" : "armed";
    var html = '<div class="sc-alarm-state ' + cls + '">' +
        (STATE_LABEL[a.state] || a.state) + '</div>';
    html += '<div class="sc-alarm-note">' + since(a.held) + '</div>';

    if (a.openSensors) {
        html += '<div class="sc-alarm-note alert">Open: ' +
            Object.keys(a.openSensors).length + ' sensor(s)</div>';
    }

    html += '<div class="sc-alarm-buttons">';
    a.modes.forEach(function (m) {
        html += '<button data-alarm="' + m.key + '">' + m.label + '</button>';
    });
    html += '<button data-alarm="disarm" class="wide">Disarm</button>';
    html += '</div>';

    if (keypad.open) {
        html += '<div class="sc-keypad"><div class="sc-keypad-head">Code for ' +
            keypad.service.replace("_", " ") + '</div>' +
            '<div class="sc-keypad-dots">' +
            (keypad.code.replace(/./g, "●") || "····") + '</div>' +
            '<div class="sc-keypad-keys">';
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "enter"].forEach(function (k) {
            html += '<button data-key="' + k + '">' + k + '</button>';
        });
        html += '</div></div>';
    }

    box.innerHTML = html;
}

function renderLocks() {
    var panel = $id("sc-locks");
    if (!panel || !feeds) {
        return;
    }
    var locks = feeds.locks();
    /* No lock entities exist in this house, so the whole panel is removed
       from the grid rather than left as an empty box. */
    panel.style.display = locks.length ? "" : "none";
    if (!locks.length) {
        return;
    }
    var html = "";
    locks.forEach(function (l) {
        html += '<div class="sc-lock' + (l.locked ? "" : " bad") + '">' +
            '<span>' + l.name + '</span>' +
            '<b>' + (l.locked ? "Locked" : "UNLOCKED") + '</b>' +
            '<button data-lock="' + l.id + '" data-do="lock">Lock</button>' +
            '<button data-lock="' + l.id + '" data-do="unlock">Unlock</button>' +
            '</div>';
    });
    $id("sc-locks-body").innerHTML = html;
}

/* ---- camera ------------------------------------------------------------------ */

function renderCamera() {
    var box = $id("sc-camera-body");
    var head = $id("sc-camera-name");
    if (!box || !feeds) {
        return;
    }
    var cams = feeds.cameras();
    if (!cams.length) {
        box.innerHTML = '<span class="sc-wait">No cameras</span>';
        return;
    }

    /* Follow the latest event: the camera in the same room, else the doorbell. */
    var want = null;
    if (feeds.lastEvent) {
        for (var i = 0; i < cams.length; i++) {
            if (cams[i].room && cams[i].room === feeds.lastEvent.room) {
                want = cams[i];
            }
        }
    }
    if (!want) {
        want = cams[0];
    }

    if (head) {
        head.textContent = want.name +
            (feeds.lastEvent ? "  " + since(Date.now() - feeds.lastEvent.at) + " ago" : "");
    }

    if (lastCamera !== want.id) {
        lastCamera = want.id;
        /* The camera proxy stream, which is what the Home Assistant frontend
           uses. It needs no token in the page because the signed path is in
           entity_picture. */
        /* entity_picture is a path on the Home Assistant host, not on the
           machine serving this page, so it needs the HA origin in front of
           it. The signed token is already in the path, so no header is
           needed and no token is held here. */
        var base = (window.HA_CONFIG && window.HA_CONFIG.httpUrl) || "";
        box.innerHTML = want.picture
            ? '<img src="' + base + want.picture + '" alt="' + want.name + '">'
            : '<span class="sc-wait">No stream for ' + want.name + '</span>';
    }
}

/* ---- log ---------------------------------------------------------------------- */

function renderLog() {
    var box = $id("sc-log");
    if (!box || !feeds) {
        return;
    }
    if (!feeds.log.length) {
        box.innerHTML = '<div class="sc-wait">No security events yet</div>';
        return;
    }
    var html = "";
    for (var i = 0; i < feeds.log.length && i < 40; i++) {
        var e = feeds.log[i];
        var t = new Date(e.at);
        var h = t.getHours() % 12 || 12;
        html += '<div class="sc-log-row ' + e.severity + '">' +
            '<span class="t">' + h + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds()) +
            (t.getHours() < 12 ? "a" : "p") + '</span>' +
            '<span class="w">' + (e.where || "") + '</span>' +
            '<span class="n">' + e.name + '</span>' +
            '<span class="k">' + e.kind + '</span></div>';
    }
    box.innerHTML = html;
}

/* ---- 24 hour activity ---------------------------------------------------------- */

function drawActivity() {
    if (!activityCtx || !activityCanvas || !feeds || !feeds.activity) {
        return;
    }
    var w = activityCanvas.clientWidth, h = activityCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var ctx = activityCtx;
    ctx.clearRect(0, 0, w, h);

    var a = feeds.activity;
    var left = 24, right = 4, top = 8, bottom = 14;
    var pw = w - left - right, ph = h - top - bottom;

    /* Doors open a handful of times an hour, motion fires hundreds. On one
       shared scale the door bars round to nothing, so each series gets its
       own scale and its own maximum is printed beside its colour. */
    var maxDoors = 1, maxMotion = 1, i;
    for (i = 0; i < 24; i++) {
        maxDoors = Math.max(maxDoors, a.doors[i]);
        maxMotion = Math.max(maxMotion, a.motion[i]);
    }

    ctx.font = "10px Menlo, Consolas, monospace";
    ctx.strokeStyle = "rgba(0,238,238,.12)";
    for (i = 0; i <= 2; i++) {
        var y = Math.floor(top + ph - ph * i / 2) + 0.5;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    }
    ctx.fillStyle = "#3fe0ff";
    ctx.fillText(String(maxDoors), 2, top + 8);
    ctx.fillStyle = "#4dffb0";
    ctx.fillText(String(maxMotion), 2, top + 19);

    var bw = pw / 24;
    var half = Math.max(1, (bw - 3) / 2);
    for (i = 0; i < 24; i++) {
        var x = left + i * bw;
        var dh = (a.doors[i] / maxDoors) * ph;
        var mh = (a.motion[i] / maxMotion) * ph;
        if (mh > 0) {
            ctx.fillStyle = "rgba(77,255,176,.75)";
            ctx.fillRect(x + 1 + half, top + ph - mh, half, mh);
        }
        if (dh > 0) {
            ctx.fillStyle = "#3fe0ff";
            ctx.fillRect(x + 1, top + ph - dh, half, dh);
        }
        if (i % 6 === 0) {
            var hr = new Date(a.start + i * 3600000).getHours() % 12 || 12;
            ctx.fillStyle = "rgba(0,238,238,.5)";
            ctx.fillText(String(hr), x, h - 3);
        }
    }
}

/* ---- clock ---------------------------------------------------------------------- */

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"];

function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
}

function renderClock() {
    var el = $id("sc-time");
    if (!el) {
        return;
    }
    var now = new Date();
    var h = now.getHours();
    el.innerHTML = (h % 12 || 12) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) +
        "<small>" + (h < 12 ? "AM" : "PM") + "</small>";
    var d = $id("sc-date");
    if (d) {
        d.textContent = DAYS[now.getDay()] + ", " + MONTHS[now.getMonth()] + " " +
            now.getDate() + ", " + now.getFullYear();
    }
}

/* ---- controls --------------------------------------------------------------------- */

function bindControls() {
    $id("security-screen").addEventListener("click", function (e) {
        var btn = e.target.closest("button");
        var row = e.target.closest(".sc-row");

        if (row && !btn) {
            selected = row.getAttribute("data-id");
            renderDetail();
            return;
        }
        if (!btn || !feeds) {
            return;
        }

        if (btn.id === "sc-detail-close") {
            selected = null;
            renderDetail();
            return;
        }

        if (btn.hasAttribute("data-alarm")) {
            var service = btn.getAttribute("data-alarm");
            var a = feeds.alarm();
            /* Only ask for a code when Home Assistant says one is needed. It
               is held in memory for the one call and never stored. */
            if (a.codeFormat && (service === "disarm" || a.codeArmRequired)) {
                keypad = { open: true, service: service, code: "" };
                renderAlarm();
            } else {
                feeds.setAlarm(service, null, say);
            }
            return;
        }

        if (btn.hasAttribute("data-key")) {
            var k = btn.getAttribute("data-key");
            if (k === "clear") {
                keypad.code = "";
            } else if (k === "enter") {
                var code = keypad.code;
                var svc = keypad.service;
                keypad = { open: false, service: null, code: "" };
                feeds.setAlarm(svc, code, say);
                code = null;
            } else {
                keypad.code += k;
            }
            renderAlarm();
            return;
        }

        if (btn.hasAttribute("data-lock")) {
            var id = btn.getAttribute("data-lock");
            var wantLock = btn.getAttribute("data-do") === "lock";
            if (!wantLock && !window.confirm("Unlock " + id + "?")) {
                return;
            }
            feeds.setLock(id, wantLock, say);
        }
    });
}

export { SecurityView };
