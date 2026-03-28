#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_ID="forge-openclaw-plugin"
LOCAL_PLUGIN_PATH="/Users/omarclaw/Documents/aurel-monorepo/projects/forge/openclaw-plugin"
LOCAL_PLUGIN_VERSION="$(node --input-type=module - "${FORGE_ROOT}/openclaw-plugin/package.json" <<'NODE'
import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(pkg.version);
NODE
)"
PUBLISHED_SPEC="${FORGE_PUBLISHED_PLUGIN_SPEC:-${PLUGIN_ID}@${LOCAL_PLUGIN_VERSION}}"
TEMP_DATA_ROOT="${FORGE_PUBLISHED_PLUGIN_DATA_ROOT:-/tmp/forge-published-plugin-data}"
LOCAL_DATA_ROOT="${FORGE_LOCAL_PLUGIN_DATA_ROOT:-${LOCAL_PLUGIN_PATH}}"
FORGE_PORT="${FORGE_PUBLISHED_PLUGIN_PORT:-4317}"
FORGE_ORIGIN="${FORGE_PUBLISHED_PLUGIN_ORIGIN:-http://127.0.0.1}"
OPENCLAW_BIN="${OPENCLAW_BIN:-}"
EXTENSION_DIR="${HOME}/.openclaw/extensions/${PLUGIN_ID}"
FORGE_HEALTH_URL="${FORGE_ORIGIN}:${FORGE_PORT}/api/v1/health"
WAIT_TIMEOUT_SECONDS="${FORGE_PUBLISHED_PLUGIN_WAIT_TIMEOUT_SECONDS:-60}"

usage() {
  cat <<EOF
Usage:
  ./scripts/smoke-test-published-openclaw-plugin.sh [restore]

Modes:
  default   Install the published ${PLUGIN_ID} version declared in this repo and point it to a temporary data root.
  restore   Reinstall the local dev plugin and reset its data root.

Environment overrides:
  FORGE_PUBLISHED_PLUGIN_SPEC
  FORGE_PUBLISHED_PLUGIN_DATA_ROOT
  FORGE_LOCAL_PLUGIN_DATA_ROOT
  FORGE_PUBLISHED_PLUGIN_PORT
  FORGE_PUBLISHED_PLUGIN_ORIGIN

Examples:
  ./scripts/smoke-test-published-openclaw-plugin.sh
  FORGE_PUBLISHED_PLUGIN_SPEC=forge-openclaw-plugin@latest ./scripts/smoke-test-published-openclaw-plugin.sh
  ./scripts/smoke-test-published-openclaw-plugin.sh restore
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing required command: $1" >&2
    exit 1
  }
}

wait_for_http() {
  local url="$1"
  local timeout_seconds="${2:-60}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if curl -sf "${url}" >/dev/null 2>&1; then
      return 0
    fi

    if (( "$(date +%s)" - started_at >= timeout_seconds )); then
      echo "error: timed out waiting for ${url}" >&2
      return 1
    fi

    sleep 1
  done
}

resolve_openclaw_bin() {
  if [[ -n "${OPENCLAW_BIN}" ]]; then
    return 0
  fi

  while IFS= read -r candidate; do
    if [[ "${candidate}" != *"/node_modules/.bin/openclaw" ]]; then
      OPENCLAW_BIN="${candidate}"
      return 0
    fi
  done < <(which -a openclaw 2>/dev/null)

  OPENCLAW_BIN="$(command -v openclaw || true)"
}

openclaw_cmd() {
  "${OPENCLAW_BIN}" "$@"
}

restart_gateway() {
  openclaw_cmd gateway stop >/dev/null 2>&1 || true
  sleep 2
  openclaw_cmd gateway start
  wait_for_http "${FORGE_HEALTH_URL}" "${WAIT_TIMEOUT_SECONDS}"
}

remove_extension_dir() {
  if [[ -e "${EXTENSION_DIR}" ]]; then
    rm -rf "${EXTENSION_DIR}"
  fi
}

configure_plugin() {
  local data_root="$1"
  openclaw_cmd plugins enable "${PLUGIN_ID}"
  openclaw_cmd config set 'plugins.entries.forge-openclaw-plugin.config.origin' "\"${FORGE_ORIGIN}\"" --strict-json
  openclaw_cmd config set 'plugins.entries.forge-openclaw-plugin.config.port' "${FORGE_PORT}" --strict-json
  openclaw_cmd config set 'plugins.entries.forge-openclaw-plugin.config.dataRoot' "\"${data_root}\"" --strict-json
}

install_published() {
  mkdir -p "${TEMP_DATA_ROOT}"
  if [[ -e "${EXTENSION_DIR}" ]]; then
    openclaw_cmd plugins uninstall "${PLUGIN_ID}" --force || true
  fi
  remove_extension_dir
  openclaw_cmd plugins install --pin "${PUBLISHED_SPEC}"
  configure_plugin "${TEMP_DATA_ROOT}"
  restart_gateway
  echo
  echo "Published plugin installed."
  echo "Plugin: ${PUBLISHED_SPEC}"
  echo "Temporary Forge data root: ${TEMP_DATA_ROOT}"
  echo
  echo "When you want to switch back to local dev:"
  echo "  bash ./scripts/smoke-test-published-openclaw-plugin.sh restore"
}

restore_local() {
  if [[ -e "${EXTENSION_DIR}" ]]; then
    openclaw_cmd plugins uninstall "${PLUGIN_ID}" --force || true
  fi
  remove_extension_dir
  openclaw_cmd plugins install "${LOCAL_PLUGIN_PATH}"
  configure_plugin "${LOCAL_DATA_ROOT}"
  restart_gateway
  echo
  echo "Local dev plugin restored."
  echo "Plugin path: ${LOCAL_PLUGIN_PATH}"
  echo "Forge data root: ${LOCAL_DATA_ROOT}"
}

main() {
  require_command openclaw
  resolve_openclaw_bin

  if [[ -z "${OPENCLAW_BIN}" ]]; then
    echo "error: could not resolve an openclaw binary" >&2
    exit 1
  fi

  case "${1:-}" in
    "")
      install_published
      ;;
    restore)
      restore_local
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "error: unknown argument: ${1}" >&2
      usage
      exit 1
      ;;
  esac
}

main "${1:-}"
