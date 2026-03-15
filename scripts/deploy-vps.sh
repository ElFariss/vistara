#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-$HOME/apps/vistara}"
APP_IMAGE="${APP_IMAGE:?APP_IMAGE is required}"
AGENT_IMAGE="${AGENT_IMAGE:?AGENT_IMAGE is required}"

mkdir -p "$APP_DIR" "$APP_DIR/data/uploads" "$APP_DIR/data/tables" "$APP_DIR/backups"
cd "$APP_DIR"

export APP_IMAGE
export AGENT_IMAGE

docker-compose -f docker-compose.vps.yml up -d --remove-orphans

docker image prune -f >/dev/null 2>&1 || true
docker-compose -f docker-compose.vps.yml ps
