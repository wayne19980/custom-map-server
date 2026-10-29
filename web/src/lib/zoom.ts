import type * as maplibregl from 'maplibre-gl';

/**
 * One wheel tick = one integer zoom step. MapLibre's default scroll zoom is
 * continuous, which makes it easy to skip several levels in one gesture.
 */
export function enableStepZoom(map: maplibregl.Map, indicator: HTMLElement): () => void {
  const canvas = map.getCanvas();
  let lastWheel = 0;

  const onWheel = (event: WheelEvent): void => {
    if (!event.deltaY) return;
    event.preventDefault();

    const now = performance.now();
    if (now - lastWheel < 240) return;
    lastWheel = now;

    const current = map.getZoom();
    const target = event.deltaY < 0 ? Math.floor(current) + 1 : Math.ceil(current) - 1;
    const clamped = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), target));
    map.easeTo({ zoom: clamped, duration: 160 });
  };

  const update = (): void => {
    indicator.textContent = `z${map.getZoom().toFixed(1)}`;
  };

  canvas.addEventListener('wheel', onWheel, { passive: false });
  map.on('zoom', update);
  map.on('move', update);
  map.on('load', update);
  update();

  return () => canvas.removeEventListener('wheel', onWheel);
}
