/* The 3D house, mounted as one widget on the House screen.
 *
 * Loaded as its own ES module, NOT through the esbuild bundle. That is the
 * BUILD.md step 6 decision: the house needs three.js r128, the boardroom's
 * widgets need r66, and r125 removed THREE.Geometry, which Box, SatBar,
 * StockChart, Swirls, TimerTrees, Logo and encom-globe all rely on. Keeping
 * r128 inside module scope means it never touches the bundle's THREE.
 *
 * Boardroom.js talks to this through window.HouseWidget, which is the only
 * thing that crosses between the two worlds.
 */
import { HouseScreen } from "../app/js/screens/house.js";

var screen = null;
var mounted = false;

window.HouseWidget = {

    /* Called by Boardroom.init when the House system opens. */
    mount: function () {
        if (mounted) {
            screen.show();
            return;
        }

        var canvas = document.getElementById("house-canvas");
        if (!canvas) {
            console.warn("house-widget: no #house-canvas in the page");
            return;
        }

        screen = new HouseScreen({
            canvas: canvas,
            tagLayer: document.getElementById("house-tags"),
            leadLayer: document.getElementById("house-lead"),
            basePath: "../models/"
        });

        screen.init({});
        screen.show();
        mounted = true;

        /* Mark the panel once the model is on screen. This used to target
           "house-widget", which is not an element on the page, so every
           successful load threw inside the then() and surfaced through the
           catch() below as if the model had failed to load. The panel that
           actually holds the canvas is #hs-house. */
        screen.load().then(function () {
            var panel = document.getElementById("hs-house");
            if (panel) {
                panel.classList.add("ready");
            }
        }).catch(function (err) {
            console.error("house-widget: " + err.message);
        });
    },

    unmount: function () {
        if (screen) {
            screen.hide();
        }
    },

    /* Forwarded from Boardroom.message. Same Encom message shape. */
    message: function (m) {
        if (screen) {
            screen.message(m);
        }
    },

    animate: function () {
        if (screen) {
            screen.animate();
        }
    },

    resize: function () {
        if (screen) {
            screen.resize();
        }
    },

    /* Driven by the House screen's floor buttons and room list. */
    setLevel: function (level) {
        if (screen) {
            screen.setLevel(level);
        }
    },

    focus: function (roomKey) {
        if (screen) {
            screen.focus(roomKey);
        }
    },

    /* "3d" or "top". */
    setView: function (preset) {
        if (screen) {
            screen.setView(preset);
        }
    }
};

/* ---------------------------------------------------------------------------
   The thermal house on the Climate screen.

   A second HouseScreen with its own canvas, rather than sharing the one
   above: both screens can be initialised in the same session and a single
   instance can only be attached to one canvas. The model JSON is fetched
   again, but the browser serves it from cache, and the two instances never
   talk to each other.

   No tag or leader layers: the panel is a thumbnail and room labels would
   not be readable in it.
   --------------------------------------------------------------------------- */

var thermal = null;
var thermalMounted = false;

window.HouseThermal = {

    mount: function () {
        if (thermalMounted) {
            thermal.show();
            return;
        }

        var canvas = document.getElementById("cl-thermal-canvas");
        if (!canvas) {
            console.warn("house-widget: no #cl-thermal-canvas in the page");
            return;
        }

        thermal = new HouseScreen({ canvas: canvas, basePath: "../models/" });
        thermal.init({});
        thermal.show();
        thermalMounted = true;

        thermal.load().then(function () {
            /* Straight down on both floors, which is the only view that shows
               every room at once in a panel this small. */
            thermal.setLevel(0);
            thermal.setView("top");
            var panel = document.getElementById("cl-thermal");
            if (panel) {
                panel.classList.add("ready");
            }
        }).catch(function (err) {
            console.error("house-thermal: " + err.message);
        });
    },

    unmount: function () {
        if (thermal) {
            thermal.hide();
        }
    },

    /* { roomKey: { color, opacity } } */
    tint: function (map) {
        if (thermal) {
            thermal.setTints(map);
        }
    },

    animate: function () {
        if (thermal) {
            thermal.animate();
        }
    },

    resize: function () {
        if (thermal) {
            thermal.resize();
        }
    }
};

/* ---------------------------------------------------------------------------
   The security map on the Security screen. A third HouseScreen, same reason
   as the second: one instance can only drive one canvas, and all three
   screens can be open in a session.
   --------------------------------------------------------------------------- */

var security = null;
var securityMounted = false;

window.HouseSecurity = {

    mount: function (onMarkerPick) {
        if (securityMounted) {
            security.show();
            return;
        }

        var canvas = document.getElementById("sc-house-canvas");
        if (!canvas) {
            console.warn("house-widget: no #sc-house-canvas in the page");
            return;
        }

        /* No tag or leader layers. Room names are the House screen's job and
            this map is about the markers. */
        security = new HouseScreen({
            canvas: canvas,
            basePath: "../models/",
            onMarkerPick: onMarkerPick
        });

        security.init({});
        security.show();
        securityMounted = true;

        security.load().then(function () {
            security.setLevel(0);
            var panel = document.getElementById("sc-house");
            if (panel) {
                panel.classList.add("ready");
            }
        }).catch(function (err) {
            console.error("house-security: " + err.message);
        });
    },

    unmount: function () {
        if (security) {
            security.hide();
        }
    },

    markers: function (list) {
        if (security) {
            security.setMarkers(list);
        }
    },

    markerState: function (state) {
        if (security) {
            security.updateMarkers(state);
        }
    },

    tint: function (map) {
        if (security) {
            security.setTints(map);
        }
    },

    /* Drive the existing green ring pulse for a room that just saw motion. */
    message: function (m) {
        if (security) {
            security.message(m);
        }
    },

    animate: function () {
        if (security) {
            security.animate();
        }
    },

    resize: function () {
        if (security) {
            security.resize();
        }
    }
};
