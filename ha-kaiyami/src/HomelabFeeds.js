/* Data for the Homelab screen.
 *
 * Three sources, and a fourth and fifth that are not standing up yet. Every
 * one was probed before this file was written, so what is marked live here is
 * live, and what is marked awaiting is genuinely missing rather than assumed.
 *
 *   LIVE  Home Assistant, over the WebSocket the whole dashboard already uses.
 *         Gives the HA panel, both UPS units, the homelab power draw, the
 *         Zigbee coordinator, Z-Wave node health and the backup sensors.
 *   LIVE  Prometheus on 10.69.2.134, via unpoller. Every homelab host is a
 *         UniFi client, so its link state, the switch and port it hangs off,
 *         its association uptime and its live throughput are all real. Twenty
 *         of the twenty one hosts are visible; Paperless is not currently
 *         seen, which the map says rather than hides.
 *   WAIT  prometheus-pve-exporter. Nothing scrapes Proxmox, so node CPU, RAM,
 *         disk and temperature, and the VM and LXC inventory, are unavailable.
 *   WAIT  node_exporter, or Beszel with credentials. Beszel at 10.69.2.18:8090
 *         answers and sends Access-Control-Allow-Origin: *, so the browser can
 *         reach it, but its API returns an empty list without a login.
 *   WAIT  Uptime Kuma. Its /metrics endpoint exists and answers 401, so it
 *         needs an API key, and it sends no CORS header, so Prometheus has to
 *         scrape it rather than the browser calling it directly.
 *
 * TrueNAS, PBS and Proxmox all answer but send no CORS headers, so the browser
 * cannot read them directly whatever credentials it had. They need an exporter
 * in front of Prometheus, which is the same answer as the two above.
 */

var PROM = "http://10.69.2.134:9090";

/* Beszel needs a login before it returns anything. Put BESZEL_USER and
 * BESZEL_PASS in app/.env and re-run tools/gen_config.py; they arrive here on
 * window.HA_CONFIG and never touch the bundle. */
function beszelConfig() {
    var c = window.HA_CONFIG || {};
    return {
        url: c.beszelUrl || "http://10.69.2.18:8090",
        user: c.beszelUser || null,
        pass: c.beszelPass || null
    };
}

/* Which source feeds which panel, so a panel can name what it is waiting for
 * instead of showing a blank or a zero. */
var SOURCES = {
    ha: { label: "Home Assistant", live: false },
    unifi: { label: "Prometheus, unpoller", live: false },
    pve: { label: "prometheus-pve-exporter", live: false },
    host: { label: "node_exporter or Beszel", live: false },
    kuma: { label: "Uptime Kuma", live: false },
    storage: { label: "TrueNAS and PBS exporters", live: false }
};

/* The homelab, as it actually is. Roles come from Jovan's host table and the
 * Homepage directory; the Arcane container on port 3552 is what marks a Docker
 * host, and every one of them has it. */
var HOSTS = [
    { ip: "10.69.2.40",  name: "Proxmox red",   kind: "pve" },
    { ip: "10.69.2.50",  name: "Proxmox blu",   kind: "pve" },
    { ip: "10.69.2.60",  name: "Proxmox grey",  kind: "pve" },

    { ip: "10.69.2.134", name: "Frigate",       kind: "docker" },
    { ip: "10.69.2.222", name: "Media",         kind: "docker" },
    { ip: "10.69.2.5",   name: "Trusted",       kind: "docker" },
    { ip: "10.69.2.184", name: "Paperless",     kind: "docker" },
    { ip: "10.69.2.18",  name: "Newt",          kind: "docker" },

    { ip: "10.69.2.41",  name: "PBS",           kind: "single" },
    { ip: "10.69.2.180", name: "TrueNAS",       kind: "single" },
    { ip: "10.69.2.70",  name: "Immich",        kind: "single" },
    { ip: "10.69.2.3",   name: "Pi-hole",       kind: "single" },
    { ip: "10.69.2.10",  name: "Zigbee2MQTT",   kind: "single" },
    { ip: "10.69.2.29",  name: "Z-Wave JS",     kind: "single" },
    { ip: "10.69.2.140", name: "SLZB-06",       kind: "single" },
    { ip: "10.69.2.133", name: "Node-RED",      kind: "single" },
    { ip: "10.69.2.112", name: "PostgreSQL",    kind: "single" },
    { ip: "10.69.2.167", name: "Semaphore",     kind: "single" },
    { ip: "10.69.2.163", name: "LoRa",          kind: "single" },
    { ip: "10.69.2.77",  name: "PeaNut",        kind: "single" },
    { ip: "10.69.2.151", name: "Home Assistant", kind: "single" }
];

/* The Homepage service directory, by host. Names, groups and ports only, which
 * are not secrets: the real services.yaml lives in private/ and holds nothing
 * else anyway, since it turned out to carry no credentials at all.
 *
 * Refresh this by re-reading private/homepage/services.yaml. Homepage lists
 * PeaNut on port 3000, but only 8080 is open on that host, so the port here is
 * the one that answers.
 */
var SERVICES = [
    { host: "10.69.2.40",  name: "Proxmox Red",    group: "System",      port: 8006, https: true },
    { host: "10.69.2.50",  name: "Proxmox Blue",   group: "System",      port: 8006, https: true },
    { host: "10.69.2.60",  name: "Proxmox Grey",   group: "System",      port: 8006, https: true },
    { host: "10.69.2.41",  name: "Proxmox Backup Server", group: "System", port: 8007, https: true },
    { host: "10.69.2.167", name: "Semaphore",      group: "System",      port: 3000 },

    { host: "10.69.2.222", name: "Arcane Media",   group: "Docker",      port: 3552 },
    { host: "10.69.2.5",   name: "Arcane Trusted", group: "Docker",      port: 3552 },
    { host: "10.69.2.134", name: "Arcane Frigate", group: "Docker",      port: 3552 },
    { host: "10.69.2.184", name: "Arcane Paperless", group: "Docker",    port: 3552 },
    { host: "10.69.2.18",  name: "Arcane Newt",    group: "Docker",      port: 3552 },

    { host: "10.69.2.151", name: "Home Assistant", group: "Home Automation", port: 8123 },
    { host: "10.69.2.10",  name: "Zigbee2MQTT",    group: "Home Automation", port: 8080 },
    { host: "10.69.2.29",  name: "Z-Wave JS",      group: "Home Automation", port: 8091 },
    { host: "10.69.2.133", name: "Node-RED",       group: "Home Automation", port: 1880 },
    { host: "10.69.2.163", name: "LoRa-the-Explorer", group: "Home Automation", port: 80 },
    { host: "10.69.2.134", name: "n8n",            group: "Home Automation", port: 5678 },
    { host: "10.69.2.140", name: "SLZB-06",        group: "Home Automation", port: 80 },

    { host: "10.69.1.1",   name: "UniFi",          group: "Network Management", port: 443, https: true },
    { host: "10.69.2.3",   name: "Pi-hole",        group: "Network Management", port: 443, https: true, path: "/admin" },

    { host: "10.69.2.222", name: "Jellyfin",       group: "Media Processing", port: 8096 },
    { host: "10.69.2.222", name: "SABnzbd",        group: "Media Processing", port: 8080 },
    { host: "10.69.2.222", name: "Prowlarr",       group: "Media Processing", port: 9696 },
    { host: "10.69.2.222", name: "Sonarr",         group: "Media Processing", port: 8989 },
    { host: "10.69.2.222", name: "Radarr",         group: "Media Processing", port: 7878 },
    { host: "10.69.2.222", name: "Jellyseerr",     group: "Media Processing", port: 5055 },

    { host: "10.69.2.18",  name: "Beszel",         group: "System Monitoring", port: 8090 },
    { host: "10.69.2.77",  name: "PeaNut",         group: "System Monitoring", port: 8080 },
    { host: "10.69.2.5",   name: "Uptime Kuma",    group: "System Monitoring", port: 3001 },
    { host: "10.69.2.5",   name: "Gotify",         group: "System Monitoring", port: 8088 },

    { host: "10.69.2.134", name: "InfluxDB",       group: "Database",    port: 8086 },
    { host: "10.69.2.112", name: "PostgreSQL",     group: "Database",    port: 80, path: "/adminer/" },
    { host: "10.69.2.134", name: "Prometheus",     group: "Database",    port: 9090 },

    { host: "10.69.2.134", name: "Frigate",        group: "Security",    port: 5000 },
    { host: "10.69.4.160", name: "Reolink Doorbell", group: "Security",  port: 80 },
    { host: "10.69.1.27",  name: "Front Yard Camera", group: "Security", port: 80 },
    { host: "10.69.1.19",  name: "Garage Camera",  group: "Security",    port: 80 },
    { host: "10.69.1.16",  name: "Back Yard Camera", group: "Security",  port: 80 },

    { host: "10.69.2.180", name: "TrueNAS",        group: "Storage",     port: 443, https: true },
    { host: "10.69.2.134", name: "Garage S3",      group: "Storage",     port: 3909 },

    { host: "10.69.2.5",   name: "Gitea",          group: "Apps",        port: 8080 },
    { host: "10.69.2.70",  name: "Immich",         group: "Apps",        port: 2283 },
    { host: "10.69.2.5",   name: "Mealie",         group: "Apps",        port: 9091 },
    { host: "10.69.2.18",  name: "Securo",         group: "Apps",        port: 3000 },

    { host: "10.69.2.184", name: "Paperless-ngx",  group: "Documents",   port: 8000 },
    { host: "10.69.2.184", name: "Paperless-AI",   group: "Documents",   port: 3000 },
    { host: "10.69.2.184", name: "Paperless-GPT",  group: "Documents",   port: 3002 }
];

/* Home Assistant entities this screen reads. Named rather than pattern matched
 * so it is obvious what the panel depends on. */
var HA_ENTITIES = {
    coreUpdate: "update.home_assistant_core_update",
    osUpdate: "update.home_assistant_operating_system_update",
    supervisorUpdate: "update.home_assistant_supervisor_update",
    backupsStale: "binary_sensor.backups_stale",
    backupState: "sensor.backup_state",
    backupLast: "sensor.backup_last_successful_automatic_backup",
    backupNext: "sensor.backup_next_scheduled_automatic_backup",
    zigbeeEth: "binary_sensor.slzb_06_ethernet",
    zigbeeNet: "binary_sensor.slzb_06_internet",
    zigbeeChip: "sensor.slzb_06_zigbee_chip_temp",
    zigbeeCore: "sensor.slzb_06_core_chip_temp",
    z2mState: "binary_sensor.zigbee2mqtt_bridge_connection_state",
    z2mVersion: "sensor.zigbee2mqtt_bridge_version"
};

/* The two UPS units, as Home Assistant sees them through NUT. There is no
 * runtime sensor on either, so the panel says so rather than inventing one. */
var UPS = [
    { key: "servers", label: "Servers UPS",
      charge: "sensor.servers_battery_charge",
      load: "sensor.servers_load",
      volts: "sensor.servers_input_voltage" },
    { key: "network", label: "Network UPS",
      charge: "sensor.network_battery_charge",
      load: "sensor.network_load",
      volts: "sensor.network_input_voltage" }
];

/* The homelab's own draw, from the plugs the Energy screen already reads. */
var POWER = [
    { entity: "sensor.server_power_monitoring_power", label: "Server" },
    { entity: "sensor.mox_power_monitoring_power", label: "Mox" },
    { entity: "sensor.network_power_monitoring_power", label: "Network" },
    { entity: "sensor.office_ups_power", label: "Office UPS" },
    { entity: "sensor.attic_3d_printer_plug_power", label: "USW Switch" }
];

var POLL_MS = 6000;
var DAY_MS = 24 * 3600 * 1000;
var BACKUP_STALE_HOURS = 26;

/* Number(null) is 0 and Number("") is 0, so a missing entity was arriving as
 * a real zero and the Home Assistant panel printed "CPU 0%" for a sensor that
 * does not exist. Absent has to stay absent, or the panel invents a reading. */
function num(v) {
    if (v === null || v === undefined || v === "" ||
        v === "unknown" || v === "unavailable") {
        return null;
    }
    var n = Number(v);
    return isFinite(n) ? n : null;
}

/* ---- Prometheus ------------------------------------------------------------- */

function promBase() {
    var c = window.HA_CONFIG || {};
    return (c.prometheusUrl || PROM).replace(/\/+$/, "");
}

function instant(expr) {
    return fetch(promBase() + "/api/v1/query?query=" + encodeURIComponent(expr),
                 { mode: "cors" })
        .then(function (r) {
            if (!r.ok) { throw new Error("prometheus " + r.status); }
            return r.json();
        })
        .then(function (j) {
            if (j.status !== "success") { throw new Error("query failed"); }
            return j.data.result || [];
        });
}

function rangeQuery(expr, startMs, endMs, stepSec) {
    var url = promBase() + "/api/v1/query_range?query=" + encodeURIComponent(expr) +
        "&start=" + Math.floor(startMs / 1000) + "&end=" + Math.floor(endMs / 1000) +
        "&step=" + stepSec;
    return fetch(url, { mode: "cors" })
        .then(function (r) {
            if (!r.ok) { throw new Error("prometheus " + r.status); }
            return r.json();
        })
        .then(function (j) { return (j.data && j.data.result) || []; });
}

function HomelabFeeds(ha, onUpdate) {
    this.ha = ha;
    this.onUpdate = onUpdate || function () {};
    this.sources = JSON.parse(JSON.stringify(SOURCES));
    this.unifi = {};          // ip -> client series
    this.pve = null;          // filled once pve-exporter exists
    this.kuma = null;         // filled once Uptime Kuma is scraped
    this.hostStats = null;    // filled by Beszel or node_exporter
    this.beszelToken = null;
    this.error = null;
    this._timers = [];
    this._history = {};
}

HomelabFeeds.prototype.start = function () {
    var self = this;
    this.poll();
    this._timers.push(setInterval(function () { self.poll(); }, POLL_MS));
};

HomelabFeeds.prototype.stop = function () {
    this._timers.forEach(clearInterval);
    this._timers = [];
};

HomelabFeeds.prototype.poll = function () {
    var self = this;

    /* Home Assistant is live if the shared socket has states in it. */
    this.sources.ha.live = !!(this.ha && this.ha.states && this.ha.states.size > 0);

    Promise.all([
        /* Every homelab host is a UniFi client, so this one query gives link
           state, switch and port, uptime and throughput for all of them. */
        instant('{__name__=~"unpoller_client_(uptime_seconds|receive_rate_bytes|' +
                'transmit_rate_bytes)"}').catch(function () { return null; }),
        /* These two stay empty until the exporters exist. Asking anyway means
           the screen lights up on its own the moment they do. */
        instant('{__name__=~"pve_(up|node_info|cpu_usage_ratio|memory_usage_bytes|' +
                'memory_size_bytes|disk_usage_bytes|disk_size_bytes|uptime_seconds|' +
                'guest_info)"}').catch(function () { return null; }),
        instant('{__name__=~"monitor_(status|response_time|cert_days_remaining)"}')
            .catch(function () { return null; })
    ]).then(function (res) {
        if (res[0]) {
            self.sources.unifi.live = res[0].length > 0;
            var by = {};
            res[0].forEach(function (s) {
                var ip = s.metric.ip;
                if (!ip) { return; }
                if (!by[ip]) { by[ip] = { m: s.metric }; }
                var n = s.metric.__name__;
                if (n === "unpoller_client_uptime_seconds") { by[ip].uptime = num(s.value[1]); }
                if (n === "unpoller_client_receive_rate_bytes") { by[ip].rx = num(s.value[1]); }
                if (n === "unpoller_client_transmit_rate_bytes") { by[ip].tx = num(s.value[1]); }
            });
            self.unifi = by;
        }
        self.sources.pve.live = !!(res[1] && res[1].length > 0);
        self.pve = self.sources.pve.live ? res[1] : null;
        self.sources.kuma.live = !!(res[2] && res[2].length > 0);
        self.kuma = self.sources.kuma.live ? res[2] : null;
        self.onUpdate();
    });

    this.pollBeszel();
};

/* Beszel answers from the browser (it sends Access-Control-Allow-Origin: *) but
 * returns an empty list until it has a login. With credentials in .env this
 * fills the host metrics; without them the panels keep saying what they are
 * waiting for. */
HomelabFeeds.prototype.pollBeszel = function () {
    var self = this;
    var c = beszelConfig();
    if (!c.user || !c.pass) {
        return;
    }

    var fetchSystems = function (token) {
        return fetch(c.url + "/api/collections/systems/records?perPage=100", {
            mode: "cors",
            headers: token ? { Authorization: token } : {}
        }).then(function (r) { return r.json(); });
    };

    var go = this.beszelToken
        ? fetchSystems(this.beszelToken)
        : fetch(c.url + "/api/collections/users/auth-with-password", {
              method: "POST",
              mode: "cors",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ identity: c.user, password: c.pass })
          }).then(function (r) { return r.json(); })
            .then(function (j) {
                self.beszelToken = j.token || null;
                return fetchSystems(self.beszelToken);
            });

    go.then(function (j) {
        if (j && j.items && j.items.length) {
            var by = {};
            j.items.forEach(function (it) {
                var info = it.info || {};
                by[it.name] = {
                    name: it.name,
                    host: it.host,
                    status: it.status,
                    cpu: info.cpu !== undefined ? info.cpu : null,
                    memPct: info.mp !== undefined ? info.mp : null,
                    diskPct: info.dp !== undefined ? info.dp : null,
                    uptime: info.u !== undefined ? info.u : null,
                    temp: info.dt !== undefined ? info.dt : null
                };
            });
            self.hostStats = by;
            self.sources.host.live = true;
        } else {
            self.sources.host.live = false;
        }
        self.onUpdate();
    }).catch(function () {
        self.beszelToken = null;
        self.sources.host.live = false;
    });
};

/* ---- Home Assistant helpers --------------------------------------------------- */

HomelabFeeds.prototype.state = function (id) {
    var s = this.ha && this.ha.states ? this.ha.states.get(id) : null;
    return s ? s.state : null;
};

HomelabFeeds.prototype.numState = function (id) {
    return num(this.state(id));
};

HomelabFeeds.prototype.attr = function (id, key) {
    var s = this.ha && this.ha.states ? this.ha.states.get(id) : null;
    return s && s.attributes ? s.attributes[key] : null;
};

/* ---- the map ------------------------------------------------------------------ */

HomelabFeeds.prototype.hosts = function () {
    var self = this;
    return HOSTS.map(function (h) {
        var c = self.unifi[h.ip];
        var stats = self.hostStats
            ? (self.hostStats[h.name] || self.hostStats[h.ip] || null) : null;
        var services = SERVICES.filter(function (s) { return s.host === h.ip; });

        return {
            ip: h.ip,
            name: h.name,
            kind: h.kind,
            /* Seen by the controller means the link is up. Not seen is a real
               state worth showing, not a blank. */
            seen: !!c,
            uptime: c ? c.uptime : null,
            rx: c ? (c.rx || 0) : 0,
            tx: c ? (c.tx || 0) : 0,
            via: c ? (c.m.sw_name || c.m.ap_name || "") : "",
            port: c ? (c.m.sw_port || "") : "",
            mac: c ? c.m.mac : "",
            stats: stats,
            services: services,
            serviceCount: services.length
        };
    });
};

HomelabFeeds.prototype.guests = function () {
    /* Nothing enumerates VMs and LXCs until pve-exporter is scraped. Returning
       an empty list rather than a guess is the point. */
    if (!this.sources.pve.live || !this.pve) {
        return [];
    }
    var by = {};
    this.pve.forEach(function (s) {
        var id = s.metric.id;
        if (!id || id.indexOf("node/") === 0) { return; }
        if (!by[id]) {
            by[id] = { id: id, node: s.metric.node || "",
                       name: s.metric.name || id,
                       type: id.indexOf("qemu/") === 0 ? "VM" : "LXC" };
        }
        var n = s.metric.__name__;
        if (n === "pve_up") { by[id].up = num(s.value[1]) === 1; }
        if (n === "pve_cpu_usage_ratio") { by[id].cpu = num(s.value[1]); }
        if (n === "pve_memory_usage_bytes") { by[id].mem = num(s.value[1]); }
    });
    return Object.keys(by).map(function (k) { return by[k]; });
};

/* ---- Home Assistant panel -------------------------------------------------------- */

HomelabFeeds.prototype.homeAssistant = function () {
    var self = this;
    if (!this.sources.ha.live) {
        return { live: false };
    }

    var updates = [];
    this.ha.states.forEach(function (s, id) {
        if (id.indexOf("update.") === 0 && s.state === "on") {
            updates.push({
                id: id,
                name: (s.attributes && s.attributes.friendly_name) || id,
                installed: s.attributes ? s.attributes.installed_version : null,
                latest: s.attributes ? s.attributes.latest_version : null
            });
        }
    });

    /* Z-Wave node health. A failed node reads "dead"; the controller also
       raises a software failure flag per device, and nine of those are on
       right now, which is a real fault the panel has to surface. */
    var dead = [], failing = [];
    this.ha.states.forEach(function (s, id) {
        if (/_node_status$/.test(id) && s.state === "dead") {
            dead.push((s.attributes && s.attributes.friendly_name) || id);
        }
        if (/system_software_failure/.test(id) && s.state === "on") {
            failing.push(((s.attributes && s.attributes.friendly_name) || id)
                .replace(/\s*System software failure.*$/i, ""));
        }
    });

    var lastBackup = this.state(HA_ENTITIES.backupLast);
    var backupAgeH = null;
    if (lastBackup) {
        var t = Date.parse(lastBackup);
        if (isFinite(t)) { backupAgeH = (Date.now() - t) / 3600000; }
    }

    return {
        live: true,
        version: this.attr(HA_ENTITIES.coreUpdate, "installed_version"),
        latest: this.attr(HA_ENTITIES.coreUpdate, "latest_version"),
        coreUpdate: this.state(HA_ENTITIES.coreUpdate) === "on",
        osUpdate: this.state(HA_ENTITIES.osUpdate) === "on",
        supervisorUpdate: this.state(HA_ENTITIES.supervisorUpdate) === "on",
        updates: updates.sort(function (a, b) { return a.name.localeCompare(b.name); }),
        /* No processor or memory entity exists on this instance. The System
           Monitor integration would add them; until then this says so. */
        cpu: this.numState("sensor.processor_use"),
        memory: this.numState("sensor.memory_use_percent"),
        dbSize: this.numState("sensor.home_assistant_v2_db_size"),
        zigbee: {
            eth: this.state(HA_ENTITIES.zigbeeEth) === "on",
            net: this.state(HA_ENTITIES.zigbeeNet) === "on",
            chipTemp: this.numState(HA_ENTITIES.zigbeeChip),
            coreTemp: this.numState(HA_ENTITIES.zigbeeCore),
            z2m: this.state(HA_ENTITIES.z2mState) === "on",
            z2mVersion: this.state(HA_ENTITIES.z2mVersion)
        },
        zwave: { dead: dead, failing: failing },
        backups: {
            stale: this.state(HA_ENTITIES.backupsStale) === "on",
            state: this.state(HA_ENTITIES.backupState),
            last: lastBackup,
            ageHours: backupAgeH,
            next: this.state(HA_ENTITIES.backupNext)
        }
    };
};

/* ---- power and UPS ---------------------------------------------------------------- */

HomelabFeeds.prototype.power = function () {
    var self = this;
    if (!this.sources.ha.live) {
        return { live: false, items: [], total: 0 };
    }
    var items = POWER.map(function (p) {
        return { label: p.label, watts: self.numState(p.entity) };
    }).filter(function (p) { return p.watts !== null; });
    return {
        live: items.length > 0,
        items: items,
        total: items.reduce(function (a, p) { return a + p.watts; }, 0)
    };
};

HomelabFeeds.prototype.ups = function () {
    var self = this;
    if (!this.sources.ha.live) {
        return { live: false, units: [] };
    }
    var units = UPS.map(function (u) {
        return {
            label: u.label,
            charge: self.numState(u.charge),
            load: self.numState(u.load),
            volts: self.numState(u.volts),
            /* NUT exposes no runtime sensor through this integration. */
            runtime: null
        };
    }).filter(function (u) { return u.charge !== null; });
    return { live: units.length > 0, units: units };
};

/* ---- services board ----------------------------------------------------------------- */

HomelabFeeds.prototype.services = function () {
    var self = this;
    var hostSeen = {};
    this.hosts().forEach(function (h) { hostSeen[h.ip] = h.seen; });

    var kumaBy = {};
    if (this.sources.kuma.live && this.kuma) {
        this.kuma.forEach(function (s) {
            var n = (s.metric.monitor_name || "").toLowerCase();
            if (!kumaBy[n]) { kumaBy[n] = {}; }
            if (s.metric.__name__ === "monitor_status") {
                kumaBy[n].status = num(s.value[1]);
            }
            if (s.metric.__name__ === "monitor_response_time") {
                kumaBy[n].ms = num(s.value[1]);
            }
        });
    }

    var groups = {};
    SERVICES.forEach(function (s) {
        if (!groups[s.group]) { groups[s.group] = []; }
        var k = kumaBy[s.name.toLowerCase()] || null;
        groups[s.group].push({
            name: s.name,
            group: s.group,
            host: s.host,
            url: (s.https ? "https://" : "http://") + s.host +
                 ((s.port === 80 || s.port === 443) ? "" : ":" + s.port) + (s.path || ""),
            /* The host's link state is known from the controller. Whether the
               service itself answers is not, until Uptime Kuma is scraped, and
               the board labels the difference rather than implying one from
               the other. */
            hostSeen: hostSeen[s.host] !== false,
            hostKnown: hostSeen[s.host] !== undefined,
            status: k ? k.status : null,
            ms: k ? k.ms : null
        });
    });

    return Object.keys(groups).sort().map(function (g) {
        return { group: g, items: groups[g] };
    });
};

/* ---- storage and backups -------------------------------------------------------------- */

HomelabFeeds.prototype.storage = function () {
    /* TrueNAS and PBS both answer but send no CORS headers, so the browser
       cannot read them whatever credentials it has. They need an exporter in
       front of Prometheus, which is the same answer as pve-exporter. */
    return { live: this.sources.storage.live, pools: [], datastores: [], backups: [] };
};

/* ---- status row -------------------------------------------------------------------------- */

HomelabFeeds.prototype.status = function () {
    var hosts = this.hosts();
    var pve = hosts.filter(function (h) { return h.kind === "pve"; });
    var guests = this.guests();
    var ha = this.homeAssistant();
    var services = this.services();

    var totalServices = 0, upServices = 0, knownServices = 0;
    services.forEach(function (g) {
        g.items.forEach(function (s) {
            totalServices += 1;
            if (s.status !== null) {
                knownServices += 1;
                if (s.status === 1) { upServices += 1; }
            }
        });
    });

    var alerts = [];
    hosts.forEach(function (h) {
        if (!h.seen) {
            alerts.push({ kind: "host", text: h.name + " not seen by the controller" });
        }
    });
    if (ha.live) {
        if (ha.backups.stale) { alerts.push({ kind: "backup", text: "Home Assistant backups are stale" }); }
        if (ha.zwave.failing.length) {
            alerts.push({ kind: "zwave",
                text: ha.zwave.failing.length + " Z-Wave devices report a software failure" });
        }
        if (ha.zwave.dead.length) {
            alerts.push({ kind: "zwave", text: ha.zwave.dead.length + " dead Z-Wave nodes" });
        }
        if (!ha.zigbee.eth || !ha.zigbee.net) {
            alerts.push({ kind: "zigbee", text: "Zigbee coordinator link is down" });
        }
        if (ha.updates.length) {
            alerts.push({ kind: "update", text: ha.updates.length + " updates available" });
        }
    }

    return {
        nodesUp: pve.filter(function (h) { return h.seen; }).length,
        nodesTotal: pve.length,
        hostsUp: hosts.filter(function (h) { return h.seen; }).length,
        hostsTotal: hosts.length,
        guestsRunning: guests.filter(function (g) { return g.up; }).length,
        guestsTotal: guests.length,
        guestsKnown: this.sources.pve.live,
        servicesUp: upServices,
        servicesKnown: knownServices,
        servicesTotal: totalServices,
        alerts: alerts
    };
};

/* 24 hours of throughput for one host, for its detail panel. */
HomelabFeeds.prototype.hostHistory = function (ip) {
    var self = this;
    var cached = this._history[ip];
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
        return Promise.resolve(cached.points);
    }
    var end = Date.now(), start = end - DAY_MS;
    var sel = '{ip="' + ip + '"}';
    return Promise.all([
        rangeQuery("unpoller_client_receive_rate_bytes" + sel, start, end, 300),
        rangeQuery("unpoller_client_transmit_rate_bytes" + sel, start, end, 300)
    ]).then(function (res) {
        var rx = res[0][0], tx = res[1][0];
        var points = rx ? rx.values.map(function (p, i) {
            return { t: p[0] * 1000, rx: num(p[1]) || 0,
                     tx: tx && tx.values[i] ? (num(tx.values[i][1]) || 0) : 0 };
        }) : [];
        self._history[ip] = { at: Date.now(), points: points };
        return points;
    }).catch(function () { return []; });
};

export { HomelabFeeds, HOSTS, SERVICES, SOURCES, BACKUP_STALE_HOURS };
