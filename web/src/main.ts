import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { absolutizeStyle } from './lib/style';
import { enableStepZoom } from './lib/zoom';

declare global {
  interface Window {
    __map?: maplibregl.Map;
  }
}

maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface Branding {
  title?: string;
  subtitle?: string;
  attribution?: string;
  attributionUrl?: string;
}

interface DatasetMeta {
  label?: string;
  pmtiles: string;
  version: string;
  center: [number, number];
  zoom: number;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  attribution?: string;
}

interface StyleMeta {
  id: string;
  label: string;
  base: string;
  dataset: string;
}

interface Manifest {
  branding?: Branding;
  datasets: Record<string, DatasetMeta>;
  styles: StyleMeta[];
  defaultStyle?: string;
}

const els = {
  map: document.getElementById('map') as HTMLDivElement,
  brand: document.getElementById('brand') as HTMLElement,
  brandTitle: document.getElementById('brand-title') as HTMLElement,
  brandSubtitle: document.getElementById('brand-subtitle') as HTMLElement,
  switcher: document.getElementById('style-switcher') as HTMLElement,
  loading: document.getElementById('loading') as HTMLElement,
  loadingText: document.getElementById('loading-text') as HTMLElement,
  toast: document.getElementById('toast') as HTMLElement,
  osmLink: document.getElementById('osm-link') as HTMLAnchorElement,
};

let manifest: Manifest;
let map: maplibregl.Map | undefined;
let activeStyleId: string | undefined;

function setLoading(visible: boolean, text = '加载地图…'): void {
  els.loadingText.textContent = text;
  els.loading.classList.toggle('is-hidden', !visible);
}

let toastTimer: number | undefined;
function showToast(message: string): void {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 6000);
}

async function fetchManifest(): Promise<Manifest> {
  const response = await fetch('/map.manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`地图配置加载失败 (${response.status})`);
  const data = (await response.json()) as Manifest;
  if (!data.styles?.length) throw new Error('地图配置中没有可用样式');
  return data;
}

async function fetchStyle(meta: StyleMeta): Promise<Record<string, unknown>> {
  const response = await fetch(`/styles/${encodeURIComponent(meta.id)}/style.json`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`样式「${meta.label}」加载失败 (${response.status})`);
  return (await response.json()) as Record<string, unknown>;
}

function applyBranding(branding: Branding = {}): void {
  const title = branding.title || '自定义地图';
  document.title = title;
  els.brandTitle.textContent = title;
  els.brandSubtitle.textContent = branding.subtitle || '';
  if (!branding.subtitle) els.brandSubtitle.hidden = true;
  if (branding.attribution) els.osmLink.textContent = branding.attribution;
  if (branding.attributionUrl) els.osmLink.href = branding.attributionUrl;
}

function renderStyleSwitcher(): void {
  els.switcher.replaceChildren(
    ...manifest.styles.map((meta) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = meta.label;
      button.dataset.styleId = meta.id;
      button.setAttribute('aria-pressed', String(meta.id === activeStyleId));
      button.addEventListener('click', () => {
        void switchStyle(meta.id);
      });
      return button;
    }),
  );
}

function updateActiveStyle(): void {
  for (const button of els.switcher.querySelectorAll<HTMLButtonElement>('button')) {
    const isActive = button.dataset.styleId === activeStyleId;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

async function switchStyle(styleId: string): Promise<void> {
  if (!map || styleId === activeStyleId) return;
  const meta = manifest.styles.find((item) => item.id === styleId);
  if (!meta) return;

  setLoading(true, `切换样式：${meta.label}`);
  try {
    const style = absolutizeStyle(await fetchStyle(meta));
    const done = (): void => setLoading(false);
    map.once('style.load', done);
    map.setStyle(style as any, { diff: false });
    activeStyleId = styleId;
    updateActiveStyle();
    // Guard against a style that never finishes loading.
    window.setTimeout(() => setLoading(false), 5000);
  } catch (error) {
    console.error(error);
    setLoading(false);
    showToast(error instanceof Error ? error.message : '样式切换失败');
  }
}

function createMap(style: Record<string, unknown>, dataset: DatasetMeta): maplibregl.Map {
  const map = new maplibregl.Map({
    container: els.map,
    style: style as any,
    center: dataset.center,
    zoom: dataset.zoom,
    minZoom: Math.max(2, dataset.minzoom),
    maxZoom: 18,
    scrollZoom: false,
    attributionControl: false,
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  enableStepZoom(map, document.getElementById('zoom-level') as HTMLElement);

  map.on('load', () => setLoading(false));
  map.on('error', (event: any) => {
    const status = (event.error as { status?: number } | undefined)?.status;
    if (status === 404) {
      console.warn('[maplibre] tile not found', event.error);
    } else {
      console.error('[maplibre]', event.error);
    }
  });

  // Never leave the loading veil up if the first style fails.
  window.setTimeout(() => setLoading(false), 8000);
  window.__map = map;
  return map;
}

async function bootstrap(): Promise<void> {
  try {
    manifest = await fetchManifest();
    applyBranding(manifest.branding);
    const requested = new URLSearchParams(window.location.search).get('style');
    activeStyleId =
      requested && manifest.styles.some((style) => style.id === requested)
        ? requested
        : manifest.styles.some((style) => style.id === manifest.defaultStyle)
          ? manifest.defaultStyle
          : manifest.styles[0].id;
    const defaultMeta = manifest.styles.find((style) => style.id === activeStyleId)!;
    const dataset = manifest.datasets[defaultMeta.dataset];
    if (!dataset) throw new Error(`数据集 ${defaultMeta.dataset} 不存在`);

    setLoading(true, '加载地图…');
    const style = absolutizeStyle(await fetchStyle(defaultMeta));
    map = createMap(style, dataset);
    renderStyleSwitcher();
    updateActiveStyle();
  } catch (error) {
    console.error(error);
    setLoading(false);
    els.brandTitle.textContent = '地图加载失败';
    els.brandSubtitle.textContent = error instanceof Error ? error.message : String(error);
    showToast(error instanceof Error ? error.message : '地图加载失败');
  }
}

void bootstrap();
