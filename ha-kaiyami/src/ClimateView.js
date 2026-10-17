/* The Climate screen.
 *
 * Exterior on the left, interior on the right, and a strip along the bottom,
 * laid out the same way the House screen is: a full viewport CSS grid sized in
 * fr units rather than Encom's fixed 1900x715 canvas. Every panel sizes from
 * its own cell, nothing here hardcodes pixels.
 *
 * Only comfort data appears here. The entity list in ClimateFeeds.js is fixed
 * by hand for exactly that reason.
 */

import { ClimateFeeds, HOME } from "./ClimateFeeds.js";
import { Radar } from "./Radar.js";

function $id(id) {
    return document.getElementById(id);
}

var ClimateView = {};

var feeds = null;
var radar = null;
var active = false;
var dirty = true;
var lastRender = 0;
var resizeTimer = null;
var observer = null;
var built = false;

var minutelyCanvas = null, minutelyCtx = null;
var trendCanvas = null, trendCtx = null;

/* Comfort band, for the thermal house and the temperature colours. */
var COOL = 66, WARM = 76;

ClimateView.init = function (ha) {
    var root = $id("climate-screen");

    /* Laid out but not painted, so the splash in onSwitch is what shows for
       its three seconds. Same split the House screen uses. */
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;

    minutelyCanvas = $id("cl-minutely-canvas");
    minutelyCtx = minutelyCanvas ? minutelyCanvas.getContext("2d") : null;
    trendCanvas = $id("cl-trend-canvas");
    trendCtx = trendCanvas ? trendCanvas.getContext("2d") : null;

    if (!feeds && ha) {
        feeds = new ClimateFeeds(ha, function () { dirty = true; });
        feeds.start();
    }

    if (!radar) {
        radar = new Radar({
            el: $id("cl-radar"),
            timeEl: $id("cl-radar-time"),
            windEl: $id("cl-radar-wind"),
            bannerEl: $id("cl-radar-banner"),
            legendEl: $id("cl-radar-legend"),
            scrubEl: $id("cl-radar-scrub"),
            home: HOME,
            zoom: 8
        });
    }

    if (!built) {
        built = true;
        bindControls();
    }

    if (window.HouseThermal) {
        window.HouseThermal.mount();
    }

    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            radar.mount();
            ClimateView.resize();
        });
    });

    watchPanels();
    dirty = true;
};

ClimateView.show = function () {
    active = true;
    var root = $id("climate-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
    ClimateView.resize();
};

ClimateView.hide = function () {
    active = false;
    $id("climate-screen").style.display = "none";
    if (window.HouseThermal) {
        window.HouseThermal.unmount();
    }
};

/* Climate reads the whole state map rather than individual messages, so a
   message is only a nudge to re-render. */
ClimateView.message = function () {
    dirty = true;
};

ClimateView.seed = function () {
    dirty = true;
};

ClimateView.animate = function () {
    if (!active) {
        return;
    }

    radar.tick();
    if (window.HouseThermal) {
        window.HouseThermal.animate();
    }

    renderClock();

    var now = Date.now();
    if (dirty && now - lastRender > 1000) {
        lastRender = now;
        dirty = false;
        renderExterior();
        renderAlerts();
        renderZones();
        renderAir();
        renderForecast();
        renderMinutely();
        renderTrend();
        paintThermalHouse();
    }
};

ClimateView.resize = function () {
    if (!active) {
        return;
    }
    radar.resize();
    sizeCanvas(minutelyCanvas, minutelyCtx);
    sizeCanvas(trendCanvas, trendCtx);
    if (window.HouseThermal) {
        window.HouseThermal.resize();
    }
    dirty = true;
};

ClimateView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        ClimateView.resize();
    }, 150);
};

function watchPanels() {
    if (observer || typeof ResizeObserver === "undefined") {
        return;
    }
    observer = new ResizeObserver(function () { ClimateView.resizeDebounced(); });
    ["cl-radar", "cl-minutely", "cl-trend", "cl-thermal"].forEach(function (id) {
        var el = $id(id);
        if (el) { observer.observe(el); }
    });
}

function sizeCanvas(canvas, ctx) {
    if (!canvas || !ctx) {
        return;
    }
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ---- the MUTHER line, where every change this screen sends is confirmed --- */

function say(text, isError) {
    var el = $id("cl-log");
    if (!el) {
        return;
    }
    el.textContent = "muther: " + text;
    el.className = isError ? "alert" : "";
    clearTimeout(say._t);
    say._t = setTimeout(function () {
        el.textContent = "";
        el.className = "";
    }, 6000);
}

/* ---- exterior -------------------------------------------------------------- */

function one(label, value, unit, cls) {
    return '<div class="cl-read' + (cls ? " " + cls : "") + '">' +
        '<span>' + label + '</span><b>' +
        (value === null || value === undefined || value === "" ? "--" : value) +
        (unit && value !== null && value !== undefined && value !== "" ? unit : "") +
        '</b></div>';
}

function compass(deg) {
    var names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return names[Math.round(((deg % 360) / 22.5)) % 16];
}

function renderExterior() {
    var box = $id("cl-exterior");
    if (!box || !feeds) {
        return;
    }
    var e = feeds.exterior();

    radar.setWind(e.windSpeed, e.windBearing);
    radar.setPrecip(feeds.hasPrecipitation());

    var html =
        '<div class="cl-now">' +
            '<div class="cl-now-temp">' + (e.temperature === null ? "--" : Math.round(e.temperature)) + '<i>F</i></div>' +
            '<div class="cl-now-cond">' + (e.summary || "") + '</div>' +
            '<div class="cl-now-feels">Feels ' + (e.apparent === null ? "--" : Math.round(e.apparent)) + 'F</div>' +
        '</div>';

    html += '<div class="cl-reads">';
    html += one("Humidity", e.humidity === null ? null : Math.round(e.humidity), "%");
    html += one("Dew point", e.dewPoint === null ? null : Math.round(e.dewPoint), "F");
    html += one("Wind", e.windSpeed === null ? null :
        Math.round(e.windSpeed) + " " + compass(e.windBearing || 0), " mph");
    html += one("Gust", e.windGust === null ? null : Math.round(e.windGust), " mph");
    html += one("UV index", e.uv === null ? null : e.uv.toFixed(1), "");
    html += one("Pressure", e.pressure === null ? null : e.pressure.toFixed(2), " inHg");
    html += one("Visibility", e.visibility === null ? null : e.visibility.toFixed(0), " mi");
    html += one("Rain chance", e.rainChance === null ? null : Math.round(e.rainChance), "%");
    html += one("Cloud", e.cloud === null ? null : Math.round(e.cloud), "%");
    html += '</div>';

    box.innerHTML = html;
}

function renderAlerts() {
    var box = $id("cl-alerts");
    if (!box || !feeds) {
        return;
    }
    if (!feeds.alerts.length) {
        /* Nothing to show, but say so differently when the last check did not
           get through, so a silent panel is never read as an all clear. */
        if (feeds.alertsOk === false) {
            box.style.display = "block";
            box.innerHTML = '<div class="cl-alert-down">Alerts unavailable, ' +
                'could not reach the National Weather Service</div>';
        } else {
            box.style.display = "none";
            box.innerHTML = "";
        }
        return;
    }
    box.style.display = "block";
    var html = "";
    for (var i = 0; i < feeds.alerts.length; i++) {
        var a = feeds.alerts[i];
        html += '<div class="cl-alert">' +
            '<b>' + a.event + '</b>' +
            '<span>' + (a.headline || a.severity) + '</span>' +
            '</div>';
    }
    box.innerHTML = html;
}

/* ---- HVAC zones ------------------------------------------------------------ */

var MODE_LABEL = { off: "Off", heat: "Heat", cool: "Cool", heat_cool: "Auto" };

function renderZones() {
    var wrap = $id("cl-zones");
    if (!wrap || !feeds) {
        return;
    }
    var zones = feeds.zones();
    var html = "";

    for (var i = 0; i < zones.length; i++) {
        var z = zones[i];
        var cooling = z.action === "cooling";
        var heating = z.action === "heating";
        var cls = "cl-zone" + (cooling ? " cooling" : "") + (heating ? " heating" : "");

        html += '<div class="' + cls + '" data-zone="' + z.key + '">';
        html += '<div class="cl-zone-head">' + z.label +
                '<em>' + (z.action ? z.action : "idle") + '</em></div>';

        html += '<div class="cl-zone-main">';
        html += '<div class="cl-zone-temp">' +
                    (z.current === null ? "--" : Math.round(z.current)) + '<i>F</i></div>';
        html += '<div class="cl-zone-set">' +
                    '<button class="cl-step" data-act="down" data-zone="' + z.key + '">-</button>' +
                    '<span class="cl-setpoint' + (z.dirty ? " pending" : "") + '">' +
                        (z.target === null ? "--" : Math.round(z.target)) + '</span>' +
                    '<button class="cl-step" data-act="up" data-zone="' + z.key + '">+</button>' +
                '</div>';
        html += '</div>';

        html += '<div class="cl-zone-stats">';
        html += one("Humidity", z.humidity === null ? null : Math.round(z.humidity), "%");
        html += one("Preset", z.preset || "none", "");
        html += '</div>';

        html += '<div class="cl-seg" data-kind="mode">';
        for (var m = 0; m < z.modes.length; m++) {
            var mode = z.modes[m];
            html += '<button class="' + (z.mode === mode ? "on" : "") +
                '" data-zone="' + z.key + '" data-mode="' + mode + '">' +
                (MODE_LABEL[mode] || mode) + '</button>';
        }
        html += '</div>';

        html += '<div class="cl-seg" data-kind="fan">';
        for (var f = 0; f < z.fanModes.length; f++) {
            var fan = z.fanModes[f];
            html += '<button class="' + (z.fan === fan ? "on" : "") +
                '" data-zone="' + z.key + '" data-fan="' + fan + '">' + fan + '</button>';
        }
        html += '</div>';

        html += '</div>';
    }
    wrap.innerHTML = html;
}

/* One delegated listener for the whole screen, bound once, so re-rendering
   the panels does not pile up handlers. */
function bindControls() {
    var root = $id("climate-screen");
    root.addEventListener("click", function (e) {
        var btn = e.target.closest("button");
        if (!btn || !feeds) {
            return;
        }

        if (btn.classList.contains("cl-step")) {
            feeds.nudgeSetpoint(btn.getAttribute("data-zone"),
                btn.getAttribute("data-act") === "up" ? 1 : -1, say);
            /* Straight away, not on the next render tick a second later, so
               the number answers the tap while the send is still debouncing. */
            renderZones();
            return;
        }
        if (btn.hasAttribute("data-mode")) {
            feeds.setMode(btn.getAttribute("data-zone"), btn.getAttribute("data-mode"), say);
            return;
        }
        if (btn.hasAttribute("data-fan")) {
            feeds.setFan(btn.getAttribute("data-zone"), btn.getAttribute("data-fan"), say);
            return;
        }
        if (btn.id === "cl-purifier") {
            feeds.togglePurifier(say);
        }
    });
}

/* ---- air quality ----------------------------------------------------------- */

function humidityClass(v, limits) {
    if (v === null) { return ""; }
    return v < limits.humidityLow || v > limits.humidityHigh ? "warn" : "";
}

function renderAir() {
    var box = $id("cl-air");
    if (!box || !feeds) {
        return;
    }
    var a = feeds.air();
    var L = a.limits;

    var html = '<div class="cl-air-group"><div class="cl-sub">Jovan’s Desk</div><div class="cl-reads">';
    html += one("Temp", a.deskTemp === null ? null : Math.round(a.deskTemp), "F");
    html += one("Humidity", a.deskHumidity === null ? null : Math.round(a.deskHumidity), "%",
                humidityClass(a.deskHumidity, L));
    html += one("CO2", a.deskCo2 === null ? null : Math.round(a.deskCo2), " ppm",
                a.deskCo2 !== null && a.deskCo2 > L.co2 ? "warn" : "");
    html += one("PM2.5", a.deskPm25 === null ? null : Math.round(a.deskPm25), "",
                a.deskPm25 !== null && a.deskPm25 > L.pm25 ? "warn" : "");
    html += '</div></div>';

    html += '<div class="cl-air-group"><div class="cl-sub">House</div><div class="cl-reads">';
    html += one("Upstairs PM2.5", a.upstairsPm25 === null ? null : Math.round(a.upstairsPm25), "",
                a.upstairsPm25 !== null && a.upstairsPm25 > L.pm25 ? "warn" : "");
    html += one("Upstairs VOC", a.upstairsVoc === null ? null : Math.round(a.upstairsVoc), "",
                a.upstairsVoc !== null && a.upstairsVoc > L.voc ? "warn" : "");
    html += one("Living VOC", a.livingVoc === null ? null : Math.round(a.livingVoc), "",
                a.livingVoc !== null && a.livingVoc > L.voc ? "warn" : "");
    html += one("Living humidity", a.livingHumidity === null ? null : Math.round(a.livingHumidity), "%",
                humidityClass(a.livingHumidity, L));
    html += one("Attic humidity", a.atticHumidity === null ? null : Math.round(a.atticHumidity), "%",
                humidityClass(a.atticHumidity, L));
    html += '</div></div>';

    html += '<div class="cl-air-group"><div class="cl-sub">Living Room Air</div>' +
        '<div class="cl-purifier">' +
            '<button id="cl-purifier" class="' + (a.purifierOn ? "on" : "") + '">' +
                (a.purifierOn === null ? "--" : a.purifierOn ? "On" : "Off") + '</button>' +
            '<span>' + (a.purifierPct === null ? "" : Math.round(a.purifierPct) + "%") +
            (a.purifierSpeed === null ? "" : " , speed " + a.purifierSpeed) + '</span>' +
        '</div></div>';

    box.innerHTML = html;
}

/* ---- next 60 minutes of rain ------------------------------------------------ */

function renderMinutely() {
    var note = $id("cl-minutely-note");
    var empty = $id("cl-minutely-empty");
    if (!note || !feeds) {
        return;
    }
    var m = feeds.minutely;

    var blank = function (short, long) {
        note.textContent = short;
        if (empty) {
            /* One span, because the box is a flex container and a bare text
               node plus a <b> would be laid out as two separate flex items. */
            empty.innerHTML = "<span>" + long + "</span>";
            empty.className = "show";
        }
    };

    if (!m) {
        blank("Loading", "Loading");
        return;
    }
    if (m.missingKey) {
        blank("No key", "Minute by minute rain needs a Pirate Weather key.<br>" +
            "Put <b>PW_KEY</b> in app/.env, then run tools/gen_config.py");
        return;
    }
    if (m.unavailable || !m.points || !m.points.length) {
        blank("Unavailable", "Minute by minute rain is not available for this location");
        return;
    }
    if (empty) {
        empty.className = "";
    }

    var first = -1, i;
    for (i = 0; i < m.points.length; i++) {
        if (m.points[i].intensity > 0.002 || m.points[i].probability > 0.25) {
            first = i;
            break;
        }
    }
    if (first < 0) {
        note.textContent = "No rain in the next hour";
    } else if (first === 0) {
        note.textContent = "Rain now";
    } else {
        note.textContent = "Rain starting in " + first + " min";
    }

    drawMinutely(m.points);
}

function drawMinutely(points) {
    if (!minutelyCtx || !minutelyCanvas) {
        return;
    }
    var w = minutelyCanvas.clientWidth, h = minutelyCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var ctx = minutelyCtx;
    ctx.clearRect(0, 0, w, h);

    var top = 12, base = h - 14;
    var max = 0.02, i;
    for (i = 0; i < points.length; i++) {
        if (points[i].intensity > max) { max = points[i].intensity; }
    }

    ctx.strokeStyle = "rgba(0,238,238,.10)";
    ctx.lineWidth = 1;
    for (i = 0; i <= 6; i++) {
        var gx = Math.floor(w * i / 6) + 0.5;
        ctx.beginPath();
        ctx.moveTo(gx, top);
        ctx.lineTo(gx, base);
        ctx.stroke();
    }

    var bw = w / points.length;
    for (i = 0; i < points.length; i++) {
        var p = points[i];
        var hh = Math.max(p.intensity > 0 ? 1 : 0, (p.intensity / max) * (base - top));
        if (hh <= 0) {
            continue;
        }
        ctx.fillStyle = p.intensity > 0.1 ? "#ff8a1f" : "#3fe0ff";
        ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, p.probability + 0.2);
        ctx.fillRect(i * bw, base - hh, Math.max(1, bw - 1), hh);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(0,238,238,.35)";
    ctx.beginPath();
    ctx.moveTo(0, base + 0.5);
    ctx.lineTo(w, base + 0.5);
    ctx.stroke();

    ctx.fillStyle = "rgba(0,238,238,.6)";
    ctx.font = "10px Menlo, Consolas, monospace";
    ctx.fillText("NOW", 2, h - 3);
    ctx.fillText("+30", w / 2 - 10, h - 3);
    ctx.fillText("+60", w - 22, h - 3);
}

/* ---- inside against outside, 24 hours --------------------------------------- */

function renderTrend() {
    if (!trendCtx || !trendCanvas || !feeds || !feeds.history) {
        return;
    }
    var w = trendCanvas.clientWidth, h = trendCanvas.clientHeight;
    if (!w || !h) {
        return;
    }

    var ctx = trendCtx;
    ctx.clearRect(0, 0, w, h);

    var hist = feeds.history;
    var left = 28, right = 4, top = 10, bottom = 16;
    var plotW = w - left - right, plotH = h - top - bottom;

    var all = hist.outside.concat(hist.upstairs, hist.downstairs);
    if (!all.length) {
        return;
    }
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < all.length; i++) {
        if (all[i].v < min) { min = all[i].v; }
        if (all[i].v > max) { max = all[i].v; }
    }
    min = Math.floor((min - 2) / 5) * 5;
    max = Math.ceil((max + 2) / 5) * 5;
    if (max - min < 5) { max = min + 5; }

    var xAt = function (t) { return left + ((t - hist.start) / (hist.end - hist.start)) * plotW; };
    var yAt = function (v) { return top + (1 - (v - min) / (max - min)) * plotH; };

    /* Gridlines and labels, same style the other charts use. */
    ctx.font = "10px Menlo, Consolas, monospace";
    ctx.strokeStyle = "rgba(0,238,238,.12)";
    ctx.fillStyle = "rgba(0,238,238,.55)";
    var steps = 4;
    for (i = 0; i <= steps; i++) {
        var v = min + (max - min) * i / steps;
        var y = Math.floor(yAt(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(w - right, y);
        ctx.stroke();
        ctx.fillText(Math.round(v) + "F", 2, y + 3);
    }
    for (i = 0; i <= 4; i++) {
        var t = hist.start + (hist.end - hist.start) * i / 4;
        var x = Math.floor(xAt(t)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, h - bottom);
        ctx.stroke();
        var d = new Date(t);
        var hr = d.getHours() % 12 || 12;
        ctx.fillText(hr + (d.getHours() < 12 ? "a" : "p"), x - 6, h - 4);
    }

    var line = function (series, color, dashed) {
        if (!series.length) {
            return;
        }
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash(dashed ? [4, 3] : []);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        for (var k = 0; k < series.length; k++) {
            var px = xAt(series[k].at), py = yAt(series[k].v);
            if (k) { ctx.lineTo(px, py); } else { ctx.moveTo(px, py); }
        }
        ctx.stroke();
        ctx.restore();
    };

    line(hist.outside, "#ff8a1f", true);
    line(hist.downstairs, "#2aa3bb", false);
    line(hist.upstairs, "#3fe0ff", false);
}

/* ---- 7 day forecast ---------------------------------------------------------- */

var DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* Plain glyphs rather than an icon set, so nothing extra has to load.
   Every one is in the basic multilingual plane and so is a single code unit.
   The windy glyph used to be written ἲC, which is not a valid four digit
   escape: JavaScript read it as ἲ followed by a literal C, which is why
   today showed a Greek letter and a C once the condition turned windy.
   Astral characters would need a surrogate pair, and would not render in the
   mono face anyway, so the set stays inside the BMP.
   All fifteen Home Assistant weather conditions are covered. */
var ICON = {
    "clear-night": "☾",
    cloudy: "☁",
    exceptional: "⚠",
    fog: "▒",
    hail: "⁂",
    lightning: "⚡",
    "lightning-rainy": "⚡",
    partlycloudy: "⛅",
    pouring: "☔",
    rainy: "☂",
    snowy: "❄",
    "snowy-rainy": "❅",
    sunny: "☀",
    windy: "≋",
    "windy-variant": "≋",
    /* Not Home Assistant conditions, but harmless aliases. */
    clear: "☀"
};

function renderForecast() {
    var box = $id("cl-forecast");
    if (!box || !feeds) {
        return;
    }
    if (!feeds.forecast.length) {
        box.innerHTML = '<span class="cl-wait">Waiting</span>';
        return;
    }
    var html = "";
    for (var i = 0; i < feeds.forecast.length; i++) {
        var d = feeds.forecast[i];
        var day = i === 0 ? "Today" : DAY_SHORT[new Date(d.at).getDay()];
        html += '<div class="cl-day">' +
            '<span class="cl-day-name">' + day + '</span>' +
            '<span class="cl-day-icon">' + (ICON[d.condition] || "·") + '</span>' +
            '<span class="cl-day-hi">' + (d.high === null ? "--" : Math.round(d.high)) + '</span>' +
            '<span class="cl-day-lo">' + (d.low === null ? "--" : Math.round(d.low)) + '</span>' +
            '<span class="cl-day-rain">' + (d.rain === null ? "" : Math.round(d.rain) + "%") + '</span>' +
            '</div>';
    }
    box.innerHTML = html;
}

/* ---- clock -------------------------------------------------------------------- */

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"];

function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
}

function renderClock() {
    var el = $id("cl-time");
    if (!el) {
        return;
    }
    var now = new Date();
    var h = now.getHours();
    var h12 = h % 12 || 12;
    el.innerHTML = h12 + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) +
        "<small>" + (h < 12 ? "AM" : "PM") + "</small>";
    var date = $id("cl-date");
    if (date) {
        date.textContent = DAYS[now.getDay()] + ", " + MONTHS[now.getMonth()] +
            " " + now.getDate() + ", " + now.getFullYear();
    }
}

/* ---- thermal house ------------------------------------------------------------ */

/* Blue below the comfort band, cyan inside it, orange above. */
function tempColor(f) {
    if (f <= COOL) {
        var c = Math.max(0, Math.min(1, (COOL - f) / 12));
        return { r: Math.round(63 - 40 * c), g: Math.round(140 - 60 * c), b: 255 };
    }
    if (f >= WARM) {
        var wmix = Math.max(0, Math.min(1, (f - WARM) / 12));
        return {
            r: Math.round(63 + (255 - 63) * wmix),
            g: Math.round(224 - (224 - 138) * wmix),
            b: Math.round(255 - (255 - 31) * wmix)
        };
    }
    return { r: 63, g: 224, b: 255 };
}

function paintThermalHouse() {
    if (!window.HouseThermal || !feeds) {
        return;
    }
    var temps = feeds.roomTemps();
    var tints = {};
    for (var key in temps) {
        if (temps.hasOwnProperty(key)) {
            var c = tempColor(temps[key]);
            tints[key] = { color: (c.r << 16) | (c.g << 8) | c.b, opacity: 0.3 };
        }
    }
    window.HouseThermal.tint(tints);
}

export { ClimateView };
