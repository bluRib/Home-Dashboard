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
