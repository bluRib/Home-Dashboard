/* Data for the Climate screen.
 *
 * Exterior comes from the Pirate Weather integration in Home Assistant, plus
 * two things Home Assistant does not carry: active government weather alerts
 * from the National Weather Service, and the next 60 minutes of rain, which
 * needs the Pirate Weather API directly because the integration does not
 * expose the minutely block.
 *
 * Interior is deliberately a fixed list, not a search. Asking Home Assistant
 * for every temperature sensor in this house returns the Titan CPU at 125F,
 * the Phobos D24 at 147F, the deep freezer at -10F and the Zigbee coordinator
 * chip. None of that is comfort data and none of it belongs on this screen,
 * so every entity below was chosen by hand.
 */

var HOME = { lat: 35.02763, lon: -81.99418 };

/* ---- the entities this screen reads -------------------------------------- */

var EXTERIOR = {
    temperature: "sensor.pirateweather_temperature",
    apparent: "sensor.pirateweather_apparent_temperature",
    humidity: "sensor.pirateweather_humidity",
    dewPoint: "sensor.pirateweather_dew_point",
    windSpeed: "sensor.pirateweather_wind_speed",
    windGust: "sensor.pirateweather_wind_gust",
    windBearing: "sensor.pirateweather_wind_bearing",
    uv: "sensor.pirateweather_uv_index",
    pressure: "sensor.pirateweather_pressure",
    visibility: "sensor.pirateweather_visibility",
    rainChance: "sensor.pirateweather_precip_probability",
    summary: "sensor.pirateweather_summary",
    cloud: "sensor.pirateweather_cloud_coverage"
};

var ZONES = [
    { key: "up",   label: "Upstairs",   entity: "climate.loft_upstairs_thermostat" },
    { key: "down", label: "Downstairs", entity: "climate.living_room_downstairs_thermostat" }
];

/* Comfort air quality only. Jovan's desk is the only CO2 source in the house. */
var AIR = {
    deskTemp: "sensor.loft_jovans_desk_aq_temperature",
    deskHumidity: "sensor.loft_jovans_desk_aq_humidity",
    deskCo2: "sensor.loft_jovans_desk_aq_carbon_dioxide",
    deskPm25: "sensor.loft_jovans_desk_aq_pm2_5",
    upstairsPm25: "sensor.upstairs_air_sensor_pm25",
    livingHumidity: "sensor.living_room_humidity",
    atticHumidity: "sensor.attic_temp_sensor_humidity",
    purifier: "fan.living_room_air",
    purifierSpeed: "sensor.living_room_air_fan_speed"
};

/* Room temperatures for the thermal house. The two thermostats cover their
   zones. Snake Plant Dining is the Dining room, per the brief.
   Corn Plant and White Aglaonema are left out until Jovan confirms the rooms,
   though their entity ids say living_room and office. */
var ROOM_TEMPS = {
    loft: "sensor.loft_upstairs_thermostat_air_temperature",
    aks_room: "sensor.loft_upstairs_thermostat_air_temperature",
    bath1: "sensor.loft_upstairs_thermostat_air_temperature",
    living: "sensor.living_room_downstairs_thermostat_air_temperature",
    kitchen: "sensor.living_room_downstairs_thermostat_air_temperature",
    dining: "sensor.sm4_snake_plant_dining_room_temperature"
};

/* Thresholds. Orange past these, per rule 10. */
var LIMITS = { co2: 1000, pm25: 35, humidityLow: 30, humidityHigh: 60 };

var ALERTS_EVERY = 5 * 60 * 1000;
var MINUTELY_EVERY = 5 * 60 * 1000;
var HISTORY_EVERY = 10 * 60 * 1000;
var FORECAST_EVERY = 15 * 60 * 1000;
var PM_WINDOW = 5;            // readings kept for the median

function ClimateFeeds(ha, onUpdate) {
    this.ha = ha;
    this.onUpdate = onUpdate || function () {};
    this.alerts = [];
    this.minutely = null;
    this.history = null;
    this.forecast = [];
    this.pmHistory = {};      // entity id -> recent readings, for the median
    this._timers = [];        // refresh intervals
    this._debounce = {};      // zone key -> pending setpoint timer
    this._pending = {};       // zone key -> setpoint tapped but not yet sent
}

ClimateFeeds.prototype.start = function () {
    var self = this;
    if (!this.ha) {
        return;
    }
    this.refreshAlerts();
    this.refreshMinutely();
    this.refreshHistory();
    this.refreshForecast();
    this._timers.push(setInterval(function () { self.refreshAlerts(); }, ALERTS_EVERY));
    this._timers.push(setInterval(function () { self.refreshMinutely(); }, MINUTELY_EVERY));
    this._timers.push(setInterval(function () { self.refreshHistory(); }, HISTORY_EVERY));
    this._timers.push(setInterval(function () { self.refreshForecast(); }, FORECAST_EVERY));
};

ClimateFeeds.prototype.stop = function () {
    for (var i = 0; i < this._timers.length; i++) {
        clearInterval(this._timers[i]);
    }
    this._timers = [];
};

/* ---- reading Home Assistant ---------------------------------------------- */

ClimateFeeds.prototype.state = function (id) {
    return this.ha && this.ha.states ? this.ha.states.get(id) : null;
};

ClimateFeeds.prototype.num = function (id) {
    var s = this.state(id);
    if (!s) {
        return null;
    }
    var v = Number(s.state);
    return isFinite(v) ? v : null;
};

ClimateFeeds.prototype.text = function (id) {
    var s = this.state(id);
    return s && s.state !== "unknown" && s.state !== "unavailable" ? s.state : "";
};

ClimateFeeds.prototype.exterior = function () {
    var out = {};
    for (var key in EXTERIOR) {
        if (EXTERIOR.hasOwnProperty(key)) {
            out[key] = key === "summary" ? this.text(EXTERIOR[key]) : this.num(EXTERIOR[key]);
        }
    }
    return out;
};

ClimateFeeds.prototype.zones = function () {
    var out = [], i;
    for (i = 0; i < ZONES.length; i++) {
        var z = ZONES[i];
        var s = this.state(z.entity);
        var a = (s && s.attributes) || {};
        out.push({
            key: z.key,
            label: z.label,
            entity: z.entity,
            available: !!s,
            mode: s ? s.state : "",
            current: numOrNull(a.current_temperature),
            /* Pending is the value the taps have moved to but that has not
               been sent yet, so the number on screen answers the tap at once
               rather than a second later. */
            target: this._pending[z.key] !== undefined
                ? this._pending[z.key] : numOrNull(a.temperature),
            dirty: this._pending[z.key] !== undefined,
            humidity: numOrNull(a.current_humidity),
            action: a.hvac_action || "",
            fan: a.fan_mode || "",
            fanModes: a.fan_modes || [],
            preset: a.preset_mode || "",
            modes: a.hvac_modes || [],
            step: numOrNull(a.target_temp_step) || 1
        });
    }
    return out;
};

/* A median over the last few readings, because the upstairs sensor spikes and
   a single spike should not paint the panel orange. */
ClimateFeeds.prototype.smoothPm = function (id) {
    var v = this.num(id);
    if (v === null) {
        return null;
    }
    var list = this.pmHistory[id] || (this.pmHistory[id] = []);
    list.push(v);
    while (list.length > PM_WINDOW) {
        list.shift();
    }
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.floor(sorted.length / 2)];
};

ClimateFeeds.prototype.air = function () {
    var fan = this.state(AIR.purifier);
    return {
        deskTemp: this.num(AIR.deskTemp),
        deskHumidity: this.num(AIR.deskHumidity),
        deskCo2: this.num(AIR.deskCo2),
        deskPm25: this.smoothPm(AIR.deskPm25),
        upstairsPm25: this.smoothPm(AIR.upstairsPm25),
        livingHumidity: this.num(AIR.livingHumidity),
        atticHumidity: this.num(AIR.atticHumidity),
        purifierOn: fan ? fan.state === "on" : null,
        purifierPct: fan && fan.attributes ? numOrNull(fan.attributes.percentage) : null,
        purifierSpeed: this.num(AIR.purifierSpeed),
        limits: LIMITS
    };
};

ClimateFeeds.prototype.roomTemps = function () {
    var out = {}, key;
    for (key in ROOM_TEMPS) {
        if (ROOM_TEMPS.hasOwnProperty(key)) {
            var v = this.num(ROOM_TEMPS[key]);
            if (v !== null) {
                out[key] = v;
            }
        }
    }
    return out;
};

/* ---- acting on Home Assistant -------------------------------------------- */

/* Setpoint taps are debounced: the number moves at once, the service call
   goes a second after the last tap, so holding the button is one call. */
ClimateFeeds.prototype.nudgeSetpoint = function (zoneKey, delta, onSent) {
    var self = this;
    var zone = null, i;
    for (i = 0; i < ZONES.length; i++) {
        if (ZONES[i].key === zoneKey) {
            zone = ZONES[i];
        }
    }
    if (!zone) {
        return;
    }

    var s = this.state(zone.entity);
    var a = (s && s.attributes) || {};
    var base = this._pending[zoneKey] !== undefined
        ? this._pending[zoneKey] : numOrNull(a.temperature);
    if (base === null) {
        return;
    }

    var step = numOrNull(a.target_temp_step) || 1;
    var next = Math.round((base + delta * step) * 10) / 10;
    var min = numOrNull(a.min_temp), max = numOrNull(a.max_temp);
    if (min !== null) { next = Math.max(min, next); }
    if (max !== null) { next = Math.min(max, next); }

    this._pending[zoneKey] = next;
    this.onUpdate();

    if (this._debounce[zoneKey]) {
        clearTimeout(this._debounce[zoneKey]);
    }
    this._debounce[zoneKey] = setTimeout(function () {
        delete self._debounce[zoneKey];
        var value = self._pending[zoneKey];
        delete self._pending[zoneKey];
        self.ha.callService("climate", "set_temperature",
            { temperature: value }, { entity_id: zone.entity })
            .then(function () {
                if (onSent) { onSent(zone.label + " setpoint to " + value); }
            })
            .catch(function (err) {
                if (onSent) { onSent(zone.label + " setpoint failed: " + err.message, true); }
            });
        self.onUpdate();
    }, 1000);
};

ClimateFeeds.prototype.setMode = function (zoneKey, mode, onSent) {
    var zone = byKey(zoneKey);
    if (!zone) { return; }
    this.ha.callService("climate", "set_hvac_mode", { hvac_mode: mode },
        { entity_id: zone.entity })
        .then(function () { if (onSent) { onSent(zone.label + " mode to " + mode); } })
        .catch(function (e) { if (onSent) { onSent(zone.label + " mode failed: " + e.message, true); } });
};

ClimateFeeds.prototype.setFan = function (zoneKey, fan, onSent) {
    var zone = byKey(zoneKey);
    if (!zone) { return; }
    this.ha.callService("climate", "set_fan_mode", { fan_mode: fan },
        { entity_id: zone.entity })
        .then(function () { if (onSent) { onSent(zone.label + " fan to " + fan); } })
        .catch(function (e) { if (onSent) { onSent(zone.label + " fan failed: " + e.message, true); } });
};

ClimateFeeds.prototype.togglePurifier = function (onSent) {
    var s = this.state(AIR.purifier);
    var on = s && s.state === "on";
    this.ha.callService("fan", on ? "turn_off" : "turn_on", {}, { entity_id: AIR.purifier })
        .then(function () { if (onSent) { onSent("Living Room Air " + (on ? "off" : "on")); } })
        .catch(function (e) { if (onSent) { onSent("Living Room Air failed: " + e.message, true); } });
};

/* ---- National Weather Service alerts -------------------------------------- */

ClimateFeeds.prototype.refreshAlerts = function () {
    var self = this;
    var url = "https://api.weather.gov/alerts/active?point=" + HOME.lat + "," + HOME.lon;
    fetch(url, { headers: { Accept: "application/geo+json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
            if (!data) { return; }
            self.alerts = (data.features || []).map(function (f) {
                var p = f.properties || {};
                return {
                    event: p.event || "Alert",
                    severity: p.severity || "",
                    headline: p.headline || "",
                    ends: p.ends || p.expires || ""
                };
            });
            self.onUpdate();
        })
        .catch(function () {});
};

/* ---- next 60 minutes of rain ---------------------------------------------- */

ClimateFeeds.prototype.refreshMinutely = function () {
    var self = this;
    var key = (window.HA_CONFIG || {}).pirateWeatherKey;
    if (!key) {
        this.minutely = { missingKey: true };
        this.onUpdate();
        return;
    }
    var url = "https://api.pirateweather.net/forecast/" + key + "/" +
        HOME.lat + "," + HOME.lon + "?exclude=daily,alerts";
    fetch(url)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
            if (!data || !data.minutely) {
                self.minutely = { unavailable: true };
            } else {
                var points = (data.minutely.data || []).map(function (d) {
                    return {
                        at: d.time * 1000,
                        intensity: Number(d.precipIntensity) || 0,
                        probability: Number(d.precipProbability) || 0
                    };
                });
                self.minutely = { summary: data.minutely.summary || "", points: points };
            }
            self.onUpdate();
        })
        .catch(function () {
            self.minutely = { unavailable: true };
            self.onUpdate();
        });
};

/* ---- inside against outside, last 24 hours -------------------------------- */

ClimateFeeds.prototype.refreshHistory = function () {
    var self = this;
    var ids = [
        EXTERIOR.temperature,
        "sensor.loft_upstairs_thermostat_air_temperature",
        "sensor.living_room_downstairs_thermostat_air_temperature"
    ];
    var end = Date.now();
    var start = end - 24 * 3600 * 1000;

    this.ha.command({
        type: "history/history_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true
    }).then(function (raw) {
        var series = {};
        ids.forEach(function (id) {
            series[id] = (raw[id] || []).map(function (row) {
                return {
                    at: row.lu !== undefined ? row.lu * 1000
                        : Date.parse(row.last_updated || row.last_changed),
                    v: parseFloat(row.s !== undefined ? row.s : row.state)
                };
            }).filter(function (p) { return isFinite(p.at) && isFinite(p.v); });
        });
        self.history = {
            start: start,
            end: end,
            outside: series[ids[0]],
            upstairs: series[ids[1]],
            downstairs: series[ids[2]]
        };
        self.onUpdate();
    }).catch(function () {});
};

/* ---- 7 day forecast -------------------------------------------------------- */

ClimateFeeds.prototype.refreshForecast = function () {
    var self = this;
    this.ha.command({
        type: "call_service",
        domain: "weather",
        service: "get_forecasts",
        service_data: { type: "daily" },
        target: { entity_id: "weather.pirateweather" },
        return_response: true
    }).then(function (result) {
        var response = (result && result.response) || {};
        var entry = response["weather.pirateweather"] || {};
        self.forecast = (entry.forecast || []).slice(0, 7).map(function (d) {
            return {
                at: Date.parse(d.datetime),
                condition: d.condition || "",
                high: numOrNull(d.temperature),
                low: numOrNull(d.templow),
                rain: numOrNull(d.precipitation_probability)
            };
        });
        self.onUpdate();
    }).catch(function () {});
};

/* ---- helpers --------------------------------------------------------------- */

function byKey(key) {
    for (var i = 0; i < ZONES.length; i++) {
        if (ZONES[i].key === key) {
            return ZONES[i];
        }
    }
    return null;
}

function numOrNull(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
}

export { ClimateFeeds, HOME, LIMITS, ROOM_TEMPS };
