#!/usr/bin/env bash
# Build an offline deployment bundle under dist/.
set -euo pipefail

cd "$(dirname "$0")/.."
WEB_IMAGE="custom-map-server-web:latest"
EDITOR_IMAGE="custom-map-editor-api:latest"
TILESERVER_IMAGE="maptiler/tileserver-gl:v5.7.0"
DIST="dist"

if [[ ! -f data/tiles/shanghai.pmtiles ]]; then
  echo "bundle: missing data/tiles/shanghai.pmtiles (run: make tiles)" >&2
  exit 1
fi
if [[ ! -f data/fonts/fonts.json ]]; then
  echo "bundle: missing glyphs (run: make fonts)" >&2
  exit 1
fi
if [[ ! -f config/tileserver.config.json ]]; then
  echo "bundle: missing config/tileserver.config.json (run: make config)" >&2
  exit 1
fi

if ! docker image inspect "$WEB_IMAGE" >/dev/null 2>&1; then
  echo "bundle: building $WEB_IMAGE"
  docker build -f docker/web.Dockerfile -t "$WEB_IMAGE" .
fi
if ! docker image inspect "$EDITOR_IMAGE" >/dev/null 2>&1; then
  echo "bundle: building $EDITOR_IMAGE"
  docker build -f docker/editor.Dockerfile -t "$EDITOR_IMAGE" .
fi
if ! docker image inspect "$TILESERVER_IMAGE" >/dev/null 2>&1; then
  echo "bundle: pulling $TILESERVER_IMAGE"
  docker pull "$TILESERVER_IMAGE"
fi

rm -rf "$DIST"
mkdir -p "$DIST"/{data/tiles,data/fonts,data/sprites,data/style-versions,styles/schema,config}

echo "bundle: saving images (this can take a minute)"
docker save -o "$DIST/images.tar" "$WEB_IMAGE" "$EDITOR_IMAGE" "$TILESERVER_IMAGE"

echo "bundle: copying data and styles"
cp -a data/tiles/. "$DIST/data/tiles/"
cp -a data/fonts/. "$DIST/data/fonts/"
cp -a data/sprites/. "$DIST/data/sprites/"
cp -a styles/*.json "$DIST/styles/"
cp -a styles/schema/. "$DIST/styles/schema/"
cp -a config/map.manifest.json config/tileserver.config.json "$DIST/config/"
cp -a docker-compose.offline.yml "$DIST/docker-compose.yml"
cp -a .env.example "$DIST/.env.example"
cp -a scripts/install-offline.sh "$DIST/install.sh"
chmod +x "$DIST/install.sh"

cp -a docs/deployment-offline.md "$DIST/README-offline.md" 2>/dev/null || true

chmod 755 "$DIST/install.sh"
chmod 644 "$DIST/README-offline.md" "$DIST/docker-compose.yml" "$DIST/.env.example" "$DIST/images.tar"
chmod 644 "$DIST"/config/* "$DIST"/styles/*.json "$DIST"/styles/schema/*
chmod 755 "$DIST/data" "$DIST/data"/*
find "$DIST/data" -type d -exec chmod 755 {} +
find "$DIST/data" -type f -exec chmod 644 {} + 2>/dev/null || true

echo "bundle: done"
du -sh "$DIST"
ls -lh "$DIST"
