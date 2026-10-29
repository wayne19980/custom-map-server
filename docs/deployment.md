# 部署与运维

> 命令示例用 `make`；若构建机没有 GNU make，把 `make <cmd>` 换成 `./run <cmd>`（参数同样适用）。

## 1. 前置条件

| 用途 | 要求 |
|---|---|
| 构建机 | Linux / WSL2，Docker 24+，Docker Compose v2，Node 20+，Python 3，约 3 GB 空闲磁盘 |
| 运行机（客户服务器） | Linux，Docker 24+，Docker Compose v2，2C4G 起步，约 2 GB 磁盘（含镜像） |
| 浏览器 | 支持 WebGL2 的现代浏览器 |

## 2. 首次构建

```bash
cp .env.example .env
make fetch REGION=shanghai
make coastline          # 约 900MB；不用海面可跳过并 COASTLINE=none make tiles
make tiles
make fonts
make sprites
make styles
make config
make check
make up
make verify
```

打开 `http://localhost:8081/`。

### 2.1 数据

- `data/osm/shanghai-latest.osm.pbf`：Geofabrik 上海 extract，`make fetch` 会校验 md5。
- 其他区域：把 Geofabrik 区域名传给 `REGION`，或在 `config/map.manifest.json` 中新增 dataset；`scripts/fetch-pbf.sh` 默认只支持中国子区域 URL，其他大洲需改 `PBF_BASE`。
- 海岸线：`data/cache/coastline/water_polygons.shp`（OSM water polygons，ODbL）。只需下载一次。
- 不用海面：`COASTLINE=none make tiles`，使用 `tilegen/config.no-coastline.json`。

### 2.2 字体

- `make fonts` 下载 Noto Sans CJK SC Regular/Bold（约 32 MB），用 glyphore 生成约 74 MB glyph。
- 生成结果在 `data/fonts/`，`data/fonts/fonts.json` 记录真实字体名。
- 客户端运行不需要 Node；字体在构建期生成。

### 2.3 样式

- `styles/vendor/` 是上游样式（Positron / Dark Matter / OSM Bright），不要直接部署；`styles/palettes/` 是调色板覆盖（如 `blueprint.json`）。
- `make styles` 生成 `styles/*.json`。
- `make config` 生成 `config/tileserver.config.json`。

## 3. 环境变量

`.env`（从 `.env.example` 复制）：

```ini
PUBLIC_URL=http://localhost:8081/
WEB_PORT=8081
ALLOWED_HOSTS=*
REGION=shanghai
COASTLINE=osm
```

- `PUBLIC_URL`：客户端实际访问地址，**末尾带 `/`**。生产必须设置，否则 TileServer GL 生成的 TileJSON/调试链接会使用错误主机。
- `WEB_PORT`：Nginx 对外端口。
- `ALLOWED_HOSTS`：TileServer GL 的 Host 白名单；生产建议填域名，逗号分隔。`*` 表示不限制。
- `EDITOR_TOKEN`：样式编辑器令牌；默认 `change-me`，生产必须改。不需要编辑器时可在 Nginx 关闭 `/editor` 与 `/api/`。
- `EDITOR_UID` / `EDITOR_GID`：编辑器容器写 `styles/` 的用户，默认 1000；需与宿主目录权限匹配。
- `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`：可选的 OpenAI 兼容端点；不配置时 AI 面板使用本地规则模式。

## 4. 启动与停止

```bash
make up       # docker compose up -d --build
make logs
make down
make verify
```

Compose 服务：

- `tileserver`：`maptiler/tileserver-gl:v5.7.0`，只读挂载 `data/tiles`、`data/fonts`、`data/sprites`、`styles`、`config`。
- `web`：`custom-map-server-web:latest`，Nginx 静态前端/样式 + 反代。
- `editor`：`custom-map-editor-api:latest`，样式编辑 API；可读写 `styles/` 和 `data/style-versions/`。

> 本项目在 Makefile 中把 `DOCKER_CONFIG` 指到 `./.docker`，避免 WSL/受限环境 `~/.docker` 只读导致 Docker buildx 失败。正常 Linux 可删除该设置或覆盖 `DOCKER_CONFIG`。

## 5. 更新数据

1. `make fetch FORCE=1` 或替换 `data/osm/shanghai-latest.osm.pbf`。
2. `make tiles` 重新生成 PMTiles。
3. 更新 `config/map.manifest.json` 中 dataset 的 `version`（例如日期），使样式里的 `?v=` 变化。
4. `make styles config`。
5. `docker compose restart tileserver`。
6. 浏览器强制刷新/等待缓存过期。

如果只想替换数据、不改样式版本，可以保持 `version` 不变，但浏览器可能缓存旧瓦片；生产建议版本化。

## 6. 更新样式

推荐用 `/editor`：

1. 打开 `http://<host>:8081/editor`，输入 `EDITOR_TOKEN`；
2. 改颜色/线宽/层级/JSON，保存；
3. 主地图刷新页面即可生效（Nginx 静态样式，无需重启）。

也可以直接改 `styles/<id>.json`。`/styles/` 响应为 `no-store`，通常无需清缓存。样式保存会自动在 `data/style-versions/<id>/` 留版本。

> `./run styles` 会从 vendor + manifest 重新生成，覆盖编辑器保存的内容；长期定制请把改动回写到 vendor/base，或把编辑器作为唯一入口。

样式改动不影响 PMTiles 数据。

## 7. 新增样式

1. 在 `styles/vendor/` 放入新的 MapLibre Style JSON（建议基于 OpenMapTiles schema）。
2. 在 `config/map.manifest.json` 的 `styles` 数组新增条目：
   ```json
   { "id": "brand", "label": "品牌", "base": "vendor/brand/style.json", "dataset": "shanghai" }
   ```
3. 准备对应图标（`styles/vendor/brand/icons/`），`./run sprites`。
4. `./run styles config check`。
5. 前端会自动从 manifest 读取并显示新按钮（刷新即可；TileServer GL 的 WMTS/栅格端点需重启）。

## 8. 新增数据集

1. 放入 `data/tiles/<dataset>.pmtiles`（或按 2.1 构建）。
2. 在 manifest 的 `datasets` 新增条目，并在需要引用它的样式条目里改 `dataset`。
3. `./run styles config check`。
4. 主地图刷新即可（TileServer GL 的 WMTS/栅格端点需重启）。

## 9. 生产部署建议

- 在 Nginx 前加一层 HTTPS 反向代理（客户现有 Nginx/Caddy/网关），或给 `web` 挂证书。
- 设置 `PUBLIC_URL=https://map.example.com/`、`ALLOWED_HOSTS=map.example.com`。
- `data/` 只读挂载；`styles/` 对 editor 可写、对 web 只读；不要把 Docker socket 暴露给容器。
- 需要鉴权时，在反向代理层加 Basic Auth/OIDC；本 MVP 无用户体系。
- 定期备份 `data/tiles`、`styles`、`config/map.manifest.json`。
- 监控 `/health`；日志用 `docker compose logs`。
- 如需栅格/WMTS：TileServer GL 已具备，可在 `config/tileserver.config.json` 的 style 条目设置 `"serve_rendered": true`，并暴露对应端点（会增加 CPU/内存）。

## 10. 排障

| 现象 | 排查 |
|---|---|
| `make up` 报 `~/.docker/buildx` 只读 | 确认 `DOCKER_CONFIG` 指向可写目录（Makefile 默认 `./.docker`） |
| 页面空白、控制台 404 | 打开 `/map.manifest.json`、`/styles/light/style.json` 是否 200；确认 `make config` 已执行 |
| 瓦片 404 | 确认 `data/tiles/shanghai.pmtiles` 存在；`docker compose exec tileserver ls /srv/map/tiles` |
| 字体 404 | `curl /fonts/NotoSansSC-Regular/0-255.pbf`；确认 `make fonts` 且字体名与样式一致 |
| 图标 404 | 样式里的 `sprite` 应为 `<styleId>/sprite`（相对 `paths.sprites`），不要写 `/sprites/...` |
| 中文不显示 | 确认样式 `text-font` 为 Noto Sans CJK SC；`data/fonts` 已生成；源数据有 `name` 标签 |
| 海面缺失 | 用了 `COASTLINE=none`；或 `data/cache/coastline/water_polygons.shp` 不存在 |
| 样式改了不生效 | 主地图样式由 Nginx 静态提供，刷新即可；若通过 TileServer GL 的 WMTS 使用则需重启 |
| 编辑器 403 `layer-groups.json` | `styles/schema/layer-groups.json` 需 644 可读 |
| 编辑器保存 401 | 顶部令牌与 `.env` 的 `EDITOR_TOKEN` 不一致 |
| 编辑器保存 422 | Style Spec 校验失败，看返回的 `issues` |
| 编辑器保存后主地图没变 | 刷新页面；确认 Nginx `/styles/` 指向 `./styles` |
| Host 头告警 | 设置 `PUBLIC_URL` 与 `ALLOWED_HOSTS` |
