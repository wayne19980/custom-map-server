#!/usr/bin/env bash
# Download and extract OSM water polygons for the ocean layer.
# ~900 MB download, cached under data/cache; only needed for tile generation.
set -euo pipefail

cd "$(dirname "$0")/.."
ZIP="data/cache/water-polygons-split-4326.zip"
DIR="data/cache/coastline"
URL="https://osmdata.openstreetmap.de/download/water-polygons-split-4326.zip"

mkdir -p data/cache "$DIR"

if [[ ! -f "$DIR/water_polygons.shp" ]]; then
  if [[ ! -s "$ZIP" ]]; then
    echo "fetch-coastline: downloading $URL (~900 MB)"
    curl -L --fail --retry 3 --progress-bar -o "$ZIP" "$URL"
  fi
  echo "fetch-coastline: extracting"
  python3 - "$ZIP" "$DIR" <<'PY'
import os, sys, zipfile
zip_path, out_dir = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path) as z:
    for name in z.namelist():
        base = os.path.basename(name)
        if base.lower().endswith(('.shp', '.shx', '.dbf', '.prj', '.cpg')):
            target = os.path.join(out_dir, base)
            with z.open(name) as src, open(target, 'wb') as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
PY
fi

if [[ ! -f "$DIR/water_polygons.shp" ]]; then
  echo "fetch-coastline: extraction failed" >&2
  exit 1
fi

echo "fetch-coastline: ready"
ls -lh "$DIR"
