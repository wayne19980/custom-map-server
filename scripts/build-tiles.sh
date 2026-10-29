#!/usr/bin/env bash
# Build data/tiles/<region>.pmtiles from data/osm/<region>-latest.osm.pbf.
set -euo pipefail

cd "$(dirname "$0")/.."
REGION="${REGION:-shanghai}"
COASTLINE="${COASTLINE:-osm}"
PBF="data/osm/${REGION}-latest.osm.pbf"
OUT="data/tiles/${REGION}.pmtiles"
IMAGE="${TILEMAKER_IMAGE:-ghcr.io/systemed/tilemaker:master}"

if [[ ! -f "$PBF" ]]; then
  echo "build-tiles: missing $PBF (run: make fetch REGION=$REGION)" >&2
  exit 1
fi

if [[ "$COASTLINE" == "none" ]]; then
  CONFIG="tilegen/config.no-coastline.json"
  echo "build-tiles: coastline disabled"
else
  CONFIG="tilegen/config.json"
  if [[ ! -f data/cache/coastline/water_polygons.shp ]]; then
    echo "build-tiles: missing data/cache/coastline/water_polygons.shp" >&2
    echo "  run: make coastline" >&2
    echo "  or:  COASTLINE=none make tiles" >&2
    exit 1
  fi
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "build-tiles: pulling $IMAGE"
  docker pull "$IMAGE"
fi

mkdir -p data/tiles data/tmp
rm -rf data/tmp/*
START=$(date +%s)

echo "build-tiles: $PBF -> $OUT"
docker run --rm \
  -v "$PWD/data:/data" \
  -v "$PWD/tilegen:/tilegen:ro" \
  -w /data \
  "$IMAGE" \
  --input "/data/osm/${REGION}-latest.osm.pbf" \
  --output "/data/tiles/${REGION}.pmtiles" \
  --config "/tilegen/${CONFIG#tilegen/}" \
  --process /tilegen/process.lua \
  --store /data/tmp \
  --threads 0 2>&1 | tee "/tmp/tilemaker-${REGION}.log"

if [[ ! -f "$OUT" ]]; then
  echo "build-tiles: tilemaker did not produce $OUT" >&2
  exit 1
fi

# PMTiles magic check
if [[ "$(head -c 7 "$OUT")" != "PMTiles" ]]; then
  echo "build-tiles: $OUT is not a PMTiles file" >&2
  exit 1
fi

END=$(date +%s)
echo "build-tiles: done in $((END - START))s"
ls -lh "$OUT"
