#!/usr/bin/env bash
# Download a Geofabrik .osm.pbf extract and verify its md5.
set -euo pipefail

cd "$(dirname "$0")/.."
REGION="${1:-${REGION:-shanghai}}"
PBF_BASE="${PBF_BASE:-https://download.geofabrik.de/asia/china}"
OUT="data/osm/${REGION}-latest.osm.pbf"
FORCE="${FORCE:-0}"

mkdir -p data/osm

if [[ -f "$OUT" && "$FORCE" != "1" ]]; then
  echo "fetch-pbf: $OUT already exists (FORCE=1 to re-download)"
else
  echo "fetch-pbf: downloading ${PBF_BASE}/${REGION}-latest.osm.pbf"
  curl -L --fail --retry 3 --progress-bar -o "$OUT" "${PBF_BASE}/${REGION}-latest.osm.pbf"
  curl -L --fail --retry 3 -sS -o "${OUT}.md5" "${PBF_BASE}/${REGION}-latest.osm.pbf.md5"
fi

if [[ ! -f "${OUT}.md5" ]]; then
  echo "fetch-pbf: warning: no md5 file for $OUT; skipping checksum" >&2
else
  expected="$(awk '{print $1}' "${OUT}.md5")"
  actual="$(md5sum "$OUT" | awk '{print $1}')"
  if [[ "$expected" != "$actual" ]]; then
    echo "fetch-pbf: checksum mismatch: expected $expected, got $actual" >&2
    exit 1
  fi
  echo "fetch-pbf: checksum OK"
fi

ls -lh "$OUT"
