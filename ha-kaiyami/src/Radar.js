/* Animated NEXRAD radar for the Climate screen.
 *
 * Leaflet, loaded as a global from cdnjs by index.html. It owns its own canvas
 * and DOM and never touches three.js, so the fork's r66 and the house widget's
 * r128 are both left alone.
 *
 * Radar frames come from the Iowa Environmental Mesonet NEXRAD cache, which is
 * the national composite and needs no key. Eleven frames: fifty minutes ago
 * through to the current composite, stepped five minutes apart.
 *
 * Frames are all added as layers once and then cross faded by opacity rather
 * than being added and removed, because adding a tile layer refetches its
 * tiles and the animation would stutter on every loop.
 */

var TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
var NEXRAD = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913";

/* Oldest to newest. The empty string is the live composite. */
var OFFSETS = ["m50m", "m45m", "m40m", "m35m", "m30m", "m25m",
               "m20m", "m15m", "m10m", "m05m", ""];

var FRAME_MS = 600;        // time on each frame
var HOLD_MS = 1600;        // extra pause on the newest frame
var REFRESH_MS = 5 * 60 * 1000;   // never faster, the cache updates every 5 min

function Radar(options) {
    this.el = options.el;
    this.timeEl = options.timeEl || null;
    this.windEl = options.windEl || null;
    this.home = options.home;
    this.zoom = options.zoom || 8;

    this.map = null;
    this.layers = [];
    this.frame = 0;
    this.started = 0;
    this.lastRefresh = 0;
    this.lastStep = 0;
    this.wind = { speed: 0, bearing: 0 };
    this.particles = [];
    this.ctx = null;
    this.canvas = null;
}

Radar.prototype.mount = function () {
    if (this.map || !this.el || typeof window.L === "undefined") {
        return;
    }
    var L = window.L;

    this.map = L.map(this.el, {
        center: [this.home.lat, this.home.lon],
        zoom: this.zoom,
        zoomControl: false,
        attributionControl: false,
        /* Drag and scroll zoom stay on, the brief asks for them. */
        scrollWheelZoom: true,
        dragging: true
    });

    L.tileLayer(TILES, { maxZoom: 18, className: "radar-base" }).addTo(this.map);

    for (var i = 0; i < OFFSETS.length; i++) {
        var url = NEXRAD + (OFFSETS[i] ? "-" + OFFSETS[i] : "") + "/{z}/{x}/{y}.png";
        var layer = L.tileLayer(url, { opacity: 0, maxZoom: 12, className: "radar-echo" });
        layer.addTo(this.map);
        this.layers.push(layer);
    }

    /* Home. A plain circle marker, no icon file to load. */
    L.circleMarker([this.home.lat, this.home.lon], {
        radius: 5,
        color: "#3fe0ff",
        weight: 2,
        fillColor: "#bff4ff",
        fillOpacity: 0.9
    }).addTo(this.map);
    L.circle([this.home.lat, this.home.lon], {
        radius: 8000,
        color: "#3fe0ff",
        weight: 1,
        opacity: 0.45,
        fill: false
    }).addTo(this.map);

    this._buildWindCanvas();
    this.started = Date.now();
    this.lastRefresh = Date.now();
    this.show(OFFSETS.length - 1);
};

Radar.prototype.resize = function () {
    if (this.map) {
        this.map.invalidateSize();
    }
    this._sizeWindCanvas();
};

/* ---- frame animation ------------------------------------------------------ */

Radar.prototype.show = function (index) {
    for (var i = 0; i < this.layers.length; i++) {
        this.layers[i].setOpacity(i === index ? 0.75 : 0);
    }
    this.frame = index;
    if (this.timeEl) {
        this.timeEl.textContent = labelFor(index);
    }
};

Radar.prototype.tick = function () {
    if (!this.map) {
        return;
    }
    var now = Date.now();

    var last = this.frame === this.layers.length - 1;
    if (now - this.lastStep > (last ? FRAME_MS + HOLD_MS : FRAME_MS)) {
        this.lastStep = now;
        this.show((this.frame + 1) % this.layers.length);
    }

    if (now - this.lastRefresh > REFRESH_MS) {
        this.lastRefresh = now;
        this.refresh();
    }

    this._drawWind();
};

/* Re-request the tiles so the loop follows the storm rather than replaying the
   same fifty minutes forever. */
Radar.prototype.refresh = function () {
    for (var i = 0; i < this.layers.length; i++) {
        this.layers[i].redraw();
    }
};

/* ---- wind particles -------------------------------------------------------- */

Radar.prototype.setWind = function (speedMph, bearingDegrees) {
    this.wind.speed = Number(speedMph) || 0;
    this.wind.bearing = Number(bearingDegrees) || 0;
    if (this.windEl) {
        this.windEl.textContent = Math.round(this.wind.speed) + " mph " + compass(this.wind.bearing);
    }
};

Radar.prototype._buildWindCanvas = function () {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "radar-wind";
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this._sizeWindCanvas();
};

Radar.prototype._sizeWindCanvas = function () {
    if (!this.canvas) {
        return;
    }
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) {
        return;
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var want = Math.round((w * h) / 14000);
    this.particles = [];
    for (var i = 0; i < want; i++) {
        this.particles.push(newParticle(w, h));
    }
};

Radar.prototype._drawWind = function () {
    if (!this.ctx || !this.canvas) {
        return;
    }
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) {
        return;
    }

    var ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    /* Meteorological bearing is the direction the wind comes FROM, so the
       particles travel the opposite way. Screen y grows downward. */
    var rad = (this.wind.bearing + 180) * Math.PI / 180;
    var speed = 0.25 + this.wind.speed * 0.055;
    var dx = Math.sin(rad) * speed;
    var dy = -Math.cos(rad) * speed;

    ctx.lineWidth = 1;
    for (var i = 0; i < this.particles.length; i++) {
        var p = this.particles[i];
        var px = p.x, py = p.y;
        p.x += dx;
        p.y += dy;
        p.life -= 1;

        if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
            this.particles[i] = newParticle(w, h);
            continue;
        }

        ctx.strokeStyle = "rgba(191,244,255," + (0.07 + 0.2 * (p.life / p.max)) + ")";
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - dx * 7, py - dy * 7);
        ctx.stroke();
    }
};

function newParticle(w, h) {
    var max = 90 + Math.random() * 130;
    return { x: Math.random() * w, y: Math.random() * h, life: max, max: max };
}

function labelFor(index) {
    var minutes = (OFFSETS.length - 1 - index) * 5;
    if (!minutes) {
        return "NOW";
    }
    return "-" + minutes + " MIN";
}

function compass(deg) {
    var names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return names[Math.round(((deg % 360) / 22.5)) % 16];
}

export { Radar };
