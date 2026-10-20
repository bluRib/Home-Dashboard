/* The Homelab screen, as a placeholder.
 *
 * Nothing scrapes Proxmox or the services yet: Prometheus on 10.69.2.134 runs
 * two jobs, itself and unpoller, so there is no node, VM, container or service
 * data to draw. Rather than invent panels against data that does not exist,
 * this is a real screen in the switch that says so, and the folder, the
 * terminal and the splash can be verified end to end today.
 *
 * It keeps the same contract as every other screen (init, show, hide, message,
 * seed, animate, resize, resizeDebounced) so the real panels drop straight in.
 */

function $id(id) {
    return document.getElementById(id);
}

function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
}

var HomelabView = {};

var active = false;
var resizeTimer = null;
var lastClock = "";

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"];

HomelabView.init = function () {
    var root = $id("homelab-screen");
    root.style.display = "grid";
    root.style.visibility = "hidden";
    active = true;
};

HomelabView.show = function () {
    active = true;
    var root = $id("homelab-screen");
    root.style.display = "grid";
    root.style.visibility = "visible";
};

HomelabView.hide = function () {
    active = false;
    $id("homelab-screen").style.display = "none";
};

/* Nothing to route yet. The method exists so main.js does not need a special
   case for this screen once it starts reading the bus. */
HomelabView.message = function () {};

HomelabView.seed = function () {};

HomelabView.animate = function () {
    if (!active) {
        return;
    }
    renderClock();
};

HomelabView.resize = function () {};

HomelabView.resizeDebounced = function () {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        resizeTimer = null;
        HomelabView.resize();
    }, 150);
};

function renderClock() {
    var el = $id("hl-time");
    if (!el) {
        return;
    }
    var d = new Date();
    var h = d.getHours();
    var text = (h % 12 || 12) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    if (text === lastClock) {
        return;
    }
    lastClock = text;
    el.innerHTML = text + "<small>" + (h < 12 ? "AM" : "PM") + "</small>";
    var dt = $id("hl-date");
    if (dt) {
        dt.textContent = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " +
            d.getDate() + ", " + d.getFullYear();
    }
}

export { HomelabView };
