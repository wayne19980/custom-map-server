/**
 * Natural-language style editing.
 *
 * Two modes:
 *  - OpenAI-compatible LLM (AI_API_KEY / AI_BASE_URL / AI_MODEL) producing a
 *    restricted RFC 6902 JSON Patch;
 *  - deterministic local fallback for common color/visibility/width requests.
 *
 * The model never gets to execute code, and the caller validates the patched
 * style with the MapLibre Style Spec before offering it to the user.
 */
import jsonpatch from 'fast-json-patch';

const { applyPatch } = jsonpatch;

const AI_BASE_URL = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

const ALLOWED_PATH = /^\/layers\/\d+\/(paint|layout|minzoom|maxzoom|filter)(\/[^/]+)*$/;
const COLOR_WORDS = [
  ['深蓝', '#002447'],
  ['浅蓝', '#7dd3fc'],
  ['青色', '#06b6d4'],
  ['青', '#06b6d4'],
  ['蓝色', '#0061a3'],
  ['蓝', '#0061a3'],
  ['绿色', '#22c55e'],
  ['绿', '#22c55e'],
  ['红色', '#ef4444'],
  ['红', '#ef4444'],
  ['黄色', '#eab308'],
  ['黄', '#eab308'],
  ['橙色', '#f97316'],
  ['橙', '#f97316'],
  ['紫色', '#a855f7'],
  ['紫', '#a855f7'],
  ['白色', '#ffffff'],
  ['白', '#ffffff'],
  ['黑色', '#000000'],
  ['黑', '#000000'],
  ['灰色', '#94a3b8'],
  ['灰', '#94a3b8'],
];

const GROUPS = [
  {
    id: 'background',
    re: /背景|底色|background/i,
    match: (layer) => layer.id === 'background',
  },
  {
    id: 'water',
    re: /水体|水面|河流|江河|湖泊|海|water|river|lake|sea/i,
    match: (layer) => ['water', 'waterway'].includes(layer['source-layer']),
  },
  {
    id: 'building',
    re: /建筑|楼房|building/i,
    match: (layer) => layer['source-layer'] === 'building',
  },
  {
    id: 'land',
    re: /公园|绿地|林地|地表|park|green|land/i,
    match: (layer) => ['landuse', 'landcover', 'park'].includes(layer['source-layer']),
  },
  {
    id: 'labels',
    re: /地名|标注|文字|标签|名称|label|name|text/i,
    match: (layer) =>
      layer.type === 'symbol' &&
      ['place', 'transportation_name', 'water_name'].includes(layer['source-layer']),
  },
  {
    id: 'roads',
    re: /道路|路网|主干|高速|马路|road|highway|street|motorway/i,
    match: (layer) =>
      layer['source-layer'] === 'transportation' &&
      layer.type === 'line' &&
      layer.id.startsWith('highway_') &&
      /(?:inner|minor|path)$/.test(layer.id),
  },
];

function clampString(value) {
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

function extractColor(prompt) {
  const hex = prompt.match(/#[0-9a-fA-F]{3,8}\b/);
  if (hex) return hex[0];
  for (const [word, color] of COLOR_WORDS) {
    if (prompt.includes(word)) return color;
  }
  return null;
}

function pickTargets(style, prompt) {
  const direct = (style.layers || []).filter((layer) => prompt.includes(layer.id));
  if (direct.length) return direct;

  // "隐藏村庄名称" should not hide all labels.
  if (/村庄|village/i.test(prompt)) {
    return (style.layers || []).filter((layer) => layer.id === 'place_village');
  }

  for (const group of GROUPS) {
    if (group.re.test(prompt)) {
      return (style.layers || []).filter(group.match);
    }
  }
  return [];
}

function colorProperty(layer) {
  if (layer.id === 'background') return 'background-color';
  if (layer.type === 'fill') return 'fill-color';
  if (layer.type === 'line') return 'line-color';
  if (layer.type === 'circle') return 'circle-color';
  if (layer.type === 'symbol') return 'text-color';
  return null;
}

function propertyExists(layer, section, key) {
  return Boolean(layer[section] && Object.prototype.hasOwnProperty.call(layer[section], key));
}

function buildSetPatch(style, layers, section, key, makeValue, patch, notes) {
  for (const layer of layers) {
    const index = style.layers.indexOf(layer);
    if (index < 0) continue;
    const value = makeValue(layer);
    if (value === undefined) {
      notes.push(`跳过 ${layer.id}：没有可直接修改的 ${section}.${key}`);
      continue;
    }
    if (!layer[section]) {
      patch.push({ op: 'add', path: `/layers/${index}/${section}`, value: { [key]: value } });
    } else {
      patch.push({
        op: propertyExists(layer, section, key) ? 'replace' : 'add',
        path: `/layers/${index}/${section}/${key}`,
        value,
      });
    }
  }
}

function rulePatch(style, prompt) {
  const targets = pickTargets(style, prompt);
  if (!targets.length) {
    throw new Error('没有识别到要修改的图层。可以写“水体”“道路”“地名”“建筑”或直接写图层 id。');
  }

  const patch = [];
  const notes = [];
  const color = extractColor(prompt);
  const hide = /隐藏|不显示|去掉|hide|remove/i.test(prompt);
  const show = /显示|显示出来|show/i.test(prompt);
  const thinner = /细|变细|thin|thinner/i.test(prompt);

  if (hide || show) {
    buildSetPatch(
      style,
      targets,
      'layout',
      'visibility',
      () => (hide ? 'none' : 'visible'),
      patch,
      notes,
    );
  }

  if (color) {
    for (const layer of targets) {
      const key = colorProperty(layer);
      if (!key) {
        notes.push(`跳过 ${layer.id}：该图层没有可设置的颜色属性`);
        continue;
      }
      const index = style.layers.indexOf(layer);
      if (!layer.paint) {
        patch.push({ op: 'add', path: `/layers/${index}/paint`, value: { [key]: color } });
      } else {
        patch.push({
          op: propertyExists(layer, 'paint', key) ? 'replace' : 'add',
          path: `/layers/${index}/paint/${key}`,
          value: color,
        });
      }
    }
  }

  if (thinner) {
    for (const layer of targets) {
      if (layer.type !== 'line' || !layer.paint) {
        notes.push(`跳过 ${layer.id}：不是线图层`);
        continue;
      }
      const width = layer.paint['line-width'];
      const index = style.layers.indexOf(layer);
      if (typeof width === 'number') {
        patch.push({
          op: 'replace',
          path: `/layers/${index}/paint/line-width`,
          value: Math.max(0.1, Math.round(width * 0.7 * 100) / 100),
        });
      } else {
        // For expression widths, use a conservative preset per road class.
        const preset = /motorway/.test(layer.id)
          ? { base: 1.2, stops: [[6, 0.8], [10, 1.0], [14, 1.5], [18, 3], [20, 5]] }
          : /major|secondary/.test(layer.id)
            ? { base: 1.2, stops: [[11, 0.7], [14, 1.1], [18, 2.5], [20, 6]] }
            : /minor/.test(layer.id)
              ? { base: 1.3, stops: [[13, 0.5], [16, 0.8], [20, 4]] }
              : { base: 1.2, stops: [[14, 0.3], [18, 0.7]] };
        patch.push({ op: 'replace', path: `/layers/${index}/paint/line-width`, value: preset });
      }
    }
  }

  if (!patch.length) {
    throw new Error('识别到了图层，但没有可执行的修改。请试“改成 #06b6d4”“隐藏”“显示”。');
  }

  const explanationParts = [];
  if (color) explanationParts.push(`颜色改为 ${color}`);
  if (hide) explanationParts.push('隐藏');
  if (show) explanationParts.push('显示');
  if (thinner) explanationParts.push('线宽收细');
  if (notes.length) explanationParts.push(`注意：${notes.join('；')}`);

  return {
    provider: 'rules',
    explanation: `已针对 ${targets.map((layer) => layer.id).join(', ')}：${explanationParts.join('，')}。`,
    patch,
  };
}

function validPatch(patch) {
  if (!Array.isArray(patch) || patch.length === 0) throw new Error('AI 没有返回修改');
  for (const operation of patch) {
    if (!['add', 'replace', 'remove'].includes(operation.op)) {
      throw new Error(`不支持的 patch 操作：${operation.op}`);
    }
    if (typeof operation.path !== 'string' || !ALLOWED_PATH.test(operation.path)) {
      throw new Error(`不允许修改的路径：${operation.path}`);
    }
    if (operation.path.includes('__proto__') || operation.path.includes('constructor')) {
      throw new Error(`不允许修改的路径：${operation.path}`);
    }
    if (operation.op !== 'remove' && !('value' in operation)) {
      throw new Error(`patch 缺少 value：${operation.path}`);
    }
  }
}

function pointerParts(pointer) {
  return pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getByPointer(document, pointer) {
  let current = document;
  for (const part of pointerParts(pointer)) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function makeDiff(style, patch) {
  return patch.map((operation) => {
    const parts = pointerParts(operation.path);
    const layerIndex = Number(parts[0] === 'layers' ? parts[1] : NaN);
    const layer = style.layers[layerIndex];
    const property = parts.slice(2).join('.');
    return {
      layerId: layer?.id || '?',
      property,
      op: operation.op,
      before: operation.op === 'add' ? undefined : getByPointer(style, operation.path),
      after: operation.value,
    };
  });
}

function styleSummary(style) {
  return (style.layers || []).map((layer, index) => ({
    index,
    id: layer.id,
    type: layer.type,
    sourceLayer: layer['source-layer'],
    group: layer.metadata?.group,
    paint: layer.paint,
    minzoom: layer.minzoom,
    maxzoom: layer.maxzoom,
  }));
}

function parseModelJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI 返回内容不是 JSON');
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function llmPatch(style, prompt) {
  const endpoint = AI_BASE_URL.endsWith('/chat/completions')
    ? AI_BASE_URL
    : `${AI_BASE_URL}/chat/completions`;
  const system = [
    'You are a MapLibre Style Spec editor.',
    'Return ONLY a JSON object: {"explanation":"...","patch":[RFC6902 operations]}.',
    'Allowed patch paths: /layers/<index>/(paint|layout|minzoom|maxzoom|filter) and nested fields.',
    'Never modify sources, glyphs, sprite, metadata, or layer arrays themselves.',
    'Use existing layers only. Colors should be hex/rgb strings.',
    'If the request is ambiguous, make the smallest reasonable change and explain it briefly in Chinese.',
  ].join('\n');
  const user = JSON.stringify({
    request: prompt,
    layers: styleSummary(style),
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.1,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AI API ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('AI API 没有返回文本');
  const parsed = parseModelJson(content);
  const patch = parsed.patch;
  validPatch(patch);
  return {
    provider: 'llm',
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : 'AI 已生成修改。',
    patch,
  };
}

export async function generateStylePatch(style, prompt) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('请输入修改描述');
  }

  let warning;
  if (AI_API_KEY && AI_BASE_URL) {
    try {
      const result = await llmPatch(style, prompt.trim());
      const { style: patched, diff } = apply(style, result.patch);
      return { ...result, style: patched, diff };
    } catch (error) {
      warning = `AI 模型不可用，已使用规则模式：${error.message}`;
    }
  }

  const result = rulePatch(style, prompt.trim());
  const { style: patched, diff } = apply(style, result.patch);
  return { ...result, style: patched, diff, warning };
}

function apply(style, patch) {
  validPatch(patch);
  const clone = JSON.parse(JSON.stringify(style));
  const result = applyPatch(clone, patch, false, false);
  return {
    style: result.newDocument,
    diff: makeDiff(style, patch),
  };
}
