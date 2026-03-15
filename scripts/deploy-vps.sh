#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-$HOME/apps/vistara}"
APP_IMAGE="${APP_IMAGE:?APP_IMAGE is required}"
AGENT_IMAGE="${AGENT_IMAGE:?AGENT_IMAGE is required}"
COMPOSE_FILE="docker-compose.vps.yml"

mkdir -p "$APP_DIR" "$APP_DIR/data/uploads" "$APP_DIR/data/tables" "$APP_DIR/backups"
cd "$APP_DIR"

export APP_IMAGE
export AGENT_IMAGE

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" "$@"
    return
  fi
  docker compose -f "$COMPOSE_FILE" "$@"
}

remove_matching_containers() {
  matches="$(
    {
      docker ps -aq --filter "name=umkm-agent-backend"
      docker ps -aq --filter "name=umkm-intelligence"
      docker ps -aq --filter "label=com.docker.compose.project=umkm" --filter "label=com.docker.compose.service=agent-backend"
      docker ps -aq --filter "label=com.docker.compose.project=umkm" --filter "label=com.docker.compose.service=app"
    } | sort -u | tr '\n' ' ' | xargs echo 2>/dev/null
  )"
  if [ -n "$matches" ]; then
    # shellcheck disable=SC2086
    docker rm -f $matches >/dev/null 2>&1 || true
  fi
}

# docker-compose v1 can crash on recreate when stale containers were created by
# a newer engine. Remove the app containers first so deploy stays recoverable.
compose stop agent-backend app >/dev/null 2>&1 || true
remove_matching_containers
compose rm -f agent-backend app >/dev/null 2>&1 || true

compose up -d --remove-orphans

docker image prune -f >/dev/null 2>&1 || true
compose ps
