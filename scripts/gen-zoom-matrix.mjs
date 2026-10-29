#!/usr/bin/env node
/**
 * Generate a human-readable layer/zoom matrix from a built style.
 * Usage: node scripts/gen-zoom-matrix.mjs [styleId]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const styleId = process.argv[2] || 'blueprint';
const stylePath = path.join(root, 'styles', `${styleId}.json`);
const groupsPath = path.join(root, 'styles/schema/layer-groups.json');
const outPath = path.join(root, 'docs/zoom-matrix.md');

if (!fs.existsSync(stylePath)) {
  console.error(`gen-zoom-matrix: missing ${stylePath}`);
  process.exit(1);
}
const style = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
const schema = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
const groups = [...(schema.groups || [])].sort((a, b) => a.order - b.order);
const byGroup = new Map(groups.map((g) => [g.id, []]));

for (const layer of style.layers || []) {
  const group = layer.metadata?.group || 'other';
  if (!byGroup.has(group)) byGroup.set(group, []);
  byGroup.get(group).push(layer);
}

const lines = [];
lines.push(`# 图层/层级矩阵：${styleId}`);
lines.push('');
lines.push(`由 \`scripts/gen-zoom-matrix.mjs\` 从 \`styles/${styleId}.json\` 生成。`);
lines.push('');
lines.push('| 分组 | 图层 | 类型 | source-layer | minzoom | maxzoom |');
lines.push('|---|---|---|---|---|---|');

for (const group of groups) {
  for (const layer of byGroup.get(group.id) || []) {
    lines.push(
      `| ${group.label} | \`${layer.id}\` | ${layer.type} | ${layer['source-layer'] || '-'} | ${layer.minzoom ?? 0} | ${layer.maxzoom ?? '∞'} |`,
    );
  }
}
for (const [groupId, layers] of byGroup) {
  if (groups.some((g) => g.id === groupId)) continue;
  for (const layer of layers) {
    lines.push(`| ${groupId} | \`${layer.id}\` | ${layer.type} | ${layer['source-layer'] || '-'} | ${layer.minzoom ?? 0} | ${layer.maxzoom ?? '∞'} |`);
  }
}

fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(`gen-zoom-matrix: wrote ${path.relative(root, outPath)} (${style.layers.length} layers)`);
