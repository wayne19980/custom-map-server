#!/usr/bin/env bash
# Download Noto Sans CJK SC and generate SDF glyph PBFs with glyphore.
set -euo pipefail

cd "$(dirname "$0")/.."
FONT_DIR="data/fonts-src"
OUT_DIR="data/fonts"
REGULAR="$FONT_DIR/NotoSansCJKsc-Regular.otf"
BOLD="$FONT_DIR/NotoSansCJKsc-Bold.otf"
BASE_URL="https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese"

mkdir -p "$FONT_DIR" "$OUT_DIR"

if [[ ! -f "$REGULAR" ]]; then
  echo "build-fonts: downloading Noto Sans CJK SC Regular"
  curl -L --fail --retry 3 --progress-bar -o "$REGULAR" "$BASE_URL/NotoSansCJKsc-Regular.otf"
fi
if [[ ! -f "$BOLD" ]]; then
  echo "build-fonts: downloading Noto Sans CJK SC Bold"
  curl -L --fail --retry 3 --progress-bar -o "$BOLD" "$BASE_URL/NotoSansCJKsc-Bold.otf"
fi

if [[ -f "$OUT_DIR/fonts.json" && -d "$OUT_DIR/NotoSansSC-Regular" && "${FORCE:-0}" != "1" ]]; then
  echo "build-fonts: glyphs already generated (FORCE=1 to rebuild)"
else
  rm -rf "$OUT_DIR"
  mkdir -p "$OUT_DIR"
  echo "build-fonts: generating glyph ranges (this can take a minute)"
  npm_config_cache="$PWD/.cache/npm" \
    npx --yes @kartore/glyphore@0.2.0 build "$FONT_DIR" -o "$OUT_DIR"
fi

# Stable no-space fontstack names: TileServer GL's native raster renderer
# receives these names over a fonts:// request, and spaces complicate that
# path. (Browser glyph URLs handle either form.)
if [[ -d "$OUT_DIR/Noto Sans CJK SC Regular" && ! -d "$OUT_DIR/NotoSansSC-Regular" ]]; then
  mv "$OUT_DIR/Noto Sans CJK SC Regular" "$OUT_DIR/NotoSansSC-Regular"
fi
if [[ -d "$OUT_DIR/Noto Sans CJK SC Bold" && ! -d "$OUT_DIR/NotoSansSC-Bold" ]]; then
  mv "$OUT_DIR/Noto Sans CJK SC Bold" "$OUT_DIR/NotoSansSC-Bold"
fi

node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(process.cwd(), 'data/fonts');
const dirs = fs.readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
const pick = (re) => dirs.find((d) => re.test(d));
const regular = pick(/Regular$/);
const bold = pick(/Bold$/);
if (!regular) {
  console.error('build-fonts: could not find a Regular font directory in data/fonts');
  process.exit(1);
}
const out = { regular, bold: bold || regular };
fs.writeFileSync(path.join(dir, 'fonts.json'), JSON.stringify(out, null, 2) + '\n');
console.log('build-fonts: fonts.json =', out);
NODE

echo "build-fonts: done"
du -sh "$OUT_DIR"
