#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKTREE_DIR="${VISTARA_TEST_DIR:-/tmp/vistara-test}"
DEFAULT_PORT="${PORT:-8080}"

usage() {
  cat <<EOF
Usage: scripts/local-test.sh <command>

Commands:
  setup    Create or refresh a clean detached worktree from origin/main and install dependencies
  start    Run the app locally from the clean test worktree
  test     Run npm test from the clean test worktree
  docker   Run docker compose up --build from the clean test worktree
  info     Print the test worktree path and URLs

Environment:
  VISTARA_TEST_DIR   Override the test worktree path (default: /tmp/vistara-test)
  PORT               Override the app port when using the start command (default: 8080)
EOF
}

log() {
  printf '[local-test] %s\n' "$*"
}

fail() {
  printf '[local-test] %s\n' "$*" >&2
  exit 1
}

ensure_git_worktree() {
  git -C "${REPO_ROOT}" fetch origin
  git -C "${REPO_ROOT}" worktree prune

  if git -C "${REPO_ROOT}" worktree list --porcelain | grep -Fxq "worktree ${WORKTREE_DIR}"; then
    if [[ ! -d "${WORKTREE_DIR}" ]]; then
      fail "Registered worktree path ${WORKTREE_DIR} is missing. Run: git -C ${REPO_ROOT} worktree prune"
    fi
  fi

  if [[ -e "${WORKTREE_DIR}" && ! -e "${WORKTREE_DIR}/.git" ]]; then
    if [[ -n "$(find "${WORKTREE_DIR}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
      fail "${WORKTREE_DIR} exists and is not a git worktree. Pick another VISTARA_TEST_DIR."
    fi
  fi

  if [[ -e "${WORKTREE_DIR}/.git" || -f "${WORKTREE_DIR}/.git" ]]; then
    if [[ -n "$(git -C "${WORKTREE_DIR}" status --porcelain)" ]]; then
      fail "${WORKTREE_DIR} has local changes. Clean it or set a different VISTARA_TEST_DIR."
    fi
    log "Refreshing existing test worktree at ${WORKTREE_DIR}"
    git -C "${WORKTREE_DIR}" fetch origin
    git -C "${WORKTREE_DIR}" checkout --detach origin/main
    git -C "${WORKTREE_DIR}" clean -fd
    return
  fi

  log "Creating clean test worktree at ${WORKTREE_DIR}"
  git -C "${REPO_ROOT}" worktree add --detach "${WORKTREE_DIR}" origin/main
}

ensure_env_file() {
  cd "${WORKTREE_DIR}"
  if [[ ! -f .env ]]; then
    cp .env.example .env
    log "Created ${WORKTREE_DIR}/.env from .env.example"
  fi
}

install_dependencies() {
  cd "${WORKTREE_DIR}"
  if [[ ! -d node_modules || package-lock.json -nt node_modules ]]; then
    log "Installing npm dependencies"
    npm install
    return
  fi
  log "Using existing node_modules in ${WORKTREE_DIR}"
}

setup() {
  ensure_git_worktree
  ensure_env_file
  install_dependencies
}

print_info() {
  cat <<EOF
Worktree: ${WORKTREE_DIR}
App URL: http://localhost:${DEFAULT_PORT}
Health:  http://localhost:${DEFAULT_PORT}/api/health

Notes:
- Edit ${WORKTREE_DIR}/.env if you want GEMINI_API_KEY enabled.
- This uses origin/main in a detached worktree, not your current codex checkout.
EOF
}

command="${1:-}"

case "${command}" in
  setup)
    setup
    print_info
    ;;
  start)
    setup
    print_info
    cd "${WORKTREE_DIR}"
    exec npm start
    ;;
  test)
    setup
    cd "${WORKTREE_DIR}"
    exec npm test
    ;;
  docker)
    setup
    print_info
    cd "${WORKTREE_DIR}"
    exec docker compose up --build
    ;;
  info)
    print_info
    ;;
  *)
    usage
    exit 1
    ;;
esac
