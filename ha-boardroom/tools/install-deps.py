"""Install the client side dependencies and esbuild, without Node or npm.

usage (from the ha-boardroom folder):
    python tools/install-deps.py

Why this exists: upstream's package.json mixes 2014 era server dependencies
with the client code, and a plain `npm install` fails on Node 22 because
`request` is deprecated and Express 4.3 is from 2014. BUILD.md step 2 says to
install only what src/ actually bundles, which is what this does. It also
fetches the esbuild binary, which is pure Go and needs no Node to run.

Everything lands in node_modules/, which is gitignored. Only the Python
standard library is needed.
"""
import io
import json
import os
import sys
import tarfile
import urllib.request

# The client side packages src/ requires. Server only dependencies
# (express, request, github-timeline-stream, ...) are deliberately skipped:
# they exist for stream-server.js, which Home Assistant replaces.
PACKAGES = {
    'three': '0.66.2',
    'jquery': '2.1.4',
    'jquery-ui': '1.10.5',
    'moment': '2.6.0',
    'moment-timezone': '0.0.6',
    'pusher.color': '0.2.4',
    'pleaserotate.js': '0.1.2',
    'encom-globe': '0.5.4',
    'event-source': '0.1.1',
}

ESBUILD_VERSION = '0.21.5'
REGISTRY = 'https://registry.npmjs.org/'


def fetch_json(url):
    return json.load(urllib.request.urlopen(url))


def untar_into(raw, dest):
    os.makedirs(dest, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as tf:
        for member in tf.getmembers():
            if not member.name.startswith('package/'):
                continue
            member.name = member.name[len('package/'):]
            if not member.name:
                continue
            tf.extract(member, dest)


def install(name, version, seen):
    if name in seen:
        return
    seen.add(name)

    meta = fetch_json(REGISTRY + name.replace('/', '%2f'))
    if version not in meta['versions']:
        version = meta['dist-tags']['latest']
        print('  %s: pinned version unavailable, using %s' % (name, version))
    spec = meta['versions'][version]

    dest = os.path.join('node_modules', *name.split('/'))
    if os.path.isdir(dest):
        print('  %-18s already present' % name)
    else:
        untar_into(urllib.request.urlopen(spec['dist']['tarball']).read(), dest)
        print('  %-18s %s' % (name, version))

    # Follow runtime dependencies so the bundler can resolve everything.
    for dep, rng in (spec.get('dependencies') or {}).items():
        install(dep, rng.lstrip('^~>=< ').split(' ')[0], seen)


def install_esbuild():
    target = os.path.join('node_modules', '.bin', 'esbuild.exe'
                          if sys.platform == 'win32' else 'esbuild')
    if os.path.exists(target):
        print('  %-18s already present' % 'esbuild')
        return

    plat = {'win32': 'win32-x64', 'darwin': 'darwin-x64', 'linux': 'linux-x64'}
    key = plat.get(sys.platform)
    if key is None:
        sys.exit('no esbuild build mapped for platform %r' % sys.platform)
    if sys.platform == 'darwin' and os.uname().machine == 'arm64':
        key = 'darwin-arm64'

    meta = fetch_json(REGISTRY + '@esbuild%2f' + key)
    version = ESBUILD_VERSION
    if version not in meta['versions']:
        version = meta['dist-tags']['latest']
    raw = urllib.request.urlopen(meta['versions'][version]['dist']['tarball']).read()

    staging = os.path.join('node_modules', '.esbuild-pkg')
    untar_into(raw, staging)

    os.makedirs(os.path.dirname(target), exist_ok=True)
    for root, _dirs, files in os.walk(staging):
        for f in files:
            if f in ('esbuild', 'esbuild.exe'):
                os.replace(os.path.join(root, f), target)
                if sys.platform != 'win32':
                    os.chmod(target, 0o755)
                print('  %-18s %s' % ('esbuild', version))
                return
    sys.exit('esbuild binary not found inside the downloaded package')


def main():
    if not os.path.isdir('src'):
        sys.exit('run this from the ha-boardroom folder')
    print('installing client dependencies')
    seen = set()
    for name, version in PACKAGES.items():
        install(name, version, seen)
    print('installing esbuild')
    install_esbuild()
    print('\n%d packages ready. Now run build.sh or build.ps1' % len(seen))


if __name__ == '__main__':
    main()
