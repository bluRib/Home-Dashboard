// Screen registry and message fan-out.
//
// This is the Encom Boardroom pattern from BUILD.md section 5: one pipe in,
// every interested widget gets a copy. Encom's Boardroom.message(msg) handed
// each event to every widget it owned. Here the bus holds the screens, knows
// which one is active, and fans each message out.
//
// Screen contract (same as Encom's widget contract):
//   init(ctx)   called once, gets { ha, bus }
//   show()      becoming active
//   hide()      no longer active
//   animate()   called from the single requestAnimationFrame loop
//   message(m)  one dashboard message
//   resize()    window changed
// Every method is optional. A screen that only watches data can define
// message() and nothing else.

export class Bus {
  constructor(ha) {
    this.ha = ha;
    this.screens = new Map();
    this.active = null;
    this._subscribers = [];
    this._running = false;
    this._frame = null;
    this._brokenAnimate = new Set();
  }

  register(name, screen) {
    this.screens.set(name, screen);
    if (screen.init) screen.init({ ha: this.ha, bus: this });
    return screen;
  }

  // Watch every message regardless of which screen is active. Used by things
  // that persist across screens, such as an alert ticker or the clock.
  subscribe(fn) {
    this._subscribers.push(fn);
    return () => {
      const i = this._subscribers.indexOf(fn);
      if (i >= 0) this._subscribers.splice(i, 1);
    };
  }

  activate(name) {
    if (this.active === name) return;
    const previous = this.screens.get(this.active);
    if (previous && previous.hide) previous.hide();

    this.active = name;
    const next = this.screens.get(name);
    if (next && next.show) next.show();
  }

  // Fan one message out: active screen first, then the always on subscribers.
  message(msg) {
    const screen = this.screens.get(this.active);
    if (screen && screen.message) {
      try {
        screen.message(msg);
      } catch (err) {
        console.error('screen "' + this.active + '" message() threw', err);
      }
    }
    for (const fn of this._subscribers.slice()) {
      try {
        fn(msg);
      } catch (err) {
        console.error('bus subscriber threw', err);
      }
    }
  }

  resize() {
    for (const screen of this.screens.values()) {
      if (screen.resize) screen.resize();
    }
  }

  // One loop for the whole app, exactly like Encom's main.js. Only the active
  // screen animates, so hidden screens cost nothing.
  start() {
    if (this._running) return;
    this._running = true;
    const tick = () => {
      if (!this._running) return;
      this._frame = requestAnimationFrame(tick);
      const screen = this.screens.get(this.active);
      if (screen && screen.animate && !this._brokenAnimate.has(screen)) {
        try {
          screen.animate();
        } catch (err) {
          console.error('screen "' + this.active + '" animate() threw, not animating it again', err);
          // Park the screen rather than logging the same error every frame.
          // Tracked on the bus, not by deleting the method, because a screen
          // written as a class has animate() on its prototype where delete
          // would silently do nothing.
          this._brokenAnimate.add(screen);
        }
      }
    };
    this._frame = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = null;
  }
}
