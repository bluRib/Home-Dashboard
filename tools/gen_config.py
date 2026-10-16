"""Read app/.env and write app/js/config.js, the module the browser loads.

usage (from the project root or the tools folder):
  python tools/gen_config.py
  python tools/gen_config.py path/to/.env path/to/config.js

A browser cannot read a .env file, so the token has to be handed to the page
as JavaScript. This script is the only thing that moves it across. Run it
again after any edit to .env.

Only the Python standard library is needed.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_ENV = os.path.join(ROOT, 'app', '.env')
DEFAULT_OUT = os.path.join(ROOT, 'app', 'js', 'config.js')
# The forked boardroom is bundled by esbuild, and anything it imports gets
# baked into build/encom-boardroom.js, which is committed. So the token is
# handed to it at runtime through a plain global instead, written here and
# gitignored, never imported by the bundle.
FORK_OUT = os.path.join(ROOT, 'ha-boardroom', 'config.local.js')

DEFAULTS = {
    'HA_HOST': 'homeassistant.local',
    'HA_PORT': '8123',
    'HA_SSL': 'false',
    'HA_TOKEN': '',
    'HA_RECONNECT': '2',
}


def read_env(path):
    """Parse a .env file into a dict. Blank lines and # comments are skipped."""
    if not os.path.exists(path):
        sys.exit('no .env found at %s\ncopy app/.env.example to app/.env first' % path)
    out = dict(DEFAULTS)
    for lineno, raw in enumerate(open(path, encoding='utf-8'), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            sys.exit('%s line %d: expected KEY=value, got %r' % (path, lineno, line))
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()
        # Strip one layer of matching quotes if present.
        if len(value) > 1 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        out[key] = value
    return out


def build(env):
    host = env['HA_HOST'].strip()
    port = env['HA_PORT'].strip()
    ssl = env['HA_SSL'].strip().lower() in ('1', 'true', 'yes', 'on')

    if not host:
        sys.exit('HA_HOST is empty in .env')
    if '://' in host:
        sys.exit('HA_HOST should be a bare host or IP, not a URL: %r' % host)
    if not port.isdigit():
        sys.exit('HA_PORT should be a number, got %r' % port)

    try:
        reconnect = max(1, int(float(env['HA_RECONNECT'])))
    except ValueError:
        reconnect = 2

    scheme = 'wss' if ssl else 'ws'
    return {
        'wsUrl': '%s://%s:%s/api/websocket' % (scheme, host, port),
        'httpUrl': '%s://%s:%s' % ('https' if ssl else 'http', host, port),
        'token': env['HA_TOKEN'].strip(),
        'reconnectSeconds': reconnect,
    }


def main():
    env_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ENV
    out_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT

    cfg = build(read_env(env_path))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    body = json.dumps(cfg, indent=2)
    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write(
            '// GENERATED FILE. Do not edit and do not commit.\n'
            '// Written by tools/gen_config.py from app/.env\n'
            '// Re-run that script after changing .env.\n\n'
            'export const HA_CONFIG = %s;\n' % body
        )

    # Same settings as a browser global, for the forked boardroom.
    if os.path.isdir(os.path.dirname(FORK_OUT)):
        fork_lines = [
            '// GENERATED FILE. Do not edit and do not commit.',
            '// Written by tools/gen_config.py from app/.env',
            '// Loaded by index.html before the bundle, so the token stays',
            '// out of build/encom-boardroom.js.',
            '',
            'window.HA_CONFIG = %s;' % body,
            '',
        ]
        with open(FORK_OUT, 'w', encoding='utf-8') as fh:
            fh.write(chr(10).join(fork_lines))
        print('wrote', FORK_OUT)

    print('wrote', out_path)
    print('  endpoint', cfg['wsUrl'])
    if cfg['token']:
        print('  token    %d chars ending %s' % (len(cfg['token']), cfg['token'][-6:]))
    else:
        print('  token    EMPTY. Set HA_TOKEN in %s and run this again.' % env_path)


if __name__ == '__main__':
    main()
