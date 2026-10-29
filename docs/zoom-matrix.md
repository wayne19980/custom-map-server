# 图层/层级矩阵：blueprint

由 `scripts/gen-zoom-matrix.mjs` 从 `styles/blueprint.json` 生成。

| 分组 | 图层 | 类型 | source-layer | minzoom | maxzoom |
|---|---|---|---|---|---|
| 背景 | `background` | background | - | 0 | ∞ |
| 水系 | `water` | fill | water | 0 | ∞ |
| 水系 | `waterway` | line | waterway | 0 | ∞ |
| 水系 | `water_name` | symbol | water_name | 13 | 20 |
| 地表 | `landcover_ice_shelf` | fill | landcover | 0 | 8 |
| 地表 | `landcover_glacier` | fill | landcover | 0 | 8 |
| 地表 | `landuse_residential` | fill | landuse | 0 | 9 |
| 地表 | `landcover_wood` | fill | landcover | 10 | ∞ |
| 地表 | `landuse_park` | fill | landuse | 0 | ∞ |
| 建筑 | `building` | fill | building | 13 | ∞ |
| 交通 | `aeroway-taxiway` | line | aeroway | 12 | ∞ |
| 交通 | `aeroway-runway-casing` | line | aeroway | 11 | ∞ |
| 交通 | `aeroway-area` | fill | aeroway | 4 | ∞ |
| 交通 | `aeroway-runway` | line | aeroway | 11 | ∞ |
| 交通 | `road_area_pier` | fill | transportation | 14 | ∞ |
| 交通 | `road_pier` | line | transportation | 14 | ∞ |
| 交通 | `highway_path` | line | transportation | 14 | ∞ |
| 交通 | `highway_minor` | line | transportation | 13 | ∞ |
| 交通 | `highway_major_casing` | line | transportation | 11 | ∞ |
| 交通 | `highway_secondary_casing` | line | transportation | 13 | ∞ |
| 交通 | `highway_major_inner` | line | transportation | 11 | ∞ |
| 交通 | `highway_secondary_inner` | line | transportation | 13 | ∞ |
| 交通 | `highway_major_subtle` | line | transportation | 6 | 10 |
| 交通 | `highway_motorway_casing` | line | transportation | 6 | ∞ |
| 交通 | `highway_motorway_inner` | line | transportation | 6 | ∞ |
| 交通 | `road_oneway` | symbol | transportation | 15 | ∞ |
| 交通 | `road_oneway_opposite` | symbol | transportation | 15 | ∞ |
| 交通 | `highway_motorway_subtle` | line | transportation | 0 | 6 |
| 交通 | `railway_transit` | line | transportation | 16 | ∞ |
| 交通 | `railway_transit_dashline` | line | transportation | 16 | ∞ |
| 交通 | `railway_minor` | line | transportation | 16 | ∞ |
| 交通 | `railway_minor_dashline` | line | transportation | 16 | ∞ |
| 交通 | `railway` | line | transportation | 13 | ∞ |
| 交通 | `railway_dashline` | line | transportation | 13 | ∞ |
| 交通 | `highway_name_other` | symbol | transportation_name | 13 | ∞ |
| 交通 | `highway_name_motorway` | symbol | transportation_name | 9 | ∞ |
| 边界 | `boundary_state` | line | boundary | 0 | ∞ |
| 边界 | `boundary_country_z0-4` | line | boundary | 0 | 5 |
| 边界 | `boundary_country_z5-` | line | boundary | 5 | ∞ |
| 地名 | `place_other` | symbol | place | 14 | 20 |
| 地名 | `place_suburb` | symbol | place | 14 | 20 |
| 地名 | `place_village` | symbol | place | 14 | 20 |
| 地名 | `place_town` | symbol | place | 11 | 20 |
| 地名 | `place_city` | symbol | place | 13 | 20 |
| 地名 | `place_city_large` | symbol | place | 8 | 20 |
| 地名 | `place_state` | symbol | place | 8 | 12 |
| 地名 | `place_country_other` | symbol | place | 0 | 8 |
| 地名 | `place_country_minor` | symbol | place | 0 | 8 |
| 地名 | `place_country_major` | symbol | place | 0 | 6 |
