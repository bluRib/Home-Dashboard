/* Animated NEXRAD radar for the Climate screen.
 *
 * Leaflet, loaded as a global from cdnjs by index.html. It owns its own DOM
 * and canvases and never touches three.js, so the fork's r66 and the house
 * widget's r128 are both left alone.
 *
 * Why the tiles are filtered
 * The Iowa Environmental Mesonet n0q tiles are raw base reflectivity. That
 * includes everything the radar hears, not just rain: ground clutter, the
 * Blue Ridge, birds, insects, and anomalous propagation. Drawn straight onto
 * a map and looped, that reads as rain when nothing is falling. Sampling the
 * nine tiles around this house showed 83 percent of all returns below 20 dBZ,
 * and only a tenth of one percent of the map area at or above it, which is
 * what an empty sky actually looks like through a raw reflectivity product.
 *
 * So every tile is drawn to a canvas and any pixel below 20 dBZ is cleared,
 * which is roughly where light rain starts. The n0q colour table is a fixed
 * 255 entry ramp and dBZ is exactly linear in its index, so the colour of a
 * pixel gives its value with no approximation: a sample of ten thousand
 * pixels matched the published table exactly, every one. The table below is
 * that ramp, from akrherz/pyIEM, src/pyiem/data/ramps/composite_n0q.txt.
 *
 * IEM serves the tiles with Access-Control-Allow-Origin, so the canvas stays
 * clean and getImageData is allowed. That was checked before relying on it.
 */

/* 255 colours in ramp order. Entry n is dBZ = -32 + (n - 1) * 0.5, so the
   whole scale is recovered from the index without storing a value per row. */
var RAMP_HEX = (
    "85718f85728f86738d87758b87768b887789897987897a878a7b858b7d848b7e848c7f828d81808d82808e837e" +
    "8f847c8f857c90877b918879918979928b77938d759691539894579b975b9d9a60a09d64a3a068a5a36da8a671" +
    "aaa976adac7ab0af7eb2b283b7b88cbabb90bdbe94bfc199c2c49dc4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4" +
    "c9ccb4c6c9b4c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4b0b6b4adb3b4aab0b4a4abb4a0a8b49da5b49aa2b4" +
    "97a0b4949db4919ab4949bb59098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a8" +
    "5f73a75b70a6576da44f67a24b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae4d7db24f84b6518bbb" +
    "5699c3599fc75ba6cb5eadcf60b4d462bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a24bd69043d67e" +
    "3cd66d35d65b11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e11" +
    "0c99110c95100c91100b880f0b840e0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308" +
    "467d085b88076f9207849d0698a806adb205c1bd05d6c704ead204ffe200ffd800ffd300ffce00ffc900ffc400" +
    "ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400ff8f00ff8a00ff8500ff8000ff0000f80000" +
    "f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000a300009b00009400008d00007f0000" +
    "780000710000fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960fa" +
    "f656f7f34bf4f040f1ed36efea2bece720e9e10be3b200ffac00fca400f79b00f49300ef8800ea8300e87900e2" +
    "7200dd6900db05ecf005ebf005eaf005dde005dce005dbe005cdd005ccd004bdc004bcc004bbc004aeb004adb0" +
    "049ea0049da0049ca0038e90038d90038c90037e80037d80036f70036e70036d70025f60025e60024f50024e50" +
    "024d50023f40023e40023d40013030012f30012020011f20011e203a67b53a66b53a65b53a64b53a63b53a62b5").toLowerCase().toLowerCase();

/* Light rain starts around here. Below it is clutter far more often than it
   is weather, which is the whole reason this screen was showing rain on a
   clear day. */
var MIN_DBZ = 20;

/* The tiles themselves. The base map is OpenStreetMap, filtered to dark cyan
   by CSS so the echoes read on top of it. */
var TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
var NEXRAD = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913";

/* Oldest to newest. The empty string is the live composite. */
var OFFSETS = ["m50m", "m45m", "m40m", "m35m", "m30m", "m25m",
               "m20m", "m15m", "m10m", "m05m", ""];

var FRAME_MS = 600;
var HOLD_MS = 1600;
var REFRESH_MS = 5 * 60 * 1000;
var MIN_WIND_MPH = 5;        // below this the streaks say nothing, so hide them

/* The four bands in the legend, and the colour each is drawn with. The dBZ
   edges are the usual rainfall rate breaks. */
var BANDS = [
    { label: "Light", dbz: 20, color: "#00e400" },
    { label: "Moderate", dbz: 35, color: "#ffff00" },
    { label: "Heavy", dbz: 45, color: "#ff0000" },
    { label: "Extreme", dbz: 55, color: "#ff00ff" }
];

/* packed 0xRRGGBB -> dBZ, built once. */
var DBZ_BY_RGB = (function () {
    var map = {};
    for (var i = 0; i < RAMP_HEX.length; i += 6) {
        var idx = i / 6 + 1;
        map[parseInt(RAMP_HEX.substr(i, 6), 16)] = -32 + (idx - 1) * 0.5;
    }
    return map;
})();

function Radar(options) {
    this.el = options.el;
    this.timeEl = options.timeEl || null;
    this.windEl = options.windEl || null;
    this.bannerEl = options.bannerEl || null;
    this.legendEl = options.legendEl || null;
    this.scrubEl = options.scrubEl || null;
    this.home = options.home;
    this.zoom = options.zoom || 8;

    this.map = null;
    this.layers = [];
    this.frame = OFFSETS.length - 1;
    this.playing = true;
    this.hasPrecip = true;
    this.lastRefresh = 0;
    this.lastStep = 0;
    this.wind = { speed: 0, bearing: 0 };
    this.particles = [];
    this.ctx = null;
    this.canvas = null;
    this._dragging = false;
}

Radar.prototype.mount = function () {
    if (this.map || !this.el || typeof window.L === "undefined") {
        return;
    }
    var L = window.L;
    var self = this;

    this.map = L.map(this.el, {
        center: [this.home.lat, this.home.lon],
        zoom: this.zoom,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
        dragging: true
    });

    L.tileLayer(TILES, { maxZoom: 18, className: "radar-base" }).addTo(this.map);

    var Filtered = makeFilteredLayer(L);
    for (var i = 0; i < OFFSETS.length; i++) {
        var url = NEXRAD + (OFFSETS[i] ? "-" + OFFSETS[i] : "") + "/{z}/{x}/{y}.png";
        var layer = new Filtered(url, { opacity: 0, maxZoom: 12, className: "radar-echo" });
        layer.addTo(this.map);
        this.layers.push(layer);
    }

    L.circleMarker([this.home.lat, this.home.lon], {
        radius: 5, color: "#3fe0ff", weight: 2,
        fillColor: "#bff4ff", fillOpacity: 0.9
    }).addTo(this.map);
    L.circle([this.home.lat, this.home.lon], {
        radius: 8000, color: "#3fe0ff", weight: 1, opacity: 0.45, fill: false
    }).addTo(this.map);

    this._buildWindCanvas();
    this._buildLegend();
    this._buildScrubber();

    this.lastRefresh = Date.now();
    this.show(OFFSETS.length - 1);
};

Radar.prototype.resize = function () {
    if (this.map) {
        this.map.invalidateSize();
    }
    this._sizeWindCanvas();
};

/* ---- frames ---------------------------------------------------------------- */

Radar.prototype.show = function (index) {
    for (var i = 0; i < this.layers.length; i++) {
        this.layers[i].setOpacity(i === index ? 0.8 : 0);
    }
    this.frame = index;
    if (this.timeEl) {
        this.timeEl.textContent = labelFor(index);
    }
    this._paintScrubber();
};

Radar.prototype.tick = function () {
    if (!this.map) {
        return;
    }
    var now = Date.now();

    if (this.playing && this.hasPrecip && !this._dragging) {
        var last = this.frame === this.layers.length - 1;
        if (now - this.lastStep > (last ? FRAME_MS + HOLD_MS : FRAME_MS)) {
            this.lastStep = now;
            this.show((this.frame + 1) % this.layers.length);
        }
    }

    if (now - this.lastRefresh > REFRESH_MS) {
        this.lastRefresh = now;
        this.refresh();
    }

    this._drawWind();
};

Radar.prototype.refresh = function () {
    for (var i = 0; i < this.layers.length; i++) {
        this.layers[i].redraw();
    }
};

/* Pirate Weather decides whether there is anything to animate. With nothing
   falling and no storm within reach of the map, looping eleven frames of
   leftover speckle is just an animation of noise, so it rests on the live
   frame and says so. */
Radar.prototype.setPrecip = function (hasPrecip) {
    if (this.hasPrecip === hasPrecip) {
        return;
    }
    this.hasPrecip = hasPrecip;
    if (this.bannerEl) {
        this.bannerEl.textContent = hasPrecip ? "" : "NO PRECIPITATION IN RANGE";
        this.bannerEl.style.display = hasPrecip ? "none" : "block";
    }
    if (!hasPrecip) {
        this.show(this.layers.length - 1);
    } else {
        this.lastStep = Date.now();
    }
    this._paintScrubber();
};

/* ---- the filtering tile layer ---------------------------------------------- */

/* A GridLayer that fetches the PNG itself, draws it to a canvas and clears
   every pixel below the threshold. crossOrigin is required or getImageData
   taints the canvas and throws. */
function makeFilteredLayer(L) {
    return L.GridLayer.extend({
        initialize: function (url, options) {
            this._url = url;
            L.GridLayer.prototype.initialize.call(this, options);
        },

        createTile: function (coords, done) {
            var size = this.getTileSize();
            var tile = document.createElement("canvas");
            tile.width = size.x;
            tile.height = size.y;

            var ctx = tile.getContext("2d", { willReadFrequently: true });
            var img = new Image();
            img.crossOrigin = "anonymous";

            img.onload = function () {
                try {
                    ctx.drawImage(img, 0, 0, size.x, size.y);
                    var data = ctx.getImageData(0, 0, size.x, size.y);
                    var p = data.data;
                    for (var i = 0; i < p.length; i += 4) {
                        if (p[i + 3] === 0) {
                            continue;
                        }
                        var dbz = DBZ_BY_RGB[(p[i] << 16) | (p[i + 1] << 8) | p[i + 2]];
                        /* Unknown colours are not part of the reflectivity
                           ramp, so they are not weather either. */
                        if (dbz === undefined || dbz < MIN_DBZ) {
                            p[i + 3] = 0;
                        }
                    }
                    ctx.putImageData(data, 0, 0);
                } catch (err) {
                    /* A tainted canvas would mean CORS stopped working. Better
                       a blank frame than raw unfiltered reflectivity. */
                    ctx.clearRect(0, 0, size.x, size.y);
                }
                done(null, tile);
            };

            img.onerror = function () { done(null, tile); };
            img.src = L.Util.template(this._url, L.extend({
                s: "a", x: coords.x, y: coords.y, z: coords.z
            }, this.options));

            return tile;
        }
    });
}

/* ---- legend ----------------------------------------------------------------- */

Radar.prototype._buildLegend = function () {
    if (!this.legendEl) {
        return;
    }
    var html = '<span class="radar-legend-title">Precipitation</span>';
    for (var i = 0; i < BANDS.length; i++) {
        html += '<span class="radar-legend-item">' +
            '<i style="background:' + BANDS[i].color + '"></i>' +
            BANDS[i].label + '</span>';
    }
    this.legendEl.innerHTML = html;
};

/* ---- scrubber ---------------------------------------------------------------- */

Radar.prototype._buildScrubber = function () {
    if (!this.scrubEl) {
        return;
    }
    var self = this;

    var html = '<button class="radar-play" type="button"></button>' +
        '<div class="radar-track">';
    for (var i = 0; i < OFFSETS.length; i++) {
        html += '<span class="radar-tick" data-i="' + i + '"><b></b></span>';
    }
    html += '</div><span class="radar-stamp"></span>';
    this.scrubEl.innerHTML = html;

    this.scrubEl.querySelector(".radar-play").addEventListener("click", function () {
        self.playing = !self.playing;
        self.lastStep = Date.now();
        self._paintScrubber();
    });

    var track = this.scrubEl.querySelector(".radar-track");

    var pick = function (clientX) {
        var box = track.getBoundingClientRect();
        var f = (clientX - box.left) / Math.max(1, box.width);
        var i = Math.round(f * (OFFSETS.length - 1));
        self.show(Math.max(0, Math.min(OFFSETS.length - 1, i)));
    };

    track.addEventListener("pointerdown", function (e) {
        self._dragging = true;
        self.playing = false;
        track.setPointerCapture(e.pointerId);
        pick(e.clientX);
    });
    track.addEventListener("pointermove", function (e) {
        if (self._dragging) {
            pick(e.clientX);
        }
    });
    var release = function () { self._dragging = false; self._paintScrubber(); };
    track.addEventListener("pointerup", release);
    track.addEventListener("pointercancel", release);

    this._paintScrubber();
};

Radar.prototype._paintScrubber = function () {
    if (!this.scrubEl) {
        return;
    }
    var play = this.scrubEl.querySelector(".radar-play");
    if (play) {
        var running = this.playing && this.hasPrecip;
        play.textContent = running ? "▐▐" : "▶";
        play.title = running ? "Pause" : "Play";
        play.className = "radar-play" + (running ? " on" : "");
    }

    var ticks = this.scrubEl.querySelectorAll(".radar-tick");
    for (var i = 0; i < ticks.length; i++) {
        var isNow = i === OFFSETS.length - 1;
        ticks[i].className = "radar-tick" +
            (i === this.frame ? " on" : "") +
            (isNow ? " now" : "") +
            (i <= this.frame ? " past" : "");
        ticks[i].firstChild.textContent = isNow ? "Now"
            : (i % 2 === 0 ? "-" + (OFFSETS.length - 1 - i) * 5 : "");
    }

    var stamp = this.scrubEl.querySelector(".radar-stamp");
    if (stamp) {
        var at = new Date(Date.now() - (OFFSETS.length - 1 - this.frame) * 5 * 60000);
        var h = at.getHours() % 12 || 12;
        var m = at.getMinutes();
        stamp.textContent = h + ":" + (m < 10 ? "0" + m : m) +
            (at.getHours() < 12 ? "am" : "pm");
    }
};

/* ---- wind -------------------------------------------------------------------- */

Radar.prototype.setWind = function (speedMph, bearingDegrees) {
    this.wind.speed = Number(speedMph) || 0;
    this.wind.bearing = Number(bearingDegrees) || 0;
    if (this.windEl) {
        this.windEl.textContent = this.wind.speed < MIN_WIND_MPH
            ? "calm"
            : Math.round(this.wind.speed) + " mph " + compass(this.wind.bearing);
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

    var want = Math.round((w * h) / 20000);
    this.particles = [];
    for (var i = 0; i < want; i++) {
        this.particles.push(newParticle(w, h));
    }
};

/* Thin low contrast streaks running with the wind. They are wind, not rain,
   so they stay faint and vanish entirely when there is barely any wind. */
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

    if (this.wind.speed < MIN_WIND_MPH) {
        return;
    }

    /* Meteorological bearing is where the wind comes from, so travel the
       other way. Screen y grows downward. */
    var rad = (this.wind.bearing + 180) * Math.PI / 180;
    var speed = 0.2 + this.wind.speed * 0.04;
    var dx = Math.sin(rad) * speed;
    var dy = -Math.cos(rad) * speed;

    ctx.lineWidth = 0.7;
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

        ctx.strokeStyle = "rgba(191,244,255," + (0.03 + 0.09 * (p.life / p.max)) + ")";
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - dx * 9, py - dy * 9);
        ctx.stroke();
    }
};

function newParticle(w, h) {
    var max = 90 + Math.random() * 130;
    return { x: Math.random() * w, y: Math.random() * h, life: max, max: max };
}

function labelFor(index) {
    var minutes = (OFFSETS.length - 1 - index) * 5;
    return minutes ? "-" + minutes + " MIN" : "NOW";
}

function compass(deg) {
    var names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return names[Math.round(((deg % 360) / 22.5)) % 16];
}

export { Radar, MIN_DBZ };
