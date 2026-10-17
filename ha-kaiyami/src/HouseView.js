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
import { HouseFeeds } from "./HouseFeeds.js";
import { Severity } from "../../app/js/message.js";

var TIMELINE_WINDOW = 10 * 60 * 1000;   // 10 minutes across the strip
var HIT_RADIUS = 7;                     // px, how near the pointer has to be

function $id(id) {
    return document.getElementById(id);
}

var HouseView = {};

var state = null;
var feeds = null;
var selected = null;
var active = false;
var dirty = true;
var lastRender = 0;
var resizeTimer = null;
var observer = null;
var timelineCanvas = null;
var timelineCtx = null;
var energyCanvas = null;
var energyCtx = null;
/* Screen position of every mark drawn, so the pointer can be matched to an
   event without searching the whole ring buffer on each mousemove. */
var marks = [];
var feedsDirty = true;

HouseView.init = function (ha) {
    if (!state) {
        state = new HouseState();
    }

    /* Laid out but not painted. onSwitch shows the splash for three seconds
       first, and this screen is a fixed, full viewport, opaque grid: if it
       were visible now it would cover the splash completely. visibility
       keeps the geometry so the panels can still measure themselves. */
    var root = $id("house-screen");
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;

    buildFloorButtons();
    timelineCanvas = $id("hs-timeline-canvas");
    timelineCtx = timelineCanvas ? timelineCanvas.getContext("2d") : null;
    energyCanvas = $id("hs-en-canvas");
    energyCtx = energyCanvas ? energyCanvas.getContext("2d") : null;
    bindTimelineHover();

    if (!feeds && ha) {
        feeds = new HouseFeeds(ha, function () { feedsDirty = true; });
        feeds.start();
    }

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
    var root = $id("house-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
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

    if (feedsDirty) {
        feedsDirty = false;
        renderWeather();
        renderEnergy();
    }

    renderClock();
    drawEnergyChart();
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
    sizeCanvases();
    feedsDirty = true;
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

/* ---- clock --------------------------------------------------------------- */

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"];

function renderClock() {
    var el = $id("hs-time");
    if (!el) {
        return;
    }
    var now = new Date();

    var h = now.getHours();
    var suffix = h < 12 ? "AM" : "PM";
    var h12 = h % 12;
    if (h12 === 0) {
        h12 = 12;
    }

    el.innerHTML = h12 + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) +
        "<small>" + suffix + "</small>";

    var date = $id("hs-date");
    if (date) {
        date.textContent = DAYS[now.getDay()] + ", " + MONTHS[now.getMonth()] +
            " " + now.getDate() + ", " + now.getFullYear();
    }
}

/* ---- weather ------------------------------------------------------------- */

function degrees(v, unit) {
    return v === null || v === undefined ? "--" : Math.round(v) + (unit || "");
}

function hourLabel(at) {
    var d = new Date(at);
    var h = d.getHours() % 12;
    if (h === 0) {
        h = 12;
    }
    return h + (d.getHours() < 12 ? "a" : "p");
}

function renderWeather() {
    var box = $id("hs-wx-body");
    if (!box) {
        return;
    }
    var w = feeds && feeds.weather;
    if (!w) {
        box.innerHTML = '<span class="hs-wait">No weather entity</span>';
        return;
    }

    var unit = w.unit || "";
    var html =
        '<div id="hs-wx-now">' +
            '<div id="hs-wx-temp">' + degrees(w.temp, unit) + '</div>' +
            '<div id="hs-wx-cond">' + String(w.condition || "").replace(/_/g, " ") + '</div>' +
        '</div>' +
        '<div id="hs-wx-stats">' +
            '<span>High</span><b>' + degrees(w.high, unit) + '</b>' +
            '<span>Low</span><b>' + degrees(w.low, unit) + '</b>' +
            '<span>Humidity</span><b>' + (w.humidity === null ? "--" : Math.round(w.humidity) + "%") + '</b>' +
        '</div>';

    if (w.hours && w.hours.length) {
        html += '<div id="hs-wx-hours">';
        for (var i = 0; i < w.hours.length; i++) {
            html += '<div><span>' + hourLabel(w.hours[i].at) + '</span><b>' +
                degrees(w.hours[i].temp, "") + '</b></div>';
        }
        html += '</div>';
    }

    box.innerHTML = html;
}

/* ---- energy -------------------------------------------------------------- */

function renderEnergy() {
    var box = $id("hs-en-body");
    if (!box) {
        return;
    }
    var e = feeds && feeds.energy;
    if (!e || e.watts === null) {
        box.innerHTML = '<span class="hs-wait">No power sensors</span>';
        return;
    }

    var scope = $id("hs-en-scope");
    if (scope) {
        scope.textContent = e.whole ? "Whole house" : "Monitored";
        scope.title = e.whole ? "" : e.meters + " circuits reporting, no whole house meter";
    }

    box.innerHTML =
        '<span id="hs-en-now">' + (e.watts / 1000).toFixed(2) + '<i>kW</i></span>' +
        '<span id="hs-en-today"><span>Today</span> <b>' +
            (e.todayKwh === null ? "--" : e.todayKwh.toFixed(1) + " kWh") +
        '</b></span>';
}

function drawEnergyChart() {
    if (!energyCtx || !energyCanvas) {
        return;
    }
    var w = energyCanvas.clientWidth;
    var h = energyCanvas.clientHeight;
    if (!w || !h) {
        return;
    }

    var ctx = energyCtx;
    ctx.clearRect(0, 0, w, h);

    var series = (feeds && feeds.energy.series) || [];
    var points = [], i;
    for (i = 0; i < series.length; i++) {
        if (series[i] !== null && isFinite(series[i])) {
            points.push({ i: i, v: series[i] });
        }
    }
    if (points.length < 2) {
        return;
    }

    var max = 0, min = Infinity;
    for (i = 0; i < points.length; i++) {
        if (points[i].v > max) { max = points[i].v; }
        if (points[i].v < min) { min = points[i].v; }
    }
    /* A flat trace sits in the middle rather than dividing by zero. */
    if (max - min < 1) {
        max = min + 1;
    }

    var span = series.length - 1 || 1;
    var xAt = function (idx) { return (idx / span) * w; };
    var yAt = function (v) { return h - 1 - ((v - min) / (max - min)) * (h - 2); };

    /* Filled area under the trace, the way Encom's charts read. */
    ctx.beginPath();
    ctx.moveTo(xAt(points[0].i), h);
    for (i = 0; i < points.length; i++) {
        ctx.lineTo(xAt(points[i].i), yAt(points[i].v));
    }
    ctx.lineTo(xAt(points[points.length - 1].i), h);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,238,238,.14)";
    ctx.fill();

    ctx.beginPath();
    for (i = 0; i < points.length; i++) {
        var px = xAt(points[i].i), py = yAt(points[i].v);
        if (i) { ctx.lineTo(px, py); } else { ctx.moveTo(px, py); }
    }
    ctx.strokeStyle = "#00eeee";
    ctx.lineWidth = 1;
    ctx.stroke();

    /* Head of the trace, so now is findable at a glance. */
    var last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(xAt(last.i), yAt(last.v), 1.8, 0, Math.PI * 2);
    ctx.fillStyle = "#e6fbff";
    ctx.fill();
}

/* ---- timeline ------------------------------------------------------------ */

function sizeOne(canvas, ctx) {
    if (!canvas || !ctx) {
        return;
    }
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function sizeCanvases() {
    sizeOne(timelineCanvas, timelineCtx);
    sizeOne(energyCanvas, energyCtx);
}

function colorFor(severity) {
    return severity === Severity.ALERT ? "#ff8a1f"
        : severity === Severity.MOTION ? "#4dffb0"
        : "#00eeee";
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

    var now = Date.now();
    var events = (state && state.events) || [];
    var top = Math.min(18, h * 0.3);     // room for the minute labels and legend
    var base = h - 1;
    var i, gx;

    /* Minute grid. */
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.lineWidth = 1;
    for (i = 0; i <= 10; i++) {
        gx = Math.floor(w * i / 10) + 0.5;
        ctx.beginPath();
        ctx.moveTo(gx, top);
        ctx.lineTo(gx, base);
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(0, base + 0.5);
    ctx.lineTo(w, base + 0.5);
    ctx.strokeStyle = "rgba(0,238,238,.35)";
    ctx.stroke();

    ctx.fillStyle = "rgba(0,238,238,.55)";
    ctx.font = "10px Menlo, Consolas, monospace";
    for (i = 0; i <= 10; i += 2) {
        ctx.fillText((10 - i) + "m", Math.floor(w * i / 10) + 3, 10);
    }

    /* One mark per event, tall for alerts so trouble stands out of a busy
       strip, and remembered so the pointer can be matched to an event. */
    marks = [];
    var drawn = 0;
    for (i = 0; i < events.length; i++) {
        var ev = events[i];
        var age = now - ev.at;
        if (age < 0 || age > TIMELINE_WINDOW) {
            continue;
        }
        drawn++;

        var px = w * (1 - age / TIMELINE_WINDOW);
        var isAlert = ev.severity === Severity.ALERT;
        var isMotion = ev.severity === Severity.MOTION;
        var height = isAlert ? (base - top)
            : isMotion ? (base - top) * 0.66
            : (base - top) * 0.42;
        var py = base - height;

        ctx.strokeStyle = colorFor(ev.severity);
        ctx.globalAlpha = isAlert ? 1 : 0.8;
        ctx.beginPath();
        ctx.moveTo(px, base);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (isAlert) {
            ctx.fillStyle = "#ff8a1f";
            ctx.fillRect(px - 1.5, py - 3, 3, 3);
        }

        marks.push({ x: px, y: py, ev: ev });
    }

    var wrap = $id("hs-tl");
    if (wrap) {
        if (drawn) {
            wrap.classList.remove("empty");
        } else {
            wrap.classList.add("empty");
        }
    }
}

/* ---- timeline hover ------------------------------------------------------ */

function bindTimelineHover() {
    var wrap = $id("hs-tl");
    var tip = $id("hs-tl-tip");
    if (!wrap || !tip || wrap.getAttribute("data-hover")) {
        return;
    }
    wrap.setAttribute("data-hover", "1");

    var move = function (clientX, clientY) {
        var box = wrap.getBoundingClientRect();
        var x = clientX - box.left;
        var y = clientY - box.top;

        var best = null, bestDx = HIT_RADIUS + 1, i, dx;
        for (i = 0; i < marks.length; i++) {
            dx = Math.abs(marks[i].x - x);
            if (dx < bestDx) {
                bestDx = dx;
                best = marks[i];
            }
        }

        if (!best) {
            tip.style.display = "none";
            return;
        }

        var ev = best.ev;
        var ago = Math.max(0, Math.round((Date.now() - ev.at) / 1000));
        var when = ago < 60 ? ago + "s ago" : Math.round(ago / 60) + "m ago";
        var value = ev.state === null || ev.state === undefined
            ? "" : " is " + ev.state + (ev.unit ? " " + ev.unit : "");

        tip.className = ev.severity === Severity.ALERT ? "alert"
            : ev.severity === Severity.MOTION ? "motion" : "";
        tip.innerHTML = "<b>" + (ev.location || "Unassigned") + "</b> " +
            ev.title + value + ", " + when;
        tip.style.display = "block";

        /* Keep the label inside the panel rather than letting it run off the
           right hand edge for an event near the live end of the strip. */
        var tw = tip.offsetWidth;
        var left = Math.min(Math.max(0, best.x + 10), Math.max(0, box.width - tw));
        tip.style.left = left + "px";
        tip.style.top = Math.max(0, Math.min(y - 24, box.height - tip.offsetHeight)) + "px";
    };

    wrap.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); });
    wrap.addEventListener("mouseleave", function () { tip.style.display = "none"; });
    wrap.addEventListener("touchstart", function (e) {
        if (e.touches && e.touches.length) {
            move(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
    wrap.addEventListener("touchend", function () {
        setTimeout(function () { tip.style.display = "none"; }, 2500);
    });
}

export { HouseView };
