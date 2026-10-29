# tilegen

tilemaker 配置与 Lua 处理脚本。

## 文件

| 文件 | 说明 |
|---|---|
| `config.json` | 默认配置，含 `ocean` 层，读取 `data/cache/coastline/water_polygons.shp` |
| `config.no-coastline.json` | 不含 `ocean` 层，`COASTLINE=none` 时使用 |
| `process.lua` | 从上游 `resources/process-openmaptiles.lua` 复制，OpenMapTiles schema v3.15 |
| `config-openmaptiles.json` / `process-openmaptiles.lua` | 上游原始文件，便于对比/升级 |

## 构建

```bash
make tiles                 # 默认 COASTLINE=osm
COASTLINE=none make tiles  # 不用海面
```

等价于：

```bash
docker run --rm \
  -v "$PWD/data:/data" -v "$PWD/tilegen:/tilegen:ro" -w /data \
  ghcr.io/systemed/tilemaker:master \
  --input /data/osm/shanghai-latest.osm.pbf \
  --output /data/tiles/shanghai.pmtiles \
  --config /tilegen/config.json \
  --process /tilegen/process.lua \
  --store /data/tmp --threads 0
```

## 修改图层

在 `config.json` 的 `layers` 中增删图层；在 `process.lua` 中用 `Layer()` / `Attribute()` 写入。改完后重新 `make tiles`，并用 `make check` 确认样式引用的 `source-layer` 仍存在。

## 名称语言

`process.lua` 顶部：

```lua
preferred_language = nil
preferred_language_attribute = "name:latin"
```

当 `preferred_language = nil` 时，OSM 的 `name`（上海为中文）会写入 `name:latin` 属性；上游 Positron/Dark Matter/OSM Bright 样式使用 `{name:latin}`，因此中文可直接显示。若要输出英文优先，可设置 `preferred_language = "en"`。

## 海岸线

`ocean` 层依赖 `data/cache/coastline/water_polygons.shp`：

```bash
make coastline
```

约 900 MB 下载，只需一次。没有海岸线时使用 `COASTLINE=none`，海面将显示为背景色。

## 升级上游

tilemaker 的 OpenMapTiles schema 会随版本变化。升级步骤：

1. 拉取新版本 `resources/config-openmaptiles.json` 与 `process-openmaptiles.lua`；
2. 对比本目录的裁剪（移除 `urban_areas/ice_shelf/glacier`，`ocean` 路径本地化）；
3. 重新 `make tiles fonts sprites styles config check`；
4. 用 `make verify` 与浏览器验证。
