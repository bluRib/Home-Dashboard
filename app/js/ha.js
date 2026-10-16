// Home Assistant WebSocket client.
//
// One connection for the whole dashboard. It authenticates, pulls the initial
// state of every entity, subscribes to state_changed, and reconnects on its
// own with backoff. Everything downstream (the bus, the screens, the widgets)
// reads from this and never opens its own socket.
//
// Protocol reference: https://developers.home-assistant.io/docs/api/websocket/

const PING_INTERVAL = 30000;   // keepalive, ms
const PING_TIMEOUT = 10000;    // give up on a pong after this, ms
const BACKOFF_MAX = 30000;     // longest wait between reconnects, ms

export const Status = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  AUTHENTICATING: 'authenticating',
  LOADING: 'loading',
  READY: 'ready',
  RETRYING: 'retrying',
  FAILED: 'failed',          // terminal, bad token
};

export class HomeAssistant {
  constructor(config) {
    this.config = config;
    this.ws = null;
    this.status = Status.IDLE;
    this.detail = '';
    this.version = '';

    // entity_id -> state object, kept current as events arrive.
    this.states = new Map();

    this._nextId = 1;
    this._pending = new Map();   // request id -> {resolve, reject}
    this._handlers = { status: [], states: [], event: [] };
    this._attempts = 0;
    this._pingTimer = null;
    this._pongTimer = null;
    this._closed = false;
  }

  // on('status'|'states'|'event', fn). Returns an unsubscribe function.
  on(name, fn) {
    const list = this._handlers[name];
    if (!list) throw new Error('unknown event: ' + name);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  _emit(name, payload) {
    for (const fn of this._handlers[name].slice()) {
      try {
        fn(payload);
      } catch (err) {
        console.error('handler for "' + name + '" threw', err);
      }
    }
  }

  _setStatus(status, detail = '') {
    this.status = status;
    this.detail = detail;
    this._emit('status', { status, detail, version: this.version });
  }

  connect() {
    if (!this.config.token) {
      this._setStatus(Status.FAILED, 'no token. Set HA_TOKEN in app/.env and run tools/gen_config.py');
      return;
    }
    this._closed = false;
    this._open();
  }

  close() {
    this._closed = true;
    this._stopPing();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._setStatus(Status.IDLE);
  }

  _open() {
    this._setStatus(Status.CONNECTING, this.config.wsUrl);

    let ws;
    try {
      ws = new WebSocket(this.config.wsUrl);
    } catch (err) {
      this._retry('could not open socket: ' + err.message);
      return;
    }
    this.ws = ws;

    ws.onmessage = (ev) => this._onMessage(ev);

    ws.onerror = () => {
      // onerror carries no useful detail in browsers. onclose follows and
      // handles the retry, so this only records something for the UI.
      this.detail = 'socket error';
    };

    ws.onclose = () => {
      this._stopPing();
      this._failPending('connection closed');
      if (this.status === Status.FAILED || this._closed) return;
      this._retry('connection closed');
    };
  }

  _retry(reason) {
    this._attempts += 1;
    const base = (this.config.reconnectSeconds || 2) * 1000;
    const wait = Math.min(base * Math.pow(2, this._attempts - 1), BACKOFF_MAX);
    this._setStatus(Status.RETRYING, reason + '. retrying in ' + Math.round(wait / 1000) + 's');
    setTimeout(() => {
      if (!this._closed) this._open();
    }, wait);
  }

  _send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  // Send a command and get a promise for its result.
  command(payload) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });
      if (!this._send(Object.assign({ id }, payload))) {
        this._pending.delete(id);
        reject(new Error('not connected'));
      }
    });
  }

  _failPending(reason) {
    for (const { reject } of this._pending.values()) reject(new Error(reason));
    this._pending.clear();
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (err) {
      console.error('bad JSON from Home Assistant', ev.data);
      return;
    }

    switch (msg.type) {
      case 'auth_required':
        this.version = msg.ha_version || '';
        this._setStatus(Status.AUTHENTICATING);
        this._send({ type: 'auth', access_token: this.config.token });
        return;

      case 'auth_ok':
        this.version = msg.ha_version || this.version;
        this._attempts = 0;
        this._startPing();
        this._afterAuth();
        return;

      case 'auth_invalid':
        // Terminal. Retrying with the same bad token would just loop.
        this._closed = true;
        this._stopPing();
        this._failPending('token rejected');
        if (this.ws) {
          this.ws.onclose = null;
          this.ws.close();
        }
        this._setStatus(Status.FAILED, msg.message || 'token rejected by Home Assistant');
        return;

      case 'pong':
        this._clearPongTimer();
        return;

      case 'event':
        this._onEvent(msg.event);
        return;

      case 'result': {
        const waiter = this._pending.get(msg.id);
        if (!waiter) return;
        this._pending.delete(msg.id);
        if (msg.success) waiter.resolve(msg.result);
        else waiter.reject(new Error((msg.error && msg.error.message) || 'command failed'));
        return;
      }

      default:
        return;
    }
  }

  async _afterAuth() {
    this._setStatus(Status.LOADING);
    try {
      const states = await this.command({ type: 'get_states' });
      this.states.clear();
      for (const s of states) this.states.set(s.entity_id, s);

      await this.command({ type: 'subscribe_events', event_type: 'state_changed' });

      this._setStatus(Status.READY, this.states.size + ' entities');
      this._emit('states', this.states);
    } catch (err) {
      this._retry('setup failed: ' + err.message);
    }
  }

  _onEvent(event) {
    if (!event || event.event_type !== 'state_changed') return;
    const data = event.data || {};
    if (!data.entity_id) return;

    if (data.new_state) this.states.set(data.entity_id, data.new_state);
    else this.states.delete(data.entity_id);

    this._emit('event', {
      entityId: data.entity_id,
      oldState: data.old_state || null,
      newState: data.new_state || null,
      timeFired: event.time_fired || null,
    });
  }

  // Convenience for widgets that want to act, not just watch.
  callService(domain, service, serviceData = {}, target = undefined) {
    const payload = { type: 'call_service', domain, service, service_data: serviceData };
    if (target) payload.target = target;
    return this.command(payload);
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (!this._send({ id: this._nextId++, type: 'ping' })) return;
      this._clearPongTimer();
      this._pongTimer = setTimeout(() => {
        // No pong came back. The socket is wedged, so force a reconnect.
        if (this.ws) this.ws.close();
      }, PING_TIMEOUT);
    }, PING_INTERVAL);
  }

  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
    this._clearPongTimer();
  }

  _clearPongTimer() {
    if (this._pongTimer) clearTimeout(this._pongTimer);
    this._pongTimer = null;
  }
}
