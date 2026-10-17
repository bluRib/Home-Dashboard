/* Water leak watch.
 *
 * A leak outranks whatever is on screen, so this runs from the moment the
 * dashboard connects rather than only while the Security screen is open. It
 * owns one banner that sits above every screen and the launcher, and it stays
 * up until the sensor is dry again. Nothing dismisses it by hand.
 */

var CHECK_MS = 5000;

function LeakWatch(ha, areas) {
    this.ha = ha;
    this.areas = areas;
    this.wet = [];
    this._timer = null;
}

LeakWatch.prototype.start = function () {
    var self = this;
    if (this._timer || !this.ha) {
        return;
    }
    /* Polling the state map rather than listening for events, because the
       banner has to be right after a reconnect too, not just after a change. */
    this._timer = setInterval(function () { self.check(); }, CHECK_MS);
    this.check();
};

LeakWatch.prototype.stop = function () {
    if (this._timer) {
        clearInterval(this._timer);
    }
    this._timer = null;
};

LeakWatch.prototype.check = function () {
    if (!this.ha || !this.ha.states) {
        return;
    }
    var self = this;
    var wet = [];

    this.ha.states.forEach(function (state, id) {
        if (id.indexOf("binary_sensor.") !== 0) {
            return;
        }
        var cls = (state.attributes && state.attributes.device_class) || "";
        if (cls !== "moisture" || state.state !== "on") {
            return;
        }
        wet.push({
            id: id,
            name: ((state.attributes && state.attributes.friendly_name) || id).trim(),
            where: self.areas ? self.areas.areaName(id) : ""
        });
    });

    var signature = wet.map(function (w) { return w.id; }).sort().join("|");
    if (signature === this._signature) {
        return;
    }
    this._signature = signature;
    this.wet = wet;
    this.paint();
};

LeakWatch.prototype.paint = function () {
    var el = document.getElementById("leak-banner");
    if (!el) {
        return;
    }
    if (!this.wet.length) {
        el.style.display = "none";
        el.textContent = "";
        return;
    }

    var parts = this.wet.map(function (w) {
        return w.name + (w.where ? " (" + w.where + ")" : "");
    });
    el.innerHTML = '<b>WATER LEAK</b><span>' + parts.join("  |  ") + '</span>';
    el.style.display = "flex";
};

export { LeakWatch };
