# Rebuild build/kaiyami.js from src/.
#
# Replaces Encom's Grunt + Browserify, per BUILD.md step 2. esbuild is a
# single Go binary, so this needs no Node and no npm. If node_modules is
# missing, run tools/install-deps.py first.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
& node_modules\.bin\esbuild.exe src/main.js --bundle --outfile=build/kaiyami.js
Write-Output "built build/kaiyami.js"
