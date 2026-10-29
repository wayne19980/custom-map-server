/**
 * MapLibre requires absolute glyph/sprite/tile URLs. Styles are authored with
 * root-relative paths so the same JSON works on any host/port.
 */
export function absolutizeStyle(input: Record<string, unknown>): Record<string, unknown> {
  const style = JSON.parse(JSON.stringify(input)) as Record<string, any>;
  const origin = window.location.origin;
  const absolute = (value: unknown): unknown => {
    if (typeof value !== 'string' || value.length === 0) return value;
    // TileServer GL may rewrite sprite/glyphs with PUBLIC_URL. When the page is
    // opened via a LAN IP or a client domain, a localhost URL would be broken;
    // rebase it onto the page origin. Production should still set PUBLIC_URL.
    const localhost = value.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/.*)?$/i);
    if (localhost) return origin + (localhost[1] || '/');
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
      return value;
    }
    // Do not use new URL() here: it would percent-encode {z}/{x}/{y} and
    // {fontstack}/{range}, breaking MapLibre's template expansion.
    if (value.startsWith('/')) return origin + value;
    return new URL(value, origin).href;
  };

  if (typeof style.glyphs === 'string') style.glyphs = absolute(style.glyphs);

  if (typeof style.sprite === 'string') {
    style.sprite = absolute(style.sprite);
  } else if (Array.isArray(style.sprite)) {
    style.sprite = style.sprite.map((sprite: any) => ({ ...sprite, url: absolute(sprite.url) }));
  }

  if (style.sources && typeof style.sources === 'object') {
    for (const source of Object.values<any>(style.sources)) {
      if (!source || typeof source !== 'object') continue;
      if (typeof source.url === 'string') source.url = absolute(source.url);
      if (Array.isArray(source.tiles)) source.tiles = source.tiles.map(absolute);
    }
  }

  return style;
}
