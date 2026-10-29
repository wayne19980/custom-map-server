#!/usr/bin/env bash
# Offline installer: load images and start the stack without network access.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "install: docker is required" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "install: docker compose v2 is required" >&2
  exit 1
fi

if [[ ! -f images.tar ]]; then
  echo "install: images.tar not found" >&2
  exit 1
fi

echo "install: loading images"
docker load -i images.tar

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "install: created .env from .env.example (edit PUBLIC_URL/WEB_PORT as needed)"
fi

echo "install: starting services"
docker compose up -d --pull never

WEB_PORT="$(grep -E '^WEB_PORT=' .env | cut -d= -f2 | tr -d '[:space:]')"
WEB_PORT="${WEB_PORT:-8081}"

echo "install: waiting for health"
for _ in $(seq 1 60); do
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS "http://localhost:${WEB_PORT}/health" >/dev/null 2>&1; then break; fi
  else
    if docker compose ps --format json | grep -q '"Health":"healthy"'; then break; fi
  fi
  sleep 1
done

echo "install: done"
docker compose ps
echo
echo "Open http://localhost:${WEB_PORT}/"
