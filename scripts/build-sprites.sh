#!/usr/bin/env bash
# Generate MapLibre sprite sheets from each vendored style's icons/ directory.
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE="${SPREET_IMAGE:-ghcr.io/flother/spreet:0.14.0}"

# style-id : vendor-directory
STYLES=(
  "light:positron"
  "dark:dark-matter"
  "bright:osm-bright"
  "blueprint:dark-matter"
)

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "build-sprites: pulling $IMAGE"
  docker pull "$IMAGE"
fi

for entry in "${STYLES[@]}"; do
  id="${entry%%:*}"
  vendor="${entry##*:}"
  src="styles/vendor/${vendor}/icons"
  out="data/sprites/${id}"
  if [[ ! -d "$src" ]]; then
    echo "build-sprites: missing icon directory $src" >&2
    exit 1
  fi
  mkdir -p "$out"
  docker run --rm \
    -v "$PWD/$src:/in:ro" \
    -v "$PWD/$out:/out" \
    "$IMAGE" --unique --minify-index-file /in /out/sprite
  docker run --rm \
    -v "$PWD/$src:/in:ro" \
    -v "$PWD/$out:/out" \
    "$IMAGE" --retina --unique --minify-index-file /in /out/sprite@2x
  echo "build-sprites: $id <- $src"
done

echo "build-sprites: done"
find data/sprites -name 'sprite.json' -printf '%p\n' | sort
