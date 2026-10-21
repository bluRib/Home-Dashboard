/* The Network screen.
 *
 * Full viewport grid, same approach as House, Climate, Security, Cameras and
 * Energy. The hero is a live topology: internet on the left, the two WAN lines,
 * the UDM Pro, the switches, the access points, then the clients clustered by
 * subnet. Links carry pulses whose speed and size follow real throughput.
 *
 * Layout is plain SVG, hand placed in columns, with a canvas over it for the
 * traffic pulses. No d3 here: the graph is a fixed six column tree rather than
 * something that needs a force or flow solver, and the Energy screen already
 * showed that pulses belong on a canvas rather than as SVG circles.
 */

import { NetworkFeeds, LATENCY_WARN_MS } from "./NetworkFeeds.js";

var CYAN = "#3fe0ff";
var TEXT = "#bff4ff";
var ALERT = "#ff8a1f";
var ACCENT = "#4dffb0";
var DIM = "#2aa3bb";

var REFRESH_MS = 2000;

var COLS = ["internet", "wan", "gateway", "switch", "ap", "client"];

function $id(id) {
    return document.getElementById(id);
}

function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
}

var NetworkView = {};

var feeds = null;
var active = false;
var built = false;
var dirty = true;
var lastRender = 0;
var lastFrame = 0;
var resizeTimer = null;
var observer = null;

var svg = null, pulseCanvas = null, pctx = null;
var wanCanvas = null, wctx = null;
var devCanvas = null, dctx = null;

var expanded = {};        // subnet key -> true
var selected = null;      // { kind: "client"|"device", id }
var selectedHistory = null;
var layout = { nodes: [], links: [], w: 0, h: 0 };
var pulses = [];

/* ---- lifecycle --------------------------------------------------------------- */

NetworkView.init = function () {
    var root = $id("network-screen");
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;

    svg = $id("nw-svg");
    pulseCanvas = $id("nw-pulses");
    pctx = pulseCanvas ? pulseCanvas.getContext("2d") : null;
    wanCanvas = $id("nw-wan-canvas");
    wctx = wanCanvas ? wanCanvas.getContext("2d") : null;
    devCanvas = $id("nw-detail-canvas");
    dctx = devCanvas ? devCanvas.getContext("2d") : null;

    if (!feeds) {
        feeds = new NetworkFeeds(function () { dirty = true; });
        feeds.start();
    }

    if (!built) {
        built = true;
        bindControls();
    }

    watchPanels();
    requestAnimationFrame(function () {
        requestAnimationFrame(function () { NetworkView.resize(); });
    });
    dirty = true;
};

NetworkView.show = function () {
    active = true;
    var root = $id("network-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
    NetworkView.resize();
};

NetworkView.hide = function () {
    active = false;
    $id("network-screen").style.display = "none";
};

/* Prometheus is the source here, not the Home Assistant bus. */
NetworkView.message = function () {};
NetworkView.seed = function () { dirty = true; };

NetworkView.animate = function () {
    if (!active || !feeds) {
        return;
    }
    var now = Date.now();
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
    lastFrame = now;

    renderClock(now);
    stepPulses(dt);

    if (dirty && now - lastRender > REFRESH_MS) {
        lastRender = now;
        dirty = false;
        buildTopology();
        renderStatus();
        renderWan();
        renderClients();
        renderInfra();
        renderDetail();
    }
};

NetworkView.resize = function () {
    if (!active) {
        return;
    }
    sizeCanvas(pulseCanvas, pctx);
    sizeCanvas(wanCanvas, wctx);
    sizeCanvas(devCanvas, dctx);
    dirty = true;
    lastRender = 0;
    buildTopology();
    drawWanChart();
};

NetworkView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        NetworkView.resize();
    }, 150);
};

function watchPanels() {
    if (observer || typeof ResizeObserver === "undefined") {
        return;
    }
    observer = new ResizeObserver(function () { NetworkView.resizeDebounced(); });
    ["nw-map", "nw-wan", "nw-detail"].forEach(function (id) {
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

/* ---- formatting ---------------------------------------------------------------- */

/* unpoller publishes rates in bytes per second. */
function rate(bytesPerSec) {
    if (bytesPerSec === null || bytesPerSec === undefined) {
        return "n/a";
    }
    var bits = bytesPerSec * 8;
    if (bits >= 1e9) { return (bits / 1e9).toFixed(2) + " Gb/s"; }
    if (bits >= 1e6) { return (bits / 1e6).toFixed(1) + " Mb/s"; }
    if (bits >= 1e3) { return (bits / 1e3).toFixed(0) + " kb/s"; }
    return Math.round(bits) + " b/s";
}

function bytes(n) {
    if (n === null || n === undefined) { return "n/a"; }
    if (n >= 1e12) { return (n / 1e12).toFixed(1) + " TB"; }
    if (n >= 1e9) { return (n / 1e9).toFixed(1) + " GB"; }
    if (n >= 1e6) { return (n / 1e6).toFixed(1) + " MB"; }
    if (n >= 1e3) { return (n / 1e3).toFixed(0) + " kB"; }
    return Math.round(n) + " B";
}

function duration(sec) {
    if (!sec && sec !== 0) { return "n/a"; }
    var d = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (d > 0) { return d + "d " + h + "h"; }
    if (h > 0) { return h + "h " + m + "m"; }
    return m + "m";
}

function escapeText(s) {
    return String(s === null || s === undefined ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function clockTime(ms) {
    var d = new Date(ms);
    return (d.getHours() % 12 || 12) + ":" + pad(d.getMinutes()) +
        (d.getHours() < 12 ? "a" : "p");
}

/* ---- the topology map ----------------------------------------------------------- */

function buildTopology() {
    var host = $id("nw-map-body");
    if (!host || !svg || !feeds) {
        return;
    }
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) {
        return;
    }

    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);

    if (!feeds.ready) {
        svg.innerHTML = '<text x="' + (w / 2) + '" y="' + (h / 2) +
            '" text-anchor="middle" class="nw-empty">' +
            (feeds.error ? "PROMETHEUS UNREACHABLE" : "QUERYING PROMETHEUS") +
            '</text>';
        layout = { nodes: [], links: [], w: w, h: h };
        pulses = [];
        return;
    }

    var graph = feeds.topology(expanded);
    var nodes = graph.nodes;
    var links = graph.links;

    /* Six columns across the width, each node stacked down its own column. */
    var padX = Math.max(46, Math.min(84, w * 0.055));
    var padY = 16;
    var usable = w - padX * 2;
    /* internet, wan, gateway, switch, ap, client. The last gap is the widest
       because both the access point labels and the client labels have to live
       inside it. */
    var COL_AT = [0, 0.13, 0.30, 0.50, 0.68, 0.97];
    var fontPx = Math.max(8, Math.min(12, w * 0.0062));
    var charW = fontPx * 0.62;

    var byCol = {};
    nodes.forEach(function (n) {
        if (!byCol[n.col]) { byCol[n.col] = []; }
        byCol[n.col].push(n);
    });

    Object.keys(byCol).forEach(function (c) {
        var list = byCol[c];
        /* usableY, not usable: an inner variable of the same name shadowed the
           width above, so every column was being placed along a fraction of
           the panel's HEIGHT. The whole diagram was squeezed into the left of
           the panel and the labels of neighbouring columns ran into each
           other, which is what the overlap check caught. */
        var usableY = h - padY * 2;
        var gap = usableY / (list.length + 1);
        list.forEach(function (n, i) {
            n.x = padX + COL_AT[Number(c)] * usable;
            n.y = padY + gap * (i + 1);
            n.gapY = gap;
        });
    });

    var maxRate = 1;
    links.forEach(function (l) { maxRate = Math.max(maxRate, l.rate || 0); });

    var parts = [];

    links.forEach(function (l, i) {
        var a = nodes[l.source], b = nodes[l.target];
        if (!a || !b) { return; }
        var share = (l.rate || 0) / maxRate;
        /* A standby WAN line is drawn dim; a line in failover goes orange. */
        var isStandbyWan = l.kind === "wan" && !l.active;
        var hot = (l.kind === "wan" && l.active && l.wan && l.wan.group !== "WAN") ||
                  l.isNew;
        var colour = hot ? ALERT : isStandbyWan ? DIM : CYAN;
        var width = isStandbyWan ? 1
            : Math.max(1.2, 1.2 + Math.sqrt(share) * 5.5);
        var opacity = isStandbyWan ? 0.3 : (0.3 + 0.55 * Math.sqrt(share));
        if (isStandbyWan) {
            l._dash = true;
        }
        var d = curve(a, b);
        l._d = d;
        l._w = width;
        l._hot = hot;
        l._standby = isStandbyWan;
        parts.push('<path class="nw-link' + (hot ? " hot" : "") +
            (isStandbyWan ? " standby" : "") + '" d="' + d +
            '" stroke="' + colour + '" stroke-width="' + width.toFixed(2) +
            '" stroke-opacity="' + opacity.toFixed(3) + '" fill="none"' +
            (isStandbyWan ? ' stroke-dasharray="5 5"' : '') +
            ' data-link="' + i + '"></path>');
    });

    nodes.forEach(function (n, i) {
        /* Half the gap to the neighbouring column, so a label running right
           and a label running left can never meet. */
        var ci = Number(n.col);
        var gapLeft = ci > 0 ? (COL_AT[ci] - COL_AT[ci - 1]) * usable : padX;
        var gapRight = ci < COL_AT.length - 1
            ? (COL_AT[ci + 1] - COL_AT[ci]) * usable : (w - n.x);
        /* Minus 26, not 10: the label is offset from the node centre by its
           radius plus five on each side, so the gap pays that cost twice, and
           the character width here is an estimate that can run a little short. */
        var room = (ci >= 5 ? gapLeft : gapRight) * 0.5 - 26;
        parts.push(nodeMarkup(n, i, fontPx, charW, Math.max(36, room)));
    });

    svg.innerHTML = parts.join("");
    layout = { nodes: nodes, links: links, w: w, h: h };
    seedPulses(links, maxRate);
    renderFailoverBanner();
}

/* A gentle S curve so the tree reads as cabling rather than a bar chart. */
function curve(a, b) {
    var mx = (a.x + b.x) / 2;
    return "M" + a.x + "," + a.y +
           "C" + mx + "," + a.y + " " + mx + "," + b.y + " " + b.x + "," + b.y;
}

function nodeMarkup(n, i, fontPx, charW, room) {
    var r = n.kind === "internet" ? 7
        : n.kind === "gateway" ? 9
        : n.kind === "cluster" ? 10
        : n.kind === "client" ? 3.4 : 6.5;

    var bad = false;
    var colour = CYAN;
    if (n.kind === "internet") { colour = ACCENT; }
    if (n.kind === "wan") {
        colour = n.wan && n.wan.active
            ? (n.wan.group === "WAN" ? ACCENT : ALERT)
            : DIM;
    }
    if (n.kind === "cluster" && n.isNew > 0) { colour = ALERT; bad = true; }
    if (n.kind === "client" && n.client && n.client.isNew) { colour = ALERT; bad = true; }
    if (n.device && n.device.type === "usw" && n.device.portsUp === 0) {
        colour = ALERT; bad = true;
    }

    var label = n.label;
    if (n.kind === "cluster") {
        label = n.label + " (" + n.count + ")";
    }

    /* Labels sit left of the last column and right of everything else, so
       nothing runs off either edge. */
    var right = n.col >= 5;
    var tx = right ? n.x - r - 5 : n.x + r + 5;
    var anchor = right ? "end" : "start";
    var maxChars = Math.floor(room / charW);
    if (label.length > maxChars && maxChars > 4) {
        label = label.slice(0, maxChars - 1) + "…";
    }

    var shape = n.kind === "cluster"
        ? '<rect class="nw-node nw-node-' + n.kind + (bad ? " bad" : "") +
          '" x="' + (n.x - r) + '" y="' + (n.y - r) + '" width="' + (r * 2) +
          '" height="' + (r * 2) + '" fill="' + colour +
          '" data-node="' + i + '"></rect>'
        : '<circle class="nw-node nw-node-' + n.kind + (bad ? " bad" : "") +
          '" cx="' + n.x + '" cy="' + n.y + '" r="' + r + '" fill="' + colour +
          '" data-node="' + i + '"></circle>';

    var sub = "";
    if (n.kind === "wan" && n.wan) {
        sub = n.wan.active ? "ACTIVE" : "STANDBY";
    } else if (n.device && n.device.type === "usw") {
        sub = n.device.portsUp + (n.device.portsTotal ? "/" + n.device.portsTotal : "") + " up";
    } else if (n.device && n.device.type === "uap") {
        sub = (n.device.stations || 0) + " clients";
    } else if (n.kind === "client" && n.client && n.client.total > 0) {
        sub = rate(n.client.total);
    }

    if (sub && n.gapY !== undefined && n.gapY < fontPx * 2.6) {
        sub = "";
    }
    if (sub) {
        var subMax = Math.floor(room / charW);
        if (sub.length > subMax && subMax > 4) {
            sub = sub.slice(0, subMax - 1) + "…";
        }
    }

    /* Name on one line, its reading on the next. Side by side they were twice
       as wide and ran into the neighbouring column. */
    var y1 = sub ? n.y - fontPx * 0.52 : n.y;
    return shape +
        '<text class="nw-label nw-label-' + n.kind + (bad ? " bad" : "") +
        '" x="' + tx + '" y="' + y1 + '" text-anchor="' + anchor +
        '" dominant-baseline="middle" data-node="' + i + '">' +
        '<tspan class="nw-label-name" x="' + tx + '">' + escapeText(label) + '</tspan>' +
        (sub ? '<tspan class="nw-label-sub" x="' + tx + '" dy="' +
               (fontPx * 1.06).toFixed(1) + '">' + escapeText(sub) + '</tspan>' : '') +
        '</text>';
}

/* ---- pulses -------------------------------------------------------------------- */

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

function seedPulses(links, maxRate) {
    pulses = [];
    links.forEach(function (l, i) {
        if (l._standby) {
            return;          // a standby line carries nothing, so it shows nothing
        }
        var sampled = samplePath(l._d, 30);
        if (!sampled) {
            return;
        }
        l._path = sampled;
        var share = (l.rate || 0) / maxRate;
        if (share <= 0) {
            return;
        }
        /* Busier links get more pulses and faster ones. */
        var count = Math.max(1, Math.round(1 + 7 * Math.sqrt(share)));
        var speed = 30 + 150 * Math.sqrt(share);
        for (var k = 0; k < count; k++) {
            pulses.push({
                link: i,
                at: Math.random(),
                speed: speed * (0.85 + Math.random() * 0.3),
                size: Math.max(1, l._w * 0.42),
                hot: !!l._hot
            });
        }
    });
}

function stepPulses(dt) {
    if (!pctx || !pulseCanvas) {
        return;
    }
    var w = pulseCanvas.clientWidth, h = pulseCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    pctx.clearRect(0, 0, w, h);
    if (!pulses.length || !layout.links.length) {
        return;
    }
    pctx.globalCompositeOperation = "lighter";

    for (var i = 0; i < pulses.length; i++) {
        var p = pulses[i];
        var l = layout.links[p.link];
        if (!l || !l._path) { continue; }

        p.at += (p.speed * dt) / l._path.len;
        if (p.at > 1) { p.at -= 1; }

        var pts = l._path.pts;
        var f = p.at * l._path.n;
        var i0 = Math.floor(f);
        var t = f - i0;
        if (i0 >= l._path.n) { i0 = l._path.n - 1; t = 1; }
        var x = pts[i0 * 2] + (pts[i0 * 2 + 2] - pts[i0 * 2]) * t;
        var y = pts[i0 * 2 + 1] + (pts[i0 * 2 + 3] - pts[i0 * 2 + 1]) * t;

        var edge = Math.min(p.at, 1 - p.at);
        var alpha = Math.min(1, edge / 0.07) * 0.85;

        pctx.beginPath();
        pctx.arc(x, y, p.size, 0, Math.PI * 2);
        pctx.fillStyle = p.hot
            ? "rgba(255,138,31," + alpha.toFixed(3) + ")"
            : "rgba(191,244,255," + alpha.toFixed(3) + ")";
        pctx.fill();
    }
    pctx.globalCompositeOperation = "source-over";
}

/* ---- failover banner ------------------------------------------------------------ */

function renderFailoverBanner() {
    var el = $id("nw-failover");
    if (!el || !feeds) {
        return;
    }
    var f = feeds.failover();
    if (!f.active) {
        el.style.display = "none";
        return;
    }
    el.style.display = "flex";
    el.innerHTML = '<b>FAILOVER ACTIVE</b><span>Running on ' +
        escapeText(f.on ? f.on.name : "the backup line") +
        '. ' + escapeText(f.primary ? f.primary.name : "The primary") +
        ' is not carrying traffic.</span>';
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
    el.className = "nw-stat" + (bad ? " bad" : "");
}

function renderStatus() {
    if (!feeds) {
        return;
    }
    var site = feeds.site();
    var counts = feeds.counts();
    var wans = feeds.wans();
    var activeWan = wans.filter(function (w) { return w.active; })[0];
    var f = feeds.failover();

    stat("nw-stat-wan",
         activeWan ? activeWan.short : "--",
         activeWan ? activeWan.name.replace(/^(Primary|Secondary)\s*\([^)]*\)\s*/, "")
                   : "No active line",
         f.active);

    stat("nw-stat-down",
         activeWan ? rate(activeWan.rx) : "--",
         "Down, up " + (activeWan ? rate(activeWan.tx) : "n/a"), false);

    stat("nw-stat-latency",
         site.latencyMs === null || site.latencyMs === undefined
            ? "--" : Math.round(site.latencyMs) + " ms",
         "Latency" + (site.loss !== null && site.loss !== undefined
            ? ", loss " + site.loss.toFixed(2) + "%" : ""),
         !!site.latencyHigh);

    stat("nw-stat-clients", String(counts.total),
         counts.wired + " wired, " + counts.wireless + " wireless" +
         (counts.isNew ? ", " + counts.isNew + " new" : ""),
         counts.isNew > 0);
}

/* ---- WAN panel --------------------------------------------------------------------- */

function renderWan() {
    var box = $id("nw-wan-lines");
    if (!box || !feeds) {
        return;
    }
    var wans = feeds.wans();
    var site = feeds.site();

    if (!wans.length) {
        box.innerHTML = '<div class="nw-wait">' +
            (feeds.ready ? "No WAN data" : "Loading") + '</div>';
        return;
    }

    box.innerHTML = wans.map(function (w) {
        var cls = w.active ? (w.group === "WAN" ? "on" : "on failover") : "standby";
        var provider = w.providerDown
            ? (w.providerDown / 1000).toFixed(0) + " / " +
              (w.providerUp / 1000).toFixed(0) + " Mb/s provisioned"
            : "No provisioned rate";
        return '<div class="nw-wan-line ' + cls + '">' +
            '<div class="nw-wan-head">' +
                '<b>' + escapeText(w.short) + '</b>' +
                '<span class="nw-wan-name">' + escapeText(w.name) + '</span>' +
                '<i class="nw-wan-state">' + escapeText(w.state) + '</i>' +
            '</div>' +
            '<div class="nw-wan-rates">' +
                '<span><i>DOWN</i>' + (w.active ? rate(w.rx) : "idle") + '</span>' +
                '<span><i>UP</i>' + (w.active ? rate(w.tx) : "idle") + '</span>' +
                '<span><i>SPEEDTEST</i>' +
                    (w.latency ? Math.round(w.latency) + " ms" : "n/a") + '</span>' +
                '<span><i>UPTIME</i>' +
                    (w.uptimePercent >= 0 ? w.uptimePercent + "%" : "n/a") + '</span>' +
            '</div>' +
            '<div class="nw-wan-sub">' + escapeText(provider) +
                ', priority ' + (w.priority || "n/a") + '</div>' +
            '</div>';
    }).join("");

    var loss = $id("nw-wan-loss");
    if (loss) {
        var bits = [];
        if (site.loss !== null && site.loss !== undefined) {
            bits.push("Dropped " + site.loss.toFixed(3) + "% of received packets");
        }
        if (site.rxErrors !== null && site.rxErrors !== undefined) {
            bits.push(Math.round(site.rxErrors) + " receive errors");
        }
        if (site.drops !== null && site.drops !== undefined) {
            bits.push(Math.round(site.drops) + " internet drops since boot");
        }
        loss.textContent = bits.join(", ");
    }
    drawWanChart();
}

function drawWanChart() {
    if (!wctx || !wanCanvas || !feeds) {
        return;
    }
    var w = wanCanvas.clientWidth, h = wanCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var ctx = wctx;
    ctx.clearRect(0, 0, w, h);

    var pts = feeds.wanHistory;
    if (!pts || pts.length < 2) {
        ctx.fillStyle = "rgba(191,244,255,.4)";
        ctx.font = "10px Menlo, Consolas, monospace";
        ctx.fillText(feeds.ready ? "No WAN history yet" : "Loading history", 6, 16);
        return;
    }

    var left = 44, right = 8, top = 16, bottom = 14;
    var pw = w - left - right, ph = h - top - bottom;
    var max = 1;
    pts.forEach(function (p) { max = Math.max(max, p.rx, p.tx); });
    max *= 1.12;

    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
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
        var bits = v * 8;
        ctx.fillText(bits >= 1e6 ? (bits / 1e6).toFixed(0) + "M" : (bits / 1e3).toFixed(0) + "k",
                     left - 3, y + 3);
    });

    /* Download filled, upload as a line over it. */
    var grad = ctx.createLinearGradient(0, top, 0, top + ph);
    grad.addColorStop(0, "rgba(63,224,255,.4)");
    grad.addColorStop(1, "rgba(63,224,255,.02)");
    ctx.beginPath();
    ctx.moveTo(X(pts[0].t), top + ph);
    pts.forEach(function (p) { ctx.lineTo(X(p.t), Y(p.rx)); });
    ctx.lineTo(X(pts[pts.length - 1].t), top + ph);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(function (p, i) {
        if (i) { ctx.lineTo(X(p.t), Y(p.rx)); } else { ctx.moveTo(X(p.t), Y(p.rx)); }
    });
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    pts.forEach(function (p, i) {
        if (i) { ctx.lineTo(X(p.t), Y(p.tx)); } else { ctx.moveTo(X(p.t), Y(p.tx)); }
    });
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = CYAN;
    ctx.fillText("DOWN", left + 2, top - 5);
    ctx.fillStyle = ACCENT;
    ctx.fillText("UP", left + 42, top - 5);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(191,244,255,.45)";
    for (var i = 0; i <= 24; i += 6) {
        var t = t0 + (span * i) / 24;
        var d = new Date(t);
        ctx.fillText((d.getHours() % 12 || 12) + (d.getHours() < 12 ? "a" : "p"),
                     X(t), h - 3);
    }
}

/* ---- clients panel ------------------------------------------------------------------ */

function renderClients() {
    var box = $id("nw-clients-body");
    if (!box || !feeds) {
        return;
    }
    var counts = feeds.counts();
    var fresh = feeds.newClients();
    var top = feeds.topTalkers(5);

    var html = '<div class="nw-counts">' +
        '<span><b>' + counts.total + '</b>online</span>' +
        '<span><b>' + counts.wired + '</b>wired</span>' +
        '<span><b>' + counts.wireless + '</b>wireless</span>' +
        '<span class="' + (counts.isNew ? "bad" : "") + '"><b>' +
            counts.isNew + '</b>new 24h</span>' +
        '</div>';

    html += '<div class="nw-sub-head">Top talkers now</div>';
    if (!top.length) {
        html += '<div class="nw-wait">Nothing moving</div>';
    } else {
        var max = top[0].total || 1;
        html += top.map(function (c) {
            var pc = Math.max(2, (c.total / max) * 100);
            return '<div class="nw-row' + (c.isNew ? " bad" : "") +
                '" data-client="' + escapeText(c.mac) + '">' +
                '<span class="nw-row-name">' + escapeText(c.name) + '</span>' +
                '<span class="nw-row-val">' + rate(c.total) + '</span>' +
                '<span class="nw-row-sub">' + escapeText(c.ip) + " " +
                    (c.wired ? "wired" : (c.band || "wireless")) + '</span>' +
                '<span class="nw-row-track"><i style="width:' + pc.toFixed(1) +
                    '%"></i></span>' +
                '</div>';
        }).join("");
    }

    html += '<div class="nw-sub-head' + (fresh.length ? " bad" : "") +
        '">New in the last 24 hours' +
        (fresh.length ? " (" + fresh.length + ")" : "") + '</div>';
    if (!fresh.length) {
        html += '<div class="nw-wait">None</div>';
    } else {
        html += fresh.slice(0, 8).map(function (c) {
            return '<div class="nw-row bad" data-client="' + escapeText(c.mac) + '">' +
                '<span class="nw-row-name">' + escapeText(c.name) + '</span>' +
                '<span class="nw-row-val">' + duration(c.uptime) + '</span>' +
                '<span class="nw-row-sub">' + escapeText(c.ip) + " " +
                    escapeText(c.oui || (c.wired ? "wired" : "wireless")) + '</span>' +
                '</div>';
        }).join("");
    }

    box.innerHTML = html;
}

/* ---- switches and APs ---------------------------------------------------------------- */

function renderInfra() {
    var box = $id("nw-infra-body");
    if (!box || !feeds) {
        return;
    }
    var devices = feeds.devices();
    if (!devices.length) {
        box.innerHTML = '<div class="nw-wait">' +
            (feeds.ready ? "No devices" : "Loading") + '</div>';
        return;
    }

    var html = "";

    devices.filter(function (d) { return d.type === "usw"; }).forEach(function (sw) {
        var budget = sw.poeBudget || 0;
        var pc = budget > 0 ? (sw.poeUsed / budget) * 100 : 0;
        html += '<div class="nw-dev" data-device="' + escapeText(sw.name) + '">' +
            '<div class="nw-dev-head"><b>' + escapeText(sw.name) + '</b>' +
            '<span>' + escapeText(sw.model) + '</span>' +
            '<i>' + sw.portsUp + (sw.portsTotal ? " / " + sw.portsTotal : "") +
            ' ports up</i></div>';

        if (budget > 0) {
            html += '<div class="nw-poe"><span>PoE ' + sw.poeUsed.toFixed(1) +
                ' of ' + budget + ' W</span>' +
                '<span class="nw-poe-track"><i style="width:' +
                Math.min(100, pc).toFixed(1) + '%"></i></span></div>';
        } else {
            html += '<div class="nw-poe"><span>No PoE budget</span></div>';
        }

        html += '<div class="nw-ports">';
        for (var i = 1; i <= (sw.portsTotal || sw.portsUp); i++) {
            var port = null;
            for (var k = 0; k < sw.ports.length; k++) {
                if (sw.ports[k].num === i) { port = sw.ports[k]; }
            }
            var cls = !port ? "off" : (port.poe > 0 ? "poe" : "up");
            var speed = port ? (port.speed >= 1e9
                ? (port.speed / 1e9) + "G" : Math.round(port.speed / 1e6) + "M") : "down";
            var title = "Port " + i + ": " + (port
                ? speed + (port.poe > 0 ? ", PoE " + port.poe.toFixed(1) + " W" : "")
                : "no link");
            html += '<i class="nw-port ' + cls + '" title="' + escapeText(title) +
                '">' + i + '</i>';
        }
        html += '</div></div>';
    });

    devices.filter(function (d) { return d.type === "uap"; }).forEach(function (ap) {
        html += '<div class="nw-dev" data-device="' + escapeText(ap.name) + '">' +
            '<div class="nw-dev-head"><b>' + escapeText(ap.name) + '</b>' +
            '<span>' + escapeText(ap.model) + '</span>' +
            '<i>' + (ap.stations || 0) + ' clients</i></div>';
        if (!ap.radios.length) {
            html += '<div class="nw-wait">No radio data</div>';
        } else {
            html += '<div class="nw-radios">' + ap.radios.map(function (r) {
                var util = r.utilization !== undefined && r.utilization !== null
                    ? Math.round(r.utilization * 100) + "%" : "n/a";
                var high = r.utilization > 0.7;
                return '<span class="nw-radio' + (high ? " bad" : "") + '">' +
                    '<b>' + escapeText(r.band) + '</b>' +
                    'ch ' + (r.channel || "n/a") +
                    ', ' + (r.stations || 0) + ' cl' +
                    ', util ' + util + '</span>';
            }).join("") + '</div>';
        }
        html += '</div>';
    });

    box.innerHTML = html;
}

/* ---- detail panel ----------------------------------------------------------------------- */

function openClient(mac) {
    var list = feeds.clients();
    var found = null;
    list.forEach(function (c) { if (c.mac === mac) { found = c; } });
    if (!found) {
        return;
    }
    selected = { kind: "client", id: mac };
    selectedHistory = null;
    feeds.clientHistory(mac).then(function (points) {
        if (selected && selected.id === mac) {
            selectedHistory = points;
            dirty = true;
        }
    });
    dirty = true;
    renderDetail();
}

function openDevice(name) {
    selected = { kind: "device", id: name };
    selectedHistory = null;
    dirty = true;
    renderDetail();
}

function closeDetail() {
    selected = null;
    selectedHistory = null;
    var panel = $id("nw-detail");
    if (panel) {
        panel.classList.remove("open");
    }
    dirty = true;
}

function renderDetail() {
    var panel = $id("nw-detail");
    if (!panel || !feeds) {
        return;
    }
    if (!selected) {
        panel.classList.remove("open");
        return;
    }

    var rows = [];
    var title = "", sub = "", bad = false;

    if (selected.kind === "client") {
        var c = null;
        feeds.clients().forEach(function (x) { if (x.mac === selected.id) { c = x; } });
        if (!c) {
            panel.classList.remove("open");
            return;
        }
        title = c.name;
        sub = c.ip;
        bad = c.isNew;
        rows = [
            ["Address", c.ip, c.mac],
            ["Vendor", c.oui || "unknown", ""],
            ["Network", c.network + (c.vlan ? " (VLAN " + c.vlan + ")" : ""), c.subnetLabel],
            ["Connection", c.wired ? "Wired" : "Wireless",
             c.wired ? (c.via + " port " + c.port)
                     : (c.via + (c.essid ? ", " + c.essid : ""))],
            /* radio_signal_db, not rssi_db: the first is dBm, the second is
               UniFi's 18 to 63 quality scale and would read as a nonsense
               positive dBm. */
            ["Signal", c.wired ? "n/a" : (c.signal !== undefined && c.signal !== null
                ? Math.round(c.signal) + " dBm" : "n/a"),
             c.wired ? "" : (c.band + (c.channel ? ", ch " + c.channel : "") +
                (c.snr !== null ? ", SNR " + Math.round(c.snr) + " dB" : ""))],
            ["Down now", rate(c.rx), ""],
            ["Up now", rate(c.tx), ""],
            ["Connected", duration(c.uptime), c.isNew ? "NEW IN LAST 24 H" : ""],
            ["Experience", c.satisfaction !== undefined && c.satisfaction !== null
                ? Math.round(c.satisfaction * 100) + "%" : "n/a", ""]
        ];
    } else {
        var d = null;
        feeds.devices().forEach(function (x) { if (x.name === selected.id) { d = x; } });
        if (!d) {
            panel.classList.remove("open");
            return;
        }
        title = d.name;
        sub = d.ip;
        bad = d.upgradable;
        rows = [
            ["Model", d.model, d.type.toUpperCase()],
            ["Address", d.ip, d.mac],
            ["Firmware", d.version, d.upgradable ? "UPDATE AVAILABLE" : "up to date"],
            ["Uptime", duration(d.uptime), ""],
            ["CPU", d.cpu !== null ? Math.round(d.cpu * 100) + "%" : "n/a", ""],
            ["Memory", d.memory !== null ? Math.round(d.memory * 100) + "%" : "n/a", ""],
            ["Temperature", d.temperature !== null
                ? Math.round(d.temperature) + " C" : "n/a", ""],
            ["Ports up", d.portsUp + (d.portsTotal ? " of " + d.portsTotal : ""), ""],
            ["PoE", d.poeBudget ? d.poeUsed.toFixed(1) + " of " + d.poeBudget + " W"
                : "none", ""]
        ];
    }

    panel.classList.add("open");
    $id("nw-detail-name").textContent = title;
    $id("nw-detail-sub").textContent = sub;
    $id("nw-detail-name").className = bad ? "bad" : "";

    $id("nw-detail-rows").innerHTML = rows.map(function (r) {
        var note = r[2] || "";
        var hot = /NEW IN|UPDATE AVAILABLE/.test(note);
        return '<div class="nw-drow' + (hot ? " bad" : "") + '">' +
            '<span>' + escapeText(r[0]) + '</span>' +
            '<b>' + escapeText(r[1]) + '</b>' +
            '<i>' + escapeText(note) + '</i></div>';
    }).join("");

    sizeCanvas(devCanvas, dctx);
    drawDetailChart();
}

function drawDetailChart() {
    if (!dctx || !devCanvas) {
        return;
    }
    var w = devCanvas.clientWidth, h = devCanvas.clientHeight;
    if (!w || !h) {
        return;
    }
    var ctx = dctx;
    ctx.clearRect(0, 0, w, h);

    var pts = selectedHistory;
    if (!pts || pts.length < 2) {
        ctx.fillStyle = "rgba(191,244,255,.4)";
        ctx.font = "10px Menlo, Consolas, monospace";
        ctx.fillText(selected && selected.kind === "device"
            ? "Per device history is not collected"
            : (pts ? "No traffic history" : "Loading history"), 6, 16);
        return;
    }

    var left = 44, right = 8, top = 16, bottom = 14;
    var pw = w - left - right, ph = h - top - bottom;
    var max = 1;
    pts.forEach(function (p) { max = Math.max(max, p.rx, p.tx); });
    max *= 1.15;

    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    var span = Math.max(1, t1 - t0);
    var X = function (t) { return left + ((t - t0) / span) * pw; };
    var Y = function (v) { return top + ph - (v / max) * ph; };

    ctx.font = "9px Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    [0, max].forEach(function (v) {
        var y = Math.floor(Y(v)) + 0.5;
        ctx.strokeStyle = "rgba(63,224,255,.1)";
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
        ctx.fillStyle = "rgba(191,244,255,.5)";
        var bits = v * 8;
        ctx.fillText(bits >= 1e6 ? (bits / 1e6).toFixed(1) + "M"
            : (bits / 1e3).toFixed(0) + "k", left - 3, y + 3);
    });

    var grad = ctx.createLinearGradient(0, top, 0, top + ph);
    grad.addColorStop(0, "rgba(63,224,255,.38)");
    grad.addColorStop(1, "rgba(63,224,255,.02)");
    ctx.beginPath();
    ctx.moveTo(X(pts[0].t), top + ph);
    pts.forEach(function (p) { ctx.lineTo(X(p.t), Y(p.rx)); });
    ctx.lineTo(X(pts[pts.length - 1].t), top + ph);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(function (p, i) {
        if (i) { ctx.lineTo(X(p.t), Y(p.rx)); } else { ctx.moveTo(X(p.t), Y(p.rx)); }
    });
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    pts.forEach(function (p, i) {
        if (i) { ctx.lineTo(X(p.t), Y(p.tx)); } else { ctx.moveTo(X(p.t), Y(p.tx)); }
    });
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = CYAN;
    ctx.fillText("DOWN", left + 2, top - 5);
    ctx.fillStyle = ACCENT;
    ctx.fillText("UP", left + 42, top - 5);
}

/* ---- clock ------------------------------------------------------------------------------- */

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"];
var lastClock = "";

function renderClock(now) {
    var el = $id("nw-time");
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
    var dt = $id("nw-date");
    if (dt) {
        dt.textContent = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " +
            d.getDate() + ", " + d.getFullYear();
    }
}

/* ---- controls ------------------------------------------------------------------------------ */

function nodeAt(target) {
    var i = target.getAttribute("data-node");
    return i === null ? null : layout.nodes[Number(i)];
}

function bindControls() {
    var root = $id("network-screen");

    root.addEventListener("click", function (e) {
        if (e.target.closest("#nw-detail-close")) {
            closeDetail();
            return;
        }

        var row = e.target.closest("[data-client]");
        if (row) {
            openClient(row.getAttribute("data-client"));
            return;
        }
        var dev = e.target.closest("[data-device]");
        if (dev) {
            openDevice(dev.getAttribute("data-device"));
            return;
        }

        var hit = e.target.closest("[data-node]");
        if (!hit) {
            return;
        }
        var n = nodeAt(hit);
        if (!n) {
            return;
        }
        if (n.kind === "cluster") {
            /* Clicking a cluster opens it into its clients, and again closes it. */
            expanded[n.subnet.key] = !expanded[n.subnet.key];
            dirty = true;
            lastRender = 0;
            buildTopology();
        } else if (n.kind === "client") {
            openClient(n.client.mac);
        } else if (n.device) {
            openDevice(n.device.name);
        }
    });

    window.addEventListener("keydown", function (e) {
        if (!active || e.key !== "Escape") {
            return;
        }
        if (selected) {
            closeDetail();
        } else {
            /* Escape with nothing open collapses every expanded cluster. */
            var any = Object.keys(expanded).some(function (k) { return expanded[k]; });
            if (any) {
                expanded = {};
                dirty = true;
                lastRender = 0;
                buildTopology();
            }
        }
    });
}

export { NetworkView };
