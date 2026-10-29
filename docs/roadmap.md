# 路线图：从“能看”到“可运营”

当前版本已经完成：PBF → PMTiles → TileServer GL → MapLibre，四套样式、中文标注、数据/样式分离、离线部署包；P0 的样式分组/zoom matrix 和 P1 的可视化编辑器 MVP 也已落地（见 [editor.md](editor.md)）。本文档整理后续要补的能力，按依赖关系分成 6 个模块。

## 1. 先解决：层级单调性

地图的常规原则是：

- **层级越高，局部细节越多**（支路、建筑、POI）；
- **层级越高，大范围标签越少**（国家/省/市被区县/街道取代）；
- 任何一类要素不应在“上一层有、下一层突然没有”，除非它被更细的类别替代。

本次已修正 `blueprint` 的断档：

- `highway_motorway_subtle`（≤z6）与 `highway_motorway_inner`（≥z6）重叠，z7 不再消失；
- `highway_major_subtle`（≤z10）只保留 primary/trunk，避免 secondary/tertiary 在 z10 出现、z11 又消失；
- `highway_secondary_*` 从 z13 才出现（独立图层）；
- `place_*` / `water_name` 的 `maxzoom` 提到 20，z17/18 不再丢标签；
- 道路线宽再次收细，避免低层级“粗蓝线”。

后续建议把这条规则固化成 **zoom matrix 校验**：对每类要素记录 `minzoom/maxzoom`，构建时检查区间连续、无空洞，并生成一张样式-层级矩阵表。

## 2. 模块 A：内容与样式工程

目标：让样式可维护、可审查、可复用，而不是一堆手改 JSON。

- 图层命名规范：`group/subgroup/feature`，例如 `road/motorway/inner`；
- 每层写入 `metadata.group`、`metadata.order`、`metadata.zoom`；
- 维护 `styles/schema/layer-groups.json`：分组、顺序、默认可见性；
- 生成 `docs/zoom-matrix.md`：每类要素在哪些层级出现；
- `scripts/check.mjs` 增加：
  - 层级区间连续性；
  - 同组图层顺序；
  - 字体/图标/ source-layer 引用；
  - 外部 URL 检查；
- 样式版本号 + 变更日志。

产出：一套“样式规范 + 校验器”，后续编辑器/AI 都基于它工作。

## 3. 模块 B：可视化样式编辑器

目标：不用记 JSON 字段，也能改颜色、字号、线宽、层级和显隐。

建议形态：

- 前端：React/Vue + MapLibre GL JS；
- 左侧图层树（按 `metadata.group` 分组）；
- 中间实时预览（直接使用当前瓦片服务）；
- 右侧属性面板（颜色选择器、滑块、表达式编辑器）；
- 底部/侧边 JSON 编辑器（Monaco），与图形面板双向同步；
- 顶部：样式切换、保存、另存为、版本历史、导出 JSON；
- 校验：保存前跑 Style Spec + 自定义规则，错误定位到图层/字段；
- 权限：编辑/发布分离，发布走审核。

技术上可以直接复用现有的 `styles/*.json` 与 TileServer GL 预览端点，不需要改瓦片链路。

## 4. 模块 C：AI 助手

目标：用自然语言改样式，但**不能直接改坏线上样式**。

推荐架构：

```
用户: “把主干道改成青色，次要道路再细一点，隐藏村庄名”
        │
        ▼
BFF /api/ai/style-patch
  - 注入当前 style JSON + schema + zoom matrix
  - 调用 LLM，要求返回 RFC 6902 JSON Patch（不是整份样式）
        │
        ▼
服务端校验
  - patch 结构、目标图层存在、字段白名单
  - 应用到副本 → Style Spec 校验 → 生成 diff
        │
        ▼
前端预览 + diff 确认 → 保存为新版本
```

约束：

- AI 只输出 JSON Patch，不执行代码；
- 字段/图层白名单；
- 必须预览 + 人工确认；
- 版本化与回滚；
- API Key 只在服务端；
- 对“删除图层/关闭数据源”等危险操作二次确认。

## 5. 模块 D：标准地图服务

当前 TileServer GL 已具备但默认关闭的能力：

- XYZ 矢量瓦片：`/data/<dataset>/{z}/{x}/{y}.pbf`；
- TileJSON：`/data/<dataset>.json`；
- 样式：`/styles/<id>/style.json`；
- 栅格瓦片：`/styles/<id>/{z}/{x}/{y}.png`（需 `serve_rendered: true`）；
- WMTS：`/styles/<id>/wmts.xml`；
- 静态图：`/styles/<id>/static/...`；
- OGC API Tiles：可换 Martin 或加网关。

建议补：

- 统一的 `/api/catalog`：数据集、样式、服务地址、坐标系、许可；
- 标准服务文档 + 示例（QGIS/ArcGIS/Leaflet/OpenLayers/Cesium）；
- CORS/缓存/限流；
- 栅格服务的独立进程/资源限制（渲染比矢量瓦片重）；
- 如果客户要 WMS，增加 MapServer/GeoServer 或网关转换。

详见 [标准服务与引擎适配](services.md)。

## 6. 模块 E：数据下载/加载与 POI

- **下载**：按数据集/样式导出 PMTiles + 字体 + 样式 + manifest，生成离线包；
- **加载**：前端支持本地 PMTiles/GeoJSON 文件导入（File API + pmtiles 协议或临时上传）；
- **离线缓存**：IndexedDB/Cache API，记录版本；
- **POI 搜索**：
  - 数据源：OSM PBF 的 POI/地址，或客户自有数据；
  - 索引：SQLite FTS5 / Meilisearch / Photon；
  - API：`/api/search?q=&bbox=&limit=`，返回 GeoJSON；
  - 高亮：MapLibre GeoJSON source + circle/symbol 图层；
  - 结果面板、定位、周边搜索、分类筛选；
- **地理编码/逆编码**：可接 Photon/Nominatim 离线实例；
- **交互**：点击查询、框选、测距/测面、绘制标注。

## 7. 模块 F：引擎适配

| 引擎 | 可行方式 | 注意 |
|---|---|---|
| MapLibre / Leaflet / OpenLayers | XYZ 矢量或栅格 + TileJSON | 最顺 |
| QGIS / ArcGIS | WMTS / XYZ 栅格 | 需开启 `serve_rendered` |
| CesiumJS | XYZ/WMTS 栅格 + 地形 DEM | Cesium 原生不渲染 MVT；矢量需栅格化或第三方库 |
| 百度地图 JS | 自定义栅格图层/Overlay | 坐标系 BD-09；需偏移与合规评估 |
| 高德 JS | 自定义栅格图层/Overlay | 坐标系 GCJ-02；需偏移与合规评估 |
| 小程序/App | MapLibre Native / 栅格服务 | 需单独端适配 |

关键难点不是“出图”，而是**坐标系**：OSM/WGS-84 与 BD-09/GCJ-02 的偏移需要在数据生产或服务端做转换；直接套百度/高德底图会错位。建议单独立项。

## 8. 建议优先级

| 阶段 | 内容 | 工作量（量级） |
|---|---|---|
| P0 | 内容/样式规范 + zoom matrix 校验 | ✅ 已完成基础版 |
| P1 | 可视化编辑器（图形 + JSON + 预览 + 保存 + 版本） | ✅ MVP 已完成 |
| P2 | AI 助手（JSON Patch + 校验 + diff） | ✅ MVP 已完成（规则 fallback + LLM 接口） |
| P3 | 标准服务（栅格/WMTS/TileJSON + 文档） | ✅ 基础版已完成（blueprint raster/WMTS） |
| P4 | POI 搜索/高亮 + 离线下载/加载 | 1–2 周 |
| P5 | Cesium/百度/高德适配 + 坐标转换 | 1–3 周/引擎 |

建议顺序：**P0 → P1 → P2**（编辑器是后续所有定制工作的入口），P3/P4 可并行，P5 按客户项目触发。

## 9. 需要确认

1. 先做编辑器，还是先做标准服务/引擎适配？
2. AI 用哪家模型/是否允许数据出内网？
3. 百度/高德是“叠加底图”还是“用自己的底图替换”？这决定坐标偏移方案。
4. POI 数据用 OSM 还是客户自有数据？是否有检索/ geocoding 的精度要求？
5. 编辑器是内部实施人员用，还是客户运营人员用？这决定权限/审核/多租户的复杂度。
