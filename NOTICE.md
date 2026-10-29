# NOTICE / 第三方许可

本项目包含或依赖以下第三方资产。分发时请保留相应版权与许可声明。

## 数据

- **OpenStreetMap** 数据：© OpenStreetMap contributors，许可 **ODbL 1.1**。
  - <https://www.openstreetmap.org/copyright>
  - 由 OpenStreetMap 数据生成的 PMTiles 属于衍生数据库，分发时需遵守 ODbL 的署名与 share-alike 要求。
- **OSM water polygons**（海岸线）：源自 OpenStreetMap，ODbL 1.1。
  - <https://osmdata.openstreetmap.de/>
- **Geofabrik** 区域 extract：ODbL 1.1。
  - <https://download.geofabrik.de/>

## 软件

| 组件 | 许可 | 地址 |
|---|---|---|
| tilemaker | FTWPL | <https://github.com/systemed/tilemaker> |
| TileServer GL | BSD-2-Clause | <https://github.com/maptiler/tileserver-gl> |
| MapLibre GL JS | BSD-3-Clause | <https://github.com/maplibre/maplibre-gl-js> |
| MapLibre Style Spec | BSD-3-Clause | <https://github.com/maplibre/maplibre-style-spec> |
| glyphore | MIT / Apache-2.0 | <https://github.com/Kartore/glyphore> |
| spreet | MIT | <https://github.com/flother/spreet> |
| Maputnik（可选） | MIT | <https://github.com/maplibre/maputnik> |
| Docker 镜像基础 | 各自许可 | nginx / node / alpine 等 |

## 样式

`styles/vendor/` 中的上游样式：

- **Positron**：© MapTiler.com & OpenMapTiles contributors；© CartoDB Inc.；衍生自 CartoDB Basemaps（Stamen、Paul Norman），设计部分 **CC-BY 3.0**；代码 **BSD-3-Clause**。
- **Dark Matter**：同上。
- **OSM Bright**：© MapTiler.com & OpenMapTiles contributors；© Mapbox；衍生自 Mapbox Open Styles；代码 **BSD-3-Clause**。

界面/文档中应保留对 CartoDB、Stamen、MapTiler/OpenMapTiles 的署名。每个 vendor 目录内保留了原始 `LICENSE.md`。

## 字体

- **Noto Sans CJK SC**：SIL Open Font License 1.1。
  - <https://github.com/notofonts/noto-cjk>
- 由字体生成的 glyph PBF 属于字体衍生数据，分发时需遵守 OFL。

## 本项目代码

本仓库新增的脚本、前端、配置与文档由项目作者提供；使用前请按项目实际情况补充 LICENSE。
