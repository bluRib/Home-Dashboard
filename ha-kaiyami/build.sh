#!/bin/sh
# Rebuild build/kaiyami.js from src/.
#
# Replaces Encom's Grunt + Browserify, per BUILD.md step 2. esbuild is a
# single Go binary, so this needs no Node and no npm. If node_modules is
# missing, run tools/install-deps.py first.
set -e
cd "$(dirname "$0")"
ESB=node_modules/.bin/esbuild.exe
[ -x "$ESB" ] || ESB=node_modules/.bin/esbuild
"$ESB" src/main.js --bundle --outfile=build/kaiyami.js
echo "built build/kaiyami.js"
