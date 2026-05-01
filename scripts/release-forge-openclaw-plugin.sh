#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_DIR="${FORGE_DIR}/openclaw-plugin"
ROOT_MANIFEST="${FORGE_DIR}/openclaw.plugin.json"
FORGE_PACKAGE_JSON="${FORGE_DIR}/package.json"
PLUGIN_MANIFEST="${PLUGIN_DIR}/openclaw.plugin.json"
PLUGIN_PACKAGE_JSON="${PLUGIN_DIR}/package.json"
PLUGIN_PACKAGE_LOCK_JSON="${PLUGIN_DIR}/package-lock.json"
CODEX_PLUGIN_MANIFEST="${FORGE_DIR}/plugins/forge-codex/.codex-plugin/plugin.json"
CODEX_RUNTIME_PACKAGE_JSON="${FORGE_DIR}/plugins/forge-codex/runtime/package.json"
HERMES_PLUGIN_MANIFEST="${FORGE_DIR}/plugins/forge-hermes/plugin.yaml"
SAFE_OPENCLAW_HOST_RANGE="2026.4.15"
DEFAULT_FORGE_PORT=4317
RELEASE_MODE="${FORGE_RELEASE_MODE:-full}"
SKIP_UPLOAD="${FORGE_RELEASE_SKIP_UPLOAD:-0}"
RELEASE_COMMIT_CREATED=0
RELEASE_TAG_CREATED=0
ORIGINAL_ROOT_VERSION=""
ORIGINAL_PLUGIN_MANIFEST_VERSION=""
ORIGINAL_PLUGIN_PACKAGE_VERSION=""
ORIGINAL_PLUGIN_PACKAGE_LOCK_VERSION=""
ORIGINAL_CODEX_PLUGIN_VERSION=""
ORIGINAL_CODEX_RUNTIME_VERSION=""
RELEASE_TARGET_VERSION=""
VERIFY_TESTS=(
  "npm --prefix openclaw-plugin audit --omit=dev --omit=peer"
  "npm exec -- vitest run src/openclaw/parity.test.ts src/openclaw/index.test.ts src/openclaw/api-client.test.ts src/openclaw/manifest.test.ts src/openclaw/tool-contract.test.ts"
  "npm run build"
  "node --import tsx --test --test-concurrency=1 server/src/app.test.ts"
  "npm run build:openclaw-plugin"
)

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-forge-openclaw-plugin.sh <version|patch|minor|major>
  FORGE_RELEASE_MODE=prepare ./scripts/release-forge-openclaw-plugin.sh <version|patch|minor|major>
  FORGE_RELEASE_MODE=publish-from-tag ./scripts/release-forge-openclaw-plugin.sh <version>

Examples:
  ./scripts/release-forge-openclaw-plugin.sh 1.2.3
  ./scripts/release-forge-openclaw-plugin.sh patch
  FORGE_RELEASE_MODE=prepare ./scripts/release-forge-openclaw-plugin.sh patch
  FORGE_RELEASE_MODE=publish-from-tag ./scripts/release-forge-openclaw-plugin.sh 1.2.3

This script:
1. checks Forge repo cleanliness and auth prerequisites
2. bumps the Forge plugin version across all publish/runtime surfaces
3. runs the verification suite
4. commits and tags the Forge nested repo
5. pushes main + tag to origin
6. publishes forge-openclaw-plugin to npm in full mode, or leaves that step to CI in prepare mode
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

cleanup_release_workspace() {
  rm -rf \
    "${FORGE_DIR}/dist" \
    "${PLUGIN_DIR}/dist" \
    "${FORGE_DIR}/plugins/forge-codex/runtime/dist" \
    "${FORGE_DIR}/plugins/forge-codex/runtime/server/migrations"

  git -C "${FORGE_DIR}" restore --source=HEAD --staged --worktree -- \
    "${ROOT_MANIFEST}" \
    "${PLUGIN_PACKAGE_JSON}" \
    "${PLUGIN_PACKAGE_LOCK_JSON}" \
    "${PLUGIN_MANIFEST}" \
    "${CODEX_PLUGIN_MANIFEST}" \
    "${CODEX_RUNTIME_PACKAGE_JSON}" \
    "openclaw-plugin/server/migrations" \
    "plugins/forge-codex/runtime/dist" \
    "plugins/forge-codex/runtime/server/migrations" >/dev/null 2>&1 || true
}

rollback_release_state() {
  local exit_code=$?
  if [[ ${exit_code} -eq 0 ]]; then
    return 0
  fi

  if [[ ${RELEASE_TAG_CREATED} -eq 1 ]]; then
    git -C "${FORGE_DIR}" tag -d "v${RELEASE_TARGET_VERSION}" >/dev/null 2>&1 || true
  fi

  if [[ ${RELEASE_COMMIT_CREATED} -eq 1 ]]; then
    git -C "${FORGE_DIR}" reset --mixed HEAD~1 >/dev/null 2>&1 || true
  fi

  if [[ -n "${ORIGINAL_ROOT_VERSION}" && -n "${ORIGINAL_PLUGIN_MANIFEST_VERSION}" && -n "${ORIGINAL_PLUGIN_PACKAGE_VERSION}" && -n "${ORIGINAL_PLUGIN_PACKAGE_LOCK_VERSION}" && -n "${ORIGINAL_CODEX_PLUGIN_VERSION}" && -n "${ORIGINAL_CODEX_RUNTIME_VERSION}" ]]; then
    write_release_versions "${ORIGINAL_ROOT_VERSION}" "${ROOT_MANIFEST}"
    write_release_versions "${ORIGINAL_PLUGIN_PACKAGE_VERSION}" "${PLUGIN_PACKAGE_JSON}"
    write_release_versions "${ORIGINAL_PLUGIN_PACKAGE_LOCK_VERSION}" "${PLUGIN_PACKAGE_LOCK_JSON}"
    write_release_versions "${ORIGINAL_PLUGIN_MANIFEST_VERSION}" "${PLUGIN_MANIFEST}"
    write_release_versions "${ORIGINAL_CODEX_PLUGIN_VERSION}" "${CODEX_PLUGIN_MANIFEST}"
    write_release_versions "${ORIGINAL_CODEX_RUNTIME_VERSION}" "${CODEX_RUNTIME_PACKAGE_JSON}"
  fi

  cleanup_release_workspace

  return "${exit_code}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

is_full_mode() {
  [[ "${RELEASE_MODE}" == "full" ]]
}

is_prepare_mode() {
  [[ "${RELEASE_MODE}" == "prepare" ]]
}

is_publish_from_tag_mode() {
  [[ "${RELEASE_MODE}" == "publish-from-tag" ]]
}

require_valid_release_mode() {
  case "${RELEASE_MODE}" in
    full|prepare|publish-from-tag) ;;
    *)
      fail "Unsupported FORGE_RELEASE_MODE '${RELEASE_MODE}'. Use full, prepare, or publish-from-tag."
      ;;
  esac
}

require_clean_forge_repo() {
  local status
  status="$(git -C "${FORGE_DIR}" status --porcelain)"
  if [[ -n "${status}" ]]; then
    printf 'Forge repo must be clean before releasing:\n%s\n' "${status}" >&2
    exit 1
  fi
}

require_git_auth() {
  git -C "${FORGE_DIR}" remote get-url origin >/dev/null 2>&1 || fail "Forge git remote 'origin' is not configured"
  git -C "${FORGE_DIR}" push --dry-run origin HEAD:refs/heads/main >/dev/null 2>&1 \
    || fail "GitHub push auth failed for Forge origin. Fix SSH credentials first."
}

require_npm_auth() {
  (
    cd "${PLUGIN_DIR}"
    npm whoami >/dev/null 2>&1
  ) || fail "npm auth is missing for publishing. Run npm login first."
}

resolve_next_version() {
  node --input-type=module - "$1" "$2" <<'NODE'
const current = process.argv[2];
const arg = process.argv[3];
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) {
  throw new Error(`Current version is not semver: ${current}`);
}
const next = [...match.slice(1).map(Number)];
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  process.stdout.write(arg);
  process.exit(0);
}
switch (arg) {
  case "patch":
    next[2] += 1;
    break;
  case "minor":
    next[1] += 1;
    next[2] = 0;
    break;
  case "major":
    next[0] += 1;
    next[1] = 0;
    next[2] = 0;
    break;
  default:
    throw new Error(`Unsupported version bump: ${arg}`);
}
process.stdout.write(next.join("."));
NODE
}

read_hermes_manifest_version() {
  python3 - "$1" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
match = re.search(r"^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$", text, re.MULTILINE)
if not match:
    raise SystemExit(f"Missing version in {path}")
sys.stdout.write(match.group(1))
PY
}

resolve_shared_plugin_version() {
  node --input-type=module - "$1" "$2" "$3" <<'NODE'
const openclawVersion = process.argv[2];
const hermesVersion = process.argv[3];
const arg = process.argv[4];

const parse = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`Current version is not semver: ${value}`);
  return match.slice(1).map(Number);
};

if (/^\d+\.\d+\.\d+$/.test(arg)) {
  process.stdout.write(arg);
  process.exit(0);
}

const [major, minor, patch] = [openclawVersion, hermesVersion]
  .map(parse)
  .sort((a, b) => {
    if (a[0] !== b[0]) return b[0] - a[0];
    if (a[1] !== b[1]) return b[1] - a[1];
    return b[2] - a[2];
  })[0];

const next = [major, minor, patch];
switch (arg) {
  case "patch":
    next[2] += 1;
    break;
  case "minor":
    next[1] += 1;
    next[2] = 0;
    break;
  case "major":
    next[0] += 1;
    next[1] = 0;
    next[2] = 0;
    break;
  default:
    throw new Error(`Unsupported version bump: ${arg}`);
}

process.stdout.write(next.join("."));
NODE
}

read_json_version() {
  node --input-type=module - "$1" <<'NODE'
import fs from "node:fs";
const path = process.argv[2];
const value = JSON.parse(fs.readFileSync(path, "utf8"));
if (typeof value.version !== "string") {
  throw new Error(`Missing version in ${path}`);
}
process.stdout.write(value.version);
NODE
}

write_release_versions() {
  local version="$1"
  shift
  local json_files=()
  local file
  for file in "$@"; do
    if [[ "${file}" == "${HERMES_PLUGIN_MANIFEST}" ]]; then
      python3 - "${version}" "${file}" <<'PY'
import re
import sys
from pathlib import Path

version = sys.argv[1]
path = Path(sys.argv[2])
text = path.read_text(encoding="utf-8")
text, count = re.subn(
    r"^version:\s*[0-9]+\.[0-9]+\.[0-9]+\s*$",
    f"version: {version}",
    text,
    count=1,
    flags=re.MULTILINE,
)
if count != 1:
    raise SystemExit(f"Could not update version in {path}")
path.write_text(text, encoding="utf-8")
PY
    else
      json_files+=("${file}")
    fi
  done
  if [[ ${#json_files[@]} -eq 0 ]]; then
    return 0
  fi
  node --input-type=module - "${version}" "${json_files[@]}" <<'NODE'
import fs from "node:fs";

const version = process.argv[2];
const files = process.argv.slice(3);
for (const file of files) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.version = version;
  if (file.endsWith("package-lock.json") && json.packages?.[""]) {
    json.packages[""].version = version;
  }
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
NODE
}

verify_version_alignment() {
  local version
  version="$1"
  local actual
  actual="$(node --input-type=module - "${ROOT_MANIFEST}" "${PLUGIN_PACKAGE_JSON}" "${PLUGIN_PACKAGE_LOCK_JSON}" "${PLUGIN_MANIFEST}" "${CODEX_PLUGIN_MANIFEST}" "${CODEX_RUNTIME_PACKAGE_JSON}" <<'NODE'
import fs from "node:fs";
const files = process.argv.slice(2);
const versions = files.map((file) => {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (file.endsWith("package-lock.json")) {
    return `${json.version}:${json.packages?.[""]?.version ?? ""}`;
  }
  return json.version;
});
process.stdout.write(JSON.stringify(versions));
NODE
)"
  [[ "${actual}" == "[\"${version}\",\"${version}\",\"${version}:${version}\",\"${version}\",\"${version}\",\"${version}\"]" ]] || fail "plugin versions are not aligned: ${actual}"
  local hermes_manifest_version
  hermes_manifest_version="$(read_hermes_manifest_version "${HERMES_PLUGIN_MANIFEST}")"
  [[ "${hermes_manifest_version}" == "${version}" ]] || fail "Hermes plugin manifest version mismatch: ${hermes_manifest_version}"
}

verify_openclaw_host_floor() {
  local actual
  actual="$(node --input-type=module - "${FORGE_PACKAGE_JSON}" "${PLUGIN_PACKAGE_JSON}" <<'NODE'
import fs from "node:fs";

const [forgePath, pluginPath] = process.argv.slice(2);
const forgePackage = JSON.parse(fs.readFileSync(forgePath, "utf8"));
const pluginPackage = JSON.parse(fs.readFileSync(pluginPath, "utf8"));
process.stdout.write(
  JSON.stringify({
    forgeDependency: forgePackage.dependencies?.openclaw ?? null,
    pluginPeer: pluginPackage.peerDependencies?.openclaw ?? null
  })
);
NODE
)"
  [[ "${actual}" == "{\"forgeDependency\":\"${SAFE_OPENCLAW_HOST_RANGE}\",\"pluginPeer\":\"${SAFE_OPENCLAW_HOST_RANGE}\"}" ]] \
    || fail "openclaw host floor must stay pinned to ${SAFE_OPENCLAW_HOST_RANGE}: ${actual}"
}

run_verification_suite() {
  verify_openclaw_host_floor
  if is_publish_from_tag_mode; then
    echo "+ npm run build:openclaw-plugin"
    (
      cd "${FORGE_DIR}"
      npm run build:openclaw-plugin
    )
    return 0
  fi

  local command_text
  for command_text in "${VERIFY_TESTS[@]}"; do
    echo "+ ${command_text}"
    (
      cd "${FORGE_DIR}"
      eval "${command_text}"
    )
  done
}

create_release_commit() {
  local version="$1"
  git -C "${FORGE_DIR}" add "${ROOT_MANIFEST}" "${PLUGIN_PACKAGE_JSON}" "${PLUGIN_PACKAGE_LOCK_JSON}" "${PLUGIN_MANIFEST}" "${CODEX_PLUGIN_MANIFEST}" "${CODEX_RUNTIME_PACKAGE_JSON}"
  git -C "${FORGE_DIR}" add -A \
    "${FORGE_DIR}/plugins/forge-codex/runtime/dist" \
    "${FORGE_DIR}/plugins/forge-codex/runtime/server/migrations"
  git -C "${FORGE_DIR}" commit -m "release(openclaw): v${version}"
  RELEASE_COMMIT_CREATED=1
  git -C "${FORGE_DIR}" tag "v${version}"
  RELEASE_TAG_CREATED=1
}

push_release() {
  local version="$1"
  (
    cd "${FORGE_DIR}"
    git push -u origin HEAD:main
    git push origin "v${version}"
  )
}

publish_package() {
  (
    cd "${PLUGIN_DIR}"
    npm publish --access public
  )
}

verify_published_latest() {
  local version="$1"
  local publish_state
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    publish_state="$(npm view forge-openclaw-plugin version dist-tags --json 2>/dev/null || true)"
    if [[ -n "${publish_state}" ]] && node --input-type=module - "$version" "$publish_state" <<'NODE'
const expected = process.argv[2];
const payload = JSON.parse(process.argv[3]);
if (payload.version === expected && payload["dist-tags"]?.latest === expected) {
  process.exit(0);
}
process.exit(1);
NODE
    then
      return 0
    fi
    sleep 3
  done
  fail "npm latest did not update to ${version}. Final npm view payload: ${publish_state}"
}

main() {
  local bump_arg="${1:-}"
  trap rollback_release_state EXIT
  [[ -n "${bump_arg}" ]] || {
    usage
    exit 1
  }
  [[ "${bump_arg}" == "--help" || "${bump_arg}" == "-h" ]] && {
    usage
    exit 0
  }

  require_valid_release_mode
  require_command git
  require_command node
  require_command npm
  require_command python3
  if ! is_publish_from_tag_mode; then
    require_command lsof
    require_command curl
    require_command tailscale
    require_clean_forge_repo
    require_git_auth
  fi
  if is_full_mode; then
    require_npm_auth
  fi

  ORIGINAL_ROOT_VERSION="$(read_json_version "${ROOT_MANIFEST}")"
  ORIGINAL_PLUGIN_MANIFEST_VERSION="$(read_json_version "${PLUGIN_MANIFEST}")"
  ORIGINAL_PLUGIN_PACKAGE_VERSION="$(read_json_version "${PLUGIN_PACKAGE_JSON}")"
  ORIGINAL_PLUGIN_PACKAGE_LOCK_VERSION="$(read_json_version "${PLUGIN_PACKAGE_LOCK_JSON}")"
  ORIGINAL_CODEX_PLUGIN_VERSION="$(read_json_version "${CODEX_PLUGIN_MANIFEST}")"
  ORIGINAL_CODEX_RUNTIME_VERSION="$(read_json_version "${CODEX_RUNTIME_PACKAGE_JSON}")"

  local current_version hermes_version next_version
  current_version="$(read_json_version "${PLUGIN_PACKAGE_JSON}")"
  hermes_version="$(read_hermes_manifest_version "${HERMES_PLUGIN_MANIFEST}")"
  if is_publish_from_tag_mode; then
    next_version="${bump_arg}"
    [[ "${next_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "publish-from-tag mode requires an exact semver version"
  else
    next_version="$(resolve_shared_plugin_version "${current_version}" "${hermes_version}" "${bump_arg}")"
    [[ "${next_version}" != "${current_version}" ]] || fail "next version matches current version (${current_version})"
    (
      cd "${FORGE_DIR}"
      if git rev-parse "v${next_version}" >/dev/null 2>&1; then
        fail "tag v${next_version} already exists locally"
      fi
      if git ls-remote --exit-code --tags origin "refs/tags/v${next_version}" >/dev/null 2>&1; then
        fail "tag v${next_version} already exists on origin"
      fi
    )
    echo "Releasing forge-openclaw-plugin ${current_version} -> ${next_version}"
    write_release_versions "${next_version}" "${ROOT_MANIFEST}" "${PLUGIN_PACKAGE_JSON}" "${PLUGIN_PACKAGE_LOCK_JSON}" "${PLUGIN_MANIFEST}" "${CODEX_PLUGIN_MANIFEST}" "${CODEX_RUNTIME_PACKAGE_JSON}"
  fi

  RELEASE_TARGET_VERSION="${next_version}"
  verify_version_alignment "${next_version}"
  run_verification_suite
  if ! is_publish_from_tag_mode; then
    create_release_commit "${next_version}"
    push_release "${next_version}"
  fi
  if [[ "${SKIP_UPLOAD}" == "1" ]]; then
    cat <<EOF
Release checks complete.

Skipped npm upload because FORGE_RELEASE_SKIP_UPLOAD=1.
Target package version: forge-openclaw-plugin@${next_version}
EOF
    return 0
  fi
  if is_prepare_mode; then
    cat <<EOF
Release prepared.

Pushed tag: v${next_version}
CI should publish forge-openclaw-plugin@${next_version}.
EOF
    return 0
  fi

  publish_package
  verify_published_latest "${next_version}"

  if is_publish_from_tag_mode; then
    cat <<EOF
Release complete.

Published package: forge-openclaw-plugin@${next_version}
Install:
  openclaw plugins install forge-openclaw-plugin
EOF
    return 0
  fi

  cat <<EOF
Release complete.

Published package: forge-openclaw-plugin@${next_version}
Forge git commit: $(git -C "${FORGE_DIR}" rev-parse --short HEAD)
Install:
  openclaw plugins install forge-openclaw-plugin
EOF
}

main "$@"
