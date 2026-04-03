#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_PATH="${FORGE_ROOT}/plugins/forge-hermes"
HERMES_HOME="${HERMES_HOME:-${HOME}/.hermes}"
PLUGIN_LINK="${HERMES_HOME}/plugins/forge"
CONFIG_DIR="${HERMES_HOME}/forge"
CONFIG_PATH="${CONFIG_DIR}/config.json"
STATE_PATH="${CONFIG_DIR}/.push-local-plugin-state.json"
DEFAULT_DATA_ROOT="${CONFIG_DIR}"
TEMP_DATA_ROOT="${FORGE_HERMES_TEMP_DATA_ROOT:-/tmp/forge-hermes-plugin-data}"
FORGE_ORIGIN="${FORGE_HERMES_ORIGIN:-http://127.0.0.1}"
FORGE_PORT_START="${FORGE_HERMES_PORT:-4317}"
FORGE_ACTOR_LABEL="${FORGE_HERMES_ACTOR_LABEL:-hermes}"
FORGE_TIMEOUT_MS="${FORGE_HERMES_TIMEOUT_MS:-15000}"
FORGE_PORT=""

usage() {
  cat <<EOF
Usage:
  ./scripts/install-local-hermes-plugin.sh [restore]

Modes:
  default   Link the local Forge Hermes plugin into ~/.hermes and point it to a temporary Forge data root.
  restore   Restore the previous Hermes plugin link/config snapshot if one was saved.

Environment overrides:
  HERMES_HOME
  FORGE_HERMES_TEMP_DATA_ROOT
  FORGE_HERMES_ORIGIN
  FORGE_HERMES_PORT
  FORGE_HERMES_ACTOR_LABEL
  FORGE_HERMES_TIMEOUT_MS

Examples:
  ./scripts/install-local-hermes-plugin.sh
  FORGE_HERMES_TEMP_DATA_ROOT=/tmp/forge-hermes-demo ./scripts/install-local-hermes-plugin.sh
  ./scripts/install-local-hermes-plugin.sh restore
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing required command: $1" >&2
    exit 1
  }
}

ensure_dirs() {
  mkdir -p "${HERMES_HOME}/plugins" "${CONFIG_DIR}"
}

save_state() {
  ensure_dirs
  local existing_link=""
  local existing_config=""

  if [[ -L "${PLUGIN_LINK}" ]]; then
    existing_link="$(readlink "${PLUGIN_LINK}")"
  elif [[ -e "${PLUGIN_LINK}" ]]; then
    existing_link="__non_symlink__"
  fi

  if [[ -f "${CONFIG_PATH}" ]]; then
    existing_config="$(cat "${CONFIG_PATH}")"
  fi

  EXISTING_LINK="${existing_link}" EXISTING_CONFIG="${existing_config}" STATE_PATH="${STATE_PATH}" node <<'NODE'
const fs = require("fs");
const statePath = process.env.STATE_PATH;
const payload = {
  savedAt: new Date().toISOString(),
  pluginLink: process.env.EXISTING_LINK || "",
  configJson: process.env.EXISTING_CONFIG || ""
};
fs.mkdirSync(require("path").dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
NODE
}

write_config() {
  mkdir -p "$1"
  CONFIG_PATH="${CONFIG_PATH}" \
  DATA_ROOT="$1" \
  FORGE_ORIGIN="${FORGE_ORIGIN}" \
  FORGE_PORT="${FORGE_PORT}" \
  FORGE_ACTOR_LABEL="${FORGE_ACTOR_LABEL}" \
  FORGE_TIMEOUT_MS="${FORGE_TIMEOUT_MS}" \
  node <<'NODE'
const fs = require("fs");
const path = require("path");

const configPath = process.env.CONFIG_PATH;
const next = {
  origin: process.env.FORGE_ORIGIN,
  port: Number(process.env.FORGE_PORT),
  actorLabel: process.env.FORGE_ACTOR_LABEL,
  timeoutMs: Number(process.env.FORGE_TIMEOUT_MS),
  dataRoot: process.env.DATA_ROOT
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
NODE
}

resolve_free_port() {
  FORGE_PORT="$(FORGE_PORT_START="${FORGE_PORT_START}" node <<'NODE'
const net = require("net");

async function isAvailable(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

const startPort = Math.max(1, Number(process.env.FORGE_PORT_START || 4317));

(async () => {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await isAvailable(port)) {
      process.stdout.write(String(port));
      return;
    }
  }
  process.exit(1);
})().catch(() => process.exit(1));
NODE
)"
}

run_runtime_smoke() {
  (
    cd "${FORGE_ROOT}"
    HERMES_HOME="${HERMES_HOME}" node --import tsx ./plugins/forge-hermes/scripts/ensure-runtime.mjs
  )
}

push_local_plugin() {
  require_command node
  ensure_dirs
  save_state
  resolve_free_port
  mkdir -p "${TEMP_DATA_ROOT}"
  ln -sfn "${PLUGIN_PATH}" "${PLUGIN_LINK}"
  write_config "${TEMP_DATA_ROOT}"

  echo
  echo "Local Hermes plugin linked."
  echo "Plugin path: ${PLUGIN_PATH}"
  echo "Hermes link: ${PLUGIN_LINK}"
  echo "Forge data root: ${TEMP_DATA_ROOT}"
  echo "Forge port: ${FORGE_PORT}"
  echo "Config path: ${CONFIG_PATH}"
  echo
  echo "Runtime smoke:"
  run_runtime_smoke
  echo
  echo "To restore the previous Hermes plugin/config snapshot:"
  echo "  bash ./scripts/install-local-hermes-plugin.sh restore"
}

restore_previous() {
  require_command node

  if [[ ! -f "${STATE_PATH}" ]]; then
    echo "error: no saved Hermes push state found at ${STATE_PATH}" >&2
    exit 1
  fi

  local state_json
  state_json="$(cat "${STATE_PATH}")"
  local previous_link
  local previous_config

  previous_link="$(STATE_JSON="${state_json}" node --input-type=module <<'NODE'
const payload = JSON.parse(process.env.STATE_JSON);
process.stdout.write(typeof payload.pluginLink === "string" ? payload.pluginLink : "");
NODE
)"

  previous_config="$(STATE_JSON="${state_json}" node --input-type=module <<'NODE'
const payload = JSON.parse(process.env.STATE_JSON);
process.stdout.write(typeof payload.configJson === "string" ? payload.configJson : "");
NODE
)"

  rm -f "${PLUGIN_LINK}"
  if [[ "${previous_link}" == "__non_symlink__" ]]; then
    echo "warning: previous Hermes plugin path was not a symlink; leaving ${PLUGIN_LINK} absent." >&2
  elif [[ -n "${previous_link}" ]]; then
    ln -sfn "${previous_link}" "${PLUGIN_LINK}"
  fi

  if [[ -n "${previous_config}" ]]; then
    mkdir -p "${CONFIG_DIR}"
    printf '%s' "${previous_config}" > "${CONFIG_PATH}"
  else
    rm -f "${CONFIG_PATH}"
    mkdir -p "${DEFAULT_DATA_ROOT}"
  fi

  rm -f "${STATE_PATH}"

  echo
  echo "Previous Hermes plugin/config snapshot restored."
  if [[ -L "${PLUGIN_LINK}" || -e "${PLUGIN_LINK}" ]]; then
    echo "Hermes link: ${PLUGIN_LINK}"
  else
    echo "Hermes link removed: ${PLUGIN_LINK}"
  fi

  if [[ -f "${CONFIG_PATH}" ]]; then
    echo "Config path: ${CONFIG_PATH}"
  else
    echo "Config removed: ${CONFIG_PATH}"
  fi
}

main() {
  case "${1:-}" in
    "")
      push_local_plugin
      ;;
    restore)
      restore_previous
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
