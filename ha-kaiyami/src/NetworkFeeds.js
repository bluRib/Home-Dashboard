/* Data for the Network screen.
 *
 * Source is Prometheus on 10.69.2.134, scraping unpoller, which polls the UDM
 * Pro. Every metric and every label used here was read off the live instance,
 * not guessed.
 *
 * The browser talks to Prometheus directly. Its container already runs with
 * --web.cors.origin='.*', which was confirmed by asking for the runtime flags
 * and by watching it reflect Access-Control-Allow-Origin back for an Origin of
 * http://localhost:8000. No proxy is needed and nothing had to be changed.
 *
 * Shape of the UniFi estate, as it actually is:
 *   1 gateway    Titan, UDM Pro
 *   3 switches   Phobos - D24, Io - U8, USW Ultra
 *   3 APs        Rhea - UAP, Triton - OAP, Garage IOT AP
 *   56 clients   28 wired, 28 wireless, across four subnets
 *   2 WAN lines  Primary (WAN1) AT&T Fiber, Secondary (WAN2) T-Mobile 5G
 */

var PROM = "http://10.69.2.134:9090";

/* Every poll is one HTTP round trip, so related metrics are fetched together
 * by matching on __name__ rather than one request per metric. Five requests
 * per tick instead of thirty. */
var GROUPS = {
    devices: 'unpoller_device_(info|uptime_seconds|temperature_celsius|' +
             'cpu_utilization_ratio|memory_utilization_ratio|upgradable|' +
             'max_power_total|rate_bytes|stations)',
    ports:   'unpoller_device_port_(port_speed_bps|poe_watts|receive_rate_bytes|' +
             'transmit_rate_bytes|receive_errors_total|transmit_errors_total)',
    /* radio_signal_db is the real signal in dBm, from -78 to -33 on this
       network. rssi_db is UniFi's own 18 to 63 quality scale, which is not
       dBm and must not be labelled as such. Both are read so the panel can
       show the measurement and the quality separately. */
    clients: 'unpoller_client_(receive_rate_bytes|transmit_rate_bytes|rssi_db|' +
             'radio_signal_db|uptime_seconds|satisfaction_ratio|noise_db)',
    radios:  'unpoller_device_radio_(stations|channel|channel_utilization_total_ratio|' +
             'transmit_power)',
    wan:     'unpoller_(wan_[a-z_]+|site_[a-z_]+|speedtest_[a-z_]+|' +
             'device_wan_[a-z_]+|topology_[a-z_]+)'
};

var POLL_MS = 5000;
var RANGE_MS = 5 * 60 * 1000;
var DAY_MS = 24 * 3600 * 1000;

/* A client that has been connected for less than this is treated as newly
 * arrived. unpoller carries no "first seen" timestamp, so association uptime
 * is the honest signal available: it means newly connected, which is not
 * quite the same as never seen before. */
var NEW_CLIENT_MS = DAY_MS;

/* Latency above this is a problem worth going orange for. */
var LATENCY_WARN_MS = 60;

/* Canonical names for the hosts Jovan has told us about, by IP. UniFi's own
 * client name is used when an IP is not listed, and several of UniFi's are
 * poor ("docker", "bc:24:11:a7:ee:40", "Red  Node"), which is why this exists.
 * Falls through to the UniFi name, then the hostname, then the IP. */
var HOST_NAMES = {
    "10.69.1.1":   "UDM Pro",
    /* The cameras, spelled the way Homepage spells them. UniFi has
       "Front Yard Carmera" with the typo still in it. */
    "10.69.1.16":  "Back Yard Camera",
    "10.69.1.19":  "Garage Camera",
    "10.69.1.27":  "Front Yard Camera",
    "10.69.4.160": "Reolink Doorbell",
    "10.69.2.3":   "Pi-hole",
    "10.69.2.5":   "Trusted",
    "10.69.2.10":  "Zigbee2MQTT",
    "10.69.2.18":  "Newt",
    "10.69.2.29":  "Z-Wave JS",
    "10.69.2.40":  "Proxmox red",
    "10.69.2.41":  "PBS",
    "10.69.2.50":  "Proxmox blu",
    "10.69.2.60":  "Proxmox grey",
    "10.69.2.70":  "Immich",
    "10.69.2.77":  "PeaNut",
    "10.69.2.112": "PostgreSQL",
    "10.69.2.133": "Node-RED",
    "10.69.2.134": "Frigate",
    "10.69.2.140": "SLZB-06",
    "10.69.2.151": "Home Assistant",
    "10.69.2.163": "LoRa",
    "10.69.2.167": "Semaphore",
    "10.69.2.180": "TrueNAS",
    "10.69.2.184": "Paperless",
    "10.69.2.222": "Media"
};

/* The four subnets on this network, by third octet. UniFi's own network label
 * is carried alongside, because it is the name Jovan sees in the controller. */
var SUBNETS = {
    "10.69.1": { key: "net1", label: "Network and Cameras", unifi: "Default" },
    "10.69.2": { key: "net2", label: "Servers and Homelab", unifi: "Server" },
    "10.69.3": { key: "net3", label: "Home", unifi: "Home" },
    "10.69.4": { key: "net4", label: "IoT and Doorbell", unifi: "IOT" }
};

/* Total physical ports per model, so "9 of 24 up" can be said at all. unpoller
 * publishes a series only for a port that has a link, so the count of series is
 * the number up and the total has to come from knowing the hardware. */
var MODEL_PORTS = {
    US24PRO2: 24,
    US8P60: 8,
    USM8P: 8,
    UDMPRO: 9
};

function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
}

/* ---- the Prometheus client ------------------------------------------------- */

function base() {
    var config = window.HA_CONFIG || {};
    return (config.prometheusUrl || PROM).replace(/\/+$/, "");
}

function instant(expr) {
    var url = base() + "/api/v1/query?query=" + encodeURIComponent(expr);
    return fetch(url, { mode: "cors" }).then(function (r) {
        if (!r.ok) {
            throw new Error("prometheus " + r.status);
        }
        return r.json();
    }).then(function (j) {
        if (j.status !== "success") {
            throw new Error(j.error || "query failed");
        }
        return j.data.result || [];
    });
}

function range(expr, startMs, endMs, stepSec) {
    var url = base() + "/api/v1/query_range" +
        "?query=" + encodeURIComponent(expr) +
        "&start=" + Math.floor(startMs / 1000) +
        "&end=" + Math.floor(endMs / 1000) +
        "&step=" + stepSec;
    return fetch(url, { mode: "cors" }).then(function (r) {
        if (!r.ok) {
            throw new Error("prometheus " + r.status);
        }
        return r.json();
    }).then(function (j) {
        if (j.status !== "success") {
            throw new Error(j.error || "range query failed");
        }
        return j.data.result || [];
    });
}

/* ---- helpers --------------------------------------------------------------- */

/* Prometheus hands back a flat list of series. Everything downstream wants
 * them keyed by metric name, so this does that once per poll. */
function byName(result) {
    var out = {};
    result.forEach(function (s) {
        var n = s.metric.__name__;
        if (!out[n]) {
            out[n] = [];
        }
        out[n].push({ m: s.metric, v: num(s.value[1]) });
    });
    return out;
}

function pick(groupData, metric) {
    return (groupData && groupData[metric]) || [];
}

function first(groupData, metric, test) {
    var list = pick(groupData, metric);
    for (var i = 0; i < list.length; i++) {
        if (!test || test(list[i].m)) {
            return list[i];
        }
    }
    return null;
}

function subnetOf(ip) {
    if (!ip) {
        return null;
    }
    var parts = String(ip).split(".");
    if (parts.length !== 4) {
        return null;
    }
    var three = parts.slice(0, 3).join(".");
    if (SUBNETS[three]) {
        return SUBNETS[three];
    }
    /* Any subnet not listed still gets a cluster rather than being dropped. */
    return { key: "net_" + three.replace(/\./g, "_"), label: three + ".x", unifi: "" };
}

/* UniFi falls back to the MAC when it has no name for a client, which is not a
 * name. The host table wins, then a real UniFi name, then the IP. */
function nameFor(m) {
    var ip = m.ip || "";
    if (HOST_NAMES[ip]) {
        return HOST_NAMES[ip];
    }
    var n = (m.name || "").trim();
    var mac = (m.mac || "").toLowerCase();
    if (n && n.toLowerCase() !== mac && !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(n)) {
        return n.replace(/\s+/g, " ");
    }
    if (m.hostname) {
        return m.hostname;
    }
    return ip || mac || "unknown";
}

function NetworkFeeds(onUpdate) {
    this.onUpdate = onUpdate || function () {};
    this.data = {};           // group key -> metric name -> series
    this.wanHistory = null;   // { t: [], rx: [], tx: [] }
    this.ready = false;
    this.error = null;
    this.lastPoll = 0;
    this._timers = [];
    this._deviceHistory = {}; // mac -> { at, points }
}

NetworkFeeds.prototype.start = function () {
    var self = this;
    this.poll();
    this.refreshRange();
    this._timers.push(setInterval(function () { self.poll(); }, POLL_MS));
    this._timers.push(setInterval(function () { self.refreshRange(); }, RANGE_MS));
};

NetworkFeeds.prototype.stop = function () {
    this._timers.forEach(clearInterval);
    this._timers = [];
};

NetworkFeeds.prototype.poll = function () {
    var self = this;
    var keys = Object.keys(GROUPS);

    Promise.all(keys.map(function (k) {
        return instant('{__name__=~"' + GROUPS[k] + '"}').catch(function (e) {
            self.error = e.message;
            return null;
        });
    })).then(function (results) {
        var any = false;
        results.forEach(function (r, i) {
            if (r) {
                self.data[keys[i]] = byName(r);
                any = true;
            }
        });
        if (any) {
            self.ready = true;
            self.error = null;
            self.lastPoll = Date.now();
        }
        self.onUpdate();
    });
};

/* 24 hours of WAN throughput for the bandwidth chart. */
NetworkFeeds.prototype.refreshRange = function () {
    var self = this;
    var end = Date.now();
    var start = end - DAY_MS;

    Promise.all([
        range("unpoller_device_wan_receive_rate_bytes", start, end, 300),
        range("unpoller_device_wan_transmit_rate_bytes", start, end, 300)
    ]).then(function (res) {
        var rx = res[0][0], tx = res[1][0];
        if (!rx) {
            return;
        }
        var points = rx.values.map(function (p, i) {
            return {
                t: p[0] * 1000,
                rx: num(p[1]) || 0,
                tx: tx && tx.values[i] ? (num(tx.values[i][1]) || 0) : 0
            };
        });
        self.wanHistory = points;
        self.onUpdate();
    }).catch(function () {});
};

/* 24 hours for one client, fetched when its panel is opened. */
NetworkFeeds.prototype.clientHistory = function (mac) {
    var self = this;
    var cached = this._deviceHistory[mac];
    if (cached && Date.now() - cached.at < RANGE_MS) {
        return Promise.resolve(cached.points);
    }
    var end = Date.now();
    var start = end - DAY_MS;
    var sel = '{mac="' + mac + '"}';

    return Promise.all([
        range("unpoller_client_receive_rate_bytes" + sel, start, end, 300),
        range("unpoller_client_transmit_rate_bytes" + sel, start, end, 300)
    ]).then(function (res) {
        var rx = res[0][0], tx = res[1][0];
        var points = rx ? rx.values.map(function (p, i) {
            return {
                t: p[0] * 1000,
                rx: num(p[1]) || 0,
                tx: tx && tx.values[i] ? (num(tx.values[i][1]) || 0) : 0
            };
        }) : [];
        self._deviceHistory[mac] = { at: Date.now(), points: points };
        return points;
    }).catch(function () { return []; });
};

/* ---- the UniFi estate ------------------------------------------------------- */

NetworkFeeds.prototype.devices = function () {
    var d = this.data.devices;
    if (!d) {
        return [];
    }
    var self = this;

    /* How many clients each piece of infrastructure is actually carrying.
       unpoller_device_stations reports 0 for the APs on this controller, so
       counting the clients that name the device is both more reliable and
       more accurate. */
    var attached = {};
    this.clients().forEach(function (c) {
        if (c.via) {
            attached[c.via] = (attached[c.via] || 0) + 1;
        }
    });

    return pick(d, "unpoller_device_info").map(function (s) {
        var m = s.m;
        var at = function (metric) {
            var hit = first(d, metric, function (x) { return x.name === m.name; });
            return hit ? hit.v : null;
        };
        var ports = self.ports(m.name);
        var radios = self.radios(m.name);

        return {
            key: m.name,
            name: m.name,
            type: m.type,                 // udm, usw, uap
            model: m.model,
            version: m.version,
            ip: m.ip,
            mac: m.mac,
            serial: m.serial,
            uptime: at("unpoller_device_uptime_seconds"),
            temperature: at("unpoller_device_temperature_celsius"),
            cpu: at("unpoller_device_cpu_utilization_ratio"),
            memory: at("unpoller_device_memory_utilization_ratio"),
            upgradable: at("unpoller_device_upgradable") === 1,
            stations: attached[m.name] || 0,
            poeBudget: at("unpoller_device_max_power_total"),
            poeUsed: ports.reduce(function (a, p) { return a + (p.poe || 0); }, 0),
            portsUp: ports.length,
            portsTotal: MODEL_PORTS[m.model] || null,
            ports: ports,
            radios: radios
        };
    }).sort(function (a, b) {
        var order = { udm: 0, usw: 1, uap: 2 };
        return (order[a.type] - order[b.type]) || a.name.localeCompare(b.name);
    });
};

/* unpoller publishes a port series only when the port has a link, so what is
 * here is what is up. Ports that are down are absent, not zero, which is why
 * the total has to come from the model. */
NetworkFeeds.prototype.ports = function (deviceName) {
    var p = this.data.ports;
    if (!p) {
        return [];
    }
    var out = {};
    var take = function (metric, field) {
        pick(p, metric).forEach(function (s) {
            if (s.m.name !== deviceName) {
                return;
            }
            var n = s.m.port_num;
            if (!out[n]) {
                out[n] = { num: Number(n), name: s.m.port_name };
            }
            out[n][field] = s.v;
        });
    };
    take("unpoller_device_port_port_speed_bps", "speed");
    take("unpoller_device_port_poe_watts", "poe");
    take("unpoller_device_port_receive_rate_bytes", "rx");
    take("unpoller_device_port_transmit_rate_bytes", "tx");
    take("unpoller_device_port_receive_errors_total", "rxErrors");

    return Object.keys(out).map(function (k) {
        var port = out[k];
        port.up = (port.speed || 0) > 0;
        return port;
    }).sort(function (a, b) { return a.num - b.num; });
};

NetworkFeeds.prototype.radios = function (deviceName) {
    var r = this.data.radios;
    if (!r) {
        return [];
    }
    var out = {};
    var take = function (metric, field) {
        pick(r, metric).forEach(function (s) {
            if (s.m.name !== deviceName) {
                return;
            }
            var id = s.m.radio_name || s.m.radio || "r";
            if (!out[id]) {
                /* ng is 2.4GHz, na is 5GHz, 6e is 6GHz. */
                var band = s.m.radio === "ng" ? "2.4 GHz"
                    : s.m.radio === "na" ? "5 GHz"
                    : s.m.radio === "6e" ? "6 GHz" : (s.m.radio || "");
                out[id] = { id: id, band: band, radio: s.m.radio };
            }
            /* The same radio appears more than once with different sub ids, so
               stations are summed and the rest take the largest reading. */
            if (field === "stations") {
                out[id].stations = (out[id].stations || 0) + (s.v || 0);
            } else if (out[id][field] === undefined || s.v > out[id][field]) {
                out[id][field] = s.v;
            }
        });
    };
    take("unpoller_device_radio_stations", "stations");
    take("unpoller_device_radio_channel", "channel");
    take("unpoller_device_radio_channel_utilization_total_ratio", "utilization");
    take("unpoller_device_radio_transmit_power", "power");

    return Object.keys(out).map(function (k) { return out[k]; })
        .filter(function (x) { return x.band; })
        .sort(function (a, b) { return (a.band || "").localeCompare(b.band || ""); });
};

/* ---- clients ----------------------------------------------------------------- */

NetworkFeeds.prototype.clients = function () {
    var c = this.data.clients;
    if (!c) {
        return [];
    }
    var by = {};
    var take = function (metric, field) {
        pick(c, metric).forEach(function (s) {
            var mac = s.m.mac;
            if (!mac) {
                return;
            }
            if (!by[mac]) {
                by[mac] = { m: s.m };
            }
            by[mac][field] = s.v;
        });
    };
    take("unpoller_client_receive_rate_bytes", "rx");
    take("unpoller_client_transmit_rate_bytes", "tx");
    take("unpoller_client_rssi_db", "rssi");
    take("unpoller_client_radio_signal_db", "signal");
    take("unpoller_client_uptime_seconds", "uptime");
    take("unpoller_client_satisfaction_ratio", "satisfaction");
    take("unpoller_client_noise_db", "noise");

    return Object.keys(by).map(function (mac) {
        var x = by[mac];
        var m = x.m;
        var wired = m.wired === "true";
        var sub = subnetOf(m.ip);
        var uptime = x.uptime || 0;

        return {
            mac: mac,
            name: nameFor(m),
            unifiName: (m.name || "").trim(),
            ip: m.ip || "",
            oui: m.oui || "",
            network: m.network || "",
            vlan: m.vlan || "",
            wired: wired,
            subnet: sub ? sub.key : "other",
            subnetLabel: sub ? sub.label : "Other",
            via: wired ? (m.sw_name || "") : (m.ap_name || ""),
            port: wired ? (m.sw_port || "") : "",
            essid: m.essid || "",
            channel: m.channel || "",
            band: m.radio_proto === "ng" ? "2.4 GHz"
                : m.radio_proto === "na" ? "5 GHz"
                : m.radio_proto === "ac" ? "5 GHz"
                : m.radio_proto === "ax" ? "5 GHz" : (m.radio_proto || ""),
            rssi: x.rssi,
            signal: x.signal,
            noise: x.noise,
            snr: (x.signal !== undefined && x.noise !== undefined &&
                  x.signal !== null && x.noise !== null)
                ? x.signal - x.noise : null,
            satisfaction: x.satisfaction,
            rx: x.rx || 0,
            tx: x.tx || 0,
            total: (x.rx || 0) + (x.tx || 0),
            uptime: uptime,
            isNew: uptime > 0 && uptime * 1000 < NEW_CLIENT_MS
        };
    }).sort(function (a, b) { return b.total - a.total; });
};

NetworkFeeds.prototype.subnets = function () {
    var groups = {};
    this.clients().forEach(function (c) {
        if (!groups[c.subnet]) {
            groups[c.subnet] = { key: c.subnet, label: c.subnetLabel,
                                 clients: [], rx: 0, tx: 0, isNew: 0 };
        }
        var g = groups[c.subnet];
        g.clients.push(c);
        g.rx += c.rx;
        g.tx += c.tx;
        if (c.isNew) {
            g.isNew += 1;
        }
    });
    return Object.keys(groups).map(function (k) { return groups[k]; })
        .sort(function (a, b) { return b.clients.length - a.clients.length; });
};

/* ---- WAN --------------------------------------------------------------------- */

NetworkFeeds.prototype.wans = function () {
    var w = this.data.wan;
    if (!w) {
        return [];
    }

    /* interface_state is the only metric carrying wan_interface and state;
       the rest carry wan_name. They are joined on the human readable name. */
    var states = {};
    pick(w, "unpoller_wan_interface_state").forEach(function (s) {
        states[s.m.wan_interface] = { state: s.m.state, up: s.v === 1,
                                      group: s.m.wan_networkgroup };
    });

    var byName = {};
    var take = function (metric, field) {
        pick(w, metric).forEach(function (s) {
            var n = s.m.wan_name;
            if (!n) {
                return;
            }
            if (!byName[n]) {
                byName[n] = { name: n, group: s.m.wan_networkgroup,
                              type: s.m.wan_type, balance: s.m.wan_load_balance_type };
            }
            byName[n][field] = s.v;
        });
    };
    take("unpoller_wan_failover_priority", "priority");
    take("unpoller_wan_uptime_percentage", "uptimePercent");
    take("unpoller_wan_provider_download_kbps", "providerDown");
    take("unpoller_wan_provider_upload_kbps", "providerUp");

    /* Live throughput exists for the active WAN only: unpoller publishes
       device_wan_* for the interface actually carrying traffic. */
    var liveRx = first(w, "unpoller_device_wan_receive_rate_bytes");
    var liveTx = first(w, "unpoller_device_wan_transmit_rate_bytes");
    var activePort = liveRx ? liveRx.m.port : null;

    var latency = {};
    pick(w, "unpoller_speedtest_latency_ms").forEach(function (s) {
        latency[s.m.wan_group] = { ms: s.v, iface: s.m.wan_interface };
    });

    return Object.keys(byName).map(function (n) {
        var x = byName[n];
        var st = states[n] || {};
        var lat = latency[x.group] || {};
        var isActive = st.state === "ACTIVE";
        return {
            name: n,
            short: x.group === "WAN" ? "WAN 1" : "WAN 2",
            group: x.group,
            iface: lat.iface || "",
            state: st.state || "UNKNOWN",
            active: isActive,
            priority: x.priority,
            uptimePercent: x.uptimePercent,
            providerDown: x.providerDown,
            providerUp: x.providerUp,
            latency: lat.ms,
            rx: isActive && liveRx ? liveRx.v : 0,
            tx: isActive && liveTx ? liveTx.v : 0,
            activePort: isActive ? activePort : null
        };
    }).sort(function (a, b) { return (a.priority || 9) - (b.priority || 9); });
};

/* Failover is active when the line with the best priority is not the one
 * carrying traffic. */
NetworkFeeds.prototype.failover = function () {
    var wans = this.wans();
    if (wans.length < 2) {
        return { active: false };
    }
    var primary = wans[0];
    var activeOne = wans.filter(function (x) { return x.active; })[0];
    return {
        active: !!activeOne && activeOne.group !== primary.group,
        on: activeOne || null,
        primary: primary
    };
};

NetworkFeeds.prototype.site = function () {
    var w = this.data.wan;
    if (!w) {
        return {};
    }
    var g = function (metric) {
        var hit = first(w, metric);
        return hit ? hit.v : null;
    };
    var latencyS = g("unpoller_site_latency_seconds");
    var latencyMs = latencyS === null ? null : latencyS * 1000;

    /* Packet loss is not published as a rate. unpoller gives cumulative
       dropped and error counters on the WAN interface, so what can honestly be
       shown is the share of received packets that were dropped. */
    var rxPackets = g("unpoller_device_wan_receive_packets_total");
    var rxDropped = g("unpoller_device_wan_receive_dropped_total");
    var rxErrors = g("unpoller_device_wan_receive_errors_total");
    var loss = (rxPackets && rxPackets > 0 && rxDropped !== null)
        ? (rxDropped / rxPackets) * 100 : null;

    return {
        stations: g("unpoller_site_stations"),
        users: g("unpoller_site_users"),
        guests: g("unpoller_site_guests"),
        iots: g("unpoller_site_iots"),
        latencyMs: latencyMs,
        latencyHigh: latencyMs !== null && latencyMs > LATENCY_WARN_MS,
        drops: g("unpoller_site_intenet_drops_total"),
        loss: loss,
        rxDropped: rxDropped,
        rxErrors: rxErrors,
        uptime: g("unpoller_site_uptime_seconds"),
        devicesTotal: g("unpoller_topology_devices_total"),
        clientsTotal: g("unpoller_topology_clients_total"),
        wired: g("unpoller_topology_connections_wired"),
        wireless: g("unpoller_topology_connections_wireless")
    };
};

/* ---- the topology ------------------------------------------------------------ */

/* Nodes and links for the hero, laid out in columns from the internet on the
 * left to the clients on the right. Built from the live label graph: a client
 * knows its switch and port or its AP, and an AP knows the switch it uplinks
 * through, so the tree is real rather than drawn from a diagram. */
NetworkFeeds.prototype.topology = function (expanded) {
    var devices = this.devices();
    var clients = this.clients();
    var wans = this.wans();
    var nodes = [];
    var links = [];
    var index = {};
    expanded = expanded || {};

    function node(id, label, kind, col, extra) {
        if (index[id] === undefined) {
            index[id] = nodes.length;
            nodes.push(Object.assign({ id: id, label: label, kind: kind, col: col },
                                     extra || {}));
        }
        return index[id];
    }
    function link(a, b, extra) {
        if (a === undefined || b === undefined) {
            return;
        }
        links.push(Object.assign({ source: a, target: b }, extra || {}));
    }

    var net = node("internet", "INTERNET", "internet", 0, {});

    var gateway = devices.filter(function (d) { return d.type === "udm"; })[0];
    var gw = gateway
        ? node("dev:" + gateway.name, gateway.name, "gateway", 2, { device: gateway })
        : node("gw", "GATEWAY", "gateway", 2, {});

    wans.forEach(function (w) {
        var wi = node("wan:" + w.group, w.short, "wan", 1, { wan: w });
        link(net, wi, { kind: "wan", wan: w, rate: w.rx + w.tx, active: w.active });
        link(wi, gw, { kind: "wan", wan: w, rate: w.rx + w.tx, active: w.active });
    });

    var switches = devices.filter(function (d) { return d.type === "usw"; });
    switches.forEach(function (sw) {
        var si = node("dev:" + sw.name, sw.name, "switch", 3, { device: sw });
        var rate = sw.ports.reduce(function (a, p) {
            return a + (p.rx || 0) + (p.tx || 0);
        }, 0);
        link(gw, si, { kind: "infra", rate: rate });
    });

    var aps = devices.filter(function (d) { return d.type === "uap"; });
    aps.forEach(function (ap) {
        var ai = node("dev:" + ap.name, ap.name, "ap", 4, { device: ap });
        /* An AP hangs off whichever switch port it draws PoE from. The client
           label graph names the AP's own uplink switch only indirectly, so the
           gateway is used when no switch claims it. */
        var host = null;
        switches.forEach(function (sw) {
            clients.forEach(function (c) {
                if (!host && c.wired && c.name === ap.name && c.via === sw.name) {
                    host = sw.name;
                }
            });
        });
        var from = host ? index["dev:" + host] : gw;
        link(from === undefined ? gw : from, ai, { kind: "infra", rate: 0 });
    });

    /* Clients, clustered by subnet unless the cluster has been opened. */
    this.subnets().forEach(function (g) {
        var open = !!expanded[g.key];
        if (!open) {
            var ci = node("sub:" + g.key, g.label, "cluster", 5,
                          { subnet: g, count: g.clients.length, isNew: g.isNew });
            /* The cluster hangs off whichever piece of infrastructure most of
               its members actually connect through. */
            var tally = {};
            g.clients.forEach(function (c) {
                if (c.via) {
                    tally[c.via] = (tally[c.via] || 0) + 1;
                }
            });
            var best = null, bestN = 0;
            Object.keys(tally).forEach(function (k) {
                if (tally[k] > bestN) { bestN = tally[k]; best = k; }
            });
            var from = best && index["dev:" + best] !== undefined
                ? index["dev:" + best] : gw;
            link(from, ci, { kind: "cluster", rate: g.rx + g.tx, isNew: g.isNew > 0 });
            return;
        }

        g.clients.forEach(function (c) {
            var ni = node("cli:" + c.mac, c.name, "client", 5, { client: c });
            var from = c.via && index["dev:" + c.via] !== undefined
                ? index["dev:" + c.via] : gw;
            link(from, ni, { kind: "client", rate: c.total, client: c,
                             isNew: c.isNew });
        });
    });

    return { nodes: nodes, links: links };
};

/* ---- panels ------------------------------------------------------------------- */

NetworkFeeds.prototype.topTalkers = function (n) {
    return this.clients().filter(function (c) { return c.total > 0; })
        .slice(0, n || 5);
};

NetworkFeeds.prototype.newClients = function () {
    return this.clients().filter(function (c) { return c.isNew; })
        .sort(function (a, b) { return a.uptime - b.uptime; });
};

NetworkFeeds.prototype.counts = function () {
    var clients = this.clients();
    return {
        total: clients.length,
        wired: clients.filter(function (c) { return c.wired; }).length,
        wireless: clients.filter(function (c) { return !c.wired; }).length,
        isNew: clients.filter(function (c) { return c.isNew; }).length
    };
};

export { NetworkFeeds, HOST_NAMES, SUBNETS, MODEL_PORTS, LATENCY_WARN_MS };
