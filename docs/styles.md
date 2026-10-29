# 样式指南

## 1. 样式是什么

样式是一个 MapLibre Style JSON（`version: 8`），决定：

- 用哪个数据源（`sources`）；
- 画哪些图层、按什么顺序（`layers`）；
- 颜色、线宽、字号、图标、显示级别（`paint` / `layout` / `filter`）；
- 字体（`glyphs` + `text-font`）和图标（`sprite`）。

本项目的可部署样式是 `styles/light.json`、`styles/dark.json`、`styles/bright.json`、`styles/blueprint.json`，由 `styles/vendor/` 中的上游样式 + `config/map.manifest.json` 生成。`blueprint` 还额外叠加了 `styles/palettes/blueprint.json`。

日常改样式可以直接用可视化编辑器：`http://<host>:8081/editor`，支持图层树、颜色/线宽/透明度/层级、完整 JSON、保存和版本历史。保存后刷新主地图即可生效（样式由 Nginx 静态提供，无需重启 tileserver）。详见 [编辑器说明](editor.md)。

## 2. 生成链路

```
styles/vendor/<base>/style.json
        +
config/map.manifest.json（dataset / style / version）
        +
data/fonts/fonts.json（真实字体名）
        +
data/sprites/<styleId>/sprite.json
        │
        ▼  node scripts/build-styles.mjs
styles/<styleId>.json
```

`build-styles.mjs` 做以下替换：

1. `sources` → 单一 `basemap`，指向 `/data/<dataset>/{z}/{x}/{y}.pbf?v=<version>`；
2. 图层 `source` → `basemap`；
3. `glyphs` → `/fonts/{fontstack}/{range}.pbf`；
4. `sprite` → `<styleId>/sprite`（相对 TileServer GL 的 `paths.sprites`）；
5. `center` / `zoom` / `bounds` / `minzoom` / `maxzoom` 来自 manifest；
6. `text-font` → `data/fonts/fonts.json` 中的 Regular/Bold；
7. 写入 `metadata`（`map:styleId`、`map:datasetId`、`map:dataVersion`、`map:attribution`）。

> 不要手改 `styles/light.json` 后忘记来源：如果之后重新 `./run styles`，会覆盖编辑器保存的内容。长期定制请改 `styles/vendor/` 或新增自己的 base，并在 manifest 中引用；或者把编辑器作为唯一修改入口，不再跑 `./run styles`。

## 3. 调色板（palette）

对于“只想换一套配色、不改图层结构”的需求，推荐用调色板：

```json
// config/map.manifest.json 的 style 条目
{
  "id": "blueprint",
  "label": "深蓝",
  "base": "vendor/dark-matter/style.json",
  "dataset": "shanghai",
  "palette": "palettes/blueprint.json"
}
```

```json
// styles/palettes/blueprint.json
{
  "name": "Blueprint",
  "layers": {
    "background": { "paint": { "background-color": "#001426" } },
    "water": { "paint": { "fill-color": "#002447" } },
    "landuse_park": { "paint": { "fill-color": "#0d3945" } },
    "highway_motorway_inner": { "paint": { "line-color": "#0061a3" } },
    "highway_minor": { "paint": { "line-color": "#145789" } },
    "landcover_wood": {
      "paint": { "fill-color": "#0d3945" },
      "removePaint": ["fill-pattern"]
    }
  }
}
```

- `layers.<layerId>.paint`：按图层 id 覆盖 paint 属性；
- `layers.<layerId>.layout`：覆盖 layout；
- `layers.<layerId>.filter`：覆盖 filter（例如只保留某类道路）；
- `layers.<layerId>.minzoom` / `maxzoom`：控制该图层从哪个层级开始/结束显示；
- `layers.<layerId>.removePaint`：删除上游属性（例如去掉 `fill-pattern` 的纹理）；
- `extraLayers`：克隆已有图层并改 id/filter/minzoom，用于把“次要道路”拆成更高层级才出现的独立图层；
- 应用顺序：基础样式 → 字体/数据源 → 调色板 → extraLayers → metadata；
- 改完执行 `./run styles check`，刷新地图即可（静态样式）。

`blueprint` 的层级策略（可在 palette 里直接改）：

| 层级 | 道路 | 区域名称 |
|---|---|---|
| z9–10 | 高速/主干（细线） | 城市/州/主要城镇 |
| z11–12 | 高速/主干/快速路；次干道隐藏 | 上海市/浦东新区；区县从 z13 出现 |
| z13 | 次干道、支路、服务道出现（细线）；建筑出现 | 区县出现 |
| z14+ | 步行道/小径出现 | 村庄/社区名称出现 |

对应实现：`highway_major_*` 的 `filter` 只保留 primary/trunk，`extraLayers` 克隆出 secondary/tertiary 并设 `minzoom: 13`；`highway_minor` 设 `minzoom: 13`；`highway_path` 设 `minzoom: 14`；`place_city` 设 `minzoom: 13`，`place_village`/`place_suburb` 设 `minzoom: 14`。

`blueprint` 的实际取色：背景 `#001426`、水面 `#002447`、地表 `#0d3945`、主路 `#0061a3`、次路 `#145789`。

也可以用 `?style=blueprint` 直接打开某套样式；前端会读取 `style` 查询参数。

## 4. 改颜色：最短路径

直接编辑 `styles/light.json`，例如把水体改蓝：

```json
{
  "id": "water",
  "paint": { "fill-color": "#a5c9e8" }
}
```

保存后刷新页面即可（静态样式，无需重启）。数据文件不变。

常用图层：

| 图层 id | 作用 |
|---|---|
| `background` | 地图底色 |
| `water` | 水面/海面 |
| `waterway` | 河流/运河线 |
| `landuse_*` / `landcover_*` | 用地/地表覆盖 |
| `road_*` / `bridge_*` / `tunnel_*` | 道路 |
| `building` | 建筑 |
| `place_*` | 城市/区县标注 |
| `poi_*` | POI 标注 |

## 5. 改字体

- 样式里的 `text-font` 必须是 `data/fonts/` 中真实存在的字体名。
- 本项目的字体名由 `make fonts` 检测并写入 `data/fonts/fonts.json`，例如：
  - `NotoSansSC-Regular`
  - `NotoSansSC-Bold`
- 不要写多字体栈（多个字体名用逗号拼接）：MapLibre 会请求组合目录，而 glyphore 不生成组合目录。统一用单字体 `NotoSansSC-Regular` / `NotoSansSC-Bold` 即可（Noto CJK 同时含拉丁）。
- 若要换字体：
  1. 把 TTF/OTF 放到 `data/fonts-src/`；
  2. 重新运行 glyphore（或改 `build-fonts.sh`）；
  3. 更新 `data/fonts/fonts.json`；
  4. `./run styles`；
  5. 刷新地图；如使用 TileServer GL 的栅格/WMTS，再重启 tileserver。

## 6. 改图标

- 图标源文件放在 `styles/vendor/<base>/icons/*.svg`。
- `make sprites` 生成 `data/sprites/<styleId>/sprite.json/png` + `@2x`。
- 样式里的 `icon-image` 名称必须存在于 sprite JSON；`make check` 会列出缺失项（静态名称）。
- 动态图标名（如 `{class}_11`）无法静态校验，需要浏览器里看控制台警告。

## 7. 用 Maputnik 可视化编辑

[Maputnik](https://github.com/maplibre/maputnik) 是 MIT 协议的 MapLibre 样式编辑器。

1. 启动本地服务（`make up`）。
2. 打开 Maputnik（在线版或自建）。
3. 加载样式 URL：`http://localhost:8081/styles/light/style.json`。
4. 编辑颜色/图层/字体。
5. 导出 JSON，覆盖 `styles/light.json`。
6. 刷新地图（静态样式，无需重启）。

注意：样式由 Nginx 静态提供，`sprite` / `glyphs` / tile URL 都是根相对路径；前端会自动补全为绝对地址。Maputnik 若直接打开静态样式，也建议从同一域名访问。

## 8. 新增样式

1. 新建 `styles/vendor/brand/style.json`（可从 Positron 复制改色）。
2. 准备图标 `styles/vendor/brand/icons/`（可复用现有图标）。
3. 在 `config/map.manifest.json` 添加：
   ```json
   { "id": "brand", "label": "品牌", "base": "vendor/brand/style.json", "dataset": "shanghai" }
   ```
4. 在 `scripts/build-sprites.sh` 的 `STYLES` 数组加一行 `"brand:brand"`。
5. 运行：
   ```bash
   ./run sprites styles config check
   ```
   主地图刷新即可；如使用 TileServer GL 的 WMTS/栅格端点，再重启 tileserver。

## 9. 新增数据集

1. 生成 `data/tiles/<dataset>.pmtiles`。
2. 在 manifest 的 `datasets` 添加条目（`pmtiles`、`version`、`center`、`zoom`、`bounds`、`minzoom`、`maxzoom`、`attribution`）。
3. 在需要引用它的样式条目里把 `dataset` 改成新 ID。
4. `./run styles config check`；主地图刷新即可（TileServer GL 的 WMTS/栅格端点需重启）。

## 10. 校验

```bash
make check
```

会检查：

- manifest 引用文件存在；
- 样式 JSON 通过 `@maplibre/maplibre-gl-style-spec` 校验；
- tile URL 指向正确 dataset；
- 字体名存在于 `data/fonts`；
- `source-layer` 在 `tilegen/config.json` 中存在；
- 图标名存在于 sprite JSON；
- 样式中没有外部 `http(s)` 瓦片/字体/图标 URL。

## 11. 样式与缓存

- 样式里 tile URL 带 `?v=<dataset.version>`；更新数据时同步改 manifest 的 `version`，浏览器会请求新 URL。
- `/styles/` 响应 `Cache-Control: no-store`；改样式后刷新即可。
- `/fonts/` 长缓存；换字体文件名/路径后自然失效。
