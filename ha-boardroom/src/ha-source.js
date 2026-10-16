/* Home Assistant as the boardroom's data source.
 *
 * Replaces Encom's EventSource, which pulled GitHub and Wikipedia events from
 * stream-server.js. Every HA state_changed is converted to Encom's message
 * shape by ../../app/js/message.js, so the widgets never had to change.
 *
 * The token is NOT imported here. esbuild inlines whatever it can resolve, and
 * build/encom-boardroom.js is committed, so importing app/js/config.js would
 * publish the token. index.html loads config.local.js first instead, which is
 * gitignored and sets window.HA_CONFIG at runtime.
 *
 * Note for anyone rebuilding: this reaches up into ../../app/js/, a sibling of
 * the fork. The built bundle is self contained, so a clone of this repo runs
 * on its own; only a rebuild needs the app folder beside it.
 */
import { HomeAssistant, Status } from "../../app/js/ha.js";
import { toMessage, stateToMessage } from "../../app/js/message.js";
import { Severity } from "../../app/js/message.js";

/* Every entity's current state, as messages. Filled on connect and kept so a
   screen opened later still starts from the real state of the house. */
var seed = [];

export function getSeed() {
    return seed;
}

/* start(onMessage, onStatus) opens the one connection the dashboard uses and
   hands every state change back as an Encom shaped message. */
export function start(onMessage, onStatus) {
    var config = window.HA_CONFIG;

    if (!config) {
        console.error(
            "ha-source: window.HA_CONFIG is missing. Run tools/gen_config.py " +
            "from the project root, which writes ha-boardroom/config.local.js, " +
            "and make sure index.html loads it before the bundle.");
        return null;
    }

    var ha = new HomeAssistant(config);

    if (onStatus) {
        ha.on("status", onStatus);
    }

    /* Two different needs from the initial state dump.
       The globe and swirls want a trickle, so pushing 1500 messages through
       them in one frame is out. The rooms panel and the house widget want the
       opposite: without the full picture they render an empty table and an
       unlit house, which is what "connected but blank" looks like.
       So the whole dump is kept here for anything that asks for it, and only
       the alerts are pushed through the live path on connect. */
    ha.on("states", function (states) {
        seed = [];
        states.forEach(function (state) {
            var message = stateToMessage(state);
            seed.push(message);
            if (message.severity === Severity.ALERT) {
                onMessage(message);
            }
        });
    });

    ha.on("event", function (event) {
        onMessage(toMessage(event));
    });

    ha.connect();
    return ha;
}

export { Status };
