#!/bin/zsh
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
project_root=$(CDPATH= cd -- "$plugin_root/../.." && pwd)

cd "$project_root"
exec node "$plugin_root/scripts/forge-codex-mcp.mjs"
