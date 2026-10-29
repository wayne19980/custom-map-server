#!/usr/bin/env bash
# Integration checks against a running stack.
set -euo pipefail

cd "$(dirname "$0")/.."
BASE_URL="${BASE_URL:-http://localhost:8081}"
FAIL=0

check() {
  local name="$1" url="$2" expect="${3:-200}"
  local code
  code="$(curl -s -o /tmp/verify-body -w '%{http_code}' "$url" || true)"
  if [[ "$code" == "$expect" ]]; then
    echo "verify: OK   $name ($code)"
  else
    echo "verify: FAIL $name (expected $expect, got $code) $url" >&2
    FAIL=1
  fi
}

echo "verify: waiting for $BASE_URL/health"
for _ in $(seq 1 60); do
  if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

check "health" "$BASE_URL/health"
check "manifest" "$BASE_URL/map.manifest.json"
check "style light" "$BASE_URL/styles/light/style.json"
check "style dark" "$BASE_URL/styles/dark/style.json"
check "style bright" "$BASE_URL/styles/bright/style.json"
check "style blueprint" "$BASE_URL/styles/blueprint/style.json"
check "raster blueprint" "$BASE_URL/styles/blueprint_raster/12/3430/1673.png"
check "wmts blueprint" "$BASE_URL/styles/blueprint_raster/wmts.xml"
check "tilejson" "$BASE_URL/data/shanghai.json"
check "sprite light" "$BASE_URL/sprites/light/sprite.json"
check "sprite light png" "$BASE_URL/sprites/light/sprite.png"
check "sprite light @2x" "$BASE_URL/sprites/light/sprite@2x.json"
check "sprite blueprint" "$BASE_URL/sprites/blueprint/sprite.json"
check "font range" "$BASE_URL/fonts/NotoSansSC-Regular/0-255.pbf"
check "index" "$BASE_URL/"
check "editor page" "$BASE_URL/editor"
check "editor api" "$BASE_URL/api/health"
check "catalog" "$BASE_URL/api/catalog"
check "layer groups" "$BASE_URL/styles/schema/layer-groups.json"

read -r TILE_X TILE_Y < <(node -e '
const [lon, lat] = [121.4737, 31.2304];
const z = 12, n = 2 ** z;
const x = Math.floor((lon + 180) / 360 * n);
const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
console.log(x, y);
')
check "vector tile z12/$TILE_X/$TILE_Y" "$BASE_URL/data/shanghai/12/$TILE_X/$TILE_Y.pbf"

# Content sanity
if curl -fsS "$BASE_URL/data/shanghai.json" | grep -q 'tiles'; then
  echo "verify: OK   tilejson has tiles"
else
  echo "verify: FAIL tilejson has no tiles" >&2
  FAIL=1
fi

if curl -fsS "$BASE_URL/map.manifest.json" | grep -q '"styles"'; then
  echo "verify: OK   manifest has styles"
else
  echo "verify: FAIL manifest has no styles" >&2
  FAIL=1
fi

FONT_BYTES="$(curl -fsS "$BASE_URL/fonts/NotoSansSC-Regular/0-255.pbf" -o /dev/null -w '%{size_download}')"
if [[ "${FONT_BYTES:-0}" -gt 0 ]]; then
  echo "verify: OK   font bytes readable ($FONT_BYTES bytes)"
else
  echo "verify: FAIL font range is empty" >&2
  FAIL=1
fi

if [[ "$FAIL" != "0" ]]; then
  echo "verify: FAILED" >&2
  exit 1
fi
echo "verify: ALL OK"
