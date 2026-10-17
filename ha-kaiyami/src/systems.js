/* The home systems that replace Encom's data streams.
 *
 * Single source of truth for the launcher. index.html renders one folder per
 * entry, LightTable wires the cd / ls / run commands from it, and main.js
 * switches screens on it. Adding a system means adding a line here and a
 * matching folder div in index.html.
 *
 * key    lowercase, used for the folder id, the terminal commands and the
 *        stream name on every message
 * label  what the folder says
 * splash the big word on the screensaver while the screen loads
 * size   "big" or "small", which folder artwork to use
 * hidden true keeps it out of the folder list and the ls listing, but the
 *        terminal still accepts cd and run for it
 */
module.exports = [
    { key: "house",    label: "House",    splash: "HOUSE",    size: "big"   },
    { key: "climate",  label: "Climate",  splash: "CLIMATE",  size: "small" },
    { key: "security", label: "Security", splash: "SECURITY", size: "small" },
    { key: "cameras",  label: "Cameras",  splash: "CAMERAS",  size: "small" },
    { key: "energy",   label: "Energy",   splash: "ENERGY",   size: "small" },
    { key: "network",  label: "Network",  splash: "NETWORK",  size: "small" },

    /* Kept for development without Home Assistant, per BUILD.md step 5.
       No folder, but "cd test" then "run test.exe" still works. */
    { key: "test",     label: "Test",     splash: "TEST DATA", size: "small", hidden: true }
];
