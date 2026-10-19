/* Data for the Cameras screen.
 *
 * Four cameras, their detections, their stream URLs, and a detection log
 * seeded from Home Assistant history.
 *
 * Every entity named here was read off the live instance, not guessed. The
 * house runs Frigate for all four feeds plus the Reolink integration on the
 * doorbell, which is why the doorbell is the only camera with vehicle and pet
 * sensors: Frigate on this install only tracks "person" and "all", while
 * Reolink's own AI reports person, vehicle and pet separately. Cameras with no
 * vehicle or pet sensor show no vehicle or pet row rather than a dead one.
 *
 * camera.front_door_fluent is the same doorbell as camera.reolink_doorbell and
 * is deliberately absent. camera.a1_03919d460402690_camera is the 3D printer
 * and is excluded.
 */

/* Kinds in the order they outrank each other. A person standing in front of a
 * camera that is also reporting motion reads as PERSON, not MOTION. */
var KIND_ORDER = ["person", "vehicle", "visitor", "pet", "object", "motion"];

/* Orange is for the kinds that need Jovan, per rule 10 in BUILD.md. Motion,
 * pets and unclassified objects are green. */
var KIND_LEVEL = {
    person: "alert",
    vehicle: "alert",
    visitor: "alert",
    pet: "motion",
    object: "motion",
    motion: "motion"
};

var KIND_LABEL = {
    person: "PERSON DETECTED",
    vehicle: "VEHICLE DETECTED",
    visitor: "DOORBELL PRESSED",
    pet: "PET DETECTED",
    object: "OBJECT DETECTED",
    motion: "MOTION DETECTED"
};

var KIND_SHORT = {
    person: "person",
    vehicle: "vehicle",
    visitor: "doorbell",
    pet: "pet",
    object: "object",
    motion: "motion"
};

/* The four cameras, in the order they sit in the grid.
 *
 * detect: kind -> the binary sensors that report it. Several entities per kind
 * where Frigate publishes both a camera level sensor and a zone level one, so
 * a person in the driveway zone lights the Front Yard frame as well.
 * recording: the switch that says whether this feed is being written to disk.
 */
var CAMERAS = [
    {
        id: "camera.front_yard_cam",
        num: "CAM 01",
        label: "Front Yard",
        view: "Driveway View",
        recording: "switch.front_yard_cam_recordings",
        detectSwitch: "switch.front_yard_cam_detect",
        detect: {
            person: ["binary_sensor.front_yard_cam_person_occupancy",
                     "binary_sensor.driveway_person_occupancy",
                     "binary_sensor.front_yard_person_occupancy"],
            object: ["binary_sensor.front_yard_cam_all_occupancy",
                     "binary_sensor.driveway_all_occupancy",
                     "binary_sensor.front_yard_all_occupancy"],
            motion: ["binary_sensor.front_yard_cam_motion"]
        }
    },
    {
        id: "camera.reolink_doorbell",
        num: "CAM 02",
        label: "Front Door",
        view: "Doorbell",
        recording: "switch.reolink_doorbell_recordings",
        detectSwitch: "switch.reolink_doorbell_detect",
        detect: {
            person: ["binary_sensor.reolink_doorbell_person_occupancy",
                     "binary_sensor.front_door_person"],
            vehicle: ["binary_sensor.front_door_vehicle"],
            pet: ["binary_sensor.front_door_pet"],
            visitor: ["binary_sensor.front_door_visitor"],
            object: ["binary_sensor.reolink_doorbell_all_occupancy"],
            motion: ["binary_sensor.reolink_doorbell_motion",
                     "binary_sensor.front_door_motion"]
        }
    },
    {
        id: "camera.garage_cam",
        num: "CAM 03",
        label: "Garage",
        view: "Bay",
        recording: "switch.garage_cam_recordings",
        detectSwitch: "switch.garage_cam_detect",
        detect: {
            person: ["binary_sensor.garage_cam_person_occupancy"],
            object: ["binary_sensor.garage_cam_all_occupancy"],
            motion: ["binary_sensor.garage_cam_motion"]
        }
    },
    {
        id: "camera.back_door_cam",
        num: "CAM 04",
        label: "Back Yard",
        view: "Back Door",
        recording: "switch.back_door_cam_recordings",
        detectSwitch: "switch.back_door_cam_detect",
        detect: {
            person: ["binary_sensor.back_door_cam_person_occupancy"],
            object: ["binary_sensor.back_door_cam_all_occupancy"],
            motion: ["binary_sensor.back_door_cam_motion"]
        }
    }
];

/* Two sensors firing for the same thing on the same camera inside this window
 * are one detection, not two. Without it the log is a wall of MOTION from
 * Frigate and the count for the day is meaningless. */
var COLLAPSE_MS = 60 * 1000;

var MAX_LOG = 250;
var HISTORY_EVERY = 10 * 60 * 1000;

/* entity_id -> { camera, kind }, built once from the table above so a live
 * message is a single lookup rather than a scan. */
var SENSOR_INDEX = (function () {
    var index = {};
    CAMERAS.forEach(function (cam) {
        Object.keys(cam.detect).forEach(function (kind) {
            cam.detect[kind].forEach(function (id) {
                /* An entity can only report one kind. Where both a camera and
                   a zone sensor exist they are separate entities, so there is
                   no clash to resolve. */
                index[id] = { camera: cam.id, kind: kind };
            });
        });
    });
    return index;
}());

function allSensorIds() {
    return Object.keys(SENSOR_INDEX);
}

function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function CameraFeeds(ha, areas, onUpdate) {
    this.ha = ha;
    this.areas = areas;
    this.onUpdate = onUpdate || function () {};
    this.log = [];
    this._seeded = false;
    this._timers = [];
    /* camera id -> { kind, at } for the glitch flash and the frame colour.
       Held here rather than in the view so a detection that fires while the
       screen is closed is still the current one when it opens. */
    this.flash = {};
}

CameraFeeds.prototype.start = function () {
    var self = this;
    this.refreshHistory();
    this._timers.push(setInterval(function () { self.refreshHistory(); }, HISTORY_EVERY));
};

CameraFeeds.prototype.stop = function () {
    this._timers.forEach(clearInterval);
    this._timers = [];
};

/* ---- the cameras ----------------------------------------------------------- */

CameraFeeds.prototype._state = function (id) {
    return (this.ha && this.ha.states) ? this.ha.states.get(id) : null;
};

CameraFeeds.prototype._isOn = function (id) {
    var s = this._state(id);
    return !!s && s.state === "on";
};

/* View models for the four frames, in grid order. */
CameraFeeds.prototype.cameras = function () {
    var self = this;

    return CAMERAS.map(function (cam) {
        var s = self._state(cam.id);
        var attrs = (s && s.attributes) || {};
        var live = !!s && s.state !== "unavailable" && s.state !== "unknown";

        /* Which kinds this camera can report at all, so the frame lists the
           detectors it really has. */
        var has = {};
        var on = {};
        var alert = null;

        KIND_ORDER.forEach(function (kind) {
            var ids = cam.detect[kind];
            if (!ids || !ids.length) {
                return;
            }
            /* A detector whose every sensor is unavailable is not a detector
               this camera currently has. */
            var usable = ids.filter(function (id) {
                var st = self._state(id);
                return st && st.state !== "unavailable";
            });
            if (!usable.length) {
                return;
            }
            has[kind] = true;
            on[kind] = usable.some(function (id) { return self._isOn(id); });
            if (on[kind] && !alert) {
                alert = kind;
            }
        });

        return {
            id: cam.id,
            num: cam.num,
            label: cam.label,
            view: cam.view,
            state: s ? s.state : "missing",
            live: live,
            recording: self._isOn(cam.recording),
            detecting: self._isOn(cam.detectSwitch),
            area: self.areas ? (self.areas.areaName(cam.id) || "") : "",
            accessToken: attrs.access_token || null,
            has: has,
            on: on,
            alert: alert,
            level: alert ? KIND_LEVEL[alert] : null,
            alertLabel: alert ? KIND_LABEL[alert] : null,
            /* An unavailable camera's last_changed is the moment it stopped
               reporting, which is exactly the last time it was seen. */
            lastSeen: live ? null : Date.parse(s ? (s.last_changed || s.last_updated) : "") || null,
            /* No detection source on this house carries box coordinates, so
               this is always empty and the frame draws no boxes. Frigate's
               HA binary sensors publish occupancy only; the boxes live on its
               MQTT event topic, which this dashboard does not read. Wired as a
               list so real boxes drop straight in if that ever changes. */
            boxes: boxesFor(s)
        };
    });
};

/* Real box data only. Returns [] unless an attribute actually carries one. */
function boxesFor(state) {
    var box = state && state.attributes ? state.attributes.box : null;
    if (!box || !box.length) {
        return [];
    }
    return [box];
}

CameraFeeds.prototype.camera = function (id) {
    var list = this.cameras();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
            return list[i];
        }
    }
    return null;
};

/* ---- stream URLs ------------------------------------------------------------ */

/* Every camera URL is absolute against Home Assistant, not the dashboard. The
 * dashboard is served from a different origin, so a relative path would ask
 * the static server for a stream it does not have. */
CameraFeeds.prototype.origin = function () {
    var config = window.HA_CONFIG || {};
    return (config.httpUrl || "").replace(/\/+$/, "");
};

/* HLS, the preferred path. Home Assistant hands back a signed, single use
 * path, so the long lived token never reaches a URL. */
CameraFeeds.prototype.hlsUrl = function (cameraId) {
    var self = this;
    if (!this.ha) {
        return Promise.reject(new Error("no connection"));
    }
    return this.ha.command({
        type: "camera/stream",
        entity_id: cameraId,
        format: "hls"
    }).then(function (result) {
        if (!result || !result.url) {
            throw new Error("no stream url");
        }
        return self.origin() + result.url;
    });
};

/* The MJPEG proxy, used when HLS will not play. The token on this URL is the
 * camera entity's own short lived access_token from its attributes, which
 * Home Assistant rotates, and not the long lived token. */
CameraFeeds.prototype.mjpegUrl = function (cameraId) {
    var s = this._state(cameraId);
    var token = s && s.attributes ? s.attributes.access_token : null;
    if (!token) {
        return null;
    }
    return this.origin() + "/api/camera_proxy_stream/" +
        encodeURIComponent(cameraId) + "?token=" + encodeURIComponent(token);
};

/* A single frame, used as the poster behind a stream that is still starting so
 * the frame is never empty. Same per entity token as the MJPEG path. */
CameraFeeds.prototype.stillUrl = function (cameraId) {
    var s = this._state(cameraId);
    var token = s && s.attributes ? s.attributes.access_token : null;
    if (!token) {
        return null;
    }
    return this.origin() + "/api/camera_proxy/" +
        encodeURIComponent(cameraId) + "?token=" + encodeURIComponent(token);
};

/* ---- the detection log ------------------------------------------------------ */

function cameraMeta(id) {
    for (var i = 0; i < CAMERAS.length; i++) {
        if (CAMERAS[i].id === id) {
            return CAMERAS[i];
        }
    }
    return null;
}

/* Fold a detection into the log, or bump the one already there when the same
 * camera reported the same kind moments ago. Returns true when the log moved. */
CameraFeeds.prototype._record = function (cameraId, kind, at) {
    var meta = cameraMeta(cameraId);
    if (!meta) {
        return false;
    }

    for (var i = 0; i < this.log.length; i++) {
        var row = this.log[i];
        if (row.camera === cameraId && row.kind === kind &&
            Math.abs(row.at - at) < COLLAPSE_MS) {
            row.count += 1;
            row.at = Math.max(row.at, at);
            return true;
        }
        /* The log is newest first, so once it is older than the window there
           is nothing left to collapse into. */
        if (row.at < at - COLLAPSE_MS) {
            break;
        }
    }

    this.log.unshift({
        at: at,
        camera: cameraId,
        num: meta.num,
        where: meta.label,
        kind: kind,
        short: KIND_SHORT[kind] || kind,
        level: KIND_LEVEL[kind] || "motion",
        count: 1
    });

    this.log.sort(function (a, b) { return b.at - a.at; });
    while (this.log.length > MAX_LOG) {
        this.log.pop();
    }
    return true;
};

/* Called for every message on the bus. Only the detection sensors of these
 * four cameras get through, so the log stays a camera log. */
CameraFeeds.prototype.note = function (m) {
    var id = m.entityId;
    if (!id) {
        return false;
    }

    /* A camera going offline or coming back changes the frames, so it is
       worth a redraw even though it is not a detection. */
    if (cameraMeta(id)) {
        return true;
    }

    var hit = SENSOR_INDEX[id];
    if (!hit) {
        return false;
    }
    if (m.state !== "on") {
        /* The frame still has to drop its highlight when a sensor clears. */
        return true;
    }

    var at = Date.now();
    this.flash[hit.camera] = { kind: hit.kind, at: at };
    this._record(hit.camera, hit.kind, at);
    return true;
};

/* Fill the log from the last 24 hours so the panel opens with real history
 * instead of sitting empty until something moves. Live events merge in ahead
 * of it by timestamp. Runs on every refresh, but only seeds once. */
CameraFeeds.prototype.seedLog = function (raw) {
    if (this._seeded) {
        return;
    }
    this._seeded = true;

    var self = this;
    var rows = [];

    Object.keys(raw).forEach(function (id) {
        var hit = SENSOR_INDEX[id];
        if (!hit) {
            return;
        }
        var prev = null;
        (raw[id] || []).forEach(function (row) {
            var v = row.s !== undefined ? row.s : row.state;
            var at = row.lu !== undefined ? row.lu * 1000
                : Date.parse(row.last_updated || row.last_changed);
            if (isFinite(at) && v === "on" && prev !== "on") {
                rows.push({ at: at, camera: hit.camera, kind: hit.kind });
            }
            prev = v;
        });
    });

    /* Oldest first, so _record collapses in the same direction a live run of
       events would. */
    rows.sort(function (a, b) { return a.at - b.at; });
    rows.forEach(function (r) { self._record(r.camera, r.kind, r.at); });
};

CameraFeeds.prototype.refreshHistory = function () {
    var self = this;
    var ids = allSensorIds();
    if (!ids.length || !this.ha) {
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
        self.seedLog(raw || {});
        self.onUpdate();
    }).catch(function () {
        /* History is a nicety. Without it the log fills from live events. */
    });
};

/* ---- the status row ---------------------------------------------------------- */

CameraFeeds.prototype.stats = function () {
    var list = this.cameras();
    var online = list.filter(function (c) { return c.live; }).length;
    var midnight = startOfToday();
    var today = 0;
    var lastPerson = null;

    for (var i = 0; i < this.log.length; i++) {
        var row = this.log[i];
        /* Collapsed detections, not raw sensor reports. Frigate publishes a
           camera level and a zone level sensor for the same person, so
           counting every report double counts the one event that happened.
           The x2 on a log row is where the raw number still shows. */
        if (row.at >= midnight) {
            today += 1;
        }
        if (!lastPerson && (row.kind === "person" || row.kind === "visitor")) {
            lastPerson = row;
        }
    }

    return {
        online: online,
        total: list.length,
        today: today,
        lastPerson: lastPerson,
        /* Loading until history has answered, so "0 detections today" is
           never shown while the real number is still in flight. */
        seeded: this._seeded
    };
};

export { CameraFeeds, CAMERAS, KIND_ORDER, KIND_LABEL, KIND_LEVEL, KIND_SHORT };
