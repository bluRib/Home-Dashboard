/* The Homelab screen.
 *
 * Full viewport grid, same approach as the other screens. The hero is a map of
 * the homelab: the Proxmox cluster, the five Docker hosts with their services
 * as satellites, and the singles as a cluster that opens.
 *
 * Every panel names the source it is waiting on rather than showing a zero.
 * Right now Home Assistant and unpoller are live, so host link state, uptime,
 * throughput, both UPS units, the homelab power draw and the whole Home
 * Assistant panel are real. Node and guest metrics, per service checks and
 * storage are waiting on exporters that do not exist yet, and say so.
 */

import { HomelabFeeds, BACKUP_STALE_HOURS } from "./HomelabFeeds.js";

var CYAN = "#3fe0ff";
var ALERT = "#ff8a1f";
var ACCENT = "#4dffb0";
var DIM = "#2aa3bb";

var REFRESH_MS = 2500;

function $id(id) {
    return document.getElementById(id);
}

function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
}

var HomelabView = {};

var feeds = null;
var active = false;
var built = false;
var dirty = true;
var lastRender = 0;
var lastFrame = 0;
var resizeTimer = null;
var observer = null;

var svg = null, pulseCanvas = null, pctx = null;
var detailCanvas = null, dctx = null;

var expanded = false;        // the singles cluster
var selected = null;         // host ip
var selectedHistory = null;
var layout = { nodes: [], links: [] };
var pulses = [];

/* ---- lifecycle ----------------------------------------------------------------- */

HomelabView.init = function (ha) {
    var root = $id("homelab-screen");
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;

    svg = $id("hl-svg");
    pulseCanvas = $id("hl-pulses");
    pctx = pulseCanvas ? pulseCanvas.getContext("2d") : null;
    detailCanvas = $id("hl-detail-canvas");
    dctx = detailCanvas ? detailCanvas.getContext("2d") : null;

    if (!feeds) {
        feeds = new HomelabFeeds(ha, function () { dirty = true; });
        feeds.start();
    }

    if (!built) {
        built = true;
        bindControls();
    }

    watchPanels();
    requestAnimationFrame(function () {
        requestAnimationFrame(function () { HomelabView.resize(); });
    });
    dirty = true;
};

HomelabView.show = function () {
    active = true;
    var root = $id("homelab-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
    HomelabView.resize();
};

HomelabView.hide = function () {
    active = false;
    $id("homelab-screen").style.display = "none";
};

/* Home Assistant state changes move the HA panel, the UPS and the power. */
HomelabView.message = function () { dirty = true; };
HomelabView.seed = function () { dirty = true; };

HomelabView.animate = function () {
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
        buildMap();
        renderStatus();
        renderServices();
        renderHa();
        renderStorage();
        renderPower();
        renderDetail();
    }
};

HomelabView.resize = function () {
    if (!active) {
        return;
    }
    sizeCanvas(pulseCanvas, pctx);
    sizeCanvas(detailCanvas, dctx);
    dirty = true;
    lastRender = 0;
    buildMap();
};

HomelabView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        HomelabView.resize();
    }, 150);
};

function watchPanels() {
    if (observer || typeof ResizeObserver === "undefined") {
        return;
    }
    observer = new ResizeObserver(function () { HomelabView.resizeDebounced(); });
    ["hl-map-body", "hl-detail"].forEach(function (id) {
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

/* ---- formatting ------------------------------------------------------------------- */

function rate(bps) {
    if (bps === null || bps === undefined) { return "n/a"; }
    var bits = bps * 8;
    if (bits >= 1e9) { return (bits / 1e9).toFixed(2) + " Gb/s"; }
    if (bits >= 1e6) { return (bits / 1e6).toFixed(1) + " Mb/s"; }
    if (bits >= 1e3) { return (bits / 1e3).toFixed(0) + " kb/s"; }
    return Math.round(bits) + " b/s";
}

function duration(sec) {
    if (sec === null || sec === undefined) { return "n/a"; }
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
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

/* The one place that decides how a panel says it has no source yet. */
function awaiting(source) {
    return '<div class="hl-awaiting"><b>AWAITING DATA</b>' +
        '<span>' + escapeText(source) + '</span></div>';
}

/* ---- the map ------------------------------------------------------------------------ */

function buildMap() {
    var host = $id("hl-map-body");
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

    var hosts = feeds.hosts();
    if (!hosts.length) {
        svg.innerHTML = '<text x="' + (w / 2) + '" y="' + (h / 2) +
            '" text-anchor="middle" class="hl-empty">LOADING</text>';
        layout = { nodes: [], links: [] };
        pulses = [];
        return;
    }

    var fontPx = Math.max(8, Math.min(12, w * 0.0062));
    var charW = fontPx * 0.62;
    var padX = Math.max(40, Math.min(70, w * 0.05));
    var padY = 18;

    var nodes = [], links = [];
    var pve = hosts.filter(function (x) { return x.kind === "pve"; });
    var docker = hosts.filter(function (x) { return x.kind === "docker"; });
    var singles = hosts.filter(function (x) { return x.kind === "single"; });

    /* Three bands down the panel: the cluster, the Docker hosts, the singles.
       Each band is laid out across the width, with service satellites placed
       on a short arc under their host. */
    var bandY = [h * 0.17, h * 0.52, h * 0.86];

    /* The spine sits at spineX with its band name centred above it. The widest
       band name is SINGLES at seven characters, and the name carries wide
       letter spacing, so the hosts have to begin clear of that or the first
       host label prints on top of the band name. */
    var spineX = padX * 0.42;
    var bandNameW = 7 * charW * 1.35;
    var bandLeft = Math.max(padX, spineX + bandNameW / 2 + 22);

    function place(list, y) {
        var n = list.length;
        var span = w - bandLeft - padX;
        var gap = n > 1 ? span / (n - 1) : 0;
        list.forEach(function (hst, i) {
            nodes.push({
                kind: hst.kind, host: hst,
                x: n > 1 ? bandLeft + gap * i : (bandLeft + w - padX) / 2,
                y: y, r: hst.kind === "pve" ? 13 : 11
            });
        });
    }

    place(pve, bandY[0]);
    place(docker, bandY[1]);

    if (expanded) {
        place(singles, bandY[2]);
    } else {
        var seenCount = singles.filter(function (x) { return x.seen; }).length;
        nodes.push({
            kind: "cluster", x: (bandLeft + w - padX) / 2, y: bandY[2], r: 13,
            label: "Singles", count: singles.length, seen: seenCount,
            singles: singles
        });
    }

    /* Service satellites, on an arc beneath each Docker host. */
    nodes.slice().forEach(function (n, ni) {
        if (n.kind !== "docker" || !n.host.services.length) {
            return;
        }
        var svcs = n.host.services;
        var spread = Math.min(1.5, 0.42 + svcs.length * 0.14);
        var radius = Math.max(34, Math.min(60, w * 0.035));
        svcs.forEach(function (s, i) {
            var t = svcs.length === 1 ? 0
                : (i / (svcs.length - 1) - 0.5) * spread;
            nodes.push({
                kind: "service", service: s, parent: ni,
                x: n.x + Math.sin(t) * radius,
                y: n.y + Math.cos(t) * radius * 0.78 + 8,
                r: 3
            });
            links.push({ source: ni, target: nodes.length - 1, kind: "service",
                         rate: 0, down: !n.host.seen });
        });
    });

    /* Link every host up to the band label on the left, which stands in for
       the rack. The point is to read as a map, not as an org chart. */
    [0, 1, 2].forEach(function (b) {
        nodes.push({ kind: "spine", x: spineX, y: bandY[b], r: 4,
                     label: ["PROXMOX", "DOCKER", "SINGLES"][b] });
    });
    var spineIdx = {};
    nodes.forEach(function (n, i) {
        if (n.kind === "spine") {
            spineIdx[Math.round(n.y)] = i;
        }
    });
    nodes.forEach(function (n, i) {
        if (n.kind === "pve" || n.kind === "docker" || n.kind === "cluster" ||
            (n.kind === "single" && expanded)) {
            var si = spineIdx[Math.round(n.y)];
            if (si !== undefined && si !== i) {
                links.push({ source: si, target: i, kind: "host",
                             rate: n.host ? (n.host.rx + n.host.tx) : 0,
                             down: n.host ? !n.host.seen : false });
            }
        }
    });

    var maxRate = 1;
    links.forEach(function (l) { maxRate = Math.max(maxRate, l.rate || 0); });

    var parts = [];

    links.forEach(function (l, i) {
        var a = nodes[l.source], b = nodes[l.target];
        if (!a || !b) { return; }
        var share = (l.rate || 0) / maxRate;
        var colour = l.down ? ALERT : (l.kind === "service" ? DIM : CYAN);
        var width = l.kind === "service" ? 1
            : Math.max(1.2, 1.2 + Math.sqrt(share) * 4.5);
        var opacity = l.kind === "service" ? 0.28 : (0.3 + 0.5 * Math.sqrt(share));
        var d = "M" + a.x + "," + a.y +
            "C" + ((a.x + b.x) / 2) + "," + a.y + " " +
            ((a.x + b.x) / 2) + "," + b.y + " " + b.x + "," + b.y;
        l._d = d; l._w = width; l._down = l.down;
        parts.push('<path class="hl-link' + (l.down ? " down" : "") +
            '" d="' + d + '" stroke="' + colour + '" stroke-width="' + width.toFixed(2) +
            '" stroke-opacity="' + opacity.toFixed(3) + '" fill="none"></path>');
    });

    nodes.forEach(function (n, i) {
        parts.push(nodeMarkup(n, i, fontPx, charW, w));
    });

    svg.innerHTML = parts.join("");
    layout = { nodes: nodes, links: links };
    seedPulses(links, maxRate);
}

function nodeMarkup(n, i, fontPx, charW, w) {
    if (n.kind === "spine") {
        return '<circle class="hl-node hl-node-spine" cx="' + n.x + '" cy="' + n.y +
            '" r="3" fill="' + DIM + '"></circle>' +
            '<text class="hl-label hl-label-spine" x="' + n.x + '" y="' +
            (n.y - 10) + '" text-anchor="middle">' + escapeText(n.label) + '</text>';
    }

    if (n.kind === "service") {
        var s = n.service;
        var ok = s.status === null ? null : s.status === 1;
        var col = ok === false ? ALERT : DIM;
        return '<circle class="hl-node hl-node-service" cx="' + n.x + '" cy="' + n.y +
            '" r="' + n.r + '" fill="' + col + '" data-node="' + i + '"></circle>';
    }

    var bad = false, colour = CYAN;
    var label = "", sub = "";

    if (n.kind === "cluster") {
        label = n.label + " (" + n.count + ")";
        sub = n.seen + " of " + n.count + " up";
        bad = n.seen < n.count;
        colour = bad ? ALERT : CYAN;
    } else {
        var hst = n.host;
        label = hst.name;
        bad = !hst.seen;
        colour = bad ? ALERT : (hst.kind === "pve" ? ACCENT : CYAN);
        if (!hst.seen) {
            sub = "NOT SEEN";
        } else if (hst.stats) {
            sub = Math.round(hst.stats.cpu) + "% cpu";
        } else {
            sub = rate(hst.rx + hst.tx);
        }
    }

    var maxChars = Math.floor((w * 0.13) / charW);
    if (label.length > maxChars && maxChars > 4) {
        label = label.slice(0, maxChars - 1) + "…";
    }

    var shape = n.kind === "cluster"
        ? '<rect class="hl-node hl-node-cluster' + (bad ? " bad" : "") +
          '" x="' + (n.x - n.r) + '" y="' + (n.y - n.r) + '" width="' + (n.r * 2) +
          '" height="' + (n.r * 2) + '" fill="' + colour + '" data-node="' + i + '"></rect>'
        : '<circle class="hl-node hl-node-' + n.kind + (bad ? " bad" : "") +
          '" cx="' + n.x + '" cy="' + n.y + '" r="' + n.r + '" fill="' + colour +
          '" data-node="' + i + '"></circle>';

    return shape +
        '<text class="hl-label hl-label-' + n.kind + (bad ? " bad" : "") +
        '" x="' + n.x + '" y="' + (n.y - n.r - fontPx * 0.8) +
        '" text-anchor="middle" data-node="' + i + '">' +
        '<tspan class="hl-label-name" x="' + n.x + '">' + escapeText(label) + '</tspan>' +
        (sub ? '<tspan class="hl-label-sub" x="' + n.x + '" dy="' +
               (-fontPx * 1.05).toFixed(1) + '">' + escapeText(sub) + '</tspan>' : '') +
        '</text>';
}

/* ---- pulses -------------------------------------------------------------------------- */

function samplePath(d, n) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    var len = 0;
    try { len = el.getTotalLength(); } catch (err) { return null; }
    if (!len || !isFinite(len)) { return null; }
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
        if (l.kind === "service" || !(l.rate > 0)) { return; }
        var sampled = samplePath(l._d, 24);
        if (!sampled) { return; }
        l._path = sampled;
        var share = l.rate / maxRate;
        var count = Math.max(1, Math.round(1 + 5 * Math.sqrt(share)));
        var speed = 26 + 120 * Math.sqrt(share);
        for (var k = 0; k < count; k++) {
            pulses.push({ link: i, at: Math.random(),
                          speed: speed * (0.85 + Math.random() * 0.3),
                          size: Math.max(1, l._w * 0.4), down: !!l._down });
        }
    });
}

function stepPulses(dt) {
    if (!pctx || !pulseCanvas) { return; }
    var w = pulseCanvas.clientWidth, h = pulseCanvas.clientHeight;
    if (!w || !h) { return; }
    pctx.clearRect(0, 0, w, h);
    if (!pulses.length || !layout.links.length) { return; }
    pctx.globalCompositeOperation = "lighter";

    for (var i = 0; i < pulses.length; i++) {
        var p = pulses[i];
        var l = layout.links[p.link];
        if (!l || !l._path) { continue; }
        p.at += (p.speed * dt) / l._path.len;
        if (p.at > 1) { p.at -= 1; }
        var pts = l._path.pts;
        var f = p.at * l._path.n;
        var i0 = Math.floor(f), t = f - i0;
        if (i0 >= l._path.n) { i0 = l._path.n - 1; t = 1; }
        var x = pts[i0 * 2] + (pts[i0 * 2 + 2] - pts[i0 * 2]) * t;
        var y = pts[i0 * 2 + 1] + (pts[i0 * 2 + 3] - pts[i0 * 2 + 1]) * t;
        var edge = Math.min(p.at, 1 - p.at);
        var alpha = Math.min(1, edge / 0.08) * 0.8;
        pctx.beginPath();
        pctx.arc(x, y, p.size, 0, Math.PI * 2);
        pctx.fillStyle = p.down ? "rgba(255,138,31," + alpha.toFixed(3) + ")"
                                : "rgba(191,244,255," + alpha.toFixed(3) + ")";
        pctx.fill();
    }
    pctx.globalCompositeOperation = "source-over";
}

/* ---- status row --------------------------------------------------------------------- */

function stat(id, value, sub, bad) {
    var el = $id(id);
    if (!el) { return; }
    el.firstChild.textContent = value;
    var span = el.querySelector("span");
    if (span && sub !== undefined && sub !== null) { span.textContent = sub; }
    el.className = "hl-stat" + (bad ? " bad" : "");
}

function renderStatus() {
    if (!feeds) { return; }
    var s = feeds.status();

    stat("hl-stat-nodes", s.hostsUp + " / " + s.hostsTotal,
         "Hosts seen, " + s.nodesUp + " of " + s.nodesTotal + " Proxmox",
         s.hostsUp < s.hostsTotal);

    stat("hl-stat-guests",
         s.guestsKnown ? (s.guestsRunning + " / " + s.guestsTotal) : "--",
         s.guestsKnown ? "Guests running" : "Guests, awaiting pve-exporter", false);

    stat("hl-stat-services",
         s.servicesKnown ? (s.servicesUp + " / " + s.servicesTotal)
                         : ("-- / " + s.servicesTotal),
         s.servicesKnown ? "Services up" : "Services, awaiting Uptime Kuma", false);

    stat("hl-stat-alerts", String(s.alerts.length),
         s.alerts.length ? s.alerts[0].text : "No active alerts",
         s.alerts.length > 0);
}

/* ---- services board ------------------------------------------------------------------ */

function renderServices() {
    var box = $id("hl-services-body");
    var head = $id("hl-services-note");
    if (!box || !feeds) { return; }

    var groups = feeds.services();
    var kumaLive = feeds.sources.kuma.live;
    if (head) {
        head.textContent = kumaLive ? "Live" : "Host link only";
        head.className = kumaLive ? "" : "warn";
    }

    var html = "";
    if (!kumaLive) {
        html += '<div class="hl-note"><b>AWAITING Uptime Kuma</b>' +
            'Per service checks and response times need Uptime Kuma scraped by ' +
            'Prometheus. What is shown below is whether each service\'s HOST is ' +
            'seen by the UniFi controller, which is not the same thing.</div>';
    }

    groups.forEach(function (g) {
        /* Anything down sorts to the top of its group. */
        var items = g.items.slice().sort(function (a, b) {
            var ad = a.status === 0 ? 0 : (a.hostSeen ? 2 : 1);
            var bd = b.status === 0 ? 0 : (b.hostSeen ? 2 : 1);
            return ad - bd || a.name.localeCompare(b.name);
        });
        html += '<div class="hl-sgroup">' + escapeText(g.group) + '</div>';
        items.forEach(function (s) {
            var down = s.status === 0 || (!kumaLive && !s.hostSeen);
            var stateText = s.status === 1 ? "UP"
                : s.status === 0 ? "DOWN"
                : s.hostSeen ? "host up" : "HOST DOWN";
            html += '<div class="hl-srow' + (down ? " bad" : "") +
                '" data-url="' + escapeText(s.url) + '">' +
                '<span class="hl-sname">' + escapeText(s.name) + '</span>' +
                '<span class="hl-sstate">' + stateText + '</span>' +
                '<span class="hl-sms">' +
                    (s.ms !== null && s.ms !== undefined ? Math.round(s.ms) + " ms" : "") +
                '</span></div>';
        });
    });

    box.innerHTML = html;
}

/* ---- Home Assistant panel --------------------------------------------------------------- */

function renderHa() {
    var box = $id("hl-ha-body");
    if (!box || !feeds) { return; }
    var ha = feeds.homeAssistant();

    if (!ha.live) {
        box.innerHTML = awaiting("Home Assistant WebSocket");
        return;
    }

    var row = function (label, value, note, bad) {
        return '<div class="hl-row' + (bad ? " bad" : "") + '">' +
            '<span>' + escapeText(label) + '</span>' +
            '<b>' + escapeText(value) + '</b>' +
            (note ? '<i>' + escapeText(note) + '</i>' : '') + '</div>';
    };

    var html = "";
    html += row("Core version", ha.version || "n/a",
                ha.coreUpdate ? "update to " + ha.latest : "up to date", ha.coreUpdate);
    html += row("Updates available", String(ha.updates.length),
                ha.updates.length ? ha.updates.slice(0, 2).map(function (u) {
                    return u.name;
                }).join(", ") : "none", ha.updates.length > 0);

    /* No processor or memory entity exists on this instance, so this says what
       would add them rather than showing a zero. */
    html += ha.cpu !== null
        ? row("CPU", Math.round(ha.cpu) + "%", "", ha.cpu > 85)
        : row("CPU and RAM", "AWAITING", "add the System Monitor integration", false);
    html += ha.dbSize !== null
        ? row("Database", ha.dbSize.toFixed(1) + " MB", "", false)
        : row("Database size", "AWAITING", "enable the recorder size sensor", false);

    html += row("Zigbee coordinator",
                ha.zigbee.eth && ha.zigbee.net ? "ONLINE" : "LINK DOWN",
                "SLZB-06 " + (ha.zigbee.chipTemp !== null
                    ? Math.round(ha.zigbee.chipTemp) + " C" : "") +
                (ha.zigbee.z2m ? ", Z2M " + (ha.zigbee.z2mVersion || "connected") : ", Z2M down"),
                !(ha.zigbee.eth && ha.zigbee.net) || !ha.zigbee.z2m);

    html += row("Z-Wave dead nodes", String(ha.zwave.dead.length),
                ha.zwave.dead.length ? ha.zwave.dead.slice(0, 2).join(", ") : "none",
                ha.zwave.dead.length > 0);
    html += row("Z-Wave faults", String(ha.zwave.failing.length),
                ha.zwave.failing.length
                    ? ha.zwave.failing.slice(0, 2).join(", ") + (
                        ha.zwave.failing.length > 2
                            ? " and " + (ha.zwave.failing.length - 2) + " more" : "")
                    : "none",
                ha.zwave.failing.length > 0);

    var age = ha.backups.ageHours;
    html += row("Backups",
                ha.backups.stale ? "STALE" : (ha.backups.state || "n/a"),
                age !== null ? Math.round(age) + " h ago" : "",
                ha.backups.stale || (age !== null && age > BACKUP_STALE_HOURS));

    box.innerHTML = html;
}

/* ---- storage and backups ------------------------------------------------------------------ */

function renderStorage() {
    var box = $id("hl-storage-body");
    if (!box || !feeds) { return; }
    var st = feeds.storage();
    if (!st.live) {
        box.innerHTML = awaiting("TrueNAS and PBS exporters") +
            '<div class="hl-note">Both answer on the network but send no CORS ' +
            'headers, so the browser cannot read them whatever credentials it ' +
            'has. They need an exporter in front of Prometheus.</div>';
        return;
    }
    box.innerHTML = "";
}

/* ---- power and UPS -------------------------------------------------------------------------- */

function renderPower() {
    var box = $id("hl-power-body");
    if (!box || !feeds) { return; }
    var p = feeds.power();
    var u = feeds.ups();

    if (!p.live && !u.live) {
        box.innerHTML = awaiting("Home Assistant");
        return;
    }

    var html = '<div class="hl-pgrid">';

    html += '<div class="hl-pcol"><div class="hl-sub">Homelab draw</div>';
    html += '<div class="hl-ptotal">' + Math.round(p.total) + '<small>W</small></div>';
    var max = p.items.reduce(function (a, x) { return Math.max(a, x.watts); }, 1);
    p.items.forEach(function (x) {
        html += '<div class="hl-prow"><span>' + escapeText(x.label) + '</span>' +
            '<b>' + x.watts.toFixed(1) + ' W</b>' +
            '<i style="width:' + Math.max(2, (x.watts / max) * 100).toFixed(1) +
            '%"></i></div>';
    });
    html += '</div>';

    html += '<div class="hl-pcol"><div class="hl-sub">UPS</div>';
    if (!u.live) {
        html += awaiting("Home Assistant NUT");
    } else {
        u.units.forEach(function (x) {
            var low = x.charge !== null && x.charge < 95;
            html += '<div class="hl-ups' + (low ? " bad" : "") + '">' +
                '<div class="hl-ups-head"><b>' + escapeText(x.label) + '</b>' +
                '<span>' + (x.charge !== null ? Math.round(x.charge) + "%" : "n/a") +
                '</span></div>' +
                '<div class="hl-ups-bar"><i style="width:' +
                    (x.charge !== null ? Math.max(2, x.charge) : 0) + '%"></i></div>' +
                '<div class="hl-ups-sub">load ' +
                    (x.load !== null ? Math.round(x.load) + "%" : "n/a") +
                    ', in ' + (x.volts !== null ? Math.round(x.volts) + " V" : "n/a") +
                    ', runtime not reported</div>' +
                '</div>';
        });
    }
    html += '</div></div>';

    box.innerHTML = html;
}

/* ---- detail panel ------------------------------------------------------------------------------ */

function openHost(ip) {
    selected = ip;
    selectedHistory = null;
    feeds.hostHistory(ip).then(function (points) {
        if (selected === ip) {
            selectedHistory = points;
            dirty = true;
        }
    });
    dirty = true;
    renderDetail();
}

function closeDetail() {
    selected = null;
    selectedHistory = null;
    var panel = $id("hl-detail");
    if (panel) { panel.classList.remove("open"); }
    dirty = true;
}

function renderDetail() {
    var panel = $id("hl-detail");
    if (!panel || !feeds) { return; }
    if (!selected) {
        panel.classList.remove("open");
        return;
    }
    var host = null;
    feeds.hosts().forEach(function (h) { if (h.ip === selected) { host = h; } });
    if (!host) {
        panel.classList.remove("open");
        return;
    }

    panel.classList.add("open");
    $id("hl-detail-name").textContent = host.name;
    $id("hl-detail-name").className = host.seen ? "" : "bad";
    $id("hl-detail-sub").textContent = host.ip;

    var rows = [
        ["Link", host.seen ? "UP" : "NOT SEEN",
         host.seen ? host.via + (host.port ? " port " + host.port : "") : "", !host.seen],
        ["Uptime", duration(host.uptime), "association", false],
        ["Down now", rate(host.rx), "", false],
        ["Up now", rate(host.tx), "", false],
        ["MAC", host.mac || "n/a", "", false],
        ["Role", host.kind === "pve" ? "Proxmox node"
            : host.kind === "docker" ? "Docker host" : "Single service host", "", false]
    ];

    if (host.stats) {
        rows.push(["CPU", Math.round(host.stats.cpu) + "%", "", host.stats.cpu > 85]);
        rows.push(["Memory", Math.round(host.stats.memPct) + "%", "", host.stats.memPct > 90]);
        rows.push(["Disk", Math.round(host.stats.diskPct) + "%", "", host.stats.diskPct > 90]);
    } else {
        rows.push(["CPU, RAM, disk", "AWAITING",
            host.kind === "pve" ? "prometheus-pve-exporter" : "node_exporter or Beszel", false]);
    }

    $id("hl-detail-rows").innerHTML = rows.map(function (r) {
        return '<div class="hl-drow' + (r[3] ? " bad" : "") + '">' +
            '<span>' + escapeText(r[0]) + '</span><b>' + escapeText(r[1]) + '</b>' +
            '<i>' + escapeText(r[2] || "") + '</i></div>';
    }).join("");

    var svcBox = $id("hl-detail-services");
    if (svcBox) {
        svcBox.innerHTML = host.services.length
            ? '<div class="hl-sub">Services on this host</div>' +
              host.services.map(function (s) {
                  return '<span class="hl-chip">' + escapeText(s.name) + '</span>';
              }).join("")
            : '<div class="hl-sub">No Homepage services on this host</div>';
    }

    sizeCanvas(detailCanvas, dctx);
    drawDetailChart();
}

function drawDetailChart() {
    if (!dctx || !detailCanvas) { return; }
    var w = detailCanvas.clientWidth, h = detailCanvas.clientHeight;
    if (!w || !h) { return; }
    var ctx = dctx;
    ctx.clearRect(0, 0, w, h);

    var pts = selectedHistory;
    if (!pts || pts.length < 2) {
        ctx.fillStyle = "rgba(191,244,255,.4)";
        ctx.font = "10px Menlo, Consolas, monospace";
        ctx.fillText(pts ? "No throughput history" : "Loading history", 6, 16);
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
    ctx.strokeStyle = CYAN; ctx.lineWidth = 1.2; ctx.stroke();

    ctx.beginPath();
    pts.forEach(function (p, i) {
        if (i) { ctx.lineTo(X(p.t), Y(p.tx)); } else { ctx.moveTo(X(p.t), Y(p.tx)); }
    });
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.1; ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = CYAN; ctx.fillText("DOWN", left + 2, top - 5);
    ctx.fillStyle = ACCENT; ctx.fillText("UP", left + 42, top - 5);
}

/* ---- clock ------------------------------------------------------------------------------------- */

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"];
var lastClock = "";

function renderClock(now) {
    var el = $id("hl-time");
    if (!el) { return; }
    var d = new Date(now);
    var h = d.getHours();
    var text = (h % 12 || 12) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    if (text === lastClock) { return; }
    lastClock = text;
    el.innerHTML = text + "<small>" + (h < 12 ? "AM" : "PM") + "</small>";
    var dt = $id("hl-date");
    if (dt) {
        dt.textContent = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " +
            d.getDate() + ", " + d.getFullYear();
    }
}

/* ---- controls ------------------------------------------------------------------------------------ */

function bindControls() {
    var root = $id("homelab-screen");

    root.addEventListener("click", function (e) {
        if (e.target.closest("#hl-detail-close")) {
            closeDetail();
            return;
        }

        var srow = e.target.closest("[data-url]");
        if (srow) {
            window.open(srow.getAttribute("data-url"), "_blank", "noopener");
            return;
        }

        var hit = e.target.closest("[data-node]");
        if (!hit) { return; }
        var n = layout.nodes[Number(hit.getAttribute("data-node"))];
        if (!n) { return; }

        if (n.kind === "cluster") {
            expanded = !expanded;
            dirty = true;
            lastRender = 0;
            buildMap();
        } else if (n.kind === "service") {
            window.open(n.service.url, "_blank", "noopener");
        } else if (n.host) {
            openHost(n.host.ip);
        }
    });

    window.addEventListener("keydown", function (e) {
        if (!active || e.key !== "Escape") { return; }
        if (selected) {
            closeDetail();
        } else if (expanded) {
            expanded = false;
            dirty = true;
            lastRender = 0;
            buildMap();
        }
    });
}

export { HomelabView };
