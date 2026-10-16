// Home Assistant state change to dashboard message.
//
// Encom's widgets all expect one message shape (BUILD.md section 5), so every
// HA event is converted to it once, here, and the widgets stay unmodified.
// Fields Encom used for GitHub and Wikipedia traffic are reused:
//
//   stream      which system folder this belongs to (climate, security, ...)
//   location    room name
//   type        HA domain (light, binary_sensor, sensor, lock, cover, ...)
//   title       friendly name
//   size        numeric state when there is one, else 0
//   popularity  how much the value moved, so charts have something to plot
//   latlon      a fixed point per room, for the globe widget
//
// Added for this project:
//   entityId, state, previous, unit, severity, room, level, at
//
// severity follows project rule 10: orange means a problem, green is motion,
// cyan is normal. Nothing else may use orange.

import { roomForEntity, center, BOUNDS } from './rooms.js';

export const Severity = {
  NORMAL: 'normal',
  MOTION: 'motion',
  ALERT: 'alert',
};

// Which system folder owns each HA domain.
const DOMAIN_SYSTEM = {
  climate: 'climate',
  water_heater: 'climate',
  fan: 'climate',
  humidifier: 'climate',

  lock: 'security',
  alarm_control_panel: 'security',
  binary_sensor: 'security',

  camera: 'cameras',
  image_processing: 'cameras',

  sensor: 'energy',

  light: 'house',
  switch: 'house',
  cover: 'house',
  media_player: 'house',
  vacuum: 'house',
  scene: 'house',

  device_tracker: 'network',
  update: 'network',
  button: 'network',
};

// binary_sensor device classes that belong to a system other than security.
const CLASS_SYSTEM = {
  motion: 'security',
  occupancy: 'security',
  door: 'security',
  window: 'security',
  garage_door: 'security',
  opening: 'security',
  smoke: 'security',
  gas: 'security',
  carbon_monoxide: 'security',
  moisture: 'security',
  tamper: 'security',
  connectivity: 'network',
  battery: 'network',
  update: 'network',
  problem: 'network',
};

// sensor device classes that are climate readings, not energy ones.
const CLIMATE_CLASSES = new Set([
  'temperature', 'humidity', 'pressure', 'atmospheric_pressure',
  'carbon_dioxide', 'pm25', 'pm10', 'aqi', 'volatile_organic_compounds',
]);

const ENERGY_CLASSES = new Set([
  'energy', 'power', 'current', 'voltage', 'gas', 'water',
  'power_factor', 'apparent_power', 'reactive_power', 'monetary',
]);

// States that mean "this thing is a problem" for an opening or a lock.
const OPEN_STATES = new Set(['on', 'open', 'opening', 'unlocked']);

// binary_sensor classes where "on" is a fault.
const FAULT_CLASSES = new Set([
  'smoke', 'gas', 'carbon_monoxide', 'moisture', 'problem', 'tamper', 'safety',
]);

// binary_sensor classes where "on" means something is open, which is the only
// other case worth orange. Everything else that reads "on" is reporting good
// news: connectivity on means connected, plug on means plugged in,
// battery_charging on means charging. Treating a bare "on" as a fault turned
// 8 healthy sensors into alerts.
const OPENING_CLASSES = new Set([
  'door', 'window', 'garage_door', 'opening',
]);

const MOTION_CLASSES = new Set(['motion', 'occupancy', 'presence']);

export function domainOf(entityId) {
  return entityId.split('.')[0];
}

export function systemFor(entityId, state) {
  const domain = domainOf(entityId);
  const cls = (state && state.attributes && state.attributes.device_class) || '';

  if (domain === 'binary_sensor') return CLASS_SYSTEM[cls] || 'security';
  if (domain === 'sensor') {
    if (CLIMATE_CLASSES.has(cls)) return 'climate';
    if (ENERGY_CLASSES.has(cls)) return 'energy';
    if (cls === 'battery' || cls === 'timestamp') return 'network';
    return 'energy';
  }
  return DOMAIN_SYSTEM[domain] || 'house';
}

export function severityFor(entityId, state) {
  if (!state) return Severity.NORMAL;

  const value = String(state.state || '').toLowerCase();
  const attrs = state.attributes || {};
  const cls = attrs.device_class || '';
  const domain = domainOf(entityId);

  // "unavailable" and "unknown" are deliberately NOT alerts. In this house
  // that is 266 of 1481 entities, and most of them are meant to read that
  // way: button and event entities have no state until something fires, and
  // plenty of sensors idle at unknown. Flagging them painted nearly every
  // room orange and buried the handful of things that are genuinely wrong.
  if (value === 'unavailable' || value === 'unknown') return Severity.NORMAL;

  // Low battery, whichever way it is reported.
  if (cls === 'battery') {
    if (domain === 'binary_sensor') return value === 'on' ? Severity.ALERT : Severity.NORMAL;
    const pct = Number(state.state);
    if (Number.isFinite(pct) && pct <= 20) return Severity.ALERT;
  }
  // Some integrations report the level as an attribute instead. Only treat a
  // real number as a reading: null and undefined would both coerce to 0 and
  // raise a false alert on every entity that lacks the attribute.
  if (attrs.battery_level !== undefined && attrs.battery_level !== null) {
    const level = Number(attrs.battery_level);
    if (Number.isFinite(level) && level <= 20) return Severity.ALERT;
  }

  if (domain === 'binary_sensor') {
    if (FAULT_CLASSES.has(cls)) return value === 'on' ? Severity.ALERT : Severity.NORMAL;
    if (MOTION_CLASSES.has(cls)) return value === 'on' ? Severity.MOTION : Severity.NORMAL;
    if (OPENING_CLASSES.has(cls)) return value === 'on' ? Severity.ALERT : Severity.NORMAL;
    // Anything else reading "on" is reporting a healthy state, not a fault.
    return Severity.NORMAL;
  }

  if (domain === 'cover') {
    return OPEN_STATES.has(value) ? Severity.ALERT : Severity.NORMAL;
  }

  if (domain === 'lock') {
    return value === 'unlocked' ? Severity.ALERT : Severity.NORMAL;
  }

  if (domain === 'alarm_control_panel') {
    return value.startsWith('triggered') || value === 'pending' ? Severity.ALERT : Severity.NORMAL;
  }

  return Severity.NORMAL;
}

// Place a room on the globe. The house is tiny next to a globe, so the
// footprint is spread across a visible patch rather than mapped to scale.
// Replace BASE with your real coordinates if you want the globe to point at
// the actual house.
const BASE = { lat: 35.2271, lon: -80.8431 };
const SPREAD = 0.9; // degrees across the whole footprint

function latlonFor(roomObj) {
  if (!roomObj) return { lat: BASE.lat, lon: BASE.lon };
  const c = center(roomObj);
  const fx = (c.x - BOUNDS.x[0]) / (BOUNDS.x[1] - BOUNDS.x[0]);
  const fz = (c.z - BOUNDS.z[0]) / (BOUNDS.z[1] - BOUNDS.z[0]);
  return {
    lat: BASE.lat + (fz - 0.5) * SPREAD,
    lon: BASE.lon + (fx - 0.5) * SPREAD,
  };
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Convert one state_changed event into a dashboard message.
// event: { entityId, oldState, newState, timeFired } from ha.js
export function toMessage(event) {
  const { entityId, oldState, newState } = event;
  const state = newState || oldState;
  const attrs = (state && state.attributes) || {};

  const roomObj = roomForEntity(state || entityId);
  const size = numeric(newState && newState.state);
  const previousSize = numeric(oldState && oldState.state);

  return {
    // Encom's fields
    stream: systemFor(entityId, state),
    latlon: latlonFor(roomObj),
    location: roomObj ? roomObj.name : 'Unassigned',
    type: domainOf(entityId),
    title: attrs.friendly_name || entityId,
    url: '',
    username: attrs.device_class || domainOf(entityId),
    userurl: '',
    picSmall: 'images/not_available_small.png',
    picLarge: 'images/not_available_large.png',
    size,
    popularity: Math.abs(size - previousSize),

    // Ours
    entityId,
    state: newState ? newState.state : null,
    previous: oldState ? oldState.state : null,
    unit: attrs.unit_of_measurement || '',
    severity: severityFor(entityId, newState),
    room: roomObj ? roomObj.key : null,
    level: roomObj ? roomObj.level : null,
    at: event.timeFired || new Date().toISOString(),
  };
}

// Same conversion for a state pulled from get_states, which has no old value.
// Used to seed widgets before any event arrives.
export function stateToMessage(state) {
  return toMessage({
    entityId: state.entity_id,
    oldState: null,
    newState: state,
    timeFired: state.last_changed || null,
  });
}
