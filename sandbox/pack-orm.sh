#!/usr/bin/env bash
#
# Pack VA-ORM -> tarball -> pasang ke project e2e terisolasi.
#
# Kenapa version di-rewrite jadi `<version>-local`:
#   kalau versinya sama dengan versi yang sudah ada di npm registry, Bun bisa
#   memakai cache artifact registry (bukan tarball lokal) — gejalanya: driver
#   `http` tiba-tiba "Unsupported driver: http" padahal ada di source.
#   Versi lokal dijamin unik -> tidak pernah ketuker dengan cache registry.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORM="$ROOT/engine/va-orm"
PACKS="$ROOT/sandbox/packs"
CONSUMER="$ROOT/sandbox/va-orm-http-e2e"

cd "$ORM"
echo "==> build"
bun run build >/dev/null

echo "==> pack"
rm -f ./*.tgz
bun pm pack >/dev/null
TGZ="$(ls -1 ./*.tgz | head -1)"

VERSION="$(bun -e "console.log(require('./package.json').version)")"
LOCAL_VERSION="${VERSION}-local"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar xzf "$TGZ" -C "$WORK"

bun -e "
const fs = require('fs');
const p = '$WORK/package/package.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.version = '$LOCAL_VERSION';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"

mkdir -p "$PACKS"
rm -f "$PACKS"/*.tgz
OUT="$PACKS/v-va-orm-${LOCAL_VERSION}.tgz"
tar czf "$OUT" -C "$WORK" package
rm -f "$TGZ"

echo "==> pasang ke project e2e"
cd "$CONSUMER"
bun -e "
const fs = require('fs');
const p = 'package.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.dependencies['@v-va/orm'] = 'file:../packs/v-va-orm-${LOCAL_VERSION}.tgz';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"
rm -rf node_modules bun.lock
bun install >/dev/null

echo "==> verifikasi artifact"
if grep -q 'case "http"' node_modules/@v-va/orm/packages/client/dist/*.js; then
  echo "    OK: driver http ada di artifact ter-install"
else
  echo "    GAGAL: driver http tidak ada di artifact ter-install" >&2
  exit 1
fi

echo "packed -> $OUT"
