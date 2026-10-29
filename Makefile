SHELL := /bin/bash
STYLE ?= blueprint
REGION ?= shanghai
COASTLINE ?= osm
PUBLIC_URL ?= http://localhost:8081/
WEB_PORT ?= 8081
COMPOSE ?= docker compose
DOCKER_CONFIG ?= $(CURDIR)/.docker

export DOCKER_CONFIG

export REGION COASTLINE PUBLIC_URL WEB_PORT

.PHONY: help bootstrap fetch coastline tiles fonts sprites styles config check zoom-matrix up down logs verify bundle clean

$(DOCKER_CONFIG):
	mkdir -p $@

help:
	@echo "Custom Map Server"
	@echo ""
	@echo "  make bootstrap           下载 PBF/海岸线并构建瓦片、字体、图标、样式、配置"
	@echo "  make fetch               下载 data/osm/$(REGION)-latest.osm.pbf"
	@echo "  make coastline           下载并解压 OSM water polygons（约 900MB，只需一次）"
	@echo "  make tiles               生成 data/tiles/$(REGION).pmtiles"
	@echo "  make fonts               生成中文/拉丁 glyph PBF"
	@echo "  make sprites             生成三套样式图标雪碧图"
	@echo "  make styles              由 vendor 样式 + manifest 生成 styles/*.json"
	@echo "  make config              生成 config/tileserver.config.json"
	@echo "  make check               静态校验样式/数据/字体/图标契约"
	@echo "  make up                  构建并启动 TileServer GL + Nginx"
	@echo "  make verify              对运行中的服务做 HTTP 验收"
	@echo "  make bundle              打离线部署包 dist/"
	@echo "  make down                停止服务"
	@echo "  make logs                查看日志"
	@echo "  make clean               删除构建产物（保留 data/osm 与 data/cache）"

bootstrap: coastline tiles fonts sprites styles config check

fetch:
	./scripts/fetch-pbf.sh "$(REGION)"

coastline:
	./scripts/fetch-coastline.sh

tiles:
	REGION="$(REGION)" COASTLINE="$(COASTLINE)" ./scripts/build-tiles.sh

fonts:
	./scripts/build-fonts.sh

sprites:
	./scripts/build-sprites.sh

styles:
	node scripts/build-styles.mjs

config:
	node scripts/gen-config.mjs

check:
	node scripts/check.mjs

zoom-matrix:
	node scripts/gen-zoom-matrix.mjs "$(STYLE)"

up: | $(DOCKER_CONFIG)
	$(COMPOSE) up -d --build

down: | $(DOCKER_CONFIG)
	$(COMPOSE) down

logs: | $(DOCKER_CONFIG)
	$(COMPOSE) logs -f --tail=100

verify:
	BASE_URL="http://localhost:$(WEB_PORT)" ./scripts/verify.sh

bundle:
	./scripts/bundle.sh

clean:
	rm -rf data/tiles/* data/fonts/* data/sprites/* data/tmp/* styles/*.json config/tileserver.config.json dist web/dist
