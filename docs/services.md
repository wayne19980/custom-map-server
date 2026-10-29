# 标准地图服务与引擎适配

## 1. 当前已可用

| 服务 | 地址 | 说明 |
|---|---|---|
| 矢量瓦片 XYZ | `/data/<dataset>/{z}/{x}/{y}.pbf` | MapLibre/Leaflet/OpenLayers 直接可用 |
| TileJSON | `/data/<dataset>.json` | 标准 TileJSON 2.0 |
| Style JSON | `/styles/<id>/style.json` | MapLibre Style Spec v8 |
| 字体 | `/fonts/<fontstack>/<range>.pbf` | SDF glyph |
| 图标 | `/styles/<id>/sprite[@2x].{json,png}` | 由 TileServer GL 重写 |
| 健康检查 | `/health` | 监控/负载均衡 |
| 样式列表 | `/styles.json` | 调试/目录 |

示例：

```bash
curl http://localhost:8081/data/shanghai.json
curl http://localhost:8081/data/shanghai/12/3430/1673.pbf
curl http://localhost:8081/styles/blueprint/style.json
```

这些是标准 HTTP 接口，不依赖本前端；QGIS/Leaflet/OpenLayers/Cesium 都可以直接接。

## 2. 栅格 / WMTS（需要补一步）

TileServer GL 完整版具备服务端栅格渲染和 WMTS：

```
/styles/<id>/{z}/{x}/{y}.png
/styles/<id>/wmts.xml
/styles/<id>/static/...
```

在 `config/tileserver.config.json` 里把对应 style 的 `serve_rendered` 设为 `true` 即可。

**当前限制**：我们用的是 glyphore 生成的 CJK glyph PBF；TileServer GL 的 native 渲染器在读取时会报 `Invalid font name`。浏览器端 MapLibre GL JS 完全正常，但服务端栅格渲染暂不可用。

可选修复路线：

1. 用 `fontnik` 重新生成 raster 专用 glyph（CJK 体积较大）；
2. 生成一个去掉 symbol 图层的 raster 专用样式（无文字，先保证底图出图）；
3. 用 headless Chromium + MapLibre GL JS 做栅格渲染服务（可控但更重）。

在修复前，不建议把 `serve_rendered` 打开后直接对外承诺 WMTS。

## 3. 引擎兼容性

| 引擎 | 接入方式 | 备注 |
|---|---|---|
| MapLibre GL JS | 矢量 XYZ + Style JSON | 本项目默认 |
| Leaflet | 矢量瓦片需插件（maplibre-gl-leaflet / vectorgrid）；或栅格 XYZ | 栅格更简单 |
| OpenLayers | MVT source + Style JSON | 原生支持 |
| QGIS | XYZ 栅格 / WMTS / 矢量瓦片（MVT） | 栅格需先修 WMTS |
| ArcGIS | WMTS / XYZ 栅格 | 同上 |
| CesiumJS | XYZ/WMTS 栅格 + DEM 地形 | Cesium 原生不渲染 MVT；3D Tiles 另做 |
| 百度地图 JS | 自定义栅格图层/Overlay | 需 BD-09 偏移 + 合规评估 |
| 高德地图 JS | 自定义栅格图层/Overlay | 需 GCJ-02 偏移 + 合规评估 |
| 微信小程序/App | MapLibre Native / 栅格服务 | 需端上适配 |

### Cesium 示例（栅格服务修好后）

```js
const imagery = new Cesium.UrlTemplateImageryProvider({
  url: 'https://map.example.com/styles/blueprint_raster/{z}/{x}/{y}.png',
  tilingScheme: new Cesium.WebMercatorTilingScheme(),
  maximumLevel: 16,
});
viewer.imageryLayers.addImageryProvider(imagery);
```

### 百度/高德

它们不是“标准 XYZ + WGS-84”引擎：

- 百度使用 BD-09，高德使用 GCJ-02；
- 直接把 WGS-84 的 OSM 瓦片叠上去会有几十到几百米偏移；
- 需要做坐标转换（数据生产阶段偏移，或服务端栅格重投影），并评估地图合规。

因此“支持百度/高德”本质是**坐标转换 + 栅格服务 + 合规**三件事，不是换一个 URL 就能完成。

## 4. 建议补齐

- `/api/catalog`：数据集/样式/服务地址/坐标系/许可；
- 标准服务文档 + QGIS/Leaflet/Cesium 示例；
- 栅格渲染的独立进程/资源限制；
- CORS、缓存、限流、鉴权；
- OGC API Tiles（可选 Martin）；
- 栅格字体问题修复（见第 2 节）。
