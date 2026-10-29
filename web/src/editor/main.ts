import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './editor.css';
import { absolutizeStyle } from '../lib/style';
import { enableStepZoom } from '../lib/zoom';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface StyleMeta {
  id: string;
  label: string;
  dataset: string;
}

interface Manifest {
  branding?: { title?: string };
  styles: StyleMeta[];
  defaultStyle?: string;
}

interface Group {
  id: string;
  label: string;
  order: number;
}

interface GroupSchema {
  groups: Group[];
}

interface Style {
  version: number;
  name?: string;
  center?: [number, number];
  zoom?: number;
  sources: Record<string, any>;
  layers: any[];
  glyphs?: string;
  sprite?: string | any[];
  metadata?: Record<string, any>;
  [key: string]: any;
}

const els = {
  styleSelect: document.getElementById('style-select') as HTMLSelectElement,
  token: document.getElementById('token') as HTMLInputElement,
  save: document.getElementById('save') as HTMLButtonElement,
  versions: document.getElementById('versions') as HTMLButtonElement,
  status: document.getElementById('status') as HTMLElement,
  zoom: document.getElementById('zoom-level') as HTMLElement,
  layerTree: document.getElementById('layer-tree') as HTMLElement,
  layerCount: document.getElementById('layer-count') as HTMLElement,
  inspector: document.getElementById('inspector-body') as HTMLElement,
  map: document.getElementById('map') as HTMLDivElement,
  drawer: document.getElementById('drawer') as HTMLElement,
  toggleJson: document.getElementById('toggle-json') as HTMLButtonElement,
  closeDrawer: document.getElementById('close-drawer') as HTMLButtonElement,
  json: document.getElementById('json') as HTMLTextAreaElement,
  jsonError: document.getElementById('json-error') as HTMLElement,
  formatJson: document.getElementById('format-json') as HTMLButtonElement,
  applyJson: document.getElementById('apply-json') as HTMLButtonElement,
  versionsPanel: document.getElementById('versions-panel') as HTMLElement,
  versionsList: document.getElementById('versions-list') as HTMLElement,
  closeVersions: document.getElementById('close-versions') as HTMLButtonElement,
  toast: document.getElementById('toast') as HTMLElement,
};

let manifest: Manifest;
let groupSchema: GroupSchema = { groups: [] };
let style: Style;
let currentStyleId = '';
let selectedLayerId: string | null = null;
let map: maplibregl.Map | undefined;
let dirty = false;
declare global {
  interface Window {
    __editorMap?: maplibregl.Map;
  }
}

let selectedFeature: any | null = null;
let selectionLngLat: [number, number] | null = null;
let selectionReady = false;

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] } as const;

const COLOR_KEYS = [
  'background-color',
  'fill-color',
  'fill-outline-color',
  'line-color',
  'text-color',
  'text-halo-color',
];
const OPACITY_KEYS = ['fill-opacity', 'line-opacity', 'text-opacity', 'icon-opacity'];
const SIZE_KEYS = ['line-width', 'text-size', 'text-halo-width', 'line-blur', 'line-gap-width'];

function toast(message: string, isError = false): void {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', isError);
  els.toast.hidden = false;
  window.clearTimeout((toast as any).timer);
  (toast as any).timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 4500);
}

function setStatus(message: string): void {
  els.status.textContent = message;
}

function markDirty(): void {
  dirty = true;
  setStatus('未保存');
}

function styleUrl(id: string): string {
  return `/styles/${encodeURIComponent(id)}/style.json`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = data?.error || `${response.status} ${response.statusText}`;
    const issues = data?.issues?.length ? `\n${data.issues.join('\n')}` : '';
    throw new Error(`${message}${issues}`);
  }
  return data as T;
}

function authHeaders(): Record<string, string> {
  const token = els.token.value.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function renderStyleSelect(): void {
  els.styleSelect.replaceChildren(
    ...manifest.styles.map((meta) => {
      const option = document.createElement('option');
      option.value = meta.id;
      option.textContent = meta.label;
      option.selected = meta.id === currentStyleId;
      return option;
    }),
  );
}

function ensureSelectionLayers(): void {
  if (!map || selectionReady) return;
  if (map.getSource('__editor_selection')) {
    selectionReady = true;
    return;
  }
  try {
    map.addSource('__editor_selection', { type: 'geojson', data: EMPTY_GEOJSON as any });
    // Tile-level features may be merged (e.g. many primary road segments in
    // one MultiLineString), so highlighting the whole geometry is noisy.
    // Use a click marker plus the inspector's feature details instead.
    map.addLayer({
      id: '__editor_selection_circle',
      type: 'circle',
      source: '__editor_selection',
      paint: {
        'circle-color': '#fbbf24',
        'circle-radius': 7,
        'circle-stroke-color': '#111827',
        'circle-stroke-width': 2,
      },
    });
    selectionReady = true;
  } catch (error) {
    console.warn('[editor] selection layers', error);
  }
}

function updateSelection(): void {
  const source = map?.getSource('__editor_selection') as any;
  if (!source) return;
  source.setData(
    selectionLngLat
      ? {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: selectionLngLat },
        }
      : EMPTY_GEOJSON,
  );
}

function selectFeatureAt(point: { x: number; y: number }, lngLat: { lng: number; lat: number }): void {
  if (!map) return;
  const hit = map
    .queryRenderedFeatures(point as any)
    .find(
      (feature: any) =>
        feature.layer &&
        !feature.layer.id.startsWith('__editor_') &&
        (style.layers || []).some((layer) => layer.id === feature.layer.id),
    );
  if (!hit) {
    selectedFeature = null;
    selectionLngLat = null;
    updateSelection();
    renderInspector();
    return;
  }
  selectedLayerId = hit.layer.id;
  selectedFeature = hit;
  selectionLngLat = [lngLat.lng, lngLat.lat];
  updateSelection();
  renderLayerTree();
  renderInspector();
}

function createMap(nextStyle: Style): void {
  if (map) return;
  map = new maplibregl.Map({
    container: els.map,
    style: absolutizeStyle(nextStyle) as any,
    center: nextStyle.center || [121.4737, 31.2304],
    zoom: nextStyle.zoom || 11,
    minZoom: 2,
    maxZoom: 18,
    scrollZoom: false,
    attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  enableStepZoom(map, els.zoom);
  map.on('style.load', () => {
    selectionReady = false;
    ensureSelectionLayers();
    updateSelection();
  });
  map.on('click', (event: any) => selectFeatureAt(event.point, event.lngLat));
  window.__editorMap = map;
  map.on('error', (event: any) => {
    const status = event?.error?.status;
    if (status !== 404) console.warn('[editor]', event?.error);
  });
}

async function loadStyle(id: string, force = false): Promise<void> {
  if (!force && dirty && !window.confirm('当前样式有未保存修改，确定切换？')) return;
  setStatus('加载中…');
  const next = await fetchJson<Style>(styleUrl(id));
  style = next;
  currentStyleId = id;
  selectedLayerId = null;
  selectedFeature = null;
  selectionLngLat = null;
  dirty = false;
  setStatus('');
  renderStyleSelect();
  if (!map) createMap(next);
  else map.setStyle(absolutizeStyle(next) as any, { diff: false });
  renderLayerTree();
  renderInspector();
  syncJson();
}

function groupOf(layer: any): string {
  return layer?.metadata?.group || 'other';
}

function renderLayerTree(): void {
  const groups = new Map(groupSchema.groups.map((group) => [group.id, group]));
  const byGroup = new Map<string, any[]>();
  for (const layer of style.layers || []) {
    const group = groupOf(layer);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(layer);
  }
  const ordered = [...byGroup.keys()].sort((a, b) => {
    return (groups.get(a)?.order ?? 999) - (groups.get(b)?.order ?? 999);
  });

  const nodes: HTMLElement[] = [];
  for (const groupId of ordered) {
    const group = groups.get(groupId);
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = `${group?.label || groupId} (${byGroup.get(groupId)!.length})`;
    nodes.push(title);

    for (const layer of byGroup.get(groupId)!) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `layer-button${layer.id === selectedLayerId ? ' is-active' : ''}`;
      button.dataset.layerId = layer.id;
      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = layer.type;
      const id = document.createElement('span');
      id.className = 'id';
      id.textContent = layer.id;
      button.append(type, id);
      button.addEventListener('click', () => {
        selectedLayerId = layer.id;
        selectedFeature = null;
        selectionLngLat = null;
        updateSelection();
        renderLayerTree();
        renderInspector();
      });
      nodes.push(button);
    }
  }
  els.layerTree.replaceChildren(...nodes);
  els.layerCount.textContent = `${style.layers.length}`;
}

function selectedLayer(): any | undefined {
  return (style.layers || []).find((layer) => layer.id === selectedLayerId);
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field';
  const text = document.createElement('label');
  text.textContent = label;
  row.append(text, control);
  return row;
}

function numericInput(value: unknown, onChange: (value: number) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.value = typeof value === 'number' ? String(value) : '';
  input.addEventListener('input', () => {
    if (input.value === '') return;
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(parsed);
  });
  return input;
}

function textInput(value: unknown, onChange: (value: unknown) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = typeof value === 'string' ? value : JSON.stringify(value);
  input.addEventListener('change', () => {
    const raw = input.value.trim();
    if (raw === '') return;
    if (raw.startsWith('[') || raw.startsWith('{') || raw === 'true' || raw === 'false' || raw === 'null') {
      try {
        onChange(JSON.parse(raw));
        return;
      } catch {
        toast('不是合法 JSON', true);
        return;
      }
    }
    const number = Number(raw);
    onChange(Number.isFinite(number) && raw !== '' ? number : raw);
  });
  return input;
}

function colorToHex(value: unknown): string {
  if (typeof value !== 'string') return '#000000';
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    if (hex[1].length === 3) return `#${hex[1].split('').map((c) => c + c).join('')}`;
    return `#${hex[1]}`;
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  }
  return '#000000';
}

function applyPaint(key: string, value: unknown): void {
  const layer = selectedLayer();
  if (!layer || !selectedLayerId) return;
  layer.paint = layer.paint || {};
  layer.paint[key] = value;
  map?.setPaintProperty(selectedLayerId, key as any, value as any);
  markDirty();
  syncJson();
}

function applyLayout(key: string, value: unknown): void {
  const layer = selectedLayer();
  if (!layer || !selectedLayerId) return;
  layer.layout = layer.layout || {};
  layer.layout[key] = value;
  map?.setLayoutProperty(selectedLayerId, key as any, value as any);
  markDirty();
  syncJson();
}

function applyZoom(min: number | null, max: number | null): void {
  const layer = selectedLayer();
  if (!layer || !selectedLayerId) return;
  if (min === null) delete layer.minzoom;
  else layer.minzoom = min;
  if (max === null) delete layer.maxzoom;
  else layer.maxzoom = max;
  map?.setLayerZoomRange(selectedLayerId, min ?? 0, max ?? 24);
  markDirty();
  syncJson();
}

function renderFeatureInfo(feature: any): HTMLElement {
  const box = document.createElement('div');
  box.className = 'feature-box';
  const title = document.createElement('strong');
  title.textContent = '选中要素';
  const meta = document.createElement('div');
  meta.className = 'feature-meta';
  meta.textContent = `${feature.geometry?.type || '?'} · ${feature.sourceLayer || '-'} · 样式层 ${feature.layer?.id || '-'}`;
  box.append(title, meta);

  const properties = feature.properties || {};
  const priority = ['name', 'name:latin', 'name:zh', 'name:en', 'class', 'subclass', 'type', 'ref', 'rank'];
  const keys = Object.keys(properties).sort((a, b) => {
    const pa = priority.indexOf(a);
    const pb = priority.indexOf(b);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return a.localeCompare(b);
  });
  for (const key of keys.slice(0, 14)) {
    const row = document.createElement('div');
    row.className = 'feature-prop';
    const name = document.createElement('span');
    name.textContent = key;
    const value = document.createElement('code');
    const raw = String(properties[key]);
    value.textContent = raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
    row.append(name, value);
    box.appendChild(row);
  }
  if (!keys.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '该要素没有属性';
    box.appendChild(empty);
  }

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '复制属性 JSON';
  copy.style.marginTop = '6px';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(JSON.stringify(properties, null, 2));
    toast('已复制属性');
  });
  box.appendChild(copy);
  return box;
}

function renderInspector(): void {
  const layer = selectedLayer();
  if (!layer) {
    els.inspector.innerHTML = '<p class="muted">选择一个图层</p>';
    return;
  }

  const nodes: HTMLElement[] = [];
  const head = document.createElement('div');
  head.className = 'inspector-head';
  head.innerHTML = `<code>${layer.id}</code><div class="muted">${layer.type} · ${layer['source-layer'] || '-'}</div>`;
  nodes.push(head);
  if (selectedFeature) nodes.push(renderFeatureInfo(selectedFeature));

  const visible = document.createElement('input');
  visible.type = 'checkbox';
  visible.checked = layer.layout?.visibility !== 'none';
  visible.addEventListener('change', () => {
    applyLayout('visibility', visible.checked ? 'visible' : 'none');
  });
  nodes.push(field('可见', visible));

  const min = document.createElement('input');
  min.type = 'number';
  min.min = '0';
  min.max = '24';
  min.placeholder = '0';
  min.value = layer.minzoom === undefined ? '' : String(layer.minzoom);
  const max = document.createElement('input');
  max.type = 'number';
  max.min = '0';
  max.max = '24';
  max.placeholder = '∞';
  max.value = layer.maxzoom === undefined ? '' : String(layer.maxzoom);
  const zoomRow = document.createElement('div');
  zoomRow.className = 'field';
  const zoomLabel = document.createElement('label');
  zoomLabel.textContent = '层级';
  const zoomInputs = document.createElement('div');
  zoomInputs.className = 'color-row';
  zoomInputs.append(min, document.createTextNode('→'), max);
  zoomRow.append(zoomLabel, zoomInputs);
  const commitZoom = (): void => {
    applyZoom(min.value === '' ? null : Number(min.value), max.value === '' ? null : Number(max.value));
  };
  min.addEventListener('change', commitZoom);
  max.addEventListener('change', commitZoom);
  nodes.push(zoomRow);

  const paint = layer.paint || {};
  for (const key of COLOR_KEYS) {
    if (!(key in paint)) continue;
    const value = paint[key];
    if (typeof value !== 'string') continue;
    const row = document.createElement('div');
    row.className = 'field';
    const label = document.createElement('label');
    label.textContent = key;
    const wrap = document.createElement('div');
    wrap.className = 'color-row';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = colorToHex(value);
    const text = document.createElement('input');
    text.type = 'text';
    text.value = value;
    picker.addEventListener('input', () => {
      text.value = picker.value;
      applyPaint(key, picker.value);
    });
    text.addEventListener('change', () => {
      applyPaint(key, text.value);
      picker.value = colorToHex(text.value);
    });
    wrap.append(picker, text);
    row.append(label, wrap);
    nodes.push(row);
  }

  for (const key of [...OPACITY_KEYS, ...SIZE_KEYS]) {
    if (!(key in paint)) continue;
    const value = paint[key];
    if (typeof value === 'number') {
      nodes.push(field(key, numericInput(value, (next) => applyPaint(key, next))));
    } else {
      nodes.push(field(key, textInput(value, (next) => applyPaint(key, next))));
    }
  }

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '颜色/数值改动会实时预览。复杂表达式（zoom/class 判断）请用底部 JSON 编辑。';
  nodes.push(hint);

  const jsonButton = document.createElement('button');
  jsonButton.type = 'button';
  jsonButton.textContent = '打开完整 JSON';
  jsonButton.addEventListener('click', () => openDrawer(true));
  nodes.push(jsonButton);

  els.inspector.replaceChildren(...nodes);
}

function syncJson(): void {
  els.json.value = JSON.stringify(style, null, 2);
  els.jsonError.textContent = '';
}

function openDrawer(open: boolean): void {
  els.drawer.classList.toggle('open', open);
}

function applyJson(): void {
  try {
    const next = JSON.parse(els.json.value);
    if (!next || next.version !== 8 || !Array.isArray(next.layers)) {
      throw new Error('不是有效的 MapLibre style（version 8 + layers）');
    }
    style = next;
    dirty = true;
    setStatus('未保存');
    map?.setStyle(absolutizeStyle(style) as any, { diff: false });
    renderLayerTree();
    renderInspector();
    els.jsonError.textContent = '';
    toast('已应用 JSON');
  } catch (error) {
    els.jsonError.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function save(): Promise<void> {
  if (!els.token.value.trim()) {
    els.token.focus();
    toast('请输入编辑令牌（.env 里的 EDITOR_TOKEN）', true);
    return;
  }
  setStatus('保存中…');
  try {
    const result = await fetchJson<{ ok: boolean; version: string }>(`/api/styles/${currentStyleId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(style),
    });
    dirty = false;
    setStatus(`已保存 · ${result.version}`);
    toast('已保存，刷新地图页面即可看到');
  } catch (error) {
    setStatus('保存失败');
    toast(error instanceof Error ? error.message : String(error), true);
  }
}

async function loadVersions(): Promise<void> {
  if (!els.token.value.trim()) {
    els.token.focus();
    toast('请输入编辑令牌', true);
    return;
  }
  try {
    setStatus('读取版本…');
    const result = await fetchJson<{ versions: { version: string; size: number; mtime: string }[] }>(
      `/api/styles/${currentStyleId}/versions`,
      { headers: authHeaders() },
    );
    els.versionsList.replaceChildren(
      ...result.versions.map((item) => {
        const row = document.createElement('div');
        row.className = 'version-row';
        const name = document.createElement('span');
        name.textContent = `${item.version} · ${item.size} B`;
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.textContent = '恢复';
        restore.addEventListener('click', () => {
          void restoreVersion(item.version);
        });
        row.append(name, restore);
        return row;
      }),
    );
    if (!result.versions.length) {
      els.versionsList.innerHTML = '<p class="muted">还没有版本。保存一次后会出现。</p>';
    }
    els.versionsPanel.hidden = false;
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  } finally {
    setStatus('');
  }
}

async function restoreVersion(version: string): Promise<void> {
  if (!window.confirm(`恢复到 ${version}？当前样式会先备份。`)) return;
  try {
    await fetchJson(`/api/styles/${currentStyleId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ version }),
    });
    await loadStyle(currentStyleId, true);
    els.versionsPanel.hidden = true;
    toast('已恢复；刷新地图页面即可看到');
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  }
}

async function bootstrap(): Promise<void> {
  try {
    const [manifestData, groups] = await Promise.all([
      fetchJson<Manifest>('/map.manifest.json'),
      fetchJson<GroupSchema>('/styles/schema/layer-groups.json').catch(() => ({ groups: [] })),
    ]);
    manifest = manifestData;
    groupSchema = groups;
    currentStyleId = manifest.defaultStyle && manifest.styles.some((s) => s.id === manifest.defaultStyle)
      ? manifest.defaultStyle
      : manifest.styles[0]?.id;
    if (!currentStyleId) throw new Error('manifest 中没有样式');
    els.token.value = sessionStorage.getItem('editor-token') || '';
    await loadStyle(currentStyleId, true);
  } catch (error) {
    setStatus('初始化失败');
    toast(error instanceof Error ? error.message : String(error), true);
  }
}

els.styleSelect.addEventListener('change', () => {
  void loadStyle(els.styleSelect.value);
});
els.token.addEventListener('change', () => {
  sessionStorage.setItem('editor-token', els.token.value.trim());
});
els.save.addEventListener('click', () => void save());
els.versions.addEventListener('click', () => void loadVersions());
els.closeVersions.addEventListener('click', () => {
  els.versionsPanel.hidden = true;
});
els.toggleJson.addEventListener('click', () => openDrawer(!els.drawer.classList.contains('open')));
els.closeDrawer.addEventListener('click', () => openDrawer(false));
els.formatJson.addEventListener('click', () => {
  try {
    els.json.value = JSON.stringify(JSON.parse(els.json.value), null, 2);
    els.jsonError.textContent = '';
  } catch (error) {
    els.jsonError.textContent = error instanceof Error ? error.message : String(error);
  }
});
els.applyJson.addEventListener('click', applyJson);

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

void bootstrap();
