// House screen: the 3D model as a dashboard widget.
//
// Ported from tools/viewer-template.html (geometry, materials, wall edges,
// level 1 builder, camera) and from the last script block of
// concepts/monitor/home-monitor.html (room glow, event beams, leader tags,
// click to zoom). The difference from both is that nothing here is simulated.
// Every glow, pulse and beam is driven by a real Home Assistant message
// arriving through bus.js.
//
// BUILD.md step 6 decisions honored here:
//   - own three.js r128 renderer and canvas, kept away from the fork's r66
//   - r128 arrives as an ES module, so it never touches window.THREE
//   - model JSON is fetched as static files, not inlined into the page
//
// Project rules honored here:
//   - walls are full height, no cutaway (rule 6)
//   - exterior walls draw no edge lines, interior walls keep thin cyan (rule 7)
//   - orange only ever means a problem (rule 10)

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { ROOMS, LEVEL1_ELEVATION } from '../rooms.js';
import { Severity } from '../message.js';

const E1 = LEVEL1_ELEVATION;   // level 1 floor elevation, cm
const H1 = 244;                // wall height, cm (8 ft, rule 6)

// Palette, from BUILD.md section 4.
const C = {
  bg: 0x03060a,
  line: 0x3fe0ff,
  dim: 0x2aa3bb,
  deep: 0x1d7d91,
  alert: 0xff8a1f,
  motion: 0x4dffb0,
  ground: 0x07121a,
  floor: 0x0a1d26,
  wall: 0x16424f,
  wallEm: 0x061c24,
  wallx: 0x1b4d5b,
  wallxEm: 0x072630,
  leaf: 0x1f6170,
  leafEm: 0x0a3440,
  frame: 0x2b6f80,
  frameEm: 0x0c3a46,
  furn: 0x10303a,
  furnEm: 0x041419,
  slab: 0x0b2029,
  slabEm: 0x041218,
  edgeBright: 0x7fe9ff,
};

const BEAM_MS = 1800;     // event beam lifetime
const MOTION_MS = 2600;   // how long a motion ring runs
const IDLE_MS = 6000;     // idle before the camera drifts
const MOTION_HOLD = 90000; // how long a room counts as "recently active"

// Decode a base64 packed typed array, as written by tools/obj_to_model.py.
function b64(s, Type) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Type(u.buffer);
}

// Edge builder from the viewer. Segmented wall exports read as one continuous
// wall because only real edges are drawn: tops, bottoms, corners, openings.
function wallEdges(g) {
  const p = g.attributes.position.array;
  const map = new Map();
  const q = (v) => Math.round(v * 2) / 2;
  const out = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Cv = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < p.length; i += 9) {
    A.fromArray(p, i); B.fromArray(p, i + 3); Cv.fromArray(p, i + 6);
    n.subVectors(Cv, B).cross(B.clone().sub(A)).normalize();
    const V = [A.clone(), B.clone(), Cv.clone()];
    for (let k = 0; k < 3; k++) {
      const a = V[k], b = V[(k + 1) % 3];
      const ka = q(a.x) + ',' + q(a.y) + ',' + q(a.z);
      const kb = q(b.x) + ',' + q(b.y) + ',' + q(b.z);
      const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      let e = map.get(key);
      if (!e) { e = { a, b, n: [] }; map.set(key, e); }
      e.n.push(n.clone());
    }
  }

  const cs = Math.cos(20 * Math.PI / 180);
  map.forEach((e) => {
    const d = e.b.clone().sub(e.a);
    const len = d.length();
    if (len < 0.5) return;
    let keep;
    if (e.n.length === 1) {
      keep = Math.abs(d.y) < 0.9 * len;
    } else {
      keep = false;
      for (let i = 0; i < e.n.length && !keep; i++) {
        for (let j = i + 1; j < e.n.length; j++) {
          if (Math.abs(e.n[i].dot(e.n[j])) < cs) { keep = true; break; }
        }
      }
    }
    if (keep) out.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);
  });

  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return r;
}

export class HouseScreen {
  // options: { canvas, tagLayer, leadLayer, basePath, onRoomOpen, onRoomClose }
  constructor(options = {}) {
    this.options = options;
    this.basePath = options.basePath || '../models/';
    this.canvas = options.canvas;
    this.tagLayer = options.tagLayer || null;
    this.leadLayer = options.leadLayer || null;

    this.ready = false;
    this.visible = false;
    this.rooms = [];
    this.byKey = new Map();
    this.level = 0;        // 0 both, 1 level 0 only, 2 level 1 only
    this.focused = null;
    this._idleAt = 0;
    this._prevLevel = 0;
    this._loading = null;
  }

  // ---- widget contract ---------------------------------------------------

  init(ctx) {
    this.ha = ctx && ctx.ha;
    this.bus = ctx && ctx.bus;
    this._setupRenderer();
    this._bindInput();
    this.load();
  }

  show() {
    this.visible = true;
    if (this.tagLayer) this.tagLayer.style.display = '';
    if (this.leadLayer) this.leadLayer.style.display = '';
    this.resize();
  }

  hide() {
    this.visible = false;
    if (this.tagLayer) this.tagLayer.style.display = 'none';
    if (this.leadLayer) this.leadLayer.style.display = 'none';
  }

  message(m) {
    if (!this.ready || !m.room) return;
    const slot = this.byKey.get(m.room);
    if (!slot) return;

    const now = performance.now();

    // Alerts are tracked per entity so one cleared door does not clear the
    // whole room while another is still open.
    if (m.severity === Severity.ALERT) slot.alerts.add(m.entityId);
    else slot.alerts.delete(m.entityId);

    if (m.severity === Severity.MOTION) {
      slot.motionAt = now;
      slot.lastMotion = Date.now();
      slot.ringAt = now;
    }

    // Lights and switches drive the room glow.
    if (m.type === 'light' || m.type === 'switch') {
      if (m.state === 'on') slot.lightsOn.add(m.entityId);
      else slot.lightsOn.delete(m.entityId);
    }

    // message.js puts the HA device_class in `username`, which is a far more
    // reliable signal than pattern matching the unit string.
    if (m.type === 'sensor' && m.username === 'temperature') {
      const t = Number(m.state);
      if (Number.isFinite(t)) slot.temp = t;
    }

    // Beam color follows rule 10: orange problem, green motion, cyan normal.
    slot.beamAt = now;
    slot.beamMat.color.setHex(
      m.severity === Severity.ALERT ? C.alert
        : m.severity === Severity.MOTION ? C.motion
        : C.line
    );

    this._tagText(slot);
    if (this.focused === slot && this.options.onRoomOpen) {
      this.options.onRoomOpen(this.roomInfo(slot));
    }
  }

  animate() {
    if (!this.ready || !this.visible) return;
    const t = performance.now();

    // Camera easing, same feel as the viewer.
    this.th += (this.tth - this.th) * 0.12;
    this.ph += (this.tph - this.ph) * 0.12;
    this.r += (this.tr - this.r) * 0.12;
    this.ctr.x += (this.tx - this.ctr.x) * 0.12;
    this.ctr.z += (this.tz - this.ctr.z) * 0.12;
    this.cy += (this.ty - this.cy) * 0.12;
    this.ctr.y = this.cy;

    // Slow drift once nobody has touched it, so the widget stays alive.
    if (!this.focused && t - this._idleAt > IDLE_MS) this.tth += 0.0008;

    this.cam.position.set(
      this.ctr.x + this.r * Math.cos(this.ph) * Math.sin(this.th),
      this.cy + this.r * Math.sin(this.ph),
      this.ctr.z + this.r * Math.cos(this.ph) * Math.cos(this.th)
    );
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.ctr);

    this._updateEffects(t);
    this.renderer.render(this.scene, this.cam);
    this._updateTags();
  }

  resize() {
    if (!this.canvas || !this.renderer) return;
    const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth || 1;
    const h = this.canvas.clientHeight || this.canvas.parentElement.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this._viewport = { w, h };
    if (!this.focused) this.tr = this._fitRadius();
  }

  dispose() {
    this.renderer.dispose();
    for (const slot of this.rooms) {
      if (slot.tag) slot.tag.remove();
      if (slot.line) slot.line.remove();
      if (slot.dot) slot.dot.remove();
    }
  }

  // ---- setup -------------------------------------------------------------

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(C.bg);

    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(34, 1, 1, 20000);
    this.G0 = new THREE.Group();
    this.G1 = new THREE.Group();
    this.scene.add(this.G0, this.G1);

    this.scene.add(new THREE.AmbientLight(0x7fb4c8, 0.7));
    const dl = new THREE.DirectionalLight(0xcff6ff, 0.75);
    dl.position.set(400, 1200, 900);
    this.scene.add(dl);

    this.ctr = new THREE.Vector3();
    this.th = 0; this.ph = 0.9; this.r = 2600;
    this.tth = 0; this.tph = 0.9; this.tr = 2600;
    this.tx = 0; this.tz = 0; this.ty = 0; this.cy = 0;
    this._viewport = { w: 1, h: 1 };

    this.raycaster = new THREE.Raycaster();
  }

  // Memoized. init() starts the load and a host page can await the very same
  // promise to know when the model is on screen. Without this, registering the
  // screen on the bus and then awaiting load() would fetch the 1.5 MB model
  // twice and add every mesh to the scene twice.
  load() {
    if (!this._loading) this._loading = this._load();
    return this._loading;
  }

  async _load() {
    const [model, objects, labels] = await Promise.all([
      fetch(this.basePath + 'model.json').then((r) => this._json(r, 'model.json')),
      fetch(this.basePath + 'objects.json').then((r) => this._json(r, 'objects.json')),
      fetch(this.basePath + 'labels.json').then((r) => this._json(r, 'labels.json')),
    ]);

    this.model = model;
    this.objects = objects;
    this.labels = labels;

    this._buildLevel0();
    this._buildLevel1();
    this._buildRooms();

    // Frame the house.
    const box = new THREE.Box3().setFromObject(this.scene);
    const c = box.getCenter(new THREE.Vector3());
    this.home = { x: c.x, z: c.z };
    this.ctr.set(c.x, 0, c.z);
    this.tx = c.x; this.tz = c.z;

    this.ready = true;
    this.resize();
    this.r = this.tr;
    this.setLevel(0);
  }

  async _json(response, what) {
    if (!response.ok) {
      throw new Error('could not load ' + what + ' from ' + this.basePath +
        ' (HTTP ' + response.status + '). Check the basePath option.');
    }
    return response.json();
  }

  // ---- level 0, exact from the OBJ --------------------------------------

  _geo(key) {
    const d = this.model[key];
    if (!d) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b64(d.p, Float32Array), 3));
    g.setIndex(new THREE.BufferAttribute(b64(d.i, d.b ? Uint32Array : Uint16Array), 1));
    return g;
  }

  _add(key, material, edgeMat, threshold) {
    let g = this._geo(key);
    if (!g) return null;
    g = g.toNonIndexed();

    // Room surfaces above 5 cm are ceilings. Rule 6 says no ceilings.
    if (key === 'floor') {
      const a = g.attributes.position.array;
      const keep = [];
      for (let i = 0; i < a.length; i += 9) {
        if (a[i + 1] < 5 && a[i + 4] < 5 && a[i + 7] < 5) {
          for (let j = 0; j < 9; j++) keep.push(a[i + j]);
        }
      }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    }

    g.computeVertexNormals();
    this.G0.add(new THREE.Mesh(g, material));

    if (edgeMat) {
      const eg = threshold === 'W' ? wallEdges(g) : new THREE.EdgesGeometry(g, threshold || 25);
      this.G0.add(new THREE.LineSegments(eg, edgeMat));
    }
    return g;
  }

  _buildLevel0() {
    const lam = (color, emissive) => new THREE.MeshLambertMaterial({
      color, emissive, side: THREE.DoubleSide,
    });
    const line = (color, opacity) => new THREE.LineBasicMaterial({
      color, transparent: true, opacity,
    });
    const glass = () => new THREE.MeshBasicMaterial({
      color: C.line, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false,
    });

    this._add('ground', new THREE.MeshLambertMaterial({
      color: C.ground, side: THREE.DoubleSide,
    }), null);

    this._add('floor', new THREE.MeshLambertMaterial({
      color: C.floor, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1,
    }), line(C.dim, 0.5));

    // Interior walls keep thin cyan edges (rule 7).
    this._add('wall', lam(C.wall, C.wallEm), line(C.line, 0.9), 'W');
    this._add('furn', lam(C.furn, C.furnEm), line(C.dim, 0.35), 40);
    this._add('door', lam(C.leaf, C.leafEm), line(C.edgeBright, 0.7), 30);
    this._add('frame', lam(C.frame, C.frameEm), line(C.edgeBright, 0.8), 30);
    this._add('glass', glass(), line(C.line, 0.9), 30);

    // Exterior walls are solid with no edge lines at all (rule 7), so that a
    // segmented export reads as one continuous wall.
    this._add('wallx', lam(C.wallx, C.wallxEm), null);
    this._add('doorx', lam(C.leaf, C.leafEm), line(C.edgeBright, 0.7), 30);
    this._add('framex', lam(C.frame, C.frameEm), line(C.edgeBright, 0.8), 30);
    this._add('glassx', glass(), line(C.line, 0.9), 30);
  }

  // ---- level 1, built in code ------------------------------------------
  // Transcribed from tools/viewer-template.html. There is no Sweet Home 3D
  // plan for upstairs, so this is the source of truth for it.

  _buildLevel1() {
    const M = {
      wall: new THREE.MeshLambertMaterial({ color: C.wall, emissive: C.wallEm, side: THREE.DoubleSide }),
      ext: new THREE.MeshLambertMaterial({ color: C.wallx, emissive: C.wallxEm, side: THREE.DoubleSide }),
      edge: new THREE.LineBasicMaterial({ color: C.line, transparent: true, opacity: 0.9 }),
      dim: new THREE.LineBasicMaterial({ color: C.dim, transparent: true, opacity: 0.35 }),
      furn: new THREE.MeshLambertMaterial({ color: C.furn, emissive: C.furnEm, side: THREE.DoubleSide }),
      leaf: new THREE.MeshLambertMaterial({ color: C.leaf, emissive: C.leafEm, side: THREE.DoubleSide }),
      frame: new THREE.MeshLambertMaterial({ color: C.frame, emissive: C.frameEm, side: THREE.DoubleSide }),
      glass: new THREE.MeshBasicMaterial({
        color: C.line, transparent: true, opacity: 0.32,
        side: THREE.DoubleSide, depthWrite: false,
      }),
      slab: new THREE.MeshLambertMaterial({ color: C.slab, emissive: C.slabEm, side: THREE.DoubleSide }),
    };
    this.M1 = M;

    const G1 = this.G1;
    const bx = (w, h, d, x, y, z, mat, edge) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const o = new THREE.Mesh(g, mat);
      o.position.set(x, y, z);
      G1.add(o);
      if (edge) {
        const l = new THREE.LineSegments(new THREE.EdgesGeometry(g), edge);
        l.position.copy(o.position);
        G1.add(l);
      }
      return o;
    };

    // Reusable models lifted off level 0 by tools/extract_objects.py, so
    // upstairs uses the same doors, windows and furniture (rule 8).
    const PM = {
      furn: [M.furn, M.dim, 40],
      door: [M.leaf, M.dim, 30],
      frame: [M.frame, M.edge, 30],
      glass: [M.glass, M.edge, 30],
    };
    const put = (name, x, z, rotY) => {
      const o = this.objects[name];
      if (!o) { console.warn('house: no model named ' + name + ' in objects.json'); return; }
      const grp = new THREE.Group();
      for (const cat in o.parts) {
        const d = o.parts[cat];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(b64(d.p, Float32Array), 3));
        g.setIndex(new THREE.BufferAttribute(b64(d.i, Uint16Array), 1));
        const ng = g.toNonIndexed();
        ng.computeVertexNormals();
        const pm = PM[cat];
        grp.add(new THREE.Mesh(ng, pm[0]));
        grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(ng, pm[2]), pm[1]));
      }
      grp.rotation.y = rotY;
      grp.position.set(x, E1, z);
      G1.add(grp);
    };

    // W1(x1, z1, x2, z2, exterior?, [[a, b, type], ...])
    // type: 'w' window, 'd' door, 'x' open no header, 'o' open with header
    const W1 = (x1, z1, x2, z2, ext, ops = []) => {
      const t = ext ? 12 : 9;
      const hz = z1 === z2;
      const a0 = Math.min(hz ? x1 : z1, hz ? x2 : z2);
      const a1 = Math.max(hz ? x1 : z1, hz ? x2 : z2);
      const c = hz ? z1 : x1;
      const mat = ext ? M.ext : M.wall;
      const edge = ext ? null : M.edge;

      const piece = (a, b, y0, y1) => {
        if (b - a < 1) return;
        if (hz) bx(b - a, y1 - y0, t, (a + b) / 2, E1 + (y0 + y1) / 2, c, mat, edge);
        else bx(t, y1 - y0, b - a, c, E1 + (y0 + y1) / 2, (a + b) / 2, mat, edge);
      };
      const at = (v) => (hz ? [v, c] : [c, v]);
      const rot = hz ? 0 : Math.PI / 2;

      let cur = a0;
      ops.slice().sort((p, q) => p[0] - q[0]).forEach(([a, b, ty]) => {
        piece(cur, a, 0, H1);
        const p = at((a + b) / 2);
        if (ty === 'w') {
          piece(a, b, 0, 61);
          piece(a, b, 189, H1);
          put('window', p[0], p[1], rot);
        } else if (ty === 'd') {
          put('door', p[0], p[1], rot);
        } else if (ty === 'o') {
          piece(a, b, 213, H1);
        }
        // 'x' is an opening with no header, so nothing is drawn above it.
        cur = b;
      });
      piece(cur, a1, 0, H1);
    };

    // Floor slab with the stair hole.
    {
      const s = new THREE.Shape();
      [[6, -583], [525, -583], [525, -533], [1037, -533], [1037, -1973],
       [405, -1973], [405, -797], [6, -797]]
        .forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
      const hole = new THREE.Path();
      [[101, -593], [519, -593], [519, -693], [101, -693]]
        .forEach((p, i) => (i ? hole.lineTo(p[0], p[1]) : hole.moveTo(p[0], p[1])));
      s.holes.push(hole);

      const g = new THREE.ExtrudeGeometry(s, { depth: 18, bevelEnabled: false });
      const o = new THREE.Mesh(g, M.slab);
      o.rotation.x = Math.PI / 2;
      o.position.y = E1;
      G1.add(o);
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(g), M.dim);
      l.rotation.copy(o.rotation);
      l.position.copy(o.position);
      G1.add(l);
    }

    // Glass railing along the north edge of the stair hole.
    {
      const len = 418, cx = 310, cz = -693;
      bx(len, 90, 2, cx, E1 + 45, cz, M.glass, null);
      bx(len, 5, 6, cx, E1 + 92, cz, M.leaf, M.edge);
      for (let x = 101; x <= 519; x += 104.5) {
        bx(5, 92, 5, x, E1 + 46, cz, M.leaf, M.edge);
      }
    }

    W1(6, -583, 525, -583, 1);
    W1(525, -533, 525, -583, 1);
    W1(525, -583, 525, -697, 0);
    W1(6, -583, 6, -797, 1, [[-794, -690, 'w'], [-690, -586, 'w']]);
    W1(6, -797, 405, -797, 1);
    W1(525, -533, 1037, -533, 1);
    W1(525, -697, 1037, -697, 0, [[683, 782, 'd']]);
    W1(1037, -533, 1037, -1973, 1);
    W1(405, -1973, 1037, -1973, 1, [[617, 721, 'w'], [721, 825, 'w']]);
    W1(405, -797, 405, -1973, 1);
    W1(405, -1324, 1037, -1324, 0, [[663, 856, 'x']]);
    W1(663, -1324, 663, -1563, 0, [[-1435, -1336, 'd']]);
    W1(856, -1324, 856, -1563, 0, [[-1449, -1350, 'd']]);
    W1(856, -1474, 1037, -1474, 0);
    W1(405, -1563, 1037, -1563, 0, [[709, 808, 'd'], [880, 979, 'd']]);

    const P2 = Math.PI / 2, PI = Math.PI;
    put('bed', 911.6, -1038, 0);
    put('nightstand', 1005.6, -917, 0);
    put('nightstand', 1005.6, -1159, 0);
    put('dresser', 432.6, -1038, -P2);
    put('tv', 422.5, -1038, P2);
    put('desk', 552, -1285.5, 0);
    put('chair', 552, -1230, P2);
    put('tub', 500, -1520.4, P2);
    put('showerfix', 440, -1520.4, P2);
    put('basin', 439, -1375, P2);
    put('toilet', 451, -1445, P2);
    put('bed', 530.4, -1768, PI);
    put('nightstand', 436.4, -1647, PI);
    put('nightstand', 436.4, -1889, PI);
    put('chest', 1000.5, -1768, 0);
    put('tv', 1019.5, -1768, -P2);
  }

  // ---- room overlays ----------------------------------------------------

  _buildRooms() {
    const beamGeo = new THREE.CylinderGeometry(4, 4, 1, 8, 1, true);
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);

    this.rooms = ROOMS.map((r) => {
      const cx = (r.x[0] + r.x[1]) / 2;
      const cz = (r.z[0] + r.z[1]) / 2;
      const y = r.level ? E1 + 2 : 2;
      const group = r.level ? this.G1 : this.G0;

      // Flat additive plane, the room glow.
      const planeMat = new THREE.MeshBasicMaterial({
        color: C.line, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(r.x[1] - r.x[0], r.z[1] - r.z[0]), planeMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cx, y, cz);
      group.add(plane);

      // Vertical beam, one per event.
      const beamMat = new THREE.MeshBasicMaterial({
        color: C.line, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(cx, y, cz);
      group.add(beam);

      // Green ring pulse, motion only.
      const ringMat = new THREE.MeshBasicMaterial({
        color: C.motion, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cx, y + 1, cz);
      group.add(ring);

      const slot = {
        room: r, cx, cz, y,
        plane, planeMat, beam, beamMat, ring, ringMat,
        beamAt: -1e9, ringAt: -1e9, motionAt: -1e9, lastMotion: 0,
        alerts: new Set(), lightsOn: new Set(), temp: null,
        tag: null, line: null, dot: null,
      };

      plane.userData.slot = slot;
      this._makeTag(slot);
      this.byKey.set(r.key, slot);
      return slot;
    });

    this._pickTargets = this.rooms.map((s) => s.plane);
  }

  _makeTag(slot) {
    if (!this.tagLayer) return;
    const tag = document.createElement('div');
    tag.className = 'house-tag';
    tag.tabIndex = 0;
    tag.setAttribute('role', 'button');
    tag.onclick = () => this.focus(slot);
    tag.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.focus(slot); }
    };
    this.tagLayer.appendChild(tag);
    slot.tag = tag;

    if (this.leadLayer) {
      const ns = 'http://www.w3.org/2000/svg';
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('stroke', 'rgba(191,244,255,.45)');
      line.setAttribute('stroke-width', '1');
      this.leadLayer.appendChild(line);
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', '2.5');
      dot.setAttribute('fill', '#bff4ff');
      this.leadLayer.appendChild(dot);
      slot.line = line;
      slot.dot = dot;
    }
    this._tagText(slot);
  }

  _tagText(slot) {
    if (!slot.tag) return;
    const alert = slot.alerts.size > 0;
    const motion = Date.now() - slot.lastMotion < MOTION_HOLD;
    slot.tag.className = 'house-tag' + (alert ? ' alert' : '') + (motion ? ' motion' : '');
    const temp = slot.temp === null ? '' : '<i>' + slot.temp.toFixed(0) + '</i>';
    slot.tag.innerHTML = slot.room.name + temp;
  }

  // ---- per frame effects -------------------------------------------------

  _updateEffects(t) {
    for (const s of this.rooms) {
      const alert = s.alerts.size > 0;
      const lit = s.lightsOn.size > 0;

      // Glow: orange only for a real problem (rule 10).
      const target = alert ? 0.18 : lit ? 0.13 : 0.015;
      s.planeMat.color.setHex(alert ? C.alert : C.line);
      s.planeMat.opacity += (target - s.planeMat.opacity) * 0.08;

      // Event beam rises and fades.
      const a = (t - s.beamAt) / BEAM_MS;
      if (a < 1) {
        const h = 40 + a * 420;
        s.beam.scale.set(1, h, 1);
        s.beam.position.y = s.y + h / 2;
        s.beamMat.opacity = 0.7 * (1 - a);
      } else if (s.beamMat.opacity !== 0) {
        s.beamMat.opacity = 0;
      }

      // Motion ring expands outward once.
      const m = (t - s.ringAt) / MOTION_MS;
      if (m < 1) {
        const span = Math.min(s.room.x[1] - s.room.x[0], s.room.z[1] - s.room.z[0]) / 2;
        const scale = 12 + m * span;
        s.ring.scale.set(scale, scale, 1);
        s.ringMat.opacity = 0.55 * (1 - m);
      } else if (s.ringMat.opacity !== 0) {
        s.ringMat.opacity = 0;
      }
    }
  }

  // A level 0 room sitting under the level 1 footprint is hidden while both
  // floors are shown, otherwise its tag floats through the upstairs slab.
  _coveredByUpstairs(s) {
    return s.room.level === 0 && this.level === 0 &&
      s.cx > 6 && s.cx < 1037 && s.cz < -533 && s.cz > -1973;
  }

  _updateTags() {
    if (!this.tagLayer) return;
    const { w, h } = this._viewport;
    const a = new THREE.Vector3(), b = new THREE.Vector3();

    for (const s of this.rooms) {
      if (!s.tag) continue;
      const lvl = s.room.level;
      const visible = !this._coveredByUpstairs(s) &&
        ((lvl === 0 && this.level !== 2) || (lvl === 1 && this.level !== 1));

      if (!visible) { this._hideTag(s); continue; }

      a.set(s.cx, s.y + 4, s.cz).project(this.cam);
      if (a.z >= 1) { this._hideTag(s); continue; }
      b.set(s.cx, s.y + (lvl ? 300 : 320), s.cz).project(this.cam);

      const x1 = (a.x + 1) / 2 * w, y1 = (1 - a.y) / 2 * h;
      const x2 = (b.x + 1) / 2 * w, y2 = (1 - b.y) / 2 * h;

      s.tag.style.display = '';
      s.tag.style.left = x2 + 'px';
      s.tag.style.top = y2 + 'px';

      if (s.line) {
        s.line.style.display = '';
        s.line.setAttribute('x1', x1); s.line.setAttribute('y1', y1);
        s.line.setAttribute('x2', x2); s.line.setAttribute('y2', y2);
        s.dot.style.display = '';
        s.dot.setAttribute('cx', x1);
        s.dot.setAttribute('cy', y1);
        s.dot.setAttribute('fill',
          s.alerts.size ? '#ff8a1f'
            : Date.now() - s.lastMotion < MOTION_HOLD ? '#4dffb0'
            : '#bff4ff');
      }
    }
  }

  _hideTag(s) {
    s.tag.style.display = 'none';
    if (s.line) { s.line.style.display = 'none'; s.dot.style.display = 'none'; }
  }

  // ---- camera, levels, focus --------------------------------------------

  _fitRadius() {
    const portrait = this._viewport.h > this._viewport.w;
    if (this.level === 2) return portrait ? 3900 : 3200;
    return (portrait ? 4300 : 3300) * (this.level === 0 ? 1.2 : 1);
  }

  // 0 both floors, 1 level 0 only, 2 level 1 only
  setLevel(level) {
    this.level = level;
    this.G0.visible = level !== 2;
    this.G1.visible = level !== 1;
    this.ty = level === 2 ? E1 : 0;
    if (!this.focused) {
      this.tx = level === 2 ? 521 : this.home.x;
      this.tz = level === 2 ? -1253 : this.home.z;
      this.tr = this._fitRadius();
    }
  }

  setView(preset) {
    this.tth = 0;
    this.tph = preset === 'top' ? 1.55 : 0.9;
    this._idleAt = performance.now();
  }

  roomInfo(slot) {
    const alerts = [...slot.alerts];
    return {
      key: slot.room.key,
      name: slot.room.name,
      level: slot.room.level,
      estimated: !!slot.room.est,
      temp: slot.temp,
      lightsOn: slot.lightsOn.size,
      alerts,
      motion: Date.now() - slot.lastMotion < MOTION_HOLD,
    };
  }

  focus(slotOrKey) {
    const slot = typeof slotOrKey === 'string' ? this.byKey.get(slotOrKey) : slotOrKey;
    if (!slot) return;
    if (!this.focused) this._prevLevel = this.level;
    this.focused = slot;

    this.setLevel(slot.room.level ? 2 : 1);
    this.tx = slot.cx;
    this.tz = slot.cz;
    this.ty = slot.room.level ? E1 : 0;
    this.tr = this._viewport.h > this._viewport.w ? 2300 : 1800;
    this.tph = 1.0;
    this._idleAt = performance.now();

    if (this.options.onRoomOpen) this.options.onRoomOpen(this.roomInfo(slot));
  }

  unfocus() {
    if (!this.focused) return;
    this.focused = null;
    this.setLevel(this._prevLevel);
    this.tph = 0.9;
    if (this.options.onRoomClose) this.options.onRoomClose();
  }

  // ---- input -------------------------------------------------------------

  _bindInput() {
    const canvas = this.canvas;
    const pointers = new Map();
    let pinch = 0;
    let moved = 0;

    const mark = () => { this._idleAt = performance.now(); };

    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      moved = 0;
      mark();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const [px, py] = pointers.get(e.pointerId);
      const dx = e.clientX - px, dy = e.clientY - py;
      moved += Math.abs(dx) + Math.abs(dy);

      if (pointers.size === 1) {
        this.tth -= dx * 0.007;
        this.tph = Math.min(1.55, Math.max(0.15, this.tph + dy * 0.005));
      }
      pointers.set(e.pointerId, [e.clientX, e.clientY]);

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.tr = Math.min(7000, Math.max(500, this.tr * pinch / d));
        pinch = d;
      }
      mark();
    });

    const up = (e) => {
      pointers.delete(e.pointerId);
      pinch = 0;
      canvas.style.cursor = 'grab';
      // A tap, not a drag, is a room pick.
      if (moved < 6) this._pick(e);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      pinch = 0;
      canvas.style.cursor = 'grab';
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.tr = Math.min(7000, Math.max(500, this.tr * (1 + e.deltaY * 0.001)));
      mark();
    }, { passive: false });

    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.focused) this.unfocus();
    });
  }

  _pick(e) {
    if (!this.ready) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.cam);

    const candidates = this._pickTargets.filter((p) => {
      const slot = p.userData.slot;
      if (this._coveredByUpstairs(slot)) return false;
      const lvl = slot.room.level;
      return (lvl === 0 && this.level !== 2) || (lvl === 1 && this.level !== 1);
    });

    const hits = this.raycaster.intersectObjects(candidates, false);
    if (hits.length) this.focus(hits[0].object.userData.slot);
    else if (this.focused) this.unfocus();
  }
}
