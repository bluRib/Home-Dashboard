/* Data for the Security screen.
 *
 * Which entity belongs where comes from Home Assistant's area registry
 * through Areas.js, never from a friendly name. The only things hand placed
 * here are map coordinates, because Home Assistant has no idea where a door
 * is in centimetres.
 */

import { ROOMS, center } from "../../app/js/rooms.js";

/* Appliance doors and the printer camera are not home security. */
var EXCLUDE = [
    "binary_sensor.garage_deep_freezer_door_intrusion",
    "camera.a1_03919d460402690_camera"
];

/* Interior doors stay off the map. The hall to garage door is the exception
   Jovan asked for, because it is a way into the house. */
var INTERIOR_DOORS_OFF_MAP = ["binary_sensor.loft_bathroom_door_intrusion"];

/* Where things sit on the model, in Sweet Home 3D centimetres. Home Assistant
   knows the room but not the spot, so the doors and the cameras are placed by
   hand against the geometry in BUILD.md. Everything else is placed at the
   centre of the room its area resolves to. */
var DOOR_SPOTS = {
    "binary_sensor.hallway_front_door_intrusion":
        { x: 835, z: -10, level: 0, label: "Front Door", axis: "x" },
    "binary_sensor.hallway_garage_door_intrusion":
        { x: 695, z: -300, level: 0, label: "Hall to Garage", axis: "z" },
    "binary_sensor.living_room_back_door_intrusion":
        { x: 1010, z: -1400, level: 0, label: "Back Door", axis: "x" },
    "binary_sensor.garage_garage_door_intrusion":
        { x: 340, z: -8, level: 0, label: "Garage Door", axis: "x" }
};

var CAMERA_SPOTS = {
    "camera.reolink_doorbell":
        { x: 815, z: 120, level: 0, heading: 0, label: "Doorbell" },
    "camera.front_yard_cam":
        { x: 620, z: 150, level: 0, heading: 20, label: "Front Yard" },
    "camera.garage_cam":
        { x: 340, z: 40, level: 0, heading: 0, label: "Garage" },
    "camera.back_door_cam":
        { x: 1010, z: -1960, level: 0, heading: 180, label: "Back Door" }
};

/* The doorbell reports people, vehicles and pets separately. They are its
   events, not four separate sensors worth listing. */
var DOORBELL_EVENTS = [
    "binary_sensor.front_door_person",
    "binary_sensor.front_door_vehicle",
    "binary_sensor.front_door_pet",
    "binary_sensor.front_door_motion",
    "binary_sensor.reolink_doorbell_motion",
    "binary_sensor.reolink_doorbell_person_occupancy",
    "binary_sensor.reolink_doorbell_all_occupancy"
];

var HISTORY_EVERY = 10 * 60 * 1000;
var MAX_LOG = 200;

function SecurityFeeds(ha, areas, onUpdate) {
    this.ha = ha;
    this.areas = areas;
    this.onUpdate = onUpdate || function () {};
    this.log = [];
    this.activity = null;
    this.lastEvent = null;     // { entityId, at, room } drives the live camera
    this._timers = [];
}

SecurityFeeds.prototype.start = function () {
    var self = this;
    this.refreshActivity();
    this._timers.push(setInterval(function () { self.refreshActivity(); }, HISTORY_EVERY));
};

SecurityFeeds.prototype.stop = function () {
    this._timers.forEach(clearInterval);
    this._timers = [];
};

/* ---- selecting the entities this screen cares about ----------------------- */

SecurityFeeds.prototype._pick = function (test) {
    var out = [];
    if (!this.ha || !this.ha.states) {
        return out;
    }
    this.ha.states.forEach(function (state, id) {
        if (EXCLUDE.indexOf(id) >= 0) {
            return;
        }
        if (test(state, id)) {
            out.push(state);
        }
    });
    return out;
};

function klass(state) {
    return (state.attributes && state.attributes.device_class) || "";
}

function nameOf(state) {
    return ((state.attributes && state.attributes.friendly_name) || state.entity_id).trim();
}

/* How long the entity has held its current state. */
function heldFor(state) {
    var since = Date.parse(state.last_changed || state.last_updated);
    return isFinite(since) ? Date.now() - since : null;
}

SecurityFeeds.prototype._place = function (state) {
    var id = state.entity_id;
    var room = this.areas.roomOf(id);
    var listOnly = this.areas.listOnly(id);
    return {
        id: id,
        name: nameOf(state),
        state: state.state,
        deviceClass: klass(state),
        room: room,
        area: this.areas.areaName(id) || (listOnly || ""),
        listOnly: !!listOnly,
        held: heldFor(state)
    };
};

/* Doors and the garage door, the ways into the house. */
SecurityFeeds.prototype.doors = function () {
    var self = this;
    return this._pick(function (s, id) {
        return id.indexOf("binary_sensor.") === 0 &&
            (klass(s) === "door" || klass(s) === "garage_door" ||
             klass(s) === "window" || klass(s) === "opening") &&
            INTERIOR_DOORS_OFF_MAP.indexOf(id) < 0;
    }).map(function (s) {
        var item = self._place(s);
        item.open = s.state === "on";
        item.garage = klass(s) === "garage_door";
        item.spot = DOOR_SPOTS[s.entity_id] || null;
        return item;
    }).sort(function (a, b) {
        return (b.open ? 1 : 0) - (a.open ? 1 : 0) || a.name.localeCompare(b.name);
    });
};

SecurityFeeds.prototype.leaks = function () {
    var self = this;
    return this._pick(function (s, id) {
        return id.indexOf("binary_sensor.") === 0 && klass(s) === "moisture";
    }).map(function (s) {
        var item = self._place(s);
        item.wet = s.state === "on";
        return item;
    }).sort(function (a, b) {
        return (b.wet ? 1 : 0) - (a.wet ? 1 : 0) || a.name.localeCompare(b.name);
    });
};

/* Interior motion only. The camera detections are the cameras' own events and
   are listed with them, not as room motion. */
SecurityFeeds.prototype.motion = function () {
    var self = this;
    return this._pick(function (s, id) {
        if (id.indexOf("binary_sensor.") !== 0) {
            return false;
        }
        if (klass(s) !== "motion" && klass(s) !== "occupancy") {
            return false;
        }
        if (DOORBELL_EVENTS.indexOf(id) >= 0) {
            return false;
        }
        return !/_cam_|driveway|front_yard/.test(id);
    }).map(function (s) {
        var item = self._place(s);
        item.active = s.state === "on";
        return item;
    }).sort(function (a, b) {
        return (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.name.localeCompare(b.name);
    });
};

SecurityFeeds.prototype.cameras = function () {
    var self = this;
    return this._pick(function (s, id) {
        return id.indexOf("camera.") === 0 && id !== "camera.front_door_fluent";
    }).map(function (s) {
        var item = self._place(s);
        item.spot = CAMERA_SPOTS[s.entity_id] || null;
        item.picture = (s.attributes && s.attributes.entity_picture) || null;
        return item;
    });
};

/* Alarmo, or a clear statement that there is nothing usable. */
SecurityFeeds.prototype.alarm = function () {
    var s = this.ha && this.ha.states ? this.ha.states.get("alarm_control_panel.alarmo") : null;
    if (!s || s.state === "unavailable" || s.state === "unknown") {
        return { configured: false, state: s ? s.state : "missing" };
    }
    var a = s.attributes || {};
    var f = a.supported_features || 0;
    var modes = [];
    if (f & 1) { modes.push({ key: "arm_home", label: "Arm Home" }); }
    if (f & 2) { modes.push({ key: "arm_away", label: "Arm Away" }); }
    if (f & 8) { modes.push({ key: "arm_night", label: "Arm Night" }); }
    return {
        configured: modes.length > 0,
        state: s.state,
        modes: modes,
        codeArmRequired: !!a.code_arm_required,
        codeFormat: a.code_format || null,
        openSensors: a.open_sensors || null,
        held: heldFor(s)
    };
};

/* Nothing on this screen is a lock, but if one is ever added it appears. */
SecurityFeeds.prototype.locks = function () {
    var self = this;
    return this._pick(function (s, id) {
        return id.indexOf("lock.") === 0;
    }).map(function (s) {
        var item = self._place(s);
        item.locked = s.state === "locked";
        return item;
    });
};

/* ---- acting --------------------------------------------------------------- */

SecurityFeeds.prototype.setAlarm = function (service, code, done) {
    var data = {};
    if (code) {
        data.code = code;
    }
    this.ha.callService("alarm_control_panel", "alarm_" + service, data,
        { entity_id: "alarm_control_panel.alarmo" })
        .then(function () { done(service.replace("_", " ") + " sent"); })
        .catch(function (e) { done("alarm " + service + " failed: " + e.message, true); });
};

SecurityFeeds.prototype.setLock = function (entityId, lock, done) {
    this.ha.callService("lock", lock ? "lock" : "unlock", {}, { entity_id: entityId })
        .then(function () { done((lock ? "Locked " : "Unlocked ") + entityId); })
        .catch(function (e) { done("lock failed: " + e.message, true); });
};

/* ---- the event log --------------------------------------------------------- */

/* Called for every message the bus hands over. Only the things this screen is
   about reach the log, so it stays readable instead of scrolling with power
   meter updates. */
SecurityFeeds.prototype.note = function (m) {
    var id = m.entityId;
    if (!id || EXCLUDE.indexOf(id) >= 0) {
        return false;
    }

    var state = this.ha.states.get(id);
    var cls = state ? klass(state) : "";
    var kind = null;

    if (cls === "moisture") {
        kind = m.state === "on" ? "leak" : "dry";
    } else if (cls === "door" || cls === "garage_door" || cls === "window" || cls === "opening") {
        if (INTERIOR_DOORS_OFF_MAP.indexOf(id) >= 0) {
            return false;
        }
        kind = m.state === "on" ? "opened" : "closed";
    } else if (cls === "motion" || cls === "occupancy") {
        if (m.state !== "on") {
            return false;
        }
        kind = "motion";
    } else if (id.indexOf("alarm_control_panel.") === 0) {
        kind = "alarm " + m.state;
    } else {
        return false;
    }

    var room = this.areas.roomOf(id);
    var where = this.areas.areaName(id) || (room ? roomName(room) : "");

    this.log.unshift({
        at: Date.now(),
        id: id,
        name: nameOf(state || { entity_id: id, attributes: {} }),
        where: where,
        kind: kind,
        severity: kind === "leak" ? "alert"
            : kind === "opened" ? "alert"
            : kind === "motion" ? "motion" : "normal"
    });
    while (this.log.length > MAX_LOG) {
        this.log.pop();
    }

    if (kind === "motion" || kind === "opened" || kind === "leak") {
        this.lastEvent = { entityId: id, at: Date.now(), room: room };
    }
    return true;
};

function roomName(key) {
    for (var i = 0; i < ROOMS.length; i++) {
        if (ROOMS[i].key === key) {
            return ROOMS[i].name;
        }
    }
    return "";
}

/* ---- 24 hours of door opens and motion ------------------------------------- */

SecurityFeeds.prototype.refreshActivity = function () {
    var self = this;
    var ids = this.doors().map(function (d) { return d.id; })
        .concat(this.motion().map(function (d) { return d.id; }));
    if (!ids.length) {
        return;
    }

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
        var doorsBy = new Array(24), motionBy = new Array(24), i;
        for (i = 0; i < 24; i++) {
            doorsBy[i] = 0;
            motionBy[i] = 0;
        }
        var doorIds = {};
        self.doors().forEach(function (d) { doorIds[d.id] = true; });

        Object.keys(raw).forEach(function (id) {
            var rows = raw[id] || [];
            var prev = null;
            rows.forEach(function (row) {
                var v = row.s !== undefined ? row.s : row.state;
                var at = row.lu !== undefined ? row.lu * 1000
                    : Date.parse(row.last_updated || row.last_changed);
                if (!isFinite(at)) {
                    return;
                }
                /* Only count the transition into on, not every report. */
                if (v === "on" && prev !== "on") {
                    var bucket = Math.floor((at - start) / 3600000);
                    if (bucket >= 0 && bucket < 24) {
                        if (doorIds[id]) {
                            doorsBy[bucket] += 1;
                        } else {
                            motionBy[bucket] += 1;
                        }
                    }
                }
                prev = v;
            });
        });

        self.activity = { start: start, end: end, doors: doorsBy, motion: motionBy };
        self.onUpdate();
    }).catch(function () {});
};

/* ---- helpers for the view --------------------------------------------------- */

function roomCentre(key) {
    for (var i = 0; i < ROOMS.length; i++) {
        if (ROOMS[i].key === key) {
            return center(ROOMS[i]);
        }
    }
    return null;
}

export { SecurityFeeds, DOOR_SPOTS, CAMERA_SPOTS, roomCentre, heldFor };
