/* Weather and energy feeds for the House screen bottom strip.
 *
 * Both read through the one Home Assistant connection in ha-source.js. This
 * module owns the querying and the arithmetic; HouseView only draws what it
 * hands back.
 *
 * On the energy side, a note on what these numbers are. This house has no
 * whole house meter: every power and energy sensor in Home Assistant is an
 * individual plug or circuit (servers, freezer, UPS, printers, outlets). So
 * the load figure is the sum of every monitored circuit, not the whole house,
 * and the panel says MONITORED so it is not mistaken for a utility reading.
 * Point this at a whole house clamp by filling in WHOLE_HOUSE_POWER and
 * WHOLE_HOUSE_ENERGY below, and the sums are skipped.
 */

var WHOLE_HOUSE_POWER = null;    // e.g. "sensor.house_power"
var WHOLE_HOUSE_ENERGY = null;   // e.g. "sensor.house_energy_today"

var WEATHER_EVERY = 10 * 60 * 1000;   // forecast refresh
var ENERGY_EVERY = 5 * 60 * 1000;     // today total refresh
var POWER_TICK = 10 * 1000;           // how often a new chart sample is taken
var CHART_MINUTES = 60;
var CHART_BUCKETS = 60;

function HouseFeeds(ha, onUpdate) {
    this.ha = ha;
    this.onUpdate = onUpdate || function () {};
    this.weather = null;
    this.energy = { watts: null, todayKwh: null, meters: 0, series: [], whole: false };
    this._timers = [];
}

HouseFeeds.prototype.start = function () {
    var self = this;
    if (!this.ha) {
        return;
    }

    this.refreshWeather();
    this.refreshEnergyTotal();
    this.loadPowerHistory();
    this.samplePower();

    this._timers.push(setInterval(function () { self.refreshWeather(); }, WEATHER_EVERY));
    this._timers.push(setInterval(function () { self.refreshEnergyTotal(); }, ENERGY_EVERY));
    this._timers.push(setInterval(function () { self.samplePower(); }, POWER_TICK));
};

HouseFeeds.prototype.stop = function () {
    for (var i = 0; i < this._timers.length; i++) {
        clearInterval(this._timers[i]);
    }
    this._timers = [];
};

/* ---- entity discovery ---------------------------------------------------- */

HouseFeeds.prototype._byClass = function (deviceClass, skipReturned) {
    var out = [];
    if (!this.ha || !this.ha.states) {
        return out;
    }
    this.ha.states.forEach(function (state, id) {
        if (id.indexOf("sensor.") !== 0) {
            return;
        }
        var attrs = state.attributes || {};
        if (attrs.device_class !== deviceClass) {
            return;
        }
        if (skipReturned && id.indexOf("returned") >= 0) {
            return;
        }
        out.push(id);
    });
    return out;
};

HouseFeeds.prototype.weatherEntity = function () {
    var found = null;
    if (!this.ha || !this.ha.states) {
        return null;
    }
    this.ha.states.forEach(function (state, id) {
        if (!found && id.indexOf("weather.") === 0) {
            found = id;
        }
    });
    return found;
};

/* ---- weather ------------------------------------------------------------- */

HouseFeeds.prototype.refreshWeather = function () {
    var self = this;
    var id = this.weatherEntity();
    if (!id) {
        return;
    }

    var state = this.ha.states.get(id);
    var attrs = (state && state.attributes) || {};

    var w = {
        entity: id,
        condition: state ? state.state : "",
        temp: num(attrs.temperature),
        feels: num(attrs.apparent_temperature),
        humidity: num(attrs.humidity),
        unit: attrs.temperature_unit || "",
        high: null,
        low: null,
        hours: []
    };
    this.weather = w;
    this.onUpdate();

    this._forecast(id, "daily").then(function (list) {
        if (list.length) {
            w.high = num(list[0].temperature);
            w.low = num(list[0].templow);
            self.onUpdate();
        }
    }).catch(function () {});

    this._forecast(id, "hourly").then(function (list) {
        var now = Date.now(), out = [], i;
        for (i = 0; i < list.length && out.length < 4; i++) {
            var at = Date.parse(list[i].datetime);
            if (isFinite(at) && at > now) {
                out.push({ at: at, temp: num(list[i].temperature), condition: list[i].condition });
            }
        }
        w.hours = out;
        self.onUpdate();
    }).catch(function () {});
};

HouseFeeds.prototype._forecast = function (entityId, type) {
    return this.ha.command({
        type: "call_service",
        domain: "weather",
        service: "get_forecasts",
        service_data: { type: type },
        target: { entity_id: entityId },
        return_response: true
    }).then(function (result) {
        var response = (result && result.response) || {};
        var entry = response[entityId] || {};
        return entry.forecast || [];
    });
};

/* ---- energy -------------------------------------------------------------- */

/* Current draw, summed from whatever is reporting right now. */
HouseFeeds.prototype.currentWatts = function () {
    if (WHOLE_HOUSE_POWER) {
        var one = this.ha.states.get(WHOLE_HOUSE_POWER);
        var single = one ? toWatts(one) : NaN;
        return isFinite(single) ? single : null;
    }

    var ids = this._byClass("power", false);
    var total = 0, seen = 0, i, watts;
    for (i = 0; i < ids.length; i++) {
        watts = toWatts(this.ha.states.get(ids[i]));
        if (isFinite(watts)) {
            total += watts;
            seen++;
        }
    }
    this.energy.meters = seen;
    return seen ? total : null;
};

/* Pull an hour of history once, so the chart has a shape before the page has
   been open for an hour. Each sensor is stepped forward through the buckets,
   because a sensor only appears in history when it changes. */
HouseFeeds.prototype.loadPowerHistory = function () {
    var self = this;
    var ids = WHOLE_HOUSE_POWER ? [WHOLE_HOUSE_POWER] : this._byClass("power", false);
    if (!ids.length) {
        return;
    }

    var end = Date.now();
    var start = end - CHART_MINUTES * 60 * 1000;
    var width = (end - start) / CHART_BUCKETS;

    this.ha.command({
        type: "history/history_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true
    }).then(function (history) {
        var sums = new Array(CHART_BUCKETS);
        var counted = new Array(CHART_BUCKETS);
        var b;
        for (b = 0; b < CHART_BUCKETS; b++) {
            sums[b] = 0;
            counted[b] = false;
        }

        Object.keys(history).forEach(function (id) {
            var rows = history[id] || [];
            var value = NaN;
            var r = 0;
            for (b = 0; b < CHART_BUCKETS; b++) {
                var edge = start + (b + 1) * width;
                while (r < rows.length && stamp(rows[r]) <= edge) {
                    var v = parseFloat(rows[r].s !== undefined ? rows[r].s : rows[r].state);
                    if (isFinite(v)) {
                        value = v;
                    }
                    r++;
                }
                if (isFinite(value)) {
                    sums[b] += value;
                    counted[b] = true;
                }
            }
        });

        var series = [];
        for (b = 0; b < CHART_BUCKETS; b++) {
            series.push(counted[b] ? sums[b] : null);
        }
        self.energy.series = series;
        self.onUpdate();
    }).catch(function () {});
};

/* One live sample, appended to the chart. */
HouseFeeds.prototype.samplePower = function () {
    var watts = this.currentWatts();
    this.energy.watts = watts;
    this.energy.whole = !!WHOLE_HOUSE_POWER;

    if (watts !== null) {
        this.energy.series.push(watts);
        while (this.energy.series.length > CHART_BUCKETS) {
            this.energy.series.shift();
        }
    }
    this.onUpdate();
};

/* Today's total. The meters here are lifetime total_increasing counters, so
   today is the last reading minus the reading at midnight. A counter that
   went backwards was reset during the day, and its current value is already
   the day's total. */
HouseFeeds.prototype.refreshEnergyTotal = function () {
    var self = this;
    var ids = WHOLE_HOUSE_ENERGY ? [WHOLE_HOUSE_ENERGY] : this._byClass("energy", true);
    if (!ids.length) {
        return;
    }

    if (WHOLE_HOUSE_ENERGY) {
        var one = this.ha.states.get(WHOLE_HOUSE_ENERGY);
        var value = one ? parseFloat(one.state) : NaN;
        this.energy.todayKwh = isFinite(value) ? value : null;
        this.onUpdate();
        return;
    }

    var midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    this.ha.command({
        type: "history/history_during_period",
        start_time: midnight.toISOString(),
        end_time: new Date().toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true
    }).then(function (history) {
        var total = 0, meters = 0;
        Object.keys(history).forEach(function (id) {
            var rows = history[id] || [];
            if (rows.length < 2) {
                return;
            }
            var first = parseFloat(rows[0].s !== undefined ? rows[0].s : rows[0].state);
            var tail = rows[rows.length - 1];
            var last = parseFloat(tail.s !== undefined ? tail.s : tail.state);
            if (!isFinite(first) || !isFinite(last)) {
                return;
            }
            total += last >= first ? last - first : last;
            meters++;
        });
        self.energy.todayKwh = meters ? total : null;
        self.onUpdate();
    }).catch(function () {});
};

/* ---- helpers ------------------------------------------------------------- */

function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
}

function stamp(row) {
    if (row.lu !== undefined) {
        return row.lu * 1000;
    }
    return Date.parse(row.last_updated || row.last_changed || 0);
}

/* Normalise to watts, since some integrations report kW. */
function toWatts(state) {
    if (!state) {
        return NaN;
    }
    var value = parseFloat(state.state);
    if (!isFinite(value)) {
        return NaN;
    }
    var unit = (state.attributes && state.attributes.unit_of_measurement) || "W";
    return unit.toLowerCase() === "kw" ? value * 1000 : value;
}

export { HouseFeeds };
