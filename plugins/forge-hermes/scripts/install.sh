#!/bin/zsh
set -euo pipefail

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-root)
      export FORGE_DATA_ROOT="$2"
      shift 2
      ;;
    --port)
      export FORGE_PORT="$2"
      shift 2
      ;;
    --origin)
      export FORGE_ORIGIN="$2"
      shift 2
      ;;
    --actor-label)
      export FORGE_ACTOR_LABEL="$2"
      shift 2
      ;;
    --api-token)
      export FORGE_API_TOKEN="$2"
      shift 2
      ;;
    --timeout-ms)
      export FORGE_TIMEOUT_MS="$2"
      shift 2
      ;;
    --help|-h)
      print "Usage: ./plugins/forge-hermes/scripts/install.sh [--data-root PATH] [--port PORT] [--origin URL] [--actor-label LABEL] [--api-token TOKEN] [--timeout-ms MS]"
      exit 0
      ;;
    *)
      print -u2 "Unknown option: $1"
      exit 1
      ;;
  esac
done

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
hermes_home="${HERMES_HOME:-$HOME/.hermes}"
target_dir="$hermes_home/plugins"
target_path="$target_dir/forge"
config_dir="$hermes_home/forge"
config_path="$config_dir/config.json"
default_data_root="${FORGE_DATA_ROOT:-$config_dir}"

mkdir -p "$target_dir"
mkdir -p "$config_dir"
ln -sfn "$plugin_root" "$target_path"

export FORGE_HERMES_CONFIG_PATH="$config_path"
export FORGE_HERMES_DEFAULT_DATA_ROOT="$default_data_root"

node <<'NODE'
const fs = require("fs");
const path = require("path");

const configPath = process.env.FORGE_HERMES_CONFIG_PATH;
const defaultDataRoot = process.env.FORGE_HERMES_DEFAULT_DATA_ROOT;

const existing =
  configPath && fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};

const next = existing && typeof existing === "object" ? { ...existing } : {};
if (!next.dataRoot || String(next.dataRoot).trim().length === 0) {
  next.dataRoot = defaultDataRoot;
}

const rawOverrides = {
  origin: process.env.FORGE_ORIGIN,
  port: process.env.FORGE_PORT,
  dataRoot: process.env.FORGE_DATA_ROOT,
  apiToken: process.env.FORGE_API_TOKEN,
  actorLabel: process.env.FORGE_ACTOR_LABEL,
  timeoutMs: process.env.FORGE_TIMEOUT_MS
};

let shouldWrite = !fs.existsSync(configPath);

for (const [key, value] of Object.entries(rawOverrides)) {
  if (typeof value !== "string" || value.trim().length === 0) {
    continue;
  }
  next[key] = key === "port" || key === "timeoutMs" ? Number(value) : value;
  shouldWrite = true;
}

if (shouldWrite) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
NODE

print "Forge Hermes plugin linked at: $target_path"
print "Forge Hermes config lives at: $config_path"
print "Forge Hermes data root defaults to: $default_data_root"
print "Next step: start Hermes and run /plugins to confirm Forge loaded."
