# 调研报告：本地自定义样式地图服务

> 结论：**可行**。全栈开源、可私有化部署、可完全离线、数据与样式分离。上海样例已经跑通（tilemaker → PMTiles → TileServer GL → MapLibre）。

## 1. 需求拆解

| 需求 | 对应能力 |
|---|---|
| 自定义样式 | MapLibre Style JSON（颜色、图层、字体、图标、显示级别） |
| 部署到客户服务器 | Docker Compose + Nginx；可打离线镜像包 |
| 数据与样式分离 | PMTiles 数据文件 / 样式 JSON / 字体 / 图标各自独立，manifest 绑定 |
| 加载离线 PBF | 以 `.osm.pbf` 为生产输入，离线构建为 PMTiles；运行期不依赖在线瓦片 |
| 替代百度 API | 无按次调用费，无平台样式限制，数据留在客户内网 |

需要先澄清一个常见误解：**浏览器不直接加载 `.osm.pbf`**。PBF 是原始 OSM 数据，体量大、解析重；正确做法是构建期用 tilemaker 转成 Mapbox Vector Tiles（MVT），装进 PMTiles 容器，运行期由瓦片服务按 `{z}/{x}/{y}` 提供。所谓“离线 PBF”= 离线构建 + 离线运行。

## 2. 关键组件

### 2.1 tilemaker

- 单可执行文件，C++，读取 `.osm.pbf`，输出 `.mbtiles` / `.pmtiles` / 瓦片目录。
- 不需要 PostgreSQL/PostGIS，没有数据库运维。
- 两个配置文件：
  - `config.json`：图层列表、缩放级别、简化/过滤、外部 shapefile；
  - `process.lua`：按 OSM 标签决定对象写入哪个图层、写哪些属性。
- 自带 OpenMapTiles 兼容 schema，可直接复用 OpenMapTiles 生态的样式。
- 不支持 OSM diff 增量更新；城市级数据整包重建即可（上海 PBF 26 MB，本机构建数十秒到数分钟）。
- 官方容器镜像为 `ghcr.io/systemed/tilemaker:master`；生产环境建议记录 digest 或按 `v3.2.0` 源码自建。

参考：[tilemaker.org](https://tilemaker.org/)、[tilemaker GitHub](https://github.com/systemed/tilemaker)

### 2.2 Geofabrik 上海数据

- 地址：<https://download.geofabrik.de/asia/china/shanghai.html>
- 文件：`shanghai-latest.osm.pbf`，约 26 MB，Geofabrik 定期更新。
- 许可：ODbL 1.1，必须署名 “© OpenStreetMap contributors”；衍生数据库有 share-alike 义务。

### 2.3 MapLibre Style Spec

- 当前样式版本 `version: 8`。
- 核心字段：
  - `sources`：矢量/栅格/GeoJSON 数据源；
  - `layers`：`background` / `fill` / `line` / `symbol` 等；
  - `glyphs`：`/fonts/{fontstack}/{range}.pbf`；
  - `sprite`：图标雪碧图。
- `glyphs` 规范要求绝对 URL；本项目在前端加载样式时统一补全 `location.origin`，因此样式 JSON 可以跨主机/端口复用。
- 样式是纯 JSON，改样式不需要改数据或代码。

参考：[MapLibre Style Spec](https://maplibre.org/maplibre-style-spec/)

### 2.4 服务端选型对比

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **TileServer GL 5.7** | 稳定；PMTiles/MBTiles；样式/字体/雪碧图；栅格/WMTS；Docker 成熟 | 镜像较大；字体需预生成 PBF | **本项目采用** |
| Martin 2.x | Rust 单二进制；标准 TileJSON；字体/雪碧图可动态生成 | 2.0 仍为 beta，生产稳定性待观察 | 备选 |
| 纯静态 PMTiles + Nginx | 最简；无服务进程；天然 CDN/离线 | 无栅格/WMTS；字体/图标需全部预生成 | 轻量备选 |
| 百度/高德 API | 接入快；国内底图 | 按量/商用付费；样式受限；不能离线私有化 | 不满足 |
| Mapbox/MapTiler Cloud | 生态成熟 | 订阅付费；数据在平台侧 | 不满足私有化 |

参考：[TileServer GL 文档](https://tileserver.readthedocs.io/)、[Martin 文档](https://maplibre.org/martin/)

### 2.5 字体与图标

- 中文字形不能只靠拉丁字体；本项目用 **Noto Sans CJK SC**（OFL），同时覆盖中文和拉丁。
- 用 `glyphore` 离线生成 SDF glyph PBF（每个字体约 392 个 Unicode range，Regular+Bold 合计约 74 MB；浏览器按需请求）。
- 用 `spreet` 从样式自带的 SVG 图标生成 `sprite.json/png` 与 `@2x` 版本。
- 若使用 Martin，可由服务端从 TTF/OTF 动态生成 glyph；TileServer GL 需要预生成，二者都能满足离线。

参考：[glyphore](https://github.com/Kartore/glyphore)、[spreet](https://github.com/flother/spreet)

## 3. 成本

| 项目 | 量级 |
|---|---|
| 软件许可 | 0（全开源） |
| 服务器 | 城市级 2C4G 足够；国内云约 ¥100–300/月，或复用客户现有服务器 |
| 存储 | 上海 PMTiles 约 26 MB；字体约 74 MB；全国数据可达数十 GB |
| 带宽 | 矢量瓦片压缩后很小，城市级日常访问带宽压力低 |
| 人力 | MVP 约 3–5 人日；产品化（管理后台/多租户/更新流水线）约 2–4 周 |
| 对比百度 API | 无按次费；但需自行承担数据更新、运维、合规评估 |

## 4. 许可与署名

| 资产 | 许可 | 要求 |
|---|---|---|
| OSM 数据 / PMTiles | ODbL 1.1 | 署名 “© OpenStreetMap contributors”；衍生数据库 share-alike |
| tilemaker | FTWPL | 宽松 |
| TileServer GL | BSD-2 | 保留版权声明 |
| MapLibre GL JS | BSD-3 | 保留版权声明 |
| Positron / Dark Matter / OSM Bright 样式 | BSD-3（代码）+ CC-BY 3.0（设计） | 署名 CartoDB、Stamen、MapTiler/OpenMapTiles |
| Noto Sans CJK SC | SIL OFL 1.1 | 保留 OFL，字体改名需遵守 OFL |
| glyphore / spreet / Maputnik | MIT / Apache-2.0 | 保留版权声明 |

详见仓库 [NOTICE.md](../NOTICE.md)。

## 5. 中国场景的两个硬问题

### 5.1 坐标系

- OSM 使用 **WGS-84**。
- 百度使用 **BD-09**，高德/腾讯使用 **GCJ-02**。
- 直接把 OSM 底图与国内 POI/GPS 叠加，会有几十到几百米偏移。
- 本项目 MVP 保持 WGS-84 自洽，不做偏移。若客户必须与百度/高德数据对齐，需要在**数据生产阶段**做整体偏移（生成“偏移后的底图”），或前端做转换；后者对矢量瓦片并不彻底，且会影响导航/量算精度。建议单独立项评估。

### 5.2 地图合规

- 面向公众发布的地图服务通常涉及地图审核/审图号；具体适用取决于发布范围、内容和主体。
- OSM 在国内的覆盖度/准确性因地区而异，商业项目应评估是否需要用合法来源数据补充。
- 本报告不构成法律意见；建议客户项目启动前确认“是否公网、是否面向公众、是否需要审图号、是否必须 GCJ-02”。

## 6. 风险与限制

| 风险 | 说明 | 缓解 |
|---|---|---|
| OSM 数据质量 | 国内部分区域道路/POI 不全 | 评估区域；必要时补充合法数据源 |
| 无增量更新 | tilemaker 不吃 diff | 城市级全量重建；定时任务；版本化 PMTiles |
| 字体体积 | CJK glyph 约 74 MB | 按需 range 请求；只保留 Regular/Bold；CDN/缓存 |
| 样式兼容 | 上游样式假定 OpenMapTiles 字段 | 已用 tilemaker OpenMapTiles profile；`make check` 校验 source-layer |
| 坐标系 | 与国内底图偏移 | 单独立项做偏移方案 |
| 合规 | 审图号/地图审核 | 客户侧确认；不替代法律意见 |
| 运维 | 需要自己更新数据/样式 | 提供 Makefile、离线包、文档；后续可做管理后台 |

## 7. 推荐落地路线

1. **上海 MVP**（本仓库）：PBF → PMTiles → 四套样式 → 离线包。
2. **客户试点**：替换为客户区域 PBF，确认样式/品牌/坐标系/合规。
3. **产品化**：管理后台（上传 PBF、构建任务、样式在线编辑/版本化）、多租户、定时更新、栅格/WMTS、监控。
4. **坐标/合规专项**：如客户要求与百度/高德叠加，单独做 GCJ-02/BD-09 方案与合规评估。

## 8. 参考链接

- <https://tilemaker.org/>
- <https://github.com/systemed/tilemaker>
- <https://download.geofabrik.de/asia/china/shanghai.html>
- <https://maplibre.org/maplibre-style-spec/>
- <https://maplibre.org/maplibre-gl-js/docs/>
- <https://tileserver.readthedocs.io/>
- <https://github.com/maplibre/maputnik>
- <https://github.com/Kartore/glyphore>
- <https://github.com/flother/spreet>
- <https://www.openstreetmap.org/copyright>
