/* The Energy screen.
 *
 * Full viewport grid, same approach as House, Climate, Security and Cameras.
 * The hero is a Sankey of where the power goes: total on the left, categories
 * in the middle, devices on the right, with particles running along every link
 * so the flow is something you watch rather than read.
 *
 * d3 and d3-sankey are plain globals from cdnjs, loaded in index.html beside
 * Leaflet and hls.js. The fork's three.js r66 is untouched.
 *
 * Layout is d3-sankey on an SVG. The particles are a canvas on top, because
 * four hundred moving dots as SVG circles is a lot of DOM to reflow sixty
 * times a second, and because a canvas can draw them as glow without a filter.
 */

import { EnergyFeeds, CATEGORIES, HOUSE_METER } from "./EnergyFeeds.js";

var CYAN = "#3fe0ff";
var TEXT = "#bff4ff";
var ALERT = "#ff8a1f";
var ACCENT = "#4dffb0";

/* In NOW mode the live watts move constantly, and re-running the layout on
 * every change makes the diagram twitch. So the whole screen refreshes on this
 * one tick, diagram and panels together, while the particles keep running
 * smoothly in between. One tick matters for more than flicker: when the
 * diagram and the panels sampled the sensors at different moments, the same
 * device appeared with two different wattages at once.
 * EnergyFeeds holds its snapshot for less than this, so every pass gets fresh
 * readings and every panel within a pass gets the same ones. */
var REFRESH_MS = 2000;

/* Must match the en-wipe keyframes in energy-screen.css. */
var WIPE_MS = 460;
var WIPE_SWAP_MS = 150;

var RANGE_LABEL = { now: "Now", today: "Today", week: "This week", month: "This month" };

function $id(id) {
    return document.getElementById(id);
}

function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
}

var EnergyView = {};

var feeds = null;
var areas = null;
var active = false;
var built = false;
var dirty = true;
var range = "now";
var drill = null;          // category key when drilled in, else null
var selected = null;       // device key when the detail panel is open
var lastLayout = 0;
var lastRender = 0;
var resizeTimer = null;
var observer = null;
var wipeTimer = null, swapTimer = null;

var hoverKey = null;
var svg = null, particleCanvas = null, pctx = null;
var chartCanvas = null, cctx = null;
var curveCanvas = null, curveCtx = null;
var barsCanvas = null, barsCtx = null;

/* The laid out graph, kept between frames so the particles have something to
 * run along without a relayout. */
var layout = { links: [], nodes: [], total: 0, w: 0, h: 0 };
var particles = [];
var lastFrame = 0;

/* ---- lifecycle ------------------------------------------------------------- */

EnergyView.init = function (ha, areasRef) {
    var root = $id("energy-screen");
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;
    areas = areasRef;

    svg = $id("en-svg");
    particleCanvas = $id("en-particles");
    pctx = particleCanvas ? particleCanvas.getContext("2d") : null;
    chartCanvas = $id("en-chart-canvas");
    cctx = chartCanvas ? chartCanvas.getContext("2d") : null;
    curveCanvas = $id("en-detail-curve");
    curveCtx = curveCanvas ? curveCanvas.getContext("2d") : null;
    barsCanvas = $id("en-detail-bars");
    barsCtx = barsCanvas ? barsCanvas.getContext("2d") : null;

    if (!feeds && ha) {
        feeds = new EnergyFeeds(ha, areas, function () { dirty = true; });
        feeds.start();
    }

    if (!built) {
        built = true;
        bindControls();
    }

    watchPanels();

    requestAnimationFrame(function () {
        requestAnimationFrame(function () { EnergyView.resize(); });
    });

    dirty = true;
};

EnergyView.show = function () {
    active = true;
    var root = $id("energy-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
    EnergyView.resize();
};

EnergyView.hide = function () {
    active = false;
    $id("energy-screen").style.display = "none";
};

EnergyView.message = function (m) {
    if (feeds && feeds.note(m)) {
        dirty = true;
    }
};

EnergyView.seed = function () {
    dirty = true;
};

EnergyView.animate = function () {
    if (!active || !feeds) {
        return;
    }
    var now = Date.now();
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
    lastFrame = now;

    renderClock(now);
    stepParticles(dt);

    if (dirty && now - lastRender > REFRESH_MS) {
        lastRender = now;
        lastLayout = now;
        dirty = false;
        buildLayout();
        renderStatus();
        renderTop();
        drawHouseChart();
        renderDetail();
        renderNote();
    }
};

EnergyView.resize = function () {
    if (!active) {
        return;
    }
    sizeCanvas(particleCanvas, pctx);
    sizeCanvas(chartCanvas, cctx);
    sizeCanvas(curveCanvas, curveCtx);
    sizeCanvas(barsCanvas, barsCtx);
    lastLayout = 0;
    dirty = true;
    buildLayout();
    drawHouseChart();
};

EnergyView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        EnergyView.resize();
    }, 150);
};

function watchPanels() {
    if (observer || typeof ResizeObserver === "undefined") {
        return;
    }
    observer = new ResizeObserver(function () { EnergyView.resizeDebounced(); });
    ["en-sankey", "en-chart", "en-detail"].forEach(function (id) {
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

/* ---- formatting --------------------------------------------------------------- */

function watts(w) {
    if (w === null || w === undefined) {
        return "n/a";
    }
    if (w >= 1000) {
        return (w / 1000).toFixed(2) + " kW";
    }
    return (w >= 100 ? Math.round(w) : w.toFixed(1)) + " W";
}

function kwh(v) {
    if (v === null || v === undefined) {
        return "n/a";
    }
    if (v >= 100) {
        return Math.round(v) + " kWh";
    }
    return v.toFixed(v < 10 ? 2 : 1) + " kWh";
}

function money(v) {
    return v === null || v === undefined ? "" : "$" + v.toFixed(2);
}

function pct(v) {
    return (v >= 10 ? Math.round(v) : v.toFixed(1)) + "%";
}

/* The number a flow is labelled with depends on which range is showing. */
function valueText(v) {
    return range === "now" ? watts(v) : kwh(v);
}

function clockTime(ms) {
    var d = new Date(ms);
    return (d.getHours() % 12 || 12) + ":" + pad(d.getMinutes()) +
        (d.getHours() < 12 ? "a" : "p");
}

/* ---- the Sankey ----------------------------------------------------------------- */

function buildLayout() {
    var host = $id("en-sankey");
    if (!host || !svg || !feeds || !window.d3 || !window.d3.sankey) {
        return;
    }
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) {
        return;
    }

    var graph = feeds.flow(range, drill);

    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);

    if (!graph.links.length || graph.total <= 0) {
        svg.innerHTML = '<text x="' + (w / 2) + '" y="' + (h / 2) +
            '" text-anchor="middle" class="en-empty">' +
            (feeds.loaded ? "NO MEASURED DRAW IN THIS PERIOD" : "LOADING STATISTICS") +
            '</text>';
        layout = { links: [], nodes: [], total: 0, w: w, h: h };
        particles = [];
        return;
    }

    /* d3-sankey mutates what it is given, so it gets a copy each pass. */
    var nodes = graph.nodes.map(function (n) { return Object.assign({}, n); });
    var links = graph.links.map(function (l) { return Object.assign({}, l); });

    /* Reserve the right margin from the labels that actually have to fit, not
       from a fixed cap. A fixed 190px clipped "RxDegree Test Fridge 45.6 W" as
       soon as the window got wide enough to grow the font. */
    var fontPx = Math.max(8, Math.min(13, window.innerWidth * 0.0058));
    var charW = fontPx * 0.62;              // the monospace advance
    var longest = 0;
    nodes.forEach(function (n) {
        longest = Math.max(longest, String(n.label).length);
    });
    /* The name, two spaces, and room for a value like "1234.5 kWh". */
    var labelRoom = Math.max(90, Math.min(w * 0.42, (longest + 12) * charW + 14));
    var nodeW = Math.max(6, Math.min(13, w * 0.011));
    var pad = Math.max(7, Math.min(15, h / (nodes.length + 2)));

    var sankey = window.d3.sankey()
        .nodeWidth(nodeW)
        .nodePadding(pad)
        .extent([[2, 10], [w - labelRoom, h - 10]]);

    var out;
    try {
        out = sankey({ nodes: nodes, links: links });
    } catch (err) {
        /* A degenerate graph (every value zero) can throw rather than lay out. */
        svg.innerHTML = '<text x="' + (w / 2) + '" y="' + (h / 2) +
            '" text-anchor="middle" class="en-empty">NO MEASURED DRAW</text>';
        layout = { links: [], nodes: [], total: 0, w: w, h: h };
        particles = [];
        return;
    }

    var linkPath = window.d3.sankeyLinkHorizontal();
    var max = 0;
    out.links.forEach(function (l) { max = Math.max(max, l.value); });

    var parts = [];

    /* Orange belongs to one device drawing unusually, and to nothing else. A
       category and the total are sums, and a sum cannot itself be drawing too
       much. This is the gate: whatever the data says, only a device link and a
       device node are allowed the alert colour. */
    var alertable = function (d) {
        return !!d.unusual && (d.kind === "device" || !!d.device);
    };

    /* Links first so the node bars and the labels sit over them. */
    out.links.forEach(function (l, i) {
        var share = max > 0 ? l.value / max : 0;
        /* Brighter for bigger flows, which is the whole point of the picture. */
        var opacity = 0.18 + 0.58 * Math.sqrt(share);
        var hot = alertable(l);
        var colour = hot ? ALERT : CYAN;
        var d = linkPath(l);
        /* d3 gives the true width. A hairline floor keeps a small load visible
           without inflating its value anywhere a number is shown. */
        var sw = Math.max(1.1, l.width || 0);
        parts.push('<path class="en-link' + (hot ? " unusual" : "") +
            '" d="' + d + '" stroke="' + colour + '" stroke-width="' + sw +
            '" stroke-opacity="' + opacity.toFixed(3) +
            '" fill="none" data-link="' + i + '"></path>');
        l._d = d;
        l._sw = sw;
    });

    out.nodes.forEach(function (n, i) {
        var hgt = Math.max(2, (n.y1 - n.y0));
        var nodeHot = alertable(n);
        var colour = nodeHot ? ALERT : (n.kind === "root" ? ACCENT : CYAN);
        parts.push('<rect class="en-node en-node-' + n.kind +
            (nodeHot ? " unusual" : "") +
            '" x="' + n.x0 + '" y="' + n.y0 + '" width="' + (n.x1 - n.x0) +
            '" height="' + hgt + '" fill="' + colour +
            '" data-node="' + i + '"></rect>');

        /* Root and categories label to the right of their bar, devices too,
           because the layout reserves the right margin for exactly that. */
        var tx = n.x1 + 6;
        var ty = (n.y0 + n.y1) / 2;
        var anchor = "start";
        if (n.kind === "device" || (drill && n.kind === "root")) {
            /* Nothing to the right of the last column but the reserved margin. */
            anchor = "start";
        }
        var cls = "en-label en-label-" + n.kind + (nodeHot ? " unusual" : "");
        /* How many characters of the name still fit once the value and the
           gap have taken their share of the reserved margin. */
        var nameRoom = Math.floor((w - tx - 14) / charW) - 11;
        parts.push('<text class="' + cls + '" x="' + tx + '" y="' + ty +
            '" text-anchor="' + anchor + '" dominant-baseline="middle"' +
            ' data-node="' + i + '">' +
            '<tspan class="en-label-name">' + escapeText(fit(n.label, nameRoom)) + '</tspan>' +
            '<tspan class="en-label-val" dx="6">' +
            /* A device Home Assistant cannot reach reads OFFLINE rather than
               0.0 W, which would look like a device that is simply switched
               off. */
            (n.device && !n.device.available ? "OFFLINE" : valueText(n.value)) +
            '</tspan></text>');
    });

    svg.innerHTML = parts.join("");

    layout = { links: out.links, nodes: out.nodes, total: graph.total, w: w, h: h };

    /* The elements the tooltip was describing have just been replaced and the
       pointer has not moved, so nothing else would correct it. */
    refreshTip();
    seedParticles(out.links, max);
}

/* Trim a name to the room it has, with an ellipsis so it is obvious that it
 * was trimmed rather than looking like the device's real name. */
function fit(text, chars) {
    var t = String(text);
    if (!isFinite(chars) || chars < 4 || t.length <= chars) {
        return t;
    }
    return t.slice(0, chars - 1) + "…";
}

function escapeText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---- particles ------------------------------------------------------------------- */

/* Each link is sampled into a polyline once per layout. Interpolating along
 * that is far cheaper than calling getPointAtLength for every dot every frame,
 * and at this sample count the difference is not visible. */
function samplePath(d, n) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    var len = 0;
    try {
        len = el.getTotalLength();
    } catch (err) {
        return null;
    }
    if (!len || !isFinite(len)) {
        return null;
    }
    var pts = [];
    for (var i = 0; i <= n; i++) {
        var p = el.getPointAtLength((i / n) * len);
        pts.push(p.x, p.y);
    }
    return { pts: pts, len: len, n: n };
}

function seedParticles(links, max) {
    particles = [];
    if (!max) {
        return;
    }
    var alertable = function (d) {
        return !!d.unusual && (d.kind === "device" || !!d.device);
    };
    links.forEach(function (l, i) {
        var sampled = samplePath(l._d, 44);
        if (!sampled) {
            return;
        }
        l._path = sampled;

        var share = l.value / max;
        /* Density and speed both scale with the flow, so a heavy link is a
           thick fast stream and a trickle is a few slow dots. */
        var count = Math.max(1, Math.round(1 + 15 * Math.sqrt(share)));
        var speed = 26 + 130 * Math.sqrt(share);
        var hot = alertable(l);

        for (var k = 0; k < count; k++) {
            particles.push({
                link: i,
                at: Math.random(),
                speed: speed * (0.82 + Math.random() * 0.36),
                /* Spread across the ribbon rather than all on the centreline. */
                off: (Math.random() - 0.5) * Math.max(0, l._sw - 2) * 0.8,
                size: 0.9 + Math.random() * 1.1,
                unusual: hot
            });
        }
    });
}

function stepParticles(dt) {
    if (!pctx || !particleCanvas) {
        return;
    }
    var w = particleCanvas.clientWidth, h = particleCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    pctx.clearRect(0, 0, w, h);
    if (!particles.length || !layout.links.length) {
        return;
    }

    pctx.globalCompositeOperation = "lighter";

    for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var l = layout.links[p.link];
        if (!l || !l._path) {
            continue;
        }

        p.at += (p.speed * dt) / l._path.len;
        if (p.at > 1) {
            p.at -= 1;
        }

        var pts = l._path.pts;
        var f = p.at * l._path.n;
        var i0 = Math.floor(f);
        var t = f - i0;
        if (i0 >= l._path.n) {
            i0 = l._path.n - 1;
            t = 1;
        }
        var x = pts[i0 * 2] + (pts[i0 * 2 + 2] - pts[i0 * 2]) * t;
        var y = pts[i0 * 2 + 1] + (pts[i0 * 2 + 3] - pts[i0 * 2 + 1]) * t;

        /* Fade in and out at the ends so dots do not pop at the node bars. */
        var edge = Math.min(p.at, 1 - p.at);
        var alpha = Math.min(1, edge / 0.08) * 0.85;

        pctx.beginPath();
        pctx.arc(x, y + p.off, p.size, 0, Math.PI * 2);
        pctx.fillStyle = p.unusual
            ? "rgba(255,138,31," + alpha.toFixed(3) + ")"
            : "rgba(191,244,255," + alpha.toFixed(3) + ")";
        pctx.fill();
    }

    pctx.globalCompositeOperation = "source-over";
}

/* ---- the note about what is and is not measured ------------------------------- */

/* A single line directly under the panel header. It used to be a block
 * floating inside the diagram, where it sat on top of the device labels. */
function renderNote() {
    var el = $id("en-note");
    if (!el || !feeds) {
        return;
    }
    var bits = [];
    if (!HOUSE_METER) {
        bits.push('<b>NO WHOLE HOUSE METER</b>' +
            '<span>Sum of 19 monitored circuits and plugs. Furnace, air ' +
            'conditioner, oven, dryer and most lighting and outlets are not ' +
            'included.</span>');
    }
    if (!feeds.hasRate() && !feeds.ratePending) {
        bits.push('<b class="warn">COST HIDDEN</b>' +
            '<span>No energy price is set in Home Assistant.</span>');
    } else if (feeds.hasRate()) {
        bits.push('<b>RATE</b><span>' +
            feeds.rateCents.toFixed(0) + ' cents per kWh</span>');
    }
    el.innerHTML = bits.join('<i class="en-note-sep"></i>');
}

/* ---- status row ------------------------------------------------------------------ */

function stat(id, value, sub, bad) {
    var el = $id(id);
    if (!el) {
        return;
    }
    el.firstChild.textContent = value;
    var span = el.querySelector("span");
    if (span && sub !== null && sub !== undefined) {
        span.textContent = sub;
    }
    el.className = "en-stat" + (bad ? " bad" : "");
}

function renderStatus() {
    if (!feeds) {
        return;
    }
    var s = feeds.stats();
    var showCost = feeds.hasRate();

    stat("en-stat-now", watts(s.now),
         "Now, " + (19 - s.offline) + " of 19 reporting", false);

    stat("en-stat-today", kwh(s.today),
         showCost ? "Today, " + money(feeds.cost(s.today))
                  : "Today", false);

    var monthSub = "This month";
    if (s.projected) {
        monthSub += ", projected " + kwh(s.projected);
    }
    if (showCost) {
        monthSub = "This month, " + money(feeds.cost(s.month)) +
            (s.projected ? ", projected " + money(feeds.cost(s.projected)) : "");
    }
    stat("en-stat-month", kwh(s.month), monthSub, false);

    if (s.top) {
        stat("en-stat-top", s.top.name,
             "Top consumer now, " + watts(s.top.watts), s.top.unusual);
    } else {
        stat("en-stat-top", "--", "Top consumer now", false);
    }

}

/* ---- top consumers ---------------------------------------------------------------- */

var TOP_N = 10;

/* A device's last 24 hours as a tiny inline polyline. Drawn from the same five
 * minute means the big chart uses, thinned to keep the markup small. */
function sparkline(key, hot) {
    var c = feeds.curves[key] || [];
    var pts = c.filter(function (p) { return p.mean !== null; });
    if (pts.length < 4) {
        return '<span class="en-spark empty"></span>';
    }
    var step = Math.max(1, Math.floor(pts.length / 48));
    var use = [];
    for (var i = 0; i < pts.length; i += step) {
        use.push(pts[i]);
    }
    var max = 0;
    use.forEach(function (p) { max = Math.max(max, p.mean); });
    max = Math.max(max, 0.001);

    var W = 100, H = 22;
    var d = use.map(function (p, i) {
        var x = (i / (use.length - 1)) * W;
        var y = H - (p.mean / max) * (H - 2) - 1;
        return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");

    return '<svg class="en-spark' + (hot ? " unusual" : "") +
        '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
        '<polyline points="' + d + '"></polyline></svg>';
}

function renderTop() {
    var box = $id("en-top5-body");
    var head = $id("en-top5-range");
    if (!box || !feeds) {
        return;
    }
    var r = range === "now" ? "now" : range;
    if (head) {
        head.textContent = RANGE_LABEL[r];
    }

    var list = feeds.top(r, TOP_N);
    if (!list.length) {
        box.innerHTML = '<div class="en-wait">' +
            (feeds.loaded ? "Nothing drawing" : "Loading") + '</div>';
        return;
    }
    var max = list[0].value || 1;
    var showCost = feeds.hasRate();

    box.innerHTML = list.map(function (d, i) {
        var w = Math.max(2, (d.value / max) * 100);
        /* Cost for a period is the energy times the rate. In NOW mode the
           figure is watts, so the useful money number is what it costs to run
           at this draw for a day rather than a cost for an instant. */
        var cost = showCost
            ? (r === "now" ? feeds.cost((d.value * 24) / 1000) : feeds.cost(d.value))
            : null;
        return '<div class="en-bar-row' + (d.unusual ? " unusual" : "") +
            (d.key === selected ? " on" : "") + '" data-device="' + d.key + '">' +
            '<span class="en-bar-rank">' + (i + 1) + '</span>' +
            '<span class="en-bar-name">' + escapeText(d.name) + '</span>' +
            '<span class="en-bar-val">' + valueText(d.value) + '</span>' +
            (cost !== null
                ? '<span class="en-bar-cost">' + money(cost) +
                  (r === "now" ? '<em>/day</em>' : '') + '</span>'
                : '<span class="en-bar-cost"></span>') +
            sparkline(d.key, d.unusual) +
            '<span class="en-bar-track"><i style="width:' + w.toFixed(1) +
            '%"></i></span>' +
            '</div>';
    }).join("");
}

/* ---- the house curve over 24 hours -------------------------------------------- */

function drawHouseChart() {
    if (!cctx || !chartCanvas || !feeds) {
        return;
    }
    var w = chartCanvas.clientWidth, h = chartCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var ctx = cctx;
    ctx.clearRect(0, 0, w, h);

    var curve = feeds.houseCurve();
    if (curve.length < 2) {
        ctx.fillStyle = "rgba(191,244,255,.4)";
        ctx.font = "11px Menlo, Consolas, monospace";
        ctx.fillText(feeds.loaded ? "No power history" : "Loading power history", 8, 18);
        return;
    }

    var left = 42, right = 10, top = 10, bottom = 16;
    var pw = w - left - right, ph = h - top - bottom;

    var max = 0;
    curve.forEach(function (p) { max = Math.max(max, p.w); });
    max = Math.max(max * 1.12, 50);

    var t0 = curve[0].t, t1 = curve[curve.length - 1].t;
    var span = Math.max(1, t1 - t0);
    var X = function (t) { return left + ((t - t0) / span) * pw; };
    var Y = function (v) { return top + ph - (v / max) * ph; };

    /* Grid and the watt scale. */
    ctx.font = "10px Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    for (var g = 0; g <= 2; g++) {
        var v = (max / 2) * g;
        var y = Math.floor(Y(v)) + 0.5;
        ctx.strokeStyle = "rgba(63,224,255,.12)";
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
        ctx.fillStyle = "rgba(191,244,255,.55)";
        ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v), left - 4, y + 3);
    }

    /* The area under the curve. */
    var grad = ctx.createLinearGradient(0, top, 0, top + ph);
    grad.addColorStop(0, "rgba(63,224,255,.42)");
    grad.addColorStop(1, "rgba(63,224,255,.03)");

    ctx.beginPath();
    ctx.moveTo(X(curve[0].t), top + ph);
    curve.forEach(function (p) { ctx.lineTo(X(p.t), Y(p.w)); });
    ctx.lineTo(X(curve[curve.length - 1].t), top + ph);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    curve.forEach(function (p, i) {
        if (i) { ctx.lineTo(X(p.t), Y(p.w)); } else { ctx.moveTo(X(p.t), Y(p.w)); }
    });
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    /* Hour ticks. */
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(191,244,255,.45)";
    for (var i = 0; i <= 24; i += 4) {
        var t = t0 + (span * i) / 24;
        var d = new Date(t);
        ctx.fillText((d.getHours() % 12 || 12) + (d.getHours() < 12 ? "a" : "p"),
                     X(t), h - 4);
    }

    /* Where a big load came on. */
    /* Switch on markers. Two loads coming on minutes apart used to print their
       labels on top of each other, so the labels take the first of three rows
       that is clear at this x rather than all sharing one. */
    var marks = feeds.switchOns(curve);
    ctx.textAlign = "left";
    var rowEnd = [-1e9, -1e9, -1e9];
    var rowY = [top + 10, top + 21, top + 32];
    marks.slice(-6).forEach(function (m) {
        var x = X(m.t), y = Y(m.w);
        ctx.font = "9px Menlo, Consolas, monospace";
        var label = m.name;
        var wide = ctx.measureText(label).width;

        /* Right align the label when it would run off the end of the chart. */
        var rightAligned = x + 4 + wide > w - right;
        var x0 = rightAligned ? x - 4 - wide : x + 4;
        var x1 = x0 + wide;

        var row = -1;
        for (var r = 0; r < rowEnd.length; r++) {
            if (x0 > rowEnd[r] + 8) { row = r; break; }
        }

        ctx.strokeStyle = "rgba(77,255,176,.65)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        /* The leader stops just under whichever row the label landed in, so
           the tick and its name read as one mark. */
        ctx.lineTo(x, row >= 0 ? rowY[row] + 3 : top + 2);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT; ctx.fill();

        if (row >= 0) {
            ctx.fillStyle = "rgba(77,255,176,.9)";
            ctx.textAlign = rightAligned ? "right" : "left";
            ctx.fillText(label, rightAligned ? x - 4 : x + 4, rowY[row]);
            ctx.textAlign = "left";
            rowEnd[row] = x1;
        }
        ctx.font = "10px Menlo, Consolas, monospace";
    });
}

/* ---- device detail --------------------------------------------------------------- */

function renderDetail() {
    var panel = $id("en-detail");
    if (!panel || !feeds) {
        return;
    }
    if (!selected) {
        panel.classList.remove("open");
        return;
    }

    var d = feeds.detail(selected);
    if (!d) {
        panel.classList.remove("open");
        return;
    }
    panel.classList.add("open");

    var dev = d.device;
    var showCost = feeds.hasRate();

    $id("en-detail-name").textContent = dev.name;
    $id("en-detail-area").textContent = dev.area || "No area";

    var big = $id("en-detail-watts");
    big.textContent = dev.available ? watts(dev.watts) : "OFFLINE";
    big.className = dev.unusual ? "unusual" : (dev.available ? "" : "bad");

    var st = $id("en-detail-status");
    st.textContent = dev.status === "on" ? "ON"
        : dev.status === "standby" ? "STANDBY"
        : dev.status === "off" ? "IDLE" : "OFFLINE";
    st.className = "en-detail-status " + dev.status +
        (dev.unusual ? " unusual" : "");

    var rows = [
        ["Today", kwh(dev.kwh.today), showCost ? money(feeds.cost(dev.kwh.today)) : ""],
        ["This week", kwh(dev.kwh.week), showCost ? money(feeds.cost(dev.kwh.week)) : ""],
        ["This month", kwh(dev.kwh.month), showCost ? money(feeds.cost(dev.kwh.month)) : ""],
        ["Peak power", d.peak ? watts(d.peak.w) : "n/a",
         d.peak ? "at " + clockTime(d.peak.t) : ""],
        ["Standby draw", d.standby !== null ? watts(d.standby) : "n/a",
         "lowest steady, 24 h"],
        ["7 day average", dev.avgWatts !== null ? watts(dev.avgWatts) : "n/a",
         dev.unusual ? "DRAWING HIGH" : ""],
        ["Share of house", pct(d.share), "now"],
        ["Share today", pct(d.shareToday), "of measured total"]
    ];

    $id("en-detail-rows").innerHTML = rows.map(function (r) {
        return '<div class="en-drow' +
            (r[2] === "DRAWING HIGH" ? " unusual" : "") + '">' +
            '<span>' + r[0] + '</span><b>' + r[1] + '</b>' +
            '<i>' + escapeText(r[2] || "") + '</i></div>';
    }).join("");

    sizeCanvas(curveCanvas, curveCtx);
    sizeCanvas(barsCanvas, barsCtx);
    drawDeviceCurve(d);
    drawDeviceBars(d);
}

function drawDeviceCurve(d) {
    if (!curveCtx || !curveCanvas) {
        return;
    }
    var w = curveCanvas.clientWidth, h = curveCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var ctx = curveCtx;
    ctx.clearRect(0, 0, w, h);

    var c = d.curve.filter(function (p) { return p.mean !== null; });
    if (c.length < 2) {
        ctx.fillStyle = "rgba(191,244,255,.4)";
        ctx.font = "10px Menlo, Consolas, monospace";
        ctx.fillText("No power history", 6, 14);
        return;
    }

    var left = 34, right = 6, top = 18, bottom = 13;
    var pw = w - left - right, ph = h - top - bottom;
    var max = 0;
    c.forEach(function (p) { max = Math.max(max, p.max || p.mean); });
    max = Math.max(max * 1.12, 5);

    var t0 = c[0].t, t1 = c[c.length - 1].t;
    var span = Math.max(1, t1 - t0);
    var X = function (t) { return left + ((t - t0) / span) * pw; };
    var Y = function (v) { return top + ph - (v / max) * ph; };

    ctx.font = "9px Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    [0, max / 2, max].forEach(function (v) {
        var y = Math.floor(Y(v)) + 0.5;
        ctx.strokeStyle = "rgba(63,224,255,.1)";
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
        ctx.fillStyle = "rgba(191,244,255,.5)";
        ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v), left - 3, y + 3);
    });

    var grad = ctx.createLinearGradient(0, top, 0, top + ph);
    grad.addColorStop(0, "rgba(63,224,255,.38)");
    grad.addColorStop(1, "rgba(63,224,255,.02)");
    ctx.beginPath();
    ctx.moveTo(X(c[0].t), top + ph);
    c.forEach(function (p) { ctx.lineTo(X(p.t), Y(p.mean)); });
    ctx.lineTo(X(c[c.length - 1].t), top + ph);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    c.forEach(function (p, i) {
        if (i) { ctx.lineTo(X(p.t), Y(p.mean)); } else { ctx.moveTo(X(p.t), Y(p.mean)); }
    });
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (d.peak) {
        ctx.beginPath();
        ctx.arc(X(d.peak.t), Y(d.peak.w), 2.6, 0, Math.PI * 2);
        ctx.fillStyle = ALERT;
        ctx.fill();
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(191,244,255,.45)";
    for (var i = 0; i <= 24; i += 6) {
        var t = t0 + (span * i) / 24;
        var dt = new Date(t);
        ctx.fillText((dt.getHours() % 12 || 12) + (dt.getHours() < 12 ? "a" : "p"),
                     X(t), h - 3);
    }
}

function drawDeviceBars(d) {
    if (!barsCtx || !barsCanvas) {
        return;
    }
    var w = barsCanvas.clientWidth, h = barsCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var ctx = barsCtx;
    ctx.clearRect(0, 0, w, h);

    var bars = d.bars;
    var max = 0;
    bars.forEach(function (b) { max = Math.max(max, b.kwh); });
    max = Math.max(max, 0.01);

    var left = 34, right = 6, top = 18, bottom = 14;
    var pw = w - left - right, ph = h - top - bottom;
    var bw = pw / bars.length;

    ctx.font = "9px Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(191,244,255,.5)";
    ctx.fillText(max.toFixed(max < 10 ? 1 : 0), left - 3, top + 8);
    ctx.fillText("0", left - 3, top + ph);
    ctx.strokeStyle = "rgba(63,224,255,.1)";
    ctx.beginPath();
    ctx.moveTo(left, Math.floor(top + ph) + 0.5);
    ctx.lineTo(w - right, Math.floor(top + ph) + 0.5);
    ctx.stroke();

    var DAYS = ["S", "M", "T", "W", "T", "F", "S"];
    bars.forEach(function (b, i) {
        var bh = (b.kwh / max) * ph;
        var x = left + i * bw + bw * 0.18;
        var bwid = bw * 0.64;
        /* Today is the last bar and is the one still filling, so it reads
           differently from the six complete days behind it. */
        var isToday = i === bars.length - 1;
        ctx.fillStyle = isToday ? "rgba(77,255,176,.85)" : CYAN;
        if (bh > 0) {
            ctx.fillRect(x, top + ph - bh, bwid, bh);
        }
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(191,244,255,.5)";
        ctx.fillText(DAYS[new Date(b.t).getDay()], x + bwid / 2, h - 3);
    });
}

/* ---- breadcrumb and transitions ---------------------------------------------- */

function renderCrumb() {
    var el = $id("en-crumb");
    if (!el) {
        return;
    }
    var root = HOUSE_METER ? "HOUSE" : "MEASURED TOTAL";
    if (!drill) {
        el.innerHTML = '<span class="en-crumb-here">' + root + '</span>';
        return;
    }
    var label = "";
    CATEGORIES.forEach(function (c) {
        if (c.key === drill) { label = c.label.toUpperCase(); }
    });
    el.innerHTML = '<a href="#" class="en-crumb-up" data-up="1">' + root + '</a>' +
        '<span class="en-crumb-sep">&gt;</span>' +
        '<span class="en-crumb-here">' + label + '</span>';
}

/* The same scanline wipe the Cameras screen uses between feeds, so moving
 * through this screen feels like moving through that one. */
function wipe(then) {
    var host = $id("en-flow");
    var el = $id("en-wipe");
    if (!host || !el) {
        then();
        return;
    }
    clearTimeout(wipeTimer);
    clearTimeout(swapTimer);

    el.classList.remove("run");
    void el.offsetWidth;
    el.classList.add("run");
    host.classList.add("wiping");

    swapTimer = setTimeout(then, WIPE_SWAP_MS);
    wipeTimer = setTimeout(function () {
        el.classList.remove("run");
        host.classList.remove("wiping");
    }, WIPE_MS);
}

function setDrill(cat) {
    wipe(function () {
        drill = cat;
        renderCrumb();
        lastLayout = 0;
        dirty = true;
        buildLayout();
    });
}

function setRange(r) {
    if (r === range) {
        return;
    }
    wipe(function () {
        range = r;
        Array.prototype.forEach.call(
            document.querySelectorAll("#en-range button"), function (b) {
                b.classList.toggle("on", b.getAttribute("data-range") === r);
            });
        lastLayout = 0;
        dirty = true;
        buildLayout();
        renderTop();
    });
}

function openDevice(key) {
    selected = key;
    renderDetail();
    renderTop();
}

function closeDevice() {
    selected = null;
    renderDetail();
    renderTop();
}

/* ---- tooltip -------------------------------------------------------------------- */

function showTip(evt, html) {
    var tip = $id("en-tip");
    var host = $id("en-flow");
    if (!tip || !host) {
        return;
    }
    tip.innerHTML = html;
    tip.style.display = "block";

    var box = host.getBoundingClientRect();
    var x = evt.clientX - box.left + 14;
    var y = evt.clientY - box.top + 14;
    /* Keep it inside the panel rather than letting it run off the edge. */
    if (x + tip.offsetWidth > box.width - 6) {
        x = evt.clientX - box.left - tip.offsetWidth - 14;
    }
    if (y + tip.offsetHeight > box.height - 6) {
        y = box.height - tip.offsetHeight - 6;
    }
    tip.style.left = Math.max(4, x) + "px";
    tip.style.top = Math.max(4, y) + "px";
}

function hideTip() {
    hoverKey = null;
    var tip = $id("en-tip");
    if (tip) {
        tip.style.display = "none";
    }
}

/* A stable name for the thing under the pointer, so it can be found again
 * after the diagram is rebuilt. Links are named by where they end up, which is
 * what their tooltip describes. */
function keyOf(item) {
    if (!item) {
        return null;
    }
    if (item.id) {
        return "node:" + item.id;
    }
    return "link:" + ((item.target && item.target.id) || "");
}

function findByKey(key) {
    var i;
    for (i = 0; i < layout.nodes.length; i++) {
        if (keyOf(layout.nodes[i]) === key) {
            return layout.nodes[i];
        }
    }
    for (i = 0; i < layout.links.length; i++) {
        if (keyOf(layout.links[i]) === key) {
            return layout.links[i];
        }
    }
    return null;
}

/* Recompute the open tooltip's text without moving it. Called after a relayout
 * so the numbers stay live instead of freezing or blinking away. */
function refreshTip() {
    var tip = $id("en-tip");
    if (!tip || !hoverKey || tip.style.display === "none") {
        return;
    }
    var item = findByKey(hoverKey);
    if (!item) {
        hideTip();
        return;
    }
    tip.innerHTML = tipFor(item);
}

/* Everything a flow can say about itself: watts now, energy for the period,
 * share of the total, and what it costs when a rate exists. */
function tipFor(item) {
    if (!feeds) {
        return "";
    }
    var isDevice = !!item.device;
    /* A node carries its own label. A link does not: after d3-sankey has run,
       its source and target are the node objects, and the name a flow should
       be called is the name of where it ends up. */
    var name = isDevice ? item.device.name
        : (item.label || (item.target && item.target.label) || "");
    var total = range === "now" ? feeds.totalWatts() : feeds.totalKwh(range);
    var value = item.value || 0;
    var share = total > 0 ? (value / total) * 100 : 0;

    var html = '<b>' + escapeText(name) + '</b>';
    if (isDevice && item.device.area) {
        html += '<span class="en-tip-area">' + escapeText(item.device.area) + '</span>';
    }

    var w = isDevice ? item.device.watts
        : (item.cat ? catWatts(item.cat) : feeds.totalWatts());
    html += '<div><i>Power now</i>' + watts(w) + '</div>';

    ["today", "week", "month"].forEach(function (r) {
        var v = isDevice ? item.device.kwh[r] : catKwh(item.cat, r);
        html += '<div><i>' + RANGE_LABEL[r] + '</i>' + kwh(v) +
            (feeds.hasRate() ? ' <em>' + money(feeds.cost(v)) + '</em>' : '') +
            '</div>';
    });

    html += '<div><i>Share of ' + (range === "now" ? "load now" : RANGE_LABEL[range]) +
        '</i>' + pct(share) + '</div>';

    if (isDevice && item.device.unusual) {
        html += '<div class="en-tip-alert">DRAWING HIGH, 7 day average ' +
            watts(item.device.avgWatts) + '</div>';
    }
    var hint = isDevice ? "Click for detail"
        : item.kind === "root" ? (drill ? "Click to go back" : "")
        : drill ? "Click to go back" : "Click to drill in";
    if (hint) {
        html += '<div class="en-tip-hint">' + hint + '</div>';
    }
    return html;
}

function catWatts(key) {
    if (!key || !feeds) {
        return feeds ? feeds.totalWatts() : 0;
    }
    var out = 0;
    feeds.categories("now").forEach(function (c) {
        if (c.key === key) { out = c.watts; }
    });
    return out;
}

function catKwh(key, r) {
    if (!feeds) {
        return 0;
    }
    if (!key) {
        return feeds.totalKwh(r);
    }
    var out = 0;
    feeds.categories(r).forEach(function (c) {
        if (c.key === key) { out = c.value; }
    });
    return out;
}

/* ---- clock ------------------------------------------------------------------------ */

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"];
var lastClock = "";

function renderClock(now) {
    var el = $id("en-time");
    if (!el) {
        return;
    }
    var d = new Date(now);
    var h = d.getHours();
    var text = (h % 12 || 12) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    if (text === lastClock) {
        return;
    }
    lastClock = text;
    el.innerHTML = text + "<small>" + (h < 12 ? "AM" : "PM") + "</small>";
    var dt = $id("en-date");
    if (dt) {
        dt.textContent = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " +
            d.getDate() + ", " + d.getFullYear();
    }
}

/* ---- controls ---------------------------------------------------------------------- */

function nodeAt(target) {
    var i = target.getAttribute("data-node");
    return i === null ? null : layout.nodes[Number(i)];
}

function linkAt(target) {
    var i = target.getAttribute("data-link");
    return i === null ? null : layout.links[Number(i)];
}

function bindControls() {
    var root = $id("energy-screen");

    root.addEventListener("click", function (e) {
        var rangeBtn = e.target.closest("#en-range button");
        if (rangeBtn) {
            setRange(rangeBtn.getAttribute("data-range"));
            return;
        }

        if (e.target.closest("[data-up]")) {
            e.preventDefault();
            setDrill(null);
            return;
        }

        if (e.target.closest("#en-detail-close")) {
            closeDevice();
            return;
        }

        var bar = e.target.closest(".en-bar-row");
        if (bar) {
            openDevice(bar.getAttribute("data-device"));
            return;
        }

        var hit = e.target.closest("[data-node], [data-link]");
        if (!hit) {
            return;
        }
        var node = hit.hasAttribute("data-node") ? nodeAt(hit) : null;
        var link = hit.hasAttribute("data-link") ? linkAt(hit) : null;
        var item = node || link;
        if (!item) {
            return;
        }

        if (item.kind === "device" || item.device) {
            openDevice((item.device || {}).key);
        } else if (item.kind === "category" || item.cat) {
            if (item.cat && item.cat !== "unmeasured") {
                setDrill(drill === item.cat ? null : item.cat);
            }
        } else if (item.kind === "root" && drill) {
            setDrill(null);
        }
    });

    /* Hover anywhere on a link, a node bar or its label. */
    var sankeyHost = $id("en-sankey");
    sankeyHost.addEventListener("mousemove", function (e) {
        var hit = e.target.closest("[data-node], [data-link]");
        if (!hit) {
            hideTip();
            sankeyHost.classList.remove("hot");
            return;
        }
        var item = hit.hasAttribute("data-node") ? nodeAt(hit) : linkAt(hit);
        if (!item) {
            hideTip();
            return;
        }
        sankeyHost.classList.add("hot");
        hoverKey = keyOf(item);
        showTip(e, tipFor(item));
    });
    sankeyHost.addEventListener("mouseleave", function () {
        hideTip();
        sankeyHost.classList.remove("hot");
    });

    window.addEventListener("keydown", function (e) {
        if (!active || e.key !== "Escape") {
            return;
        }
        /* Escape unwinds one level at a time: the panel, then the drill down. */
        if (selected) {
            closeDevice();
        } else if (drill) {
            setDrill(null);
        }
    });

    renderCrumb();
}

export { EnergyView };
