# 架构说明

## 1. 总览

```
构建期（可离线）
  data/osm/*.osm.pbf
        │  tilemaker (tilegen/config.json + process.lua)
        ▼
  data/tiles/*.pmtiles
  data/fonts-src/*.otf ──glyphore──> data/fonts/<fontstack>/<range>.pbf
  styles/vendor/*.json + icons ──spreet──> data/sprites/<style>/sprite*
  styles/vendor/*.json + config/map.manifest.json ──build-styles──> styles/<id>.json
                                                              └── render:true ──> styles/<id>-raster.json
  config/map.manifest.json ──gen-config──> config/tileserver.config.json

运行期（客户服务器，可断网）
  Browser (MapLibre GL JS)
    ├─ GET /map.manifest.json
    ├─ GET /styles/<id>/style.json
    ├─ GET /data/<dataset>/{z}/{x}/{y}.pbf
    ├─ GET /fonts/<fontstack>/<range>.pbf
    └─ GET /styles/<id>/sprite[@2x].{json,png}
  Nginx ──静态前端/静态样式──> Browser
        ├─/data /fonts /health──> TileServer GL ──> data/tiles/*.pmtiles
        └─/api/*──> editor-api ──> styles/*.json + data/style-versions/
```

样式由 Nginx 直接静态提供（`/styles/*.json`），因此编辑器保存后刷新页面即可生效，不需要重启 TileServer GL。TileServer GL 仍负责矢量瓦片、字体和未来可能的 WMTS。

## 2. 数据与样式分离契约

1. **数据**：`data/tiles/<dataset>.pmtiles`，一个数据集一个文件。
2. **样式**：`styles/<styleId>.json`，只含 MapLibre Style JSON；不包含数据文件路径、二进制或客户数据。
3. **绑定**：`config/map.manifest.json` 是唯一人工维护的绑定清单：
   - `datasets`：数据集 ID、PMTiles 文件名、中心点/缩放/边界/版本；
   - `styles`：样式 ID、显示名、基于哪个 vendor 样式、绑定哪个数据集。
4. **生成**：`make styles` 把 vendor 样式 + manifest 合成为可部署样式；`make config` 生成 TileServer GL 配置。
5. **替换**：
   - 数据更新：替换同名 PMTiles（或新增数据集 + manifest 条目），样式文件可不变；
   - 样式更新：替换 `styles/<id>.json`，数据文件不变；
   - 新增样式：加 manifest 条目 + `./run styles config`；主地图刷新即可（TileServer GL 的 WMTS/栅格端点需重启）。

样式源使用 `tiles` 数组而不是 TileJSON URL：

```json
{
  "sources": {
    "basemap": {
      "type": "vector",
      "tiles": ["/data/shanghai/{z}/{x}/{y}.pbf?v=20261029"],
      "minzoom": 0,
      "maxzoom": 14,
      "bounds": [120.8, 30.6, 122.2, 31.9],
      "attribution": "© OpenStreetMap contributors"
    }
  }
}
```

前端加载样式时把 `glyphs`、`sprite`、`tiles`、`sources[].url` 中的相对路径补成 `location.origin` 绝对地址。注意不能用 `new URL()` 处理 `{z}/{x}/{y}`，否则大括号会被百分号编码，MapLibre 无法替换模板。

## 3. 运行时端点

| 端点 | 说明 |
|---|---|
| `GET /` | MapLibre 前端（Nginx 静态） |
| `GET /map.manifest.json` | 样式/数据集/品牌清单 |
| `GET /styles/<id>/style.json` | 静态样式（Nginx 从 `styles/<id>.json` 提供） |
| `GET /styles/schema/layer-groups.json` | 图层分组 schema |
| `GET /styles/<id>_raster/{z}/{x}/{y}.png` | 服务端栅格（需 `render: true`） |
| `GET /styles/<id>_raster/wmts.xml` | WMTS capabilities |
| `GET /editor` | 可视化样式编辑器 |
| `GET/PUT /api/styles/...` | 编辑器 API（鉴权、校验、版本） |
| `GET /sprites/<id>/sprite[@2x].{json,png}` | Nginx 从 `data/sprites/<id>/` 读取 |
| `GET /data/<dataset>/{z}/{x}/{y}.pbf` | 矢量瓦片 |
| `GET /data/<dataset>.json` | TileJSON（调试） |
| `GET /fonts/<fontstack>/<range>.pbf` | SDF 字形 |
| `GET /health` | 健康检查 |

Nginx 将 `/data/`、`/styles/`、`/fonts/`、`/health` 反向代理到 TileServer GL；`/` 与 `/map.manifest.json` 由 Nginx 静态提供；`/sprites/` 保留为直接静态访问（调试用）。

## 4. 构建期组件

### 4.1 tilemaker

- `tilegen/config.json`：OpenMapTiles schema 裁剪版，去除依赖 Natural Earth landcover 的 `urban_areas / ice_shelf / glacier`，保留 `ocean`（OSM water polygons）。
- `tilegen/config.no-coastline.json`：`COASTLINE=none` 时使用，去掉 `ocean` 层。
- `tilegen/process.lua`：上游 `process-openmaptiles.lua` 的副本（CC-BY 4.0，保留版权头）。
- `scripts/build-tiles.sh` 负责选择配置、检查海岸线、运行 Docker、校验 PMTiles magic。
- 输出 `data/tiles/shanghai.pmtiles`（本机样例约 26 MB）。

### 4.2 字体

- `scripts/build-fonts.sh` 下载 Noto Sans CJK SC Regular/Bold，调用 `glyphore build`。
- 输出 `data/fonts/Noto Sans CJK SC Regular/0-255.pbf` 等 392 个 range/字体。
- 生成 `data/fonts/fonts.json`，记录真实内部字体名；样式构建只引用该名称。
- 样式统一使用单字体（Regular/Bold），避免多字体 fontstack 需要拼接 glyph 目录。

### 4.3 图标

- `scripts/build-sprites.sh` 对每套 vendor 样式的 `icons/` 运行 `spreet`。
- 输出 `data/sprites/<styleId>/sprite.json/png` 和 `@2x`。
- TileServer GL 的 sprite 路径按 `paths.sprites` + 样式中的相对路径解析；因此样式里写 `light/sprite`，而不是 `/sprites/light/sprite`。

### 4.4 样式

- `styles/vendor/` 保存上游 Positron / Dark Matter / OSM Bright（含 LICENSE）。
- `scripts/build-styles.mjs`：
  - 替换 `sources` 为单一 `basemap`；
  - 替换图层 `source`；
  - 设置本地 `glyphs` / `sprite`；
  - 设置中心点/缩放/边界；
  - 替换 `text-font` 为 CJK 字体；
  - 写入 `metadata`（styleId/datasetId/dataVersion/attribution）。
- 输出扁平 `styles/light.json`、`styles/dark.json`、`styles/bright.json`、`styles/blueprint.json`，对应 TileServer GL 的 style id。
- `styles/palettes/*.json` 提供按图层 id 的颜色覆盖；`blueprint` 即基于 Dark Matter + 调色板生成。

## 5. 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 瓦片格式 | PMTiles | 单文件、易拷贝/离线/对象存储；TileServer GL 直接支持 |
| 服务端 | TileServer GL 5.7 | 稳定版；同时具备 PMTiles、样式、字体、雪碧图、栅格/WMTS 能力 |
| 字体 | 预生成 glyph（glyphore） | TileServer GL 不做动态 glyph；CJK 用 Noto CJK 一次生成 |
| 样式源 | `tiles` 数组 | 不依赖 TileServer GL 生成的绝对 TileJSON URL；样式更可移植 |
| 前端 URL | 运行时补全 origin | 同一份样式可在 localhost/客户域名复用；避免硬编码 |
| 样式编辑 | 内置编辑器 + JSON + Maputnik（可选） | 图形化 + 版本化；保存即生效 |

## 6. 限制

- tilemaker 不做增量更新；数据更新是整包重建。
- 主地图样式由 Nginx 静态提供，编辑器保存后刷新即生效；TileServer GL 仅在启动时加载 PMTiles/样式，数据更新或使用其 WMTS/栅格端点时需要 `docker compose restart tileserver`。
- 样式更新会重新生成 `?v=` 版本号；数据更新时应同步更新 manifest 的 `version` 并重新 `make styles`，或接受浏览器缓存。
- 未实现鉴权/多租户/管理后台；公网部署需在 Nginx 前加认证或网关。
- 未实现 GCJ-02/BD-09 坐标偏移。
- 未实现栅格/WMTS 的默认开启；TileServer GL 已具备该能力，可按客户需求启用。
