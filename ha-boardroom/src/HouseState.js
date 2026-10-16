/* Live model of the house, shared by every widget on the House screen.
 *
 * One place that folds Home Assistant messages into per room state, so the
 * rooms table, the room details pane, the stat row and the timeline all read
 * the same numbers instead of each keeping their own tally.
 *
 * Rule 10 holds: orange only ever means a problem, green is motion.
 */
import { ROOMS } from "../../app/js/rooms.js";
import { Severity } from "../../app/js/message.js";

var MOTION_HOLD = 90000;   // how long a room counts as recently active, ms
var MAX_EVENTS = 400;      // ring buffer for the timeline

function HouseState() {
    this.rooms = {};
    this.order = [];
    this.events = [];
    this.changed = 0;

    for (var i = 0; i < ROOMS.length; i++) {
        var r = ROOMS[i];
        this.rooms[r.key] = {
            key: r.key,
            name: r.name,
            level: r.level,
            estimated: !!r.est,
            lightsOn: {},
            alerts: {},
            devices: {},
            temp: null,
            humidity: null,
            lastMotion: 0,
            seen: false
        };
        this.order.push(r.key);
    }
}

HouseState.prototype.message = function (m, isSeed) {
    /* The initial state dump is the house as it already is, not 1481 things
       that just happened, so it must not land on the timeline. */
    if (!isSeed) {
        this.events.push({ at: Date.now(), severity: m.severity, room: m.room, title: m.title });
        if (this.events.length > MAX_EVENTS) {
            this.events.shift();
        }
    }

    if (!m.room) {
        this.changed++;
        return;
    }

    var slot = this.rooms[m.room];
    if (!slot) {
        return;
    }
    slot.seen = true;

    if (m.severity === Severity.ALERT) {
        slot.alerts[m.entityId] = m.title;
    } else {
        delete slot.alerts[m.entityId];
    }

    if (m.severity === Severity.MOTION) {
        slot.lastMotion = Date.now();
    }

    if (m.type === "light" || m.type === "switch") {
        if (m.state === "on") {
            slot.lightsOn[m.entityId] = m.title;
        } else {
            delete slot.lightsOn[m.entityId];
        }
    }

    if (m.type === "sensor" && m.username === "temperature") {
        var t = Number(m.state);
        if (isFinite(t)) {
            slot.temp = t;
        }
    }

    if (m.type === "sensor" && m.username === "humidity") {
        var h = Number(m.state);
        if (isFinite(h)) {
            slot.humidity = h;
        }
    }

    /* Keep a short device list per room for the details pane. Sensors that
       already show as temperature or humidity are left out to avoid repeating
       the same reading twice. */
    if (m.type !== "sensor" || (m.username !== "temperature" && m.username !== "humidity")) {
        slot.devices[m.entityId] = {
            title: m.title,
            type: m.type,
            state: m.state,
            unit: m.unit,
            severity: m.severity
        };
    }

    this.changed++;
};

function count(o) {
    var n = 0, k;
    for (k in o) {
        if (o.hasOwnProperty(k)) { n++; }
    }
    return n;
}

HouseState.prototype.roomStats = function (key) {
    var s = this.rooms[key];
    return {
        key: s.key,
        name: s.name,
        level: s.level,
        estimated: s.estimated,
        temp: s.temp,
        humidity: s.humidity,
        lights: count(s.lightsOn),
        lightNames: s.lightsOn,
        alerts: count(s.alerts),
        alertNames: s.alerts,
        devices: s.devices,
        motion: (Date.now() - s.lastMotion) < MOTION_HOLD,
        seen: s.seen
    };
};

/* Rooms that have actually reported something, so empty closets do not pad
   the table with blank rows. */
HouseState.prototype.liveRooms = function () {
    var out = [], i, st;
    for (i = 0; i < this.order.length; i++) {
        st = this.roomStats(this.order[i]);
        if (st.seen) {
            out.push(st);
        }
    }
    return out;
};

/* Every room, including ones that have not reported yet, so the table fills
   the panel instead of stopping halfway down a tall screen. */
HouseState.prototype.allRooms = function () {
    var out = [];
    for (var i = 0; i < this.order.length; i++) {
        out.push(this.roomStats(this.order[i]));
    }
    return out;
};

HouseState.prototype.totals = function () {
    var lights = 0, alerts = 0, temps = [], live = 0;
    var rooms = this.liveRooms();
    for (var i = 0; i < rooms.length; i++) {
        lights += rooms[i].lights;
        alerts += rooms[i].alerts;
        if (rooms[i].temp !== null) {
            temps.push(rooms[i].temp);
        }
        live++;
    }
    var avg = temps.length
        ? temps.reduce(function (a, b) { return a + b; }, 0) / temps.length
        : null;
    return { lights: lights, alerts: alerts, avgTemp: avg, rooms: live };
};

export { HouseState };
