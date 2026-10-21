/* The Homelab screen.
 *
 * Built to be read the way Jovan reads his Homepage dashboard: how every
 * server is doing at a glance, and one click through to any web interface.
 *
 * Server cards across the top, a services grid underneath, and a narrow column
 * down the right for the counts, power and Home Assistant health. There is no
 * map any more: the one thing it carried that a card cannot is the network
 * path, and that now sits inside each card as a line of text.
 *
 * Every tile and every chip is a real anchor with an href, so middle click,
 * copy link address and open in a new window all behave the way they do
 * anywhere else on the web. Nothing here needs a JavaScript handler to
 * navigate.
 *
 * Sources: Beszel for CPU, memory, disk and temperature; unpoller through
 * Prometheus for link state, the switch and port, uptime and throughput; Home
 * Assistant for power, the UPS units and its own health. Beszel is optional.
 * Until it has credentials the cards simply carry no bars, and say nothing
 * about it.
 */

import { HomelabFeeds, BACKUP_STALE_HOURS } from "./HomelabFeeds.js";

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
var resizeTimer = null;

/* ---- lifecycle ----------------------------------------------------------- */

HomelabView.init = function (ha) {
    var root = $id("homelab-screen");
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;

    if (!feeds) {
        feeds = new HomelabFeeds(ha, function () { dirty = true; });
        feeds.start();
    }
    if (!built) {
        built = true;
        bindControls();
    }
    dirty = true;
};

HomelabView.show = function () {
    active = true;
    var root = $id("homelab-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
    dirty = true;
    lastRender = 0;
};

HomelabView.hide = function () {
    active = false;
    $id("homelab-screen").style.display = "none";
};

HomelabView.message = function () { dirty = true; };
HomelabView.seed = function () { dirty = true; };

HomelabView.animate = function () {
    if (!active || !feeds) {
        return;
    }
    var now = Date.now();
    renderClock(now);

    if (dirty && now - lastRender > REFRESH_MS) {
        lastRender = now;
        dirty = false;
        renderCards();
        renderGrid();
        renderCounts();
        renderPower();
        renderHa();
    }
};

HomelabView.resize = function () { dirty = true; };

HomelabView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        HomelabView.resize();
    }, 150);
};

/* ---- formatting ----------------------------------------------------------- */

function rate(bps) {
    if (bps === null || bps === undefined) { return "0 b/s"; }
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

function esc(s) {
    return String(s === null || s === undefined ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Every outbound link on this screen is built here, so they all carry the same
 * target and the same rel. */
function anchor(url, cls, title, inner) {
    return '<a class="' + cls + '" href="' + esc(url) + '" target="_blank"' +
        ' rel="noopener noreferrer" title="' + esc(title) + '">' + inner + '</a>';
}

/* A labelled bar. Only ever called with a real reading. */
function bar(label, pct, readout, warnAt) {
    var v = Math.max(0, Math.min(100, pct));
    var hot = warnAt !== undefined && pct >= warnAt;
    return '<div class="hl-bar' + (hot ? " hot" : "") + '">' +
        '<span class="hl-bar-label">' + esc(label) + '</span>' +
        '<span class="hl-bar-val">' + esc(readout) + '</span>' +
        '<span class="hl-bar-track"><i style="width:' + v.toFixed(1) + '%"></i></span>' +
        '</div>';
}

/* The icon for a tile or a chip. A service with no icon shows its initial
 * rather than a broken image, and a 404 from the icon CDN falls back to the
 * same thing. */
function icon(svc, cls) {
    var initial = esc((svc.name || "?").charAt(0).toUpperCase());
    var letter = '<span class="' + cls + ' hl-icon-letter">' + initial + '</span>';
    if (!svc.iconUrl) {
        return letter;
    }
    return '<img class="' + cls + '" src="' + esc(svc.iconUrl) + '" alt=""' +
        ' loading="lazy" data-letter="' + initial + '">';
}

/* ---- server cards ---------------------------------------------------------- */

function renderCards() {
    var box = $id("hl-cards");
    if (!box || !feeds) { return; }

    var servers = feeds.servers();
    if (!servers.length) { return; }

    box.innerHTML = servers.map(function (sv) {
        var st = sv.stats;

        var header = anchor(sv.url || "#", "hl-card-head",
            sv.name + "  " + (sv.url || ""),
            '<span class="hl-card-name">' + esc(sv.name) + '</span>' +
            '<span class="hl-card-ip">' + esc(sv.ip) + '</span>' +
            '<span class="hl-card-go">↗</span>');

        var meta = '<div class="hl-card-meta">' +
            '<span class="hl-pill ' + (sv.seen ? "up" : "down") + '">' +
                (sv.seen ? "UP" : "NOT SEEN") + '</span>' +
            '<span class="hl-card-uptime">' + esc(duration(sv.uptime)) + '</span>' +
            '</div>';

        /* The one thing the map carried that a card could not. */
        var path = '<div class="hl-card-path' + (sv.via ? "" : " dim") + '">' +
            (sv.via ? esc(sv.via) + (sv.port ? " port " + esc(sv.port) : "")
                    : "no link reported") + '</div>';

        var net = '<div class="hl-card-net">' +
            '<span><i>DOWN</i>' + rate(sv.rx) + '</span>' +
            '<span><i>UP</i>' + rate(sv.tx) + '</span></div>';

        /* Bars only exist once something is reporting them. No credentials,
           no bars, and nothing said about it. */
        var bars = "";
        if (st) {
            var parts = [];
            if (st.cpu !== null && st.cpu !== undefined) {
                parts.push(bar("CPU", st.cpu, Math.round(st.cpu) + "%", 85));
            }
            if (st.memPct !== null && st.memPct !== undefined) {
                parts.push(bar("RAM", st.memPct, Math.round(st.memPct) + "%", 90));
            }
            if (st.diskPct !== null && st.diskPct !== undefined) {
                parts.push(bar("DISK", st.diskPct, Math.round(st.diskPct) + "%", 90));
            }
            if (st.temp !== null && st.temp !== undefined) {
                /* Temperature is not a percentage, so the bar is scaled
                   against 90 C and the readout stays in degrees. */
                parts.push(bar("TEMP", (st.temp / 90) * 100,
                               Math.round(st.temp) + " C", 83));
            }
            if (parts.length) {
                bars = '<div class="hl-bars">' + parts.join("") + '</div>';
            }
        }

        var chips = sv.services.length
            ? '<div class="hl-chips">' + sv.services.map(function (s) {
                  var tip = s.name + "  " + s.url;
                  if (st && st.containers) {
                      tip += "\n" + sv.name + " reports " + st.containers +
                          " containers";
                  }
                  return anchor(s.url, "hl-chip", tip,
                      icon(s, "hl-chip-icon") +
                      '<span class="hl-chip-name">' + esc(s.name) + '</span>');
              }).join("") + '</div>'
            : "";

        return '<div class="hl-card' + (sv.seen ? "" : " down") + '">' +
            header + meta + path + net + bars + chips + '</div>';
    }).join("");

    swapBrokenIcons(box);
}

/* ---- services grid ---------------------------------------------------------- */

function renderGrid() {
    var box = $id("hl-grid");
    if (!box || !feeds) { return; }

    var groups = feeds.services();
    box.innerHTML = groups.map(function (g) {
        /* Anything down sorts to the front of its group. */
        var items = g.items.slice().sort(function (a, b) {
            var ad = a.hostSeen ? 1 : 0, bd = b.hostSeen ? 1 : 0;
            return ad - bd || a.name.localeCompare(b.name);
        });
        return '<div class="hl-gsection">' +
            '<div class="hl-gtitle">' + esc(g.group) + '</div>' +
            '<div class="hl-gtiles">' + items.map(function (s) {
                var down = s.status === 0 || (s.status === null && !s.hostSeen);
                var state = s.status === 1 ? "UP"
                    : s.status === 0 ? "DOWN"
                    : s.external ? "EXTERNAL"
                    : s.hostSeen ? "UP" : "NOT SEEN";
                return anchor(s.url, "hl-tile" + (down ? " down" : ""),
                    s.name + "  " + s.url,
                    icon(s, "hl-tile-icon") +
                    '<span class="hl-tile-text">' +
                        '<b>' + esc(s.name) + '</b>' +
                        '<i>' + esc(s.host) + '</i></span>' +
                    '<span class="hl-tile-state">' + state + '</span>');
            }).join("") + '</div></div>';
    }).join("");

    swapBrokenIcons(box);
}

/* An icon the CDN does not have would otherwise leave a broken image frame.
 * Swapping on the error event rather than an inline onerror attribute keeps
 * the markup free of script. */
function swapBrokenIcons(root) {
    root.querySelectorAll("img[data-letter]").forEach(function (img) {
        img.addEventListener("error", function () {
            var span = document.createElement("span");
            span.className = img.className + " hl-icon-letter";
            span.textContent = img.getAttribute("data-letter");
            if (img.parentNode) {
                img.parentNode.replaceChild(span, img);
            }
        }, { once: true });
    });
}

/* ---- side column ------------------------------------------------------------- */

function renderCounts() {
    var box = $id("hl-counts");
    if (!box || !feeds) { return; }
    var st = feeds.status();
    var servers = feeds.servers();
    var up = servers.filter(function (s) { return s.seen; }).length;

    var cell = function (value, label, bad) {
        return '<div class="hl-count' + (bad ? " bad" : "") + '">' +
            '<b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
    };

    var html = cell(up + " / " + servers.length, "Servers up", up < servers.length);
    html += cell(st.servicesReachable + " / " + st.servicesTotal, "Services",
                 st.servicesReachable < st.servicesTotal);
    if (st.guestsKnown) {
        html += cell(st.guestsRunning + " / " + st.guestsTotal, "Guests", false);
    }
    html += cell(String(st.alerts.length), "Alerts", st.alerts.length > 0);

    if (st.alerts.length) {
        html += '<div class="hl-alerts">' + st.alerts.slice(0, 3).map(function (a) {
            return '<div class="hl-alert">' + esc(a.text) + '</div>';
        }).join("") + '</div>';
    }
    box.innerHTML = html;
}

function renderPower() {
    var box = $id("hl-power-body");
    var panel = $id("hl-power");
    if (!box || !feeds) { return; }

    var p = feeds.power();
    var u = feeds.ups();
    if (panel) { panel.style.display = (p.live || u.live) ? "" : "none"; }
    if (!p.live && !u.live) { return; }

    var html = "";
    if (p.live) {
        html += '<div class="hl-ptotal">' + Math.round(p.total) +
            '<small>W</small></div>';
        var max = p.items.reduce(function (a, x) { return Math.max(a, x.watts); }, 1);
        html += p.items.map(function (x) {
            return '<div class="hl-prow"><span>' + esc(x.label) + '</span>' +
                '<b>' + x.watts.toFixed(0) + ' W</b>' +
                '<i style="width:' + Math.max(2, (x.watts / max) * 100).toFixed(1) +
                '%"></i></div>';
        }).join("");
    }
    if (u.live) {
        html += u.units.map(function (x) {
            var low = x.charge !== null && x.charge < 95;
            return '<div class="hl-ups' + (low ? " bad" : "") + '">' +
                '<div class="hl-ups-head"><b>' + esc(x.label) + '</b>' +
                '<span>' + (x.charge !== null ? Math.round(x.charge) + "%" : "n/a") +
                '</span></div>' +
                '<div class="hl-ups-bar"><i style="width:' +
                    (x.charge !== null ? Math.max(2, x.charge) : 0) + '%"></i></div>' +
                '<div class="hl-ups-sub">load ' +
                    (x.load !== null ? Math.round(x.load) + "%" : "n/a") +
                    ', in ' + (x.volts !== null ? Math.round(x.volts) + " V" : "n/a") +
                    '</div></div>';
        }).join("");
    }
    box.innerHTML = html;
}

function renderHa() {
    var box = $id("hl-ha-body");
    var panel = $id("hl-ha");
    if (!box || !feeds) { return; }

    var ha = feeds.homeAssistant();
    if (panel) { panel.style.display = ha.live ? "" : "none"; }
    if (!ha.live) { return; }

    var row = function (label, value, bad) {
        return '<div class="hl-harow' + (bad ? " bad" : "") + '">' +
            '<span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
    };

    var html = "";
    html += row("Core", ha.version || "n/a", ha.coreUpdate);
    html += row("Updates", String(ha.updates.length), ha.updates.length > 0);
    if (ha.cpu !== null) { html += row("CPU", Math.round(ha.cpu) + "%", ha.cpu > 85); }
    if (ha.memory !== null) { html += row("RAM", Math.round(ha.memory) + "%", ha.memory > 90); }
    if (ha.dbSize !== null) { html += row("Database", ha.dbSize.toFixed(1) + " MB", false); }
    html += row("Zigbee", ha.zigbee.eth && ha.zigbee.net ? "ONLINE" : "DOWN",
                !(ha.zigbee.eth && ha.zigbee.net));
    html += row("Z-Wave dead", String(ha.zwave.dead.length), ha.zwave.dead.length > 0);
    html += row("Z-Wave faults", String(ha.zwave.failing.length),
                ha.zwave.failing.length > 0);
    var age = ha.backups.ageHours;
    html += row("Backups", ha.backups.stale ? "STALE"
                    : (age !== null ? Math.round(age) + " h"
                                    : (ha.backups.state || "n/a")),
                ha.backups.stale || (age !== null && age > BACKUP_STALE_HOURS));

    box.innerHTML = html;
}

/* ---- clock ------------------------------------------------------------------- */

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

/* ---- controls ------------------------------------------------------------------ */

/* Navigation is the anchors' own job. This exists only so Escape behaves the
 * way it does on every other screen. */
function bindControls() {
    window.addEventListener("keydown", function (e) {
        if (!active || e.key !== "Escape") { return; }
        ["hl-grid", "hl-cards"].forEach(function (id) {
            var el = $id(id);
            if (el) { el.scrollTop = 0; }
        });
    });
}

export { HomelabView };
