# 离线部署包说明

本目录由 `make bundle` 生成，包含在**无外网**的客户服务器上运行所需的全部内容。

## 1. 前置条件

- Linux x86_64（或与构建机一致的架构）
- Docker 24+
- Docker Compose v2（`docker compose version` 可用）
- 约 2 GB 磁盘（含镜像、瓦片、字体）
- 浏览器支持 WebGL2
- 如需使用样式编辑器，准备好强随机 `EDITOR_TOKEN`

不需要 Node、Python、npm、外网。

## 2. 安装

```bash
# 把整个 dist/ 目录拷到客户服务器，例如 /opt/custom-map
cd /opt/custom-map
./install.sh
```

`install.sh` 会：

1. `docker load -i images.tar` 加载 `tileserver-gl`、`custom-map-server-web`、`custom-map-editor-api` 镜像；
2. 若没有 `.env`，从 `.env.example` 复制；
3. `docker compose up -d --pull never` 启动；
4. 等待健康检查。

## 3. 配置

编辑 `.env`：

```ini
PUBLIC_URL=http://<客户服务器IP或域名>:8081/
WEB_PORT=8081
ALLOWED_HOSTS=<客户服务器IP或域名>
EDITOR_TOKEN=<强随机令牌>
# 编辑器容器写 styles/ 的用户；通常设成宿主目录的 uid/gid
EDITOR_UID=1000
EDITOR_GID=1000
```

- `PUBLIC_URL` 末尾必须有 `/`。
- 改完执行 `docker compose up -d --pull never` 或 `docker compose restart`。

默认访问：<http://localhost:8081/>

## 4. 验证

```bash
curl http://localhost:8081/health
curl -I http://localhost:8081/data/shanghai/12/3430/1673.pbf
curl http://localhost:8081/styles/light/style.json | head
docker compose ps
docker compose logs --tail=100
```

浏览器打开页面，右上角切换「浅色/深色/彩色/深蓝」，确认中文、河流、道路、建筑正常。

## 5. 更新数据/样式

### 样式

方式一：浏览器打开 `/editor`，输入 `EDITOR_TOKEN`，图形化或 JSON 修改，保存后刷新主地图（静态样式，无需重启）。

方式二：直接替换 `styles/<id>.json`，刷新浏览器。版本会备份在 `data/style-versions/<id>/`。

> `./run styles` 只用于构建期重新生成；客户服务器上不要用它覆盖编辑器内容。

### 数据

1. 替换 `data/tiles/<dataset>.pmtiles`；
2. 如果构建方同时提供了新的 `styles/*.json` 与 `config/`，一并替换（用于更新 `?v=` 缓存版本）；
3. `docker compose restart tileserver`（PMTiles 在启动时读取）；
4. 刷新浏览器。

> 样式本身由 Nginx 静态提供，改样式不需要重启；替换 PMTiles 需要重启 tileserver。

## 6. 备份

需要备份的只有：

```
data/tiles/       # 瓦片数据
data/fonts/       # 字体
data/sprites/     # 图标
styles/           # 样式（编辑器可写）
styles/schema/    # 图层分组
data/style-versions/  # 编辑器版本备份
config/           # manifest 与生成的 config
.env              # 部署参数（含 EDITOR_TOKEN）
```

`images.tar` 可重新从构建方获取，不必长期备份。

## 7. 端口/HTTPS

- 默认 Nginx 监听 8081；改 `.env` 的 `WEB_PORT`。
- 生产建议在 `web` 前放客户现有 Nginx/Caddy 做 HTTPS 与鉴权，并把 `PUBLIC_URL` 改成 HTTPS 地址。
- 若使用域名，`ALLOWED_HOSTS` 填域名，避免 Host 头污染。

## 8. 常见问题

| 现象 | 处理 |
|---|---|
| `docker load` 报错 | 确认 `images.tar` 完整；确认 Docker 磁盘空间 |
| `docker compose` 仍尝试拉镜像 | 必须使用 `docker compose up -d --pull never`；不要执行 `docker compose pull` |
| 页面空白 | 看 `docker compose logs tileserver`；确认 `data/tiles/*.pmtiles` 存在 |
| 字体/图标 404 | 确认 `data/fonts`、`data/sprites` 随包拷贝；不要只拷 `data/tiles` |
| 中文不显示 | 确认浏览器请求 `/fonts/Noto%20Sans%20CJK%20SC%20Regular/...` 返回 200 |
| 编辑器 401 | 顶部令牌与 `.env` 的 `EDITOR_TOKEN` 不一致 |
| 编辑器 403/500 | 确认 `styles/` 对 editor 可写、`styles/schema/layer-groups.json` 可读 |
| 海面缺失 | 构建时使用了 `COASTLINE=none`；重新用带海岸线的构建产物替换 PMTiles |
| 端口占用 | 改 `.env` 的 `WEB_PORT`，重新 `docker compose up -d` |
