/* Home Assistant areas, and how they land on the 3D house.
 *
 * Every screen asks this module where an entity is. Nothing guesses a room
 * from a friendly name any more. Guessing was wrong often enough to matter:
 * the water heater leak sensor reads "Water Heater Leak" and is in the
 * Garage, the pantry motion sensor is in the Kitchen area, and three sensors
 * with "Closet" in the name are all filed under Loft.
 *
 * Resolution order for an entity, which is Home Assistant's own:
 *   1. the entity's own area_id, if it has one
 *   2. otherwise its device's area_id
 *   3. otherwise nothing, and the caller decides what to do
 *
 * The registries are fetched once per connection and cached. They need an
 * admin token, which the dashboard already uses.
 */

/* Home Assistant area_id to a room key in app/js/rooms.js.
 *
 * Only areas that correspond to a room in the model appear here. The outdoor
 * areas have no room by design: the model is the house, so a front yard
 * camera belongs at the edge of the house rather than inside a room.
 */
var AREA_TO_ROOM = {
    ak_s_room: "aks_room",
    bathroom_upstairs: "bath1",
    blu_s_bedroom: "loft",            // the Loft area, named blu_s_bedroom in HA
    garage: "garage",
    hallway: "hall0",
    kitchen: "kitchen",
    laundry_room: "laundry",
    living_room: "living",
    master_bedroom: "master_bed",
    office: "office",

    /* Confirmed by Jovan, and none of these could have been guessed from a
       name. The HA area called Oscar's Bedroom is Api's bathroom, which is
       the Hall Bath. Print Room is Jovan's Closet upstairs, by the stairs.
       Server Room is the small closet off the level 0 hall. */
    api_s_bedroom: "hall_bath",
    print_room: "jovan_closet",
    server_room: "server_room"
};

/* Entities whose own area is wrong for where the reading belongs, and
   entities with no area at all. Area lookup comes first, then this list, and
   nothing is ever guessed from a friendly name.
   Every line here is a line Jovan can delete once the entity is given a real
   area in Home Assistant. */
var OVERRIDES = {
    /* The Oscar's Bedroom area holds both the bathroom leak sensor and a
       bedroom temperature sensor. The area maps to the Hall Bath, so the
       bedroom reading is sent back to the bedroom. */
    "sensor.oscar_s_bedroom_temp_sensor_temperature": "apis_room",
    "sensor.oscar_s_bedroom_temp_sensor_humidity": "apis_room",

    /* No area in Home Assistant. Plant sensors used by the Climate screen. */
    "sensor.sm4_snake_plant_dining_room_temperature": "dining",
    "sensor.sm3_aglaonema_evergreen_office_temperature": "office",

    /* No area in Home Assistant. The doorbell and its detections, which sit
       at the front door rather than in the hallway the camera is filed under. */
    "camera.reolink_doorbell": "porch",
    "binary_sensor.reolink_doorbell_motion": "porch",
    "binary_sensor.reolink_doorbell_person_occupancy": "porch",
    "binary_sensor.reolink_doorbell_all_occupancy": "porch",
    "binary_sensor.front_door_motion": "porch",
    "binary_sensor.front_door_person": "porch",
    "binary_sensor.front_door_vehicle": "porch",
    "binary_sensor.front_door_pet": "porch",
    "camera.front_door_fluent": "porch"
};

/* Areas that exist in Home Assistant but have no room in the model, so an
   entity in one appears in lists and never on the house. */
var AREAS_LIST_ONLY = { attic: "Attic" };

/* Areas that are outside the house. They resolve to no room, and screens
   place them around the edge of the model instead of inside it. */
var OUTDOOR_AREAS = {
    front_yard: "front",
    back_yard: "back",
    outdoor: "front",
    herb_garden: "back",
    ornamental_garden: "front"
};

function Areas(ha) {
    this.ha = ha;
    this.areas = {};        // area_id -> { area_id, name, floor_id }
    this.byEntity = {};     // entity_id -> area_id
    this.loaded = false;
    this._loading = null;
}

/* Fetch once, reuse. Returns a promise so a caller can wait for it, but every
   lookup is safe before it resolves and simply returns nothing. */
Areas.prototype.load = function () {
    var self = this;
    if (this._loading) {
        return this._loading;
    }

    this._loading = Promise.all([
        this.ha.command({ type: "config/area_registry/list" }),
        this.ha.command({ type: "config/device_registry/list" }),
        this.ha.command({ type: "config/entity_registry/list" })
    ]).then(function (results) {
        var areas = results[0], devices = results[1], entities = results[2];

        self.areas = {};
        areas.forEach(function (a) { self.areas[a.area_id] = a; });

        var deviceArea = {};
        devices.forEach(function (d) { deviceArea[d.id] = d.area_id || null; });

        self.byEntity = {};
        entities.forEach(function (e) {
            var area = e.area_id || deviceArea[e.device_id] || null;
            if (area) {
                self.byEntity[e.entity_id] = area;
            }
        });

        self.loaded = true;
        return self;
    }).catch(function (err) {
        /* Without the registries every screen still works, it just falls back
           to having no area, so this is logged and not thrown. The promise is
           cleared so a later call can try again: the usual cause is being
           called before the socket has authenticated. */
        console.warn("areas: could not read the registries, " +
            (err && err.message ? err.message : "unknown error"));
        self.loaded = false;
        self._loading = null;
        return self;
    });

    return this._loading;
};

/* area_id for an entity, or null. */
Areas.prototype.areaOf = function (entityId) {
    return this.byEntity[entityId] || null;
};

/* Human readable area name for an entity, or "" when it has none. */
Areas.prototype.areaName = function (entityId) {
    var id = this.areaOf(entityId);
    var area = id ? this.areas[id] : null;
    return area ? area.name : "";
};

/* Room key on the 3D house for an entity, or null when its area has no room
   or it has no area at all. */
Areas.prototype.roomOf = function (entityId) {
    var id = this.areaOf(entityId);
    var fromArea = id ? AREA_TO_ROOM[id] : null;
    if (fromArea) {
        return fromArea;
    }
    return OVERRIDES[entityId] || null;
};

/* True when the entity belongs to an area that has no room, so a screen can
   list it under the area name instead of dropping it. */
Areas.prototype.listOnly = function (entityId) {
    var id = this.areaOf(entityId);
    return id && AREAS_LIST_ONLY[id] ? AREAS_LIST_ONLY[id] : null;
};

/* Everything currently placed by hand, so the list can be printed and worked
   through in Home Assistant until it is empty. */
Areas.prototype.overrides = function () {
    return OVERRIDES;
};

/* "front" or "back" for an entity in an outdoor area, else null. Screens use
   this to put a camera or a yard sensor against the right side of the house
   rather than inside it. */
Areas.prototype.outdoorOf = function (entityId) {
    var id = this.areaOf(entityId);
    return id ? (OUTDOOR_AREAS[id] || null) : null;
};

/* Every entity the registries place in a given area. */
Areas.prototype.entitiesIn = function (areaId) {
    var out = [];
    for (var id in this.byEntity) {
        if (this.byEntity.hasOwnProperty(id) && this.byEntity[id] === areaId) {
            out.push(id);
        }
    }
    return out;
};

/* Which areas have no room, and which rooms have no area. Used to report the
   gap rather than let it go unnoticed. */
Areas.prototype.coverage = function (roomKeys) {
    var mappedRooms = {};
    var areasWithoutRoom = [];
    var id;

    for (id in this.areas) {
        if (!this.areas.hasOwnProperty(id)) {
            continue;
        }
        if (AREA_TO_ROOM[id]) {
            mappedRooms[AREA_TO_ROOM[id]] = true;
        } else if (!OUTDOOR_AREAS[id]) {
            areasWithoutRoom.push(this.areas[id].name);
        }
    }

    var roomsWithoutArea = (roomKeys || []).filter(function (k) {
        return !mappedRooms[k];
    });

    return { areasWithoutRoom: areasWithoutRoom, roomsWithoutArea: roomsWithoutArea };
};

export { Areas, AREA_TO_ROOM, OUTDOOR_AREAS, OVERRIDES, AREAS_LIST_ONLY };
