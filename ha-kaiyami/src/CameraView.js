/* The Cameras screen: the Grid's surveillance room.
 *
 * Full viewport grid, same approach as House, Climate and Security. Four live
 * feeds in a 2x2, a detection log down the right, a status row across the top,
 * and the clock bottom right like every other screen.
 *
 * Nothing here looks like a Home Assistant camera card. Each feed sits in a
 * vector frame with corner brackets, a header bar and a timecode, and the
 * picture itself is pushed through a grayscale filter and then colour blended
 * to #3fe0ff so every feed is cyan monochrome.
 *
 * Video path, in order of preference:
 *   1. HLS from Home Assistant's stream component, played by hls.js. The URL
 *      is signed and single use, so no token reaches the page URL.
 *   2. The MJPEG proxy, using the camera entity's own rotating access_token.
 *   3. NO SIGNAL: cyan static and the time the camera was last seen. Never a
 *      broken image icon, which is why the <img> is hidden until it loads.
 */

import { CameraFeeds, KIND_ORDER } from "./CameraFeeds.js";

/* How long to wait for a first frame before giving up on HLS and trying the
 * MJPEG proxy. Home Assistant has to start ffmpeg, so this is generous. */
var HLS_FIRST_FRAME_MS = 18000;

/* Home Assistant expires an idle stream. hls.js notices as a network error on
 * the playlist, and a fresh signed URL fixes it, so a few retries are worth
 * more than dropping straight to MJPEG. */
var HLS_MAX_RETRIES = 3;

/* The glitch wipe between the grid and an enlarged feed. Must match the
 * cam-wipe keyframes in cameras-screen.css. */
var WIPE_MS = 460;
var WIPE_SWAP_MS = 150;

/* A detection keeps its frame lit for this long after the sensor clears, so a
 * half second occupancy blip is still readable. */
var FLASH_HOLD_MS = 6000;

/* A feed that Home Assistant says is up but that will not play is retried on
 * this interval rather than on every render pass. */
var OFFLINE_RETRY_MS = 20000;

function $id(id) {
    return document.getElementById(id);
}

function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
}

var CameraView = {};

var feeds = null;
var areas = null;
var active = false;
var built = false;
var dirty = true;
var lastRender = 0;
var lastQuality = 0;
var resizeTimer = null;
var observer = null;
var tiles = [];
var focused = null;      // entity id of the enlarged feed, or null for the grid
var wipeTimer = null;
var swapTimer = null;

/* ---- one tile, and the stream behind it -------------------------------------- */

function Tile(cam, index) {
    this.id = cam.id;
    this.num = cam.num;
    this.index = index;
    this.mode = "idle";       // idle, starting, hls, mjpeg, offline
    this.hls = null;
    this.retries = 0;
    this.startedAt = 0;
    this.playingSince = 0;
    this.offlineAt = 0;
    this.wasLive = undefined;
    this.bars = 0;
    this.lastTc = "";
    this.lastBadge = "";
    this.flashUntil = 0;
    this.flashKind = null;
    this.el = buildTile(cam, index);
    this.screen = this.el.querySelector(".cam-screen");
    this.video = this.el.querySelector(".cam-video");
    this.mjpeg = this.el.querySelector(".cam-mjpeg");
    this.still = this.el.querySelector(".cam-still");
    this.staticCanvas = this.el.querySelector(".cam-static");
    this.staticCtx = this.staticCanvas.getContext("2d");
    this.badge = this.el.querySelector(".cam-badge");
    this.tc = this.el.querySelector(".cam-tc");
    this.live = this.el.querySelector(".cam-live");
    this.rec = this.el.querySelector(".cam-rec");
    this.barEls = Array.prototype.slice.call(this.el.querySelectorAll(".cam-bars b"));
    this.kinds = this.el.querySelector(".cam-kinds");
    this.nosig = this.el.querySelector(".cam-nosig");
    this.lastSeenEl = this.el.querySelector(".cam-lastseen");
    this.boxLayer = this.el.querySelector(".cam-boxes");

    /* Bound once. watchFirstFrame used to add these per attempt, which left a
       pair of listeners behind on every HLS retry. */
    var self = this;
    var promote = function () { self.onFirstFrame(); };
    this.video.addEventListener("playing", promote);
    this.video.addEventListener("loadeddata", promote);
}

/* The stream produced a frame, so this is a live feed now. */
Tile.prototype.onFirstFrame = function () {
    if (this.mode !== "starting") {
        return;
    }
    clearTimeout(this._frameTimer);
    this.mode = "hls";
    this.playingSince = Date.now();
    this.video.classList.add("on");
    this.still.classList.remove("on");
    this.el.classList.remove("offline");
    dirty = true;
};

function buildTile(cam, index) {
    var el = document.createElement("div");
    el.className = "cam-tile";
    el.setAttribute("data-cam", cam.id);
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", cam.label + " camera feed");

    el.innerHTML =
        '<div class="cam-frame">' +
            '<div class="cam-head">' +
                '<span class="cam-idno">' + cam.num + '</span>' +
                '<span class="cam-name">' + cam.label + '</span>' +
                '<span class="cam-view">' + cam.view + '</span>' +
                '<span class="cam-tc">--:--:--</span>' +
            '</div>' +
            '<div class="cam-screen">' +
                /* The still sits furthest back so the frame shows a picture
                   while the stream is still negotiating. */
                '<img class="cam-still" alt="">' +
                '<video class="cam-video" muted playsinline autoplay ' +
                    'disablepictureinpicture></video>' +
                '<img class="cam-mjpeg" alt="">' +
                '<canvas class="cam-static"></canvas>' +
                /* Colour blend layer: the picture above is already grayscale,
                   and this paints the palette cyan back onto it. */
                '<div class="cam-tint"></div>' +
                '<div class="cam-scan"></div>' +
                '<div class="cam-grain"></div>' +
                '<div class="cam-vig"></div>' +
                '<div class="cam-boxes"></div>' +
                '<div class="cam-nosig">' +
                    '<b>NO SIGNAL</b>' +
                    '<span class="cam-lastseen"></span>' +
                '</div>' +
                '<div class="cam-badge"></div>' +
                '<div class="cam-foot">' +
                    '<span class="cam-rec"><i></i>REC</span>' +
                    '<span class="cam-bars"><b></b><b></b><b></b><b></b></span>' +
                    '<span class="cam-live">CONNECTING</span>' +
                    '<span class="cam-kinds"></span>' +
                '</div>' +
                '<span class="cam-c tl"></span><span class="cam-c tr"></span>' +
                '<span class="cam-c bl"></span><span class="cam-c br"></span>' +
            '</div>' +
        '</div>';

    return el;
}

/* ---- stream wiring ----------------------------------------------------------- */

Tile.prototype.connect = function (cam) {
    if (this.mode !== "idle" && this.mode !== "offline") {
        return;
    }
    if (!cam.live) {
        this.goOffline();
        return;
    }

    this.mode = "starting";
    this.startedAt = Date.now();
    this.el.classList.remove("offline");

    var still = feeds.stillUrl(cam.id);
    if (still) {
        this.still.src = still;
        this.still.classList.add("on");
    }

    var self = this;
    feeds.hlsUrl(cam.id).then(function (url) {
        /* The screen may have been closed, or the feed already dropped to
           MJPEG, while Home Assistant was starting ffmpeg. */
        if (self.mode !== "starting") {
            return;
        }
        self.playHls(url);
    }).catch(function () {
        self.playMjpeg();
    });
};

Tile.prototype.playHls = function (url) {
    var self = this;
    var video = this.video;

    /* Safari plays HLS natively and hls.js refuses to run there. */
    if (!window.Hls || !window.Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = url;
            this.watchFirstFrame();
            return;
        }
        this.playMjpeg();
        return;
    }

    this.teardownHls();

    var hls = new window.Hls({
        /* A surveillance wall wants the newest frame, not a smooth buffer. */
        lowLatencyMode: true,
        liveSyncDurationCount: 1,
        backBufferLength: 4,
        /* Home Assistant answers 404 on the playlist until ffmpeg has
           written a first segment, so the manifest needs real patience here.
           Without it the slowest camera looked like a dead one. */
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 8,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 8000,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 1000,
        fragLoadingTimeOut: 20000,
        enableWorker: true
    });
    this.hls = hls;

    hls.on(window.Hls.Events.ERROR, function (evt, data) {
        if (!data || !data.fatal) {
            return;
        }
        /* An expired stream looks like a playlist network error. A fresh
           signed URL usually fixes it, so retry before dropping to MJPEG. */
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR &&
            self.retries < HLS_MAX_RETRIES) {
            self.retries += 1;
            self.teardownHls();
            self.mode = "starting";
            /* Pause before asking again. A fresh signed URL for a stream that
               has not started yet 404s just as fast as the last one did. */
            clearTimeout(self._retryTimer);
            self._retryTimer = setTimeout(function () {
                if (self.mode !== "starting") {
                    return;
                }
                feeds.hlsUrl(self.id).then(function (fresh) {
                    if (self.mode === "starting") {
                        self.playHls(fresh);
                    }
                }).catch(function () {
                    self.playMjpeg();
                });
            }, 2000);
            return;
        }
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR &&
            self.retries < HLS_MAX_RETRIES) {
            self.retries += 1;
            hls.recoverMediaError();
            return;
        }
        self.playMjpeg();
    });

    hls.loadSource(url);
    hls.attachMedia(video);
    video.play().catch(function () {
        /* Autoplay is allowed because the video is muted, but a rejected
           promise here is not fatal: the first frame watcher decides. */
    });
    this.watchFirstFrame();
};

/* HLS can sit at zero frames forever if ffmpeg never starts. Give it a
 * deadline and fall back rather than leave an empty frame. */
Tile.prototype.watchFirstFrame = function () {
    var self = this;
    clearTimeout(this._frameTimer);
    this._frameTimer = setTimeout(function () {
        if (self.mode === "starting") {
            self.playMjpeg();
        }
    }, HLS_FIRST_FRAME_MS);
};

Tile.prototype.playMjpeg = function () {
    this.teardownHls();
    clearTimeout(this._frameTimer);
    clearTimeout(this._retryTimer);

    var url = feeds.mjpegUrl(this.id);
    if (!url) {
        this.goOffline();
        return;
    }

    var self = this;
    this.mode = "starting";
    this.video.classList.remove("on");

    /* The <img> stays hidden until it has actually decoded a frame, so a
       failing feed shows the NO SIGNAL panel and never a broken image icon. */
    this.mjpeg.onload = function () {
        self.mode = "mjpeg";
        self.playingSince = Date.now();
        self.mjpeg.classList.add("on");
        self.still.classList.remove("on");
        self.el.classList.remove("offline");
        dirty = true;
    };
    this.mjpeg.onerror = function () {
        self.mjpeg.classList.remove("on");
        self.goOffline();
    };
    this.mjpeg.src = url;
};

Tile.prototype.goOffline = function () {
    this.teardownHls();
    clearTimeout(this._frameTimer);
    this.mode = "offline";
    this.offlineAt = Date.now();
    /* tile.bars is deliberately not touched here. It records what the footer
       is currently showing, and zeroing it made renderQuality think the bars
       had already been cleared, so a dead feed kept four lit bars. */
    this.video.classList.remove("on");
    this.mjpeg.classList.remove("on");
    this.mjpeg.removeAttribute("src");
    this.still.classList.remove("on");
    this.still.removeAttribute("src");
    this.el.classList.add("offline");
    dirty = true;
};

Tile.prototype.teardownHls = function () {
    if (this.hls) {
        try {
            this.hls.destroy();
        } catch (err) {
            /* Already gone. */
        }
        this.hls = null;
    }
    this.video.removeAttribute("src");
};

Tile.prototype.disconnect = function () {
    this.teardownHls();
    clearTimeout(this._frameTimer);
    clearTimeout(this._retryTimer);
    this.mjpeg.onload = null;
    this.mjpeg.onerror = null;
    this.mjpeg.removeAttribute("src");
    this.still.removeAttribute("src");
    this.video.classList.remove("on");
    this.mjpeg.classList.remove("on");
    this.still.classList.remove("on");
    this.mode = "idle";
    this.retries = 0;
};

/* Signal strength, measured rather than decorated.
 *
 * Buffer depth is deliberately not used: lowLatencyMode throws the buffer away
 * on purpose, so a perfectly healthy low latency feed has almost nothing ahead
 * of the playhead and measuring that read every feed as one bar. What actually
 * matters on a live wall is whether the picture is still advancing and whether
 * frames are being dropped now, so both are sampled over a window rather than
 * taken cumulatively from the start of the stream.
 *
 *   0  no signal          2  running on the MJPEG fallback
 *   1  starting, or the picture has stalled
 *   3  playing, dropping frames        4  playing clean
 */
Tile.prototype.quality = function () {
    if (this.mode === "offline") {
        return 0;
    }
    if (this.mode === "starting") {
        return 1;
    }
    if (this.mode === "mjpeg") {
        return 2;
    }

    var video = this.video;
    var now = Date.now();
    var time = video.currentTime;

    /* Is the picture moving. A live feed whose currentTime has not changed in
       a second and a half has stalled, whatever its buffer says. */
    if (this._qTime === undefined) {
        this._qTime = time;
        this._qAt = now;
        this._stalled = false;
    } else if (time > this._qTime + 0.01) {
        this._qTime = time;
        this._qAt = now;
        this._stalled = false;
    } else if (now - this._qAt > 1500) {
        this._stalled = true;
    }

    if (this._stalled || video.readyState < 2) {
        return 1;
    }

    /* Dropped frames over the last window, not since the stream began, so a
       burst of drops while the decoder warmed up does not pin the bars low
       for as long as the screen is open. */
    if (video.getVideoPlaybackQuality) {
        var q = video.getVideoPlaybackQuality();
        var total = q.totalVideoFrames - (this._qTotal || 0);
        var dropped = q.droppedVideoFrames - (this._qDropped || 0);
        this._qTotal = q.totalVideoFrames;
        this._qDropped = q.droppedVideoFrames;
        if (total > 20 && dropped / total > 0.05) {
            return 3;
        }
    }

    return 4;
};

Tile.prototype.sizeStatic = function () {
    var w = this.screen.clientWidth;
    var h = this.screen.clientHeight;
    if (!w || !h) {
        return;
    }
    /* Deliberately coarse. Static drawn at a third of the real resolution
       reads as broadcast snow and costs almost nothing, and only offline
       tiles draw at all. */
    this.staticCanvas.width = Math.max(1, Math.floor(w / 3));
    this.staticCanvas.height = Math.max(1, Math.floor(h / 3));
};

/* Cyan snow. Only called for a tile that has no signal. */
Tile.prototype.drawStatic = function () {
    var c = this.staticCanvas;
    var ctx = this.staticCtx;
    if (!ctx || !c.width || !c.height) {
        return;
    }
    var img = ctx.createImageData(c.width, c.height);
    var data = img.data;
    for (var i = 0; i < data.length; i += 4) {
        var v = Math.random() * 255;
        /* Weighted to the cyan in the palette rather than white noise. */
        data[i] = v * 0.25;
        data[i + 1] = v * 0.88;
        data[i + 2] = v;
        data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
};

/* ---- screen lifecycle --------------------------------------------------------- */

CameraView.init = function (ha, areasRef) {
    var root = $id("cameras-screen");
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;
    areas = areasRef;

    if (!feeds && ha) {
        feeds = new CameraFeeds(ha, areas, function () { dirty = true; });
        feeds.start();
    }

    if (!built) {
        built = true;
        buildGrid();
        bindControls();
    }

    watchPanels();

    requestAnimationFrame(function () {
        requestAnimationFrame(function () { CameraView.resize(); });
    });

    dirty = true;
};

CameraView.show = function () {
    active = true;
    var root = $id("cameras-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
    CameraView.resize();
    openStreams();
};

CameraView.hide = function () {
    active = false;
    $id("cameras-screen").style.display = "none";
    /* Four decoders and four ffmpeg processes are not worth leaving running
       behind another screen. */
    tiles.forEach(function (t) { t.disconnect(); });
};

CameraView.message = function (m) {
    if (feeds && feeds.note(m)) {
        dirty = true;
    }
};

CameraView.seed = function () {
    dirty = true;
};

CameraView.animate = function () {
    if (!active || !feeds) {
        return;
    }

    var now = Date.now();
    var list = feeds.cameras();

    renderTimecodes(now);
    renderStatic(list);
    renderClock(now);

    /* Signal bars move on their own clock: often enough to be live, rarely
       enough that it is not a per frame DOM write. */
    if (now - lastQuality > 500) {
        lastQuality = now;
        renderQuality();
    }

    if (dirty && now - lastRender > 400) {
        lastRender = now;
        dirty = false;
        renderFrames(list, now);
        renderStatus();
        renderLog();
    } else {
        /* The highlight has to expire on its own, with no event to prompt it. */
        for (var i = 0; i < tiles.length; i++) {
            if (tiles[i].flashUntil && now > tiles[i].flashUntil) {
                dirty = true;
            }
        }
    }
};

CameraView.resize = function () {
    if (!active) {
        return;
    }
    tiles.forEach(function (t) { t.sizeStatic(); });
    dirty = true;
};

CameraView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        CameraView.resize();
    }, 150);
};

function watchPanels() {
    if (observer || typeof ResizeObserver === "undefined") {
        return;
    }
    observer = new ResizeObserver(function () { CameraView.resizeDebounced(); });
    var grid = $id("cam-grid");
    if (grid) {
        observer.observe(grid);
    }
}

function buildGrid() {
    var grid = $id("cam-grid");
    if (!grid || !feeds) {
        return;
    }
    tiles = feeds.cameras().map(function (cam, i) {
        var tile = new Tile(cam, i);
        grid.appendChild(tile.el);
        return tile;
    });
}

function openStreams() {
    if (!feeds) {
        return;
    }
    var list = feeds.cameras();
    tiles.forEach(function (tile, i) {
        tile.retries = 0;
        tile.connect(list[i]);
    });
}

/* ---- the frames ---------------------------------------------------------------- */

function renderFrames(list, now) {
    tiles.forEach(function (tile, i) {
        var cam = list[i];
        if (!cam) {
            return;
        }

        /* A camera that dropped out while the screen was open, and one that
           came back. */
        /* undefined on the first pass, so opening the screen is never
           mistaken for a camera coming back. */
        var cameBack = cam.live && tile.wasLive === false;
        tile.wasLive = cam.live;

        if (!cam.live && tile.mode !== "offline") {
            tile.goOffline();
        } else if (cam.live && tile.mode === "offline" &&
                   (cameBack || now - (tile.offlineAt || 0) > OFFLINE_RETRY_MS)) {
            /* Two different reasons to be dark, and they deserve different
               treatment. A camera Home Assistant has just called available
               again reconnects at once. One that Home Assistant calls up but
               that will not stream is backed off, so it is not retried on
               every render pass. */
            tile.retries = 0;
            tile.mode = "idle";
            tile.connect(cam);
        }

        /* Hold the last detection on screen briefly after it clears. */
        var flash = feeds.flash[cam.id];
        if (cam.alert) {
            tile.flashKind = cam.alert;
            tile.flashUntil = now + FLASH_HOLD_MS;
        } else if (flash && now - flash.at < FLASH_HOLD_MS) {
            tile.flashKind = flash.kind;
            tile.flashUntil = flash.at + FLASH_HOLD_MS;
        } else if (tile.flashUntil && now > tile.flashUntil) {
            tile.flashKind = null;
            tile.flashUntil = 0;
        }

        var kind = tile.flashKind;
        var level = kind ? levelOf(cam, kind) : null;

        tile.el.classList.toggle("det", !!kind && cam.live);
        tile.el.classList.toggle("det-alert", level === "alert" && cam.live);
        tile.el.classList.toggle("det-motion", level === "motion" && cam.live);

        var badge = kind && cam.live ? labelOf(kind) : "";
        if (badge !== tile.lastBadge) {
            tile.lastBadge = badge;
            tile.badge.textContent = badge;
            if (badge) {
                glitch(tile.el);
            }
        }

        tile.rec.classList.toggle("on", cam.recording && cam.live);
        tile.live.textContent = cam.live
            ? (tile.mode === "hls" ? "LIVE"
               : tile.mode === "mjpeg" ? "LIVE MJPEG"
               : tile.mode === "offline" ? "NO SIGNAL" : "CONNECTING")
            : "NO SIGNAL";
        tile.live.className = "cam-live" +
            (tile.mode === "offline" || !cam.live ? " bad" : "") +
            (tile.mode === "hls" || tile.mode === "mjpeg" ? " ok" : "");

        /* Only the detectors this camera really has. */
        tile.kinds.innerHTML = KIND_ORDER.filter(function (k) {
            return cam.has[k];
        }).map(function (k) {
            return '<i class="' + (cam.on[k] ? "on " + levelOf(cam, k) : "") + '">' +
                k + '</i>';
        }).join("");

        tile.nosig.style.display = (tile.mode === "offline" || !cam.live) ? "flex" : "none";
        tile.lastSeenEl.textContent = cam.lastSeen
            ? "LAST SEEN " + stamp(cam.lastSeen) + ", " + ago(now - cam.lastSeen) + " AGO"
            : "NEVER REPORTED";

        renderBoxes(tile, cam);
    });
}

/* Real box data only. No source on this house publishes one, so this normally
 * clears the layer and draws nothing. */
function renderBoxes(tile, cam) {
    if (!cam.boxes.length) {
        if (tile.boxLayer.childNodes.length) {
            tile.boxLayer.innerHTML = "";
        }
        return;
    }
    tile.boxLayer.innerHTML = cam.boxes.map(function (b) {
        /* Frigate publishes [x, y, w, h] as fractions of the frame. */
        return '<span style="left:' + (b[0] * 100) + '%;top:' + (b[1] * 100) +
            '%;width:' + (b[2] * 100) + '%;height:' + (b[3] * 100) + '%"></span>';
    }).join("");
}

function levelOf(cam, kind) {
    return kind === "person" || kind === "vehicle" || kind === "visitor"
        ? "alert" : "motion";
}

function labelOf(kind) {
    return kind === "person" ? "PERSON DETECTED"
        : kind === "vehicle" ? "VEHICLE DETECTED"
        : kind === "visitor" ? "DOORBELL PRESSED"
        : kind === "pet" ? "PET DETECTED"
        : kind === "object" ? "OBJECT DETECTED"
        : "MOTION DETECTED";
}

/* One shot digital glitch. Removing and re-adding the class with a reflow
 * between is what restarts a CSS animation that is already on the element. */
function glitch(el) {
    el.classList.remove("glitching");
    void el.offsetWidth;
    el.classList.add("glitching");
    setTimeout(function () { el.classList.remove("glitching"); }, 420);
}

function renderTimecodes(now) {
    var d = new Date(now);
    var tc = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    tiles.forEach(function (tile) {
        if (tile.lastTc !== tc) {
            tile.lastTc = tc;
            tile.tc.textContent = tc;
        }
    });
}

function renderStatic(list) {
    tiles.forEach(function (tile, i) {
        var cam = list[i];
        if (tile.mode === "offline" || (cam && !cam.live)) {
            tile.drawStatic();
        }
    });
}

function renderQuality() {
    tiles.forEach(function (tile) {
        var bars = tile.quality();
        if (bars === tile.bars) {
            return;
        }
        tile.bars = bars;
        tile.barEls.forEach(function (b, i) {
            b.classList.toggle("on", i < bars);
        });
    });
}

/* ---- enlarge one feed ----------------------------------------------------------- */

function setFocus(id) {
    if (focused === id) {
        return;
    }
    focused = id;

    var grid = $id("cam-grid");
    grid.classList.toggle("focus", !!id);
    tiles.forEach(function (tile) {
        tile.el.classList.toggle("is-focus", tile.id === id);
    });

    /* The picture box changes shape, so the static canvas has to follow. */
    tiles.forEach(function (t) { t.sizeStatic(); });

    var head = $id("cam-grid-head");
    if (head) {
        var cam = id && feeds ? feeds.camera(id) : null;
        head.innerHTML = cam
            ? 'Feed <em>' + cam.num + " " + cam.label.toUpperCase() +
              ", ESC to return</em>"
            : 'Feeds <em>Click a feed to enlarge</em>';
    }
}

/* Switching or enlarging runs a scanline wipe over the stage and swaps the
 * layout under it, so the reflow happens behind the sweep. */
function wipeTo(id) {
    var stage = $id("cam-stage");
    var wipe = $id("cam-wipe");
    if (!stage || !wipe) {
        setFocus(id);
        return;
    }

    clearTimeout(wipeTimer);
    clearTimeout(swapTimer);

    wipe.classList.remove("run");
    void wipe.offsetWidth;
    wipe.classList.add("run");
    stage.classList.add("wiping");

    swapTimer = setTimeout(function () { setFocus(id); }, WIPE_SWAP_MS);
    wipeTimer = setTimeout(function () {
        wipe.classList.remove("run");
        stage.classList.remove("wiping");
    }, WIPE_MS);
}

/* ---- status row ------------------------------------------------------------------ */

function stat(id, value, bad) {
    var el = $id(id);
    if (!el) {
        return;
    }
    el.firstChild.textContent = value;
    el.className = "cm-stat" + (bad ? " bad" : "");
}

function renderStatus() {
    if (!feeds) {
        return;
    }
    var s = feeds.stats();

    stat("cm-stat-online", s.online + " / " + s.total, s.online < s.total);
    stat("cm-stat-today", s.seeded ? String(s.today) : "--", false);

    var el = $id("cm-stat-person");
    if (el) {
        if (s.lastPerson) {
            el.firstChild.textContent = s.lastPerson.where;
            el.querySelector("span").textContent =
                "Last person, " + stamp(s.lastPerson.at);
        } else {
            el.firstChild.textContent = s.seeded ? "NONE" : "--";
            el.querySelector("span").textContent = "Last person detected";
        }
        el.className = "cm-stat";
    }

    var list = feeds.cameras();
    var recording = list.filter(function (c) { return c.recording && c.live; }).length;
    stat("cm-stat-rec", recording + " / " + list.length, false);
}

/* ---- the detection log ----------------------------------------------------------- */

function renderLog() {
    var box = $id("cam-log");
    if (!box || !feeds) {
        return;
    }
    if (!feeds.log.length) {
        box.innerHTML = '<div class="cam-wait">' +
            (feeds.stats().seeded ? "No detections in 24 hours" : "Loading history") +
            '</div>';
        return;
    }

    var html = "";
    for (var i = 0; i < feeds.log.length && i < 120; i++) {
        var e = feeds.log[i];
        html += '<div class="cam-log-row ' + e.level +
            (e.camera === focused ? " on" : "") +
            '" data-cam="' + e.camera + '">' +
            '<span class="t">' + stamp(e.at) + '</span>' +
            '<span class="c">' + e.num + '</span>' +
            '<span class="w">' + e.where + '</span>' +
            '<span class="k">' + e.short +
            (e.count > 1 ? ' <b>x' + e.count + '</b>' : '') + '</span>' +
            '</div>';
    }
    box.innerHTML = html;
}

/* ---- time ------------------------------------------------------------------------- */

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"];

/* 12 hour with a trailing a or p, the same shape the Security log uses. */
function stamp(ms) {
    var t = new Date(ms);
    return (t.getHours() % 12 || 12) + ":" + pad(t.getMinutes()) + ":" +
        pad(t.getSeconds()) + (t.getHours() < 12 ? "a" : "p");
}

function ago(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) { return s + " SEC"; }
    var m = Math.round(s / 60);
    if (m < 60) { return m + " MIN"; }
    var h = Math.floor(m / 60);
    if (h < 48) { return h + " HR"; }
    return Math.floor(h / 24) + " DAYS";
}

var lastClock = "";

function renderClock(now) {
    var el = $id("cm-time");
    if (!el) {
        return;
    }
    var d = new Date(now);
    var h = d.getHours();
    var text = (h % 12 || 12) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    if (text === lastClock) {
        return;
    }
    lastClock = text;
    el.innerHTML = text + "<small>" + (h < 12 ? "AM" : "PM") + "</small>";
    var dt = $id("cm-date");
    if (dt) {
        dt.textContent = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " +
            d.getDate() + ", " + d.getFullYear();
    }
}

/* ---- controls ---------------------------------------------------------------------- */

function bindControls() {
    var root = $id("cameras-screen");

    root.addEventListener("click", function (e) {
        var row = e.target.closest(".cam-log-row");
        if (row) {
            /* Clicking a log entry focuses that camera. */
            wipeTo(row.getAttribute("data-cam"));
            dirty = true;
            return;
        }

        var tile = e.target.closest(".cam-tile");
        if (!tile) {
            return;
        }
        var id = tile.getAttribute("data-cam");
        wipeTo(focused === id ? null : id);
        dirty = true;
    });

    /* Keyboard, for the same reason the House screen has it: Escape is the
       obvious way back and a feed is a focusable control. */
    root.addEventListener("keydown", function (e) {
        var tile = e.target.closest(".cam-tile");
        if (tile && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            var id = tile.getAttribute("data-cam");
            wipeTo(focused === id ? null : id);
            dirty = true;
        }
    });

    window.addEventListener("keydown", function (e) {
        if (!active || e.key !== "Escape" || !focused) {
            return;
        }
        wipeTo(null);
        dirty = true;
    });
}

export { CameraView };
