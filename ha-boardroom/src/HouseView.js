/* The House screen.
 *
 * Its own full viewport CSS grid rather than Encom's fixed 1900x715 canvas,
 * because that layout left the house sitting small in a corner with dead space
 * around it. The Encom look is kept: same palette, header rules, headings and
 * blinking accents. Only the geometry changed.
 *
 * Panels: the 3D house is the hero in the centre, stats and rooms on the
 * right, floor and room detail on the left, event timeline across the bottom.
 * The globe, the region list and the 2013 stock chart are not on this screen.
 *
 * Every widget sizes from its own panel. Nothing here hardcodes pixels.
 */
import { HouseState } from "./HouseState.js";
import { Severity } from "../../app/js/message.js";

var ZONES = [
    ["San Francisco", "America/Los_Angeles"],
    ["New York", "America/New_York"],
    ["London", "Europe/London"],
    ["Berlin", "Europe/Berlin"]
];

var TIMELINE_WINDOW = 10 * 60 * 1000;   // 10 minutes across the strip

function $id(id) {
    return document.getElementById(id);
}

var HouseView = {};

var state = null;
var started = 0;
var selected = null;
var active = false;
var dirty = true;
var lastRender = 0;
var resizeTimer = null;
var observer = null;
var timelineCanvas = null;
var timelineCtx = null;

HouseView.init = function () {
    if (!state) {
        state = new HouseState();
        started = Date.now();
    }

    $id("house-screen").style.display = "grid";
    active = true;

    buildFloorButtons();
    timelineCanvas = $id("hs-timeline-canvas");
    timelineCtx = timelineCanvas ? timelineCanvas.getContext("2d") : null;

    if (window.HouseWidget) {
        window.HouseWidget.mount();
    }

    /* The grid has to settle before anything can read its own panel size. */
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            HouseView.resize();
        });
    });

    watchPanels();
    dirty = true;
};

HouseView.show = function () {
    active = true;
    $id("house-screen").style.display = "grid";
    HouseView.resize();
};

HouseView.hide = function () {
    active = false;
    $id("house-screen").style.display = "none";
    if (window.HouseWidget) {
        window.HouseWidget.unmount();
    }
};

HouseView.message = function (m) {
    if (!state) {
        state = new HouseState();
        started = Date.now();
    }
    state.message(m);
    if (window.HouseWidget) {
        window.HouseWidget.message(m);
    }
    dirty = true;
};

/* Feed the initial state dump straight in, so the screen opens showing the
   house as it is rather than filling in as things happen to change. */
HouseView.seed = function (messages) {
    if (!state) {
        state = new HouseState();
        started = Date.now();
    }
    for (var i = 0; i < messages.length; i++) {
        state.message(messages[i], true);
        if (window.HouseWidget) {
            window.HouseWidget.message(messages[i]);
        }
    }
    dirty = true;
};

HouseView.animate = function () {
    if (!active) {
        return;
    }

    if (window.HouseWidget) {
        window.HouseWidget.animate();
    }

    var now = Date.now();
    if (dirty && now - lastRender > 1000) {
        lastRender = now;
        dirty = false;
        renderStats();
        renderRooms();
        renderDetail();
    }

    renderClock();
    drawTimeline();
};

/* One debounced handler for the whole screen. ResizeObserver also covers panel
   changes that are not window resizes, such as the grid reflowing. */
HouseView.resize = function () {
    if (!active) {
        return;
    }
    if (window.HouseWidget) {
        window.HouseWidget.resize();
    }
    sizeTimeline();
    dirty = true;
};

HouseView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        HouseView.resize();
    }, 150);
};

function watchPanels() {
    if (observer || typeof ResizeObserver === "undefined") {
        return;
    }
    observer = new ResizeObserver(function () {
        HouseView.resizeDebounced();
    });
    var targets = ["hs-house", "hs-timeline"];
    for (var i = 0; i < targets.length; i++) {
        var el = $id(targets[i]);
        if (el) {
            observer.observe(el);
        }
    }
}

function buildFloorButtons() {
    var wrap = $id("hs-floors");
    if (!wrap || wrap.getAttribute("data-built")) {
        return;
    }
    wrap.setAttribute("data-built", "1");

    var levels = [["Both", 0], ["Level 0", 1], ["Level 1", 2]];
    levels.forEach(function (pair, i) {
        var b = document.createElement("button");
        b.className = "hs-btn" + (i === 0 ? " on" : "");
        b.textContent = pair[0];
        b.onclick = function () {
            var all = wrap.querySelectorAll("button");
            for (var k = 0; k < all.length; k++) {
                all[k].classList.remove("on");
            }
            b.classList.add("on");
            if (window.HouseWidget && window.HouseWidget.setLevel) {
                window.HouseWidget.setLevel(pair[1]);
            }
        };
        wrap.appendChild(b);
    });
}

function renderStats() {
    var t = state.totals();
    $id("hs-stat-lights").textContent = t.lights;
    $id("hs-stat-alerts").textContent = t.alerts;
    $id("hs-stat-temp").textContent = t.avgTemp === null ? "--" : t.avgTemp.toFixed(1);
    $id("hs-stat-rooms").textContent = t.rooms;
    $id("hs-stat-alerts").parentNode.className = "hs-stat" + (t.alerts ? " alert" : "");
}

function renderRooms() {
    var rooms = state.allRooms();
    var html = [];

    /* Trouble first, then lit rooms, then the rest by name. */
    rooms.sort(function (a, b) {
        var bySeen = (b.seen ? 1 : 0) - (a.seen ? 1 : 0);
        if (bySeen) {
            return bySeen;
        }
        var byAlert = (b.alerts > 0) - (a.alerts > 0);
        if (byAlert) {
            return byAlert;
        }
        var byLight = (b.lights > 0) - (a.lights > 0);
        if (byLight) {
            return byLight;
        }
        return a.name.localeCompare(b.name);
    });

    for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i];
        var cls = r.alerts ? "alert" : r.motion ? "motion" : r.lights ? "on" : "";
        if (!r.seen) {
            cls += " dim";
        }
        html.push(
            '<tr class="' + cls + (selected === r.key ? " sel" : "") + '" data-room="' + r.key + '">' +
            '<td class="hs-r-name">' + r.name + '</td>' +
            '<td class="hs-r-lvl">L' + r.level + '</td>' +
            '<td class="hs-r-num">' + (r.temp === null ? "" : r.temp.toFixed(0)) + '</td>' +
            '<td class="hs-r-num">' + (r.humidity === null ? "" : r.humidity.toFixed(0)) + '</td>' +
            '<td class="hs-r-num hs-r-lt">' + (r.lights ? r.lights : "") + '</td>' +
            '<td class="hs-r-flag">' + (r.alerts ? r.alerts : r.motion ? "M" : "") + '</td>' +
            '</tr>');
    }

    /* Open on whatever is most worth looking at rather than an empty pane. */
    if (!selected && rooms.length && rooms[0].seen) {
        selected = rooms[0].key;
    }

    var body = $id("hs-rooms-body");
    body.innerHTML = html.join("");
    body.onclick = function (e) {
        var tr = e.target.closest("tr[data-room]");
        if (tr) {
            selectRoom(tr.getAttribute("data-room"));
        }
    };

    var sel = $id("hs-room-list");
    var names = [];
    for (var k = 0; k < rooms.length; k++) {
        names.push('<li class="' + (selected === rooms[k].key ? "sel" : "") +
            '" data-room="' + rooms[k].key + '">' + rooms[k].name + '</li>');
    }
    sel.innerHTML = names.join("");
    sel.onclick = function (e) {
        if (e.target.tagName === "LI") {
            selectRoom(e.target.getAttribute("data-room"));
        }
    };
}

function selectRoom(key) {
    selected = key;
    if (window.HouseWidget && window.HouseWidget.focus) {
        window.HouseWidget.focus(key);
    }
    dirty = true;
    renderRooms();
    renderDetail();
}

function renderDetail() {
    var box = $id("hs-detail");
    if (!selected) {
        box.innerHTML = '<div class="hs-empty">Select a room</div>';
        return;
    }

    var r = state.roomStats(selected);
    var rows = [
        ["Temp", r.temp === null ? "--" : r.temp.toFixed(1), ""],
        ["Humidity", r.humidity === null ? "--" : r.humidity.toFixed(0) + "%", ""],
        ["Motion", r.motion ? "Active" : "Clear", r.motion ? "motion" : ""],
        ["Lights on", r.lights, ""],
        ["Alerts", r.alerts, r.alerts ? "alert" : ""]
    ];

    var html = '<div class="hs-detail-name">' + r.name +
        '<span>Level ' + r.level + (r.estimated ? " , estimated" : "") + '</span></div><dl>';
    for (var i = 0; i < rows.length; i++) {
        html += '<dt>' + rows[i][0] + '</dt><dd class="' + rows[i][2] + '">' + rows[i][1] + '</dd>';
    }
    html += '</dl>';

    var devices = [];
    var id;
    for (id in r.devices) {
        if (r.devices.hasOwnProperty(id)) {
            devices.push(r.devices[id]);
        }
    }
    devices.sort(function (a, b) {
        return a.title.localeCompare(b.title);
    });

    if (devices.length) {
        html += '<div class="hs-dev-head">Devices</div><div class="hs-dev-list">';
        for (var d = 0; d < devices.length; d++) {
            var dev = devices[d];
            html += '<div class="hs-dev ' + (dev.severity === Severity.ALERT ? "alert" : "") + '">' +
                '<span>' + dev.title + '</span>' +
                '<b>' + (dev.state === null ? "" : dev.state) +
                (dev.unit ? " " + dev.unit : "") + '</b></div>';
        }
        html += '</div>';
    }

    box.innerHTML = html;
}

function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
}

function renderClock() {
    var el = $id("hs-elapsed");
    if (!el) {
        return;
    }
    var s = Math.floor((Date.now() - started) / 1000);
    el.textContent = pad(Math.floor(s / 3600)) + ":" +
        pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);

    var zonesEl = $id("hs-zones");
    if (zonesEl && !zonesEl.getAttribute("data-built")) {
        zonesEl.setAttribute("data-built", "1");
        var h = "";
        for (var i = 0; i < ZONES.length; i++) {
            h += '<div><span>' + ZONES[i][0] + '</span><b id="hs-tz-' + i + '"></b></div>';
        }
        zonesEl.innerHTML = h;
    }
    for (var z = 0; z < ZONES.length; z++) {
        var t = $id("hs-tz-" + z);
        if (t) {
            t.textContent = new Date().toLocaleTimeString("en-GB", {
                timeZone: ZONES[z][1],
                hour12: false
            });
        }
    }
}

function sizeTimeline() {
    if (!timelineCanvas) {
        return;
    }
    var panel = timelineCanvas.parentNode;
    var w = panel.clientWidth;
    var h = panel.clientHeight;
    if (!w || !h) {
        return;
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    timelineCanvas.width = Math.floor(w * dpr);
    timelineCanvas.height = Math.floor(h * dpr);
    timelineCanvas.style.width = w + "px";
    timelineCanvas.style.height = h + "px";
    timelineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawTimeline() {
    if (!timelineCtx || !timelineCanvas) {
        return;
    }
    var w = timelineCanvas.clientWidth;
    var h = timelineCanvas.clientHeight;
    if (!w || !h) {
        return;
    }

    var ctx = timelineCtx;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.lineWidth = 1;
    for (var i = 0; i <= 10; i++) {
        var x = Math.floor(w * i / 10) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.3);
        ctx.lineTo(x, h);
        ctx.stroke();
    }

    ctx.fillStyle = "rgba(0,238,238,.6)";
    ctx.font = "11px Menlo, Consolas, monospace";
    for (var g = 0; g <= 10; g += 2) {
        ctx.fillText((10 - g) + "m", Math.floor(w * g / 10) + 4, 12);
    }

    var now = Date.now();
    var events = state ? state.events : [];
    for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        var age = now - ev.at;
        if (age > TIMELINE_WINDOW) {
            continue;
        }
        var px = w * (1 - age / TIMELINE_WINDOW);
        var tall = ev.severity === Severity.ALERT;
        ctx.strokeStyle = tall ? "#ff8a1f"
            : ev.severity === Severity.MOTION ? "#4dffb0"
            : "rgba(0,238,238,.65)";
        ctx.beginPath();
        ctx.moveTo(px, h);
        ctx.lineTo(px, tall ? h * 0.36 : h * 0.6);
        ctx.stroke();
    }
}

export { HouseView };
