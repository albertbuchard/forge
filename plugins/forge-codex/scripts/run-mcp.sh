#!/bin/zsh
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
project_root=$(CDPATH= cd -- "$plugin_root/../.." && pwd)
monorepo_root=$(CDPATH= cd -- "$project_root/../.." && pwd)
shared_data_root="$monorepo_root/data/forge"

export FORGE_OPENCLAW_DEV="${FORGE_OPENCLAW_DEV:-1}"
export FORGE_DEV_WEB_ORIGIN="${FORGE_DEV_WEB_ORIGIN:-http://127.0.0.1:3027/forge/}"
export FORGE_BASE_PATH="${FORGE_BASE_PATH:-/forge/}"
export HOST="${HOST:-127.0.0.1}"
export FORGE_PORT="${FORGE_PORT:-4317}"
export PORT="${PORT:-$FORGE_PORT}"
if [[ -z "${FORGE_DATA_ROOT:-}" && -d "$shared_data_root" ]]; then
  export FORGE_DATA_ROOT="$shared_data_root"
fi

cd "$project_root"
exec node "$plugin_root/scripts/forge-codex-mcp.mjs"
