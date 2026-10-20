/* Data for the Energy screen.
 *
 * The house only consumes. There is no solar and no battery, so everything
 * here is about where the power goes.
 *
 * THERE IS NO WHOLE HOUSE METER. Read from Home Assistant's own energy
 * preferences, the "grid consumption" sources are nineteen individual plug and
 * circuit energy sensors rather than one meter at the panel, and
 * device_consumption is empty. So the top node of the flow is "Measured total"
 * and the screen says out loud that unmonitored loads are not in it. If a whole
 * house meter is ever added, set HOUSE_METER below and an "Unmeasured" node
 * appears for the difference.
 *
 * Every entity listed here was read off the live instance. Names and areas are
 * NOT hardcoded: they come from Home Assistant at runtime, friendly_name for
 * the name and Areas.js for the area, the same as every other screen. Only the
 * pairing of a power sensor to its energy sensor and the category are fixed
 * here, because neither can be derived safely. The entity id of the attic
 * switch still says 3d_printer_plug while its friendly name is "USW Switch",
 * which is exactly the kind of thing name guessing gets wrong.
 */

/* Set this to a statistic id if a whole house meter is ever installed. While
 * it is null the top node is the measured total and nothing is invented. */
var HOUSE_METER = null;

/* Cents per kWh.
 *
 * Home Assistant's energy preferences carry no price on this install: every
 * stat_cost, entity_energy_price and number_energy_price is null and
 * energy/info reports no cost sensors. getPrefs() below still reads the price
 * and prefers it if one is ever configured.
 *
 * Jovan's rate is 12 cents per kWh. Home Assistant's own price still wins if
 * one is ever configured there, and window.HA_CONFIG can override this as
 * energyRateCents without a rebuild. Set it back to null to hide cost. */
var RATE_CENTS = 12;

var CATEGORIES = [
    { key: "homelab",  label: "Homelab" },
    { key: "hvac",     label: "HVAC" },
    { key: "water",    label: "Water Heater" },
    { key: "kitchen",  label: "Kitchen" },
    { key: "lighting", label: "Lighting" },
    { key: "other",    label: "Other" }
];

/* The nineteen measured loads, each a power sensor paired with its energy
 * sensor. Category is assigned by what the thing is, which is the one judgement
 * that cannot be read from Home Assistant. */
var DEVICES = [
    /* Homelab: servers, network gear and the UPS that backs them. */
    { key: "server",       cat: "homelab",
      power: "sensor.server_power_monitoring_power",
      energy: "sensor.server_power_monitoring_energy" },
    { key: "mox",          cat: "homelab",
      power: "sensor.mox_power_monitoring_power",
      energy: "sensor.mox_power_monitoring_energy" },
    { key: "network",      cat: "homelab",
      power: "sensor.network_power_monitoring_power",
      energy: "sensor.network_power_monitoring_energy" },
    { key: "office_ups",   cat: "homelab",
      power: "sensor.office_ups_power",
      energy: "sensor.office_ups_energy" },
    { key: "usw_switch",   cat: "homelab",
      power: "sensor.attic_3d_printer_plug_power",
      energy: "sensor.attic_3d_printer_plug_energy" },
    { key: "linux_test",   cat: "homelab",
      power: "sensor.starbase_rxdeg_server_monitor_power",
      energy: "sensor.starbase_rxdeg_server_monitor_energy" },

    /* HVAC. The furnace and the air conditioner are not power monitored on
       this house, so this category is the air treatment that is. The screen
       says so rather than letting the category imply whole house HVAC. */
    { key: "air_loft",     cat: "hvac",
      power: "sensor.air_purifier_power",
      energy: "sensor.air_purifier_energy" },
    { key: "air_living",   cat: "hvac",
      power: "sensor.living_room_air_purifier_power",
      energy: "sensor.living_room_air_purifier_energy" },

    { key: "water_heater", cat: "water",
      power: "sensor.water_heater_power_monitoring_power",
      energy: "sensor.water_heater_power_monitoring_energy" },

    /* Kitchen, read as food and refrigeration rather than by room: the deep
       freezer is in the Garage and the test fridge is in the Loft. */
    { key: "deep_freezer", cat: "kitchen",
      power: "sensor.deep_freezer_power_monitor_power",
      energy: "sensor.deep_freezer_power_monitor_energy" },
    { key: "test_fridge",  cat: "kitchen",
      power: "sensor.grillplats_plug_power",
      energy: "sensor.grillplats_plug_energy" },
    { key: "keurig",       cat: "kitchen",
      power: "sensor.kitchen_keurig_coffee_power",
      energy: "sensor.kitchen_keurig_coffee_energy" },

    { key: "garage_light", cat: "lighting",
      power: "sensor.shelly1pmminig3_5432045494b4_power",
      energy: "sensor.shelly1pmminig3_5432045494b4_energy" },
    { key: "porch_lights", cat: "lighting",
      power: "sensor.back_porch_lights_power",
      energy: "sensor.back_porch_lights_energy" },
    { key: "led_sign",     cat: "lighting",
      power: "sensor.led_sign_power",
      energy: "sensor.led_sign_energy" },

    { key: "printer_3d",   cat: "other",
      power: "sensor.3d_printer_plug_power",
      energy: "sensor.3d_printer_plug_energy" },
    { key: "front_outlet", cat: "other",
      power: "sensor.front_door_outlet_power",
      energy: "sensor.front_door_outlet_energy" },
    { key: "stairway",     cat: "other",
      power: "sensor.loft_stairway_outlet_power",
      energy: "sensor.loft_stairway_outlet_energy" },
    { key: "ak_speaker",   cat: "other",
      power: "sensor.ak_s_speaker_power",
      energy: "sensor.ak_s_speaker_energy" }
];

/* Power sensors that exist but are deliberately not loads on this screen.
 *
 * The PoE port sensors measure power a switch hands to the device on the far
 * end of a cable. That power is drawn through the switch's own supply, which is
 * already measured at its plug, so counting both would count it twice. They
 * also have no energy sensor, so they could never carry a kWh figure. The
 * apparent power and returned energy sensors are not real consumption.
 *
 * Kept as a list rather than a regex so it is obvious what was left out. */
var NOT_A_LOAD = [
    "sensor.io_u8_port_5_poe_power",
    "sensor.io_u8_port_6_poe_power",
    "sensor.io_u8_port_7_poe_power",
    "sensor.io_u8_port_8_poe_power",
    "sensor.usw_ultra_poe_out_data_poe_power",
    "sensor.usw_ultra_poe_out_data_poe_power_2",
    "sensor.usw_ultra_poe_out_data_poe_power_3",
    "sensor.usw_ultra_poe_out_data_poe_power_4",
    "sensor.usw_ultra_poe_out_data_poe_power_5",
    "sensor.usw_ultra_poe_out_data_poe_power_6",
    "sensor.usw_ultra_poe_out_data_poe_power_7",
    "sensor.shelly1pmminig3_5432045494b4_energy_returned"
];

/* A device has to clear both of these to count as drawing unusually, which is
 * the only thing on this screen allowed to go orange.
 *
 * The ratio against the seven day average alone is not enough. Anything that
 * cycles (the freezer, the water heater, the coffee maker) is off most of the
 * day, so its weekly average sits far under its running draw and it would go
 * orange merely for being switched on. Orange would then mean nothing, which is
 * what rule 10 in BUILD.md exists to prevent. The percentile is the second
 * test: high for this device by its own recent standard, not just high against
 * an average that includes all the hours it was off. */
var UNUSUAL_RATIO = 1.5;
var UNUSUAL_PERCENTILE = 0.95;

/* Below this a device is off rather than idling. */
var IDLE_W = 1.0;

var STATS_EVERY = 5 * 60 * 1000;
var DAY_MS = 24 * 3600 * 1000;

function startOfDay(ms) {
    var d = new Date(ms === undefined ? Date.now() : ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function startOfMonth() {
    var d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
}

function EnergyFeeds(ha, areas, onUpdate) {
    this.ha = ha;
    this.areas = areas;
    this.onUpdate = onUpdate || function () {};

    this.rateCents = null;
    this.ratePending = true;    // true until energy/get_prefs has answered
    this.prefs = null;

    /* device key -> { day: {dayStart: kWh}, curve: [{t, mean, max, min}] } */
    this.daily = {};
    this.curves = {};
    this.loaded = false;
    this._timers = [];
}

EnergyFeeds.prototype.start = function () {
    var self = this;
    this.getPrefs();
    this.refresh();
    this._timers.push(setInterval(function () { self.refresh(); }, STATS_EVERY));
};

EnergyFeeds.prototype.stop = function () {
    this._timers.forEach(clearInterval);
    this._timers = [];
};

/* ---- price ------------------------------------------------------------------ */

/* Home Assistant's own energy configuration is the first place a rate could
 * come from. On this install there is none, so cost stays hidden until a rate
 * is supplied rather than being invented from a national average. */
EnergyFeeds.prototype.getPrefs = function () {
    var self = this;
    if (!this.ha) {
        return;
    }
    this.ha.command({ type: "energy/get_prefs" }).then(function (prefs) {
        self.prefs = prefs;
        var cents = null;
        (prefs && prefs.energy_sources ? prefs.energy_sources : []).forEach(function (s) {
            if (cents === null && typeof s.number_energy_price === "number") {
                cents = s.number_energy_price * 100;
            }
            if (cents === null && s.entity_energy_price) {
                var st = self.ha.states.get(s.entity_energy_price);
                var v = st ? num(st.state) : null;
                if (v !== null) {
                    cents = v * 100;
                }
            }
        });
        if (cents === null) {
            var override = (window.HA_CONFIG || {}).energyRateCents;
            cents = typeof override === "number" ? override
                : (typeof RATE_CENTS === "number" ? RATE_CENTS : null);
        }
        self.rateCents = cents;
        self.ratePending = false;
        self.onUpdate();
    }).catch(function () {
        self.ratePending = false;
        self.onUpdate();
    });
};

EnergyFeeds.prototype.hasRate = function () {
    return typeof this.rateCents === "number" && this.rateCents > 0;
};

/* Dollars for a number of kWh, or null when there is no rate to use. */
EnergyFeeds.prototype.cost = function (kwh) {
    if (!this.hasRate() || kwh === null || kwh === undefined) {
        return null;
    }
    return (kwh * this.rateCents) / 100;
};

/* ---- live power -------------------------------------------------------------- */

EnergyFeeds.prototype._state = function (id) {
    return (this.ha && this.ha.states) ? this.ha.states.get(id) : null;
};

/* The live reading, straight off the entity. Only _window uses this. */
EnergyFeeds.prototype._readWatts = function (device) {
    var s = this._state(device.power);
    if (!s || s.state === "unavailable" || s.state === "unknown") {
        return null;
    }
    return num(s.state);
};

/* One sampling of every power sensor, plus a cache of the ranges derived from
 * it. Everything a render pass asks for comes out of the same window, so the
 * status row, the diagram and the lists cannot disagree about a number. */
EnergyFeeds.prototype._window = function () {
    var self = this;
    var now = Date.now();
    if (!this._win || now - this._win.at > SNAPSHOT_MS) {
        var watts = {};
        DEVICES.forEach(function (d) { watts[d.key] = self._readWatts(d); });
        this._win = { at: now, watts: watts, byRange: {} };
    }
    return this._win;
};

EnergyFeeds.prototype.watts = function (device) {
    return this._window().watts[device.key];
};

/* A name like "shelly1pmminig3-5432045494b4" is the factory device id, not
 * something to put on a diagram. The long hexadecimal run is the giveaway. */
function looksLikeDeviceId(s) {
    return /[0-9a-f]{8,}/i.test(s.replace(/[\s\-_]/g, ""));
}

/* The sensor is called "Server Power Monitoring Power". The thing it measures
 * is the server. Trimming the measurement words leaves the name of the load,
 * which is what a flow diagram should be labelled with. */
function cleanName(n) {
    return n.replace(/\s+(Power|Energy)$/i, "")
            .replace(/\s+Power\s+Monitoring$/i, "")
            .replace(/\s+Power\s+Monitor$/i, "")
            .replace(/\s+plug$/i, "")
            .trim();
}

EnergyFeeds.prototype.nameOf = function (device) {
    var self = this;
    /* Two sensors, two chances at a real name. The Shelly's power sensor still
       carries the factory id while its energy sensor is called "Garage Light
       Switch", so the one that is not an id wins. */
    var names = [device.power, device.energy].map(function (id) {
        var st = self._state(id);
        var n = st && st.attributes ? st.attributes.friendly_name : null;
        return n ? cleanName(n) : null;
    }).filter(Boolean);

    for (var i = 0; i < names.length; i++) {
        if (!looksLikeDeviceId(names[i])) {
            return names[i];
        }
    }
    return names[0] || device.key;
};

EnergyFeeds.prototype.areaOf = function (device) {
    return this.areas ? (this.areas.areaName(device.power) ||
                         this.areas.areaName(device.energy) || "") : "";
};

/* ---- the devices, assembled --------------------------------------------------- */

/* Shorter than EnergyView's refresh tick, so each pass opens a fresh window
 * and every panel inside that pass reads the same one. */
var SNAPSHOT_MS = 1500;

/* range is "now", "today", "week" or "month". */
EnergyFeeds.prototype.devices = function (range) {
    var self = this;

    var win = this._window();
    if (win.byRange[range]) {
        return win.byRange[range];
    }
    var today = startOfDay();

    var list = DEVICES.map(function (d) {
        var w = win.watts[d.key];
        var day = self.daily[d.key] || {};
        var avgW = self.averageWatts(d.key);

        var kwh = {
            today: self._sumDays(day, today, today + DAY_MS),
            week: self._sumDays(day, today - 6 * DAY_MS, today + DAY_MS),
            month: self._sumDays(day, startOfMonth(), today + DAY_MS)
        };

        var available = w !== null;
        var p95 = self.percentileWatts(d.key, UNUSUAL_PERCENTILE);
        var unusual = available && w > 2 &&
                      avgW !== null && avgW > 1 && w > avgW * UNUSUAL_RATIO &&
                      p95 !== null && w > p95;

        return {
            key: d.key,
            cat: d.cat,
            powerId: d.power,
            energyId: d.energy,
            name: self.nameOf(d),
            area: self.areaOf(d),
            available: available,
            watts: available ? w : 0,
            status: !available ? "offline"
                : w < IDLE_W ? "off"
                : w < Math.max(IDLE_W, (avgW || 0) * 0.25) ? "standby"
                : "on",
            avgWatts: avgW,
            unusual: unusual,
            kwh: kwh,
            value: range === "now" ? (available ? w : 0) : (kwh[range] || 0)
        };
    });

    win.byRange[range] = list;
    return list;
};

EnergyFeeds.prototype._sumDays = function (dayMap, from, to) {
    var total = 0;
    for (var k in dayMap) {
        if (dayMap.hasOwnProperty(k)) {
            var t = Number(k);
            if (t >= from && t < to) {
                total += dayMap[k];
            }
        }
    }
    return total;
};

/* Seven day average draw in watts, from the kWh actually recorded. This is what
 * "unusually high" is measured against, so it is derived rather than assumed. */
EnergyFeeds.prototype.averageWatts = function (key) {
    var day = this.daily[key];
    if (!day) {
        return null;
    }
    var today = startOfDay();
    var kwh = this._sumDays(day, today - 7 * DAY_MS, today);
    var days = 0;
    for (var k in day) {
        if (day.hasOwnProperty(k)) {
            var t = Number(k);
            if (t >= today - 7 * DAY_MS && t < today) {
                days += 1;
            }
        }
    }
    if (!days) {
        return null;
    }
    return (kwh * 1000) / (days * 24);
};

/* Where this device's current draw sits against its own last 24 hours. Used to
 * decide whether a reading is high for this device rather than high for the
 * average of a device that spends most of its time off. */
EnergyFeeds.prototype.percentileWatts = function (key, q) {
    var c = this.curves[key];
    if (!c || c.length < 12) {
        return null;
    }
    var vals = c.map(function (p) { return p.max !== null ? p.max : p.mean; })
                .filter(function (v) { return v !== null && v !== undefined; })
                .sort(function (a, b) { return a - b; });
    if (!vals.length) {
        return null;
    }
    return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))];
};

/* ---- categories and the flow -------------------------------------------------- */

EnergyFeeds.prototype.categories = function (range) {
    var devices = this.devices(range);
    return CATEGORIES.map(function (c) {
        var mine = devices.filter(function (d) { return d.cat === c.key; });
        return {
            key: c.key,
            label: c.label,
            devices: mine,
            value: mine.reduce(function (a, d) { return a + d.value; }, 0),
            watts: mine.reduce(function (a, d) { return a + d.watts; }, 0),
            /* Deliberately not "any of my devices is unusual". A category is a
               sum, and a sum is never the thing drawing too much. Rolling it
               up turned Kitchen orange whenever the freezer cycled, and with
               it the ribbon out of the root, so the whole house read as an
               alarm. Orange stays on the one device and its own link. */
            unusualCount: mine.filter(function (d) { return d.unusual; }).length
        };
    }).filter(function (c) { return c.devices.length > 0; });
};

/* The Sankey graph: total on the left, categories in the middle, devices on
 * the right. When only is set, the graph is that one category drilled into. */
EnergyFeeds.prototype.flow = function (range, only) {
    var cats = this.categories(range);
    if (only) {
        cats = cats.filter(function (c) { return c.key === only; });
    }

    var total = cats.reduce(function (a, c) { return a + c.value; }, 0);
    var nodes = [];
    var links = [];
    var index = {};

    function node(id, label, kind, extra) {
        if (index[id] === undefined) {
            index[id] = nodes.length;
            nodes.push(Object.assign({ id: id, label: label, kind: kind }, extra || {}));
        }
        return index[id];
    }

    var rootLabel = only
        ? (cats[0] ? cats[0].label : "")
        : (HOUSE_METER ? "House total" : "Measured total");
    var root = node("root", rootLabel, "root", { value: total });

    cats.forEach(function (c) {
        /* Drilled in, the category IS the root, so it must not also appear as
           a node of its own with nothing flowing through it. */
        var from = root;
        if (!only) {
            /* No unusual flag on a category node or a category link: see
               categories() above. */
            from = node("cat:" + c.key, c.label, "category",
                        { cat: c.key, value: c.value });
            links.push({ source: root, target: from, value: c.value,
                         kind: "category", cat: c.key });
        }
        c.devices.forEach(function (d) {
            var di = node("dev:" + d.key, d.name, "device",
                          { device: d, unusual: d.unusual });
            links.push({ source: from, target: di, value: d.value,
                         kind: "device", device: d, unusual: d.unusual });
        });
    });

    /* No whole house meter exists, so there is nothing to subtract and no
       Unmeasured node. If one is ever configured this is where the difference
       between it and the measured loads becomes its own flow. */
    if (HOUSE_METER && !only) {
        var meter = this._meterValue(range);
        var gap = meter - total;
        if (gap > 0) {
            var ui = node("cat:unmeasured", "Unmeasured", "category",
                          { cat: "unmeasured" });
            links.push({ source: root, target: ui, value: gap,
                         kind: "category", cat: "unmeasured" });
            nodes[root].value = meter;
        }
    }

    return { nodes: nodes, links: links, total: total, metered: !!HOUSE_METER };
};

EnergyFeeds.prototype.totalWatts = function () {
    return this.devices("now").reduce(function (a, d) { return a + d.watts; }, 0);
};

EnergyFeeds.prototype.totalKwh = function (range) {
    return this.devices(range).reduce(function (a, d) { return a + d.value; }, 0);
};

/* ---- status row ----------------------------------------------------------------- */

EnergyFeeds.prototype.stats = function () {
    var devices = this.devices("now");
    var now = this.totalWatts();

    var top = null;
    devices.forEach(function (d) {
        if (!top || d.watts > top.watts) {
            top = d;
        }
    });

    var today = this.totalKwh("today");
    var month = this.totalKwh("month");

    /* Projected month: what has been used so far, scaled by how much of the
       month has elapsed. Days, not hours, so an evening does not flatter it. */
    var d = new Date();
    var daysIn = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    var elapsed = (d.getDate() - 1) + (Date.now() - startOfDay()) / DAY_MS;
    var projected = elapsed > 0.2 ? month * (daysIn / elapsed) : null;

    return {
        now: now,
        today: today,
        month: month,
        projected: projected,
        top: top,
        loaded: this.loaded,
        offline: devices.filter(function (x) { return !x.available; }).length
    };
};

/* Top consumers today, biggest first. */
EnergyFeeds.prototype.top = function (range, n) {
    return this.devices(range)
        .filter(function (d) { return d.value > 0; })
        .sort(function (a, b) { return b.value - a.value; })
        .slice(0, n || 5);
};

/* ---- the house curve over 24 hours ---------------------------------------------- */

/* Every device's five minute means added up, bucket by bucket. */
EnergyFeeds.prototype.houseCurve = function () {
    var buckets = {};
    var key;

    for (key in this.curves) {
        if (!this.curves.hasOwnProperty(key)) {
            continue;
        }
        this.curves[key].forEach(function (p) {
            if (!buckets[p.t]) {
                buckets[p.t] = 0;
            }
            buckets[p.t] += p.mean || 0;
        });
    }

    var out = Object.keys(buckets).map(function (t) {
        return { t: Number(t), w: buckets[t] };
    }).sort(function (a, b) { return a.t - b.t; });

    return out;
};

/* Where a big load came on. A bucket counts when the house total steps up by
 * more than the threshold, and the device that moved most in that bucket is
 * the one named. Derived from the curves, not from a list of guesses. */
EnergyFeeds.prototype.switchOns = function (curve) {
    var self = this;
    var marks = [];
    if (!curve || curve.length < 3) {
        return marks;
    }

    var step = Math.max(120, this.totalWatts() * 0.18);

    for (var i = 1; i < curve.length; i++) {
        var jump = curve[i].w - curve[i - 1].w;
        if (jump < step) {
            continue;
        }
        /* Which device accounts for the jump. */
        var who = null, best = 0;
        DEVICES.forEach(function (d) {
            var c = self.curves[d.key];
            if (!c) {
                return;
            }
            var a = null, b = null;
            for (var j = 0; j < c.length; j++) {
                if (c[j].t === curve[i].t) { b = c[j].mean; }
                if (c[j].t === curve[i - 1].t) { a = c[j].mean; }
            }
            if (a !== null && b !== null && b - a > best) {
                best = b - a;
                who = d;
            }
        });
        if (!who) {
            continue;
        }
        /* One marker per load per half hour, so a cycling freezer does not
           produce a picket fence. */
        var recent = marks.length && marks[marks.length - 1];
        if (recent && recent.key === who.key && curve[i].t - recent.t < 30 * 60000) {
            continue;
        }
        marks.push({ t: curve[i].t, w: curve[i].w, key: who.key,
                     name: self.nameOf(who), jump: jump });
    }
    return marks;
};

/* ---- one device, in detail -------------------------------------------------------- */

EnergyFeeds.prototype.detail = function (key) {
    var self = this;
    var device = null;
    this.devices("now").forEach(function (d) {
        if (d.key === key) { device = d; }
    });
    if (!device) {
        return null;
    }

    var curve = this.curves[key] || [];
    var day = this.daily[key] || {};
    var today = startOfDay();

    /* Last seven days as daily kWh, oldest first, including empty days so the
       bar chart does not silently close a gap. */
    var bars = [];
    for (var i = 6; i >= 0; i--) {
        var t = today - i * DAY_MS;
        bars.push({ t: t, kwh: day[t] || 0 });
    }

    /* Peak, from the five minute maxima, so the figure is a real reading and
       the time with it is the bucket it happened in. */
    var peak = null;
    curve.forEach(function (p) {
        if (p.max !== null && (!peak || p.max > peak.w)) {
            peak = { w: p.max, t: p.t };
        }
    });

    /* Standby is the lowest steady draw, not the lowest sample: the tenth
       percentile of the five minute minima. A single dropout to zero is not a
       standby figure. */
    var lows = curve.map(function (p) {
        return p.min !== null ? p.min : p.mean;
    }).filter(function (v) { return v !== null && v !== undefined; })
      .sort(function (a, b) { return a - b; });
    var standby = lows.length ? lows[Math.floor(lows.length * 0.1)] : null;

    var houseNow = this.totalWatts();

    return {
        device: device,
        curve: curve,
        bars: bars,
        peak: peak,
        standby: standby,
        share: houseNow > 0 ? (device.watts / houseNow) * 100 : 0,
        shareToday: (function () {
            var t = self.totalKwh("today");
            return t > 0 ? (device.kwh.today / t) * 100 : 0;
        }())
    };
};

/* ---- loading it all --------------------------------------------------------------- */

EnergyFeeds.prototype.refresh = function () {
    this._loadDaily();
    this._loadCurves();
};

/* Daily kWh per device, going back far enough to cover this month and a rolling
 * seven days even on the first of the month. One call for all nineteen. */
EnergyFeeds.prototype._loadDaily = function () {
    var self = this;
    if (!this.ha) {
        return;
    }
    var ids = DEVICES.map(function (d) { return d.energy; });
    var start = Math.min(startOfMonth(), startOfDay() - 35 * DAY_MS);

    this.ha.command({
        type: "recorder/statistics_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(Date.now() + 3600000).toISOString(),
        statistic_ids: ids,
        period: "day",
        types: ["change"]
    }).then(function (raw) {
        var byId = {};
        DEVICES.forEach(function (d) { byId[d.energy] = d.key; });

        var next = {};
        Object.keys(raw || {}).forEach(function (id) {
            var key = byId[id];
            if (!key) {
                return;
            }
            next[key] = {};
            (raw[id] || []).forEach(function (row) {
                var change = num(row.change);
                if (change === null || change < 0) {
                    return;
                }
                next[key][startOfDay(row.start)] = change;
            });
        });
        self.daily = next;
        self.loaded = true;
        self.onUpdate();
    }).catch(function () {});
};

/* Five minute power means over the last 24 hours, for the house chart, the
 * device curves, the peak and the standby figure. */
EnergyFeeds.prototype._loadCurves = function () {
    var self = this;
    if (!this.ha) {
        return;
    }
    var ids = DEVICES.map(function (d) { return d.power; });

    this.ha.command({
        type: "recorder/statistics_during_period",
        start_time: new Date(Date.now() - DAY_MS).toISOString(),
        end_time: new Date().toISOString(),
        statistic_ids: ids,
        period: "5minute",
        types: ["mean", "max", "min"]
    }).then(function (raw) {
        var byId = {};
        DEVICES.forEach(function (d) { byId[d.power] = d.key; });

        var next = {};
        Object.keys(raw || {}).forEach(function (id) {
            var key = byId[id];
            if (!key) {
                return;
            }
            next[key] = (raw[id] || []).map(function (row) {
                return { t: row.start, mean: num(row.mean),
                         max: num(row.max), min: num(row.min) };
            });
        });
        self.curves = next;
        self.onUpdate();
    }).catch(function () {});
};

/* Live state changes. Only the power sensors on this screen matter. */
EnergyFeeds.prototype.note = function (m) {
    var id = m.entityId;
    if (!id) {
        return false;
    }
    for (var i = 0; i < DEVICES.length; i++) {
        if (DEVICES[i].power === id || DEVICES[i].energy === id) {
            return true;
        }
    }
    return false;
};

EnergyFeeds.prototype._meterValue = function (range) {
    /* Only reachable once HOUSE_METER is set. */
    var s = this._state(HOUSE_METER);
    return s ? (num(s.state) || 0) : 0;
};

export { EnergyFeeds, DEVICES, CATEGORIES, NOT_A_LOAD, HOUSE_METER };
