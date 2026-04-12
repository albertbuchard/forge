#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HERMES_PLUGIN_DIR="${FORGE_DIR}/plugins/forge-hermes"
HERMES_PLUGIN_MANIFEST="${HERMES_PLUGIN_DIR}/plugin.yaml"
HERMES_PLUGIN_PACKAGE_VERSION="${HERMES_PLUGIN_DIR}/forge_hermes/version.py"
HERMES_PLUGIN_PYPROJECT="${HERMES_PLUGIN_DIR}/pyproject.toml"
HERMES_PLUGIN_PYTHON_DIST="${HERMES_PLUGIN_DIR}/python-dist"
HERMES_TAG_PREFIX="hermes-v"
RELEASE_MODE="${FORGE_RELEASE_MODE:-full}"
SKIP_UPLOAD="${FORGE_RELEASE_SKIP_UPLOAD:-0}"
PACKAGING_VENV_DIR=""
PACKAGING_PYTHON=""
RELEASE_COMMIT_CREATED=0
RELEASE_TAG_CREATED=0
ORIGINAL_HERMES_MANIFEST_VERSION=""
ORIGINAL_HERMES_PACKAGE_VERSION=""
RELEASE_TARGET_VERSION=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-forge-hermes-plugin.sh <version|patch|minor|major>
  FORGE_RELEASE_MODE=prepare ./scripts/release-forge-hermes-plugin.sh <version|patch|minor|major>
  FORGE_RELEASE_MODE=publish-from-tag ./scripts/release-forge-hermes-plugin.sh <version>

Examples:
  ./scripts/release-forge-hermes-plugin.sh 0.2.19
  ./scripts/release-forge-hermes-plugin.sh patch
  FORGE_RELEASE_MODE=prepare ./scripts/release-forge-hermes-plugin.sh patch
  FORGE_RELEASE_MODE=publish-from-tag ./scripts/release-forge-hermes-plugin.sh 0.2.19

This script:
1. checks Forge repo cleanliness and git auth prerequisites
2. bumps the Hermes plugin version across the Hermes release surfaces
3. builds the packaged Forge runtime bundle and Python distribution artifacts
4. runs the Forge + Hermes verification suite
5. smoke-installs the built Hermes wheel into a temporary virtualenv
6. commits and tags the Forge nested repo
7. pushes main + the Hermes release tag to origin
8. uploads the Hermes Python package to PyPI through twine in full mode, or leaves upload to CI in prepare mode
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

rollback_release_state() {
  local exit_code=$?
  if [[ ${exit_code} -eq 0 ]]; then
    return 0
  fi

  if [[ ${RELEASE_TAG_CREATED} -eq 1 ]]; then
    git -C "${FORGE_DIR}" tag -d "${HERMES_TAG_PREFIX}${RELEASE_TARGET_VERSION}" >/dev/null 2>&1 || true
  fi

  if [[ ${RELEASE_COMMIT_CREATED} -eq 1 ]]; then
    git -C "${FORGE_DIR}" reset --mixed HEAD~1 >/dev/null 2>&1 || true
  fi

  if [[ -n "${ORIGINAL_HERMES_MANIFEST_VERSION}" && -n "${ORIGINAL_HERMES_PACKAGE_VERSION}" ]]; then
    write_release_versions "${ORIGINAL_HERMES_MANIFEST_VERSION}"
  fi

  rm -rf "${HERMES_PLUGIN_PYTHON_DIST}"
  [[ -n "${PACKAGING_VENV_DIR}" ]] && rm -rf "${PACKAGING_VENV_DIR}"

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

ensure_packaging_env() {
  if [[ -n "${PACKAGING_PYTHON}" && -x "${PACKAGING_PYTHON}" ]]; then
    return 0
  fi

  PACKAGING_VENV_DIR="$(mktemp -d "${TMPDIR:-/tmp}/forge-hermes-release.XXXXXX")"
  python3 -m venv "${PACKAGING_VENV_DIR}"
  PACKAGING_PYTHON="${PACKAGING_VENV_DIR}/bin/python"
  "${PACKAGING_PYTHON}" -m ensurepip --upgrade >/dev/null 2>&1 || true
  "${PACKAGING_PYTHON}" -m pip install --upgrade pip build twine >/dev/null
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

read_manifest_version() {
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

read_package_version() {
  python3 - "$1" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
match = re.search(r'^__version__ = "([0-9]+\.[0-9]+\.[0-9]+)"$', text, re.MULTILINE)
if not match:
    raise SystemExit(f"Missing __version__ in {path}")
sys.stdout.write(match.group(1))
PY
}

write_release_versions() {
  python3 - "$1" "${HERMES_PLUGIN_MANIFEST}" "${HERMES_PLUGIN_PACKAGE_VERSION}" <<'PY'
import re
import sys
from pathlib import Path

version = sys.argv[1]
manifest_path = Path(sys.argv[2])
package_version_path = Path(sys.argv[3])

manifest_text = manifest_path.read_text(encoding="utf-8")
manifest_text, manifest_count = re.subn(
    r"^version:\s*[0-9]+\.[0-9]+\.[0-9]+\s*$",
    f"version: {version}",
    manifest_text,
    count=1,
    flags=re.MULTILINE,
)
if manifest_count != 1:
    raise SystemExit(f"Could not update version in {manifest_path}")
manifest_path.write_text(manifest_text, encoding="utf-8")

package_init_text = package_version_path.read_text(encoding="utf-8")
package_init_text, package_count = re.subn(
    r'^__version__ = "[0-9]+\.[0-9]+\.[0-9]+"$',
    f'__version__ = "{version}"',
    package_init_text,
    count=1,
    flags=re.MULTILINE,
)
if package_count != 1:
    raise SystemExit(f"Could not update __version__ in {package_version_path}")
package_version_path.write_text(package_init_text, encoding="utf-8")
PY
}

verify_version_alignment() {
  local version="$1"
  local manifest_version package_version
  manifest_version="$(read_manifest_version "${HERMES_PLUGIN_MANIFEST}")"
  package_version="$(read_package_version "${HERMES_PLUGIN_PACKAGE_VERSION}")"
  [[ "${manifest_version}" == "${version}" ]] || fail "plugin.yaml version mismatch: ${manifest_version}"
  [[ "${package_version}" == "${version}" ]] || fail "package version mismatch: ${package_version}"
}

run_verification_suite() {
  rm -rf "${HERMES_PLUGIN_PYTHON_DIST}"
  echo "+ node ./plugins/forge-hermes/scripts/build-package-runtime.mjs"
  (
    cd "${FORGE_DIR}"
    node ./plugins/forge-hermes/scripts/build-package-runtime.mjs
  )
  echo "+ npm exec -- tsc --noEmit"
  (
    cd "${FORGE_DIR}"
    npm exec -- tsc --noEmit
  )
  echo "+ npm exec -- tsc -p server/tsconfig.json --noEmit"
  (
    cd "${FORGE_DIR}"
    npm exec -- tsc -p server/tsconfig.json --noEmit
  )
  echo "+ npm run test"
  (
    cd "${FORGE_DIR}"
    npm run test
  )
  echo "+ node --import tsx --test --test-concurrency=1 server/src/*.test.ts"
  (
    cd "${FORGE_DIR}"
    node --import tsx --test --test-concurrency=1 server/src/*.test.ts
  )
  echo "+ python3 -m py_compile plugins/forge-hermes/__init__.py plugins/forge-hermes/forge_hermes/*.py"
  (
    cd "${FORGE_DIR}"
    python3 -m py_compile plugins/forge-hermes/__init__.py plugins/forge-hermes/forge_hermes/*.py
  )
  ensure_packaging_env
  echo "+ ${PACKAGING_PYTHON} -m build --sdist --wheel --outdir plugins/forge-hermes/python-dist plugins/forge-hermes"
  (
    cd "${FORGE_DIR}"
    "${PACKAGING_PYTHON}" -m build --sdist --wheel --outdir plugins/forge-hermes/python-dist plugins/forge-hermes
  )
  echo "+ ${PACKAGING_PYTHON} -m twine check plugins/forge-hermes/python-dist/*"
  (
    cd "${FORGE_DIR}"
    "${PACKAGING_PYTHON}" -m twine check plugins/forge-hermes/python-dist/*
  )
}

run_temp_install_smoke() {
  local temp_home temp_venv wheel_path cleanup_cmd
  temp_home="$(mktemp -d)"
  temp_venv="$(mktemp -d)"
  cleanup_cmd="$(printf 'rm -rf %q %q' "${temp_home}" "${temp_venv}")"
  trap "${cleanup_cmd}" RETURN

  wheel_path="$(find "${HERMES_PLUGIN_PYTHON_DIST}" -maxdepth 1 -type f -name 'forge_hermes_plugin-*.whl' | head -n 1)"
  [[ -n "${wheel_path}" ]] || fail "Expected a built Hermes wheel in ${HERMES_PLUGIN_PYTHON_DIST}"

  echo "+ python3 -m venv ${temp_venv}"
  (
    cd "${FORGE_DIR}"
    python3 -m venv "${temp_venv}"
    "${temp_venv}/bin/python" -m pip install --upgrade pip >/dev/null
    HERMES_HOME="${temp_home}" "${temp_venv}/bin/python" -m pip install "${wheel_path}" >/dev/null
    HERMES_HOME="${temp_home}" "${temp_venv}/bin/python" - <<'PY'
import importlib.metadata
from pathlib import Path

import forge_hermes


class Ctx:
    def __init__(self):
        self.tools = []

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)


def read_manifest_tools(path: Path) -> list[str]:
    tools: list[str] = []
    in_tools = False
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if raw_line.strip() == "provides_tools:":
            in_tools = True
            continue
        if in_tools:
            if raw_line.startswith("  - "):
                tools.append(raw_line[4:].strip())
                continue
            if raw_line and not raw_line.startswith(" "):
                break
    return tools


ctx = Ctx()
forge_hermes.register(ctx)
registered_names = sorted(
    tool["name"] for tool in ctx.tools if isinstance(tool.get("name"), str)
)
manifest_names = sorted(
    read_manifest_tools(Path("plugins/forge-hermes/plugin.yaml"))
)
assert registered_names == manifest_names, (
    len(registered_names),
    len(manifest_names),
    sorted(set(registered_names) - set(manifest_names)),
    sorted(set(manifest_names) - set(registered_names)),
)
entry_points = importlib.metadata.entry_points()
if hasattr(entry_points, "select"):
    plugin_entries = entry_points.select(group="hermes_agent.plugins")
else:
    plugin_entries = entry_points.get("hermes_agent.plugins", [])
assert any(entry.name == "forge" and entry.value == "forge_hermes" for entry in plugin_entries)
PY
  )
}

create_release_commit() {
  local version="$1"
  git -C "${FORGE_DIR}" add "${HERMES_PLUGIN_MANIFEST}" "${HERMES_PLUGIN_PACKAGE_VERSION}" "${HERMES_PLUGIN_PYPROJECT}"
  git -C "${FORGE_DIR}" add -A "${HERMES_PLUGIN_DIR}/forge_hermes" "${HERMES_PLUGIN_DIR}/scripts"
  git -C "${FORGE_DIR}" commit -m "release(hermes): v${version}"
  RELEASE_COMMIT_CREATED=1
  git -C "${FORGE_DIR}" tag "${HERMES_TAG_PREFIX}${version}"
  RELEASE_TAG_CREATED=1
}

push_release() {
  local version="$1"
  (
    cd "${FORGE_DIR}"
    git push -u origin main
    git push origin "${HERMES_TAG_PREFIX}${version}"
  )
}

publish_package() {
  ensure_packaging_env
  (
    cd "${FORGE_DIR}"
    "${PACKAGING_PYTHON}" -m twine upload "${HERMES_PLUGIN_PYTHON_DIST}"/*
  )
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
    require_clean_forge_repo
    require_git_auth
  fi

  ORIGINAL_HERMES_MANIFEST_VERSION="$(read_manifest_version "${HERMES_PLUGIN_MANIFEST}")"
  ORIGINAL_HERMES_PACKAGE_VERSION="$(read_package_version "${HERMES_PLUGIN_PACKAGE_VERSION}")"

  local current_version next_version
  current_version="${ORIGINAL_HERMES_MANIFEST_VERSION}"
  [[ "${ORIGINAL_HERMES_PACKAGE_VERSION}" == "${current_version}" ]] || fail "Hermes plugin version surfaces are already misaligned"
  if is_publish_from_tag_mode; then
    next_version="${bump_arg}"
    [[ "${next_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "publish-from-tag mode requires an exact semver version"
  else
    next_version="$(resolve_next_version "${current_version}" "${bump_arg}")"
    [[ "${next_version}" != "${current_version}" ]] || fail "next version matches current version (${current_version})"
    (
      cd "${FORGE_DIR}"
      if git rev-parse "${HERMES_TAG_PREFIX}${next_version}" >/dev/null 2>&1; then
        fail "tag ${HERMES_TAG_PREFIX}${next_version} already exists locally"
      fi
      if git ls-remote --exit-code --tags origin "refs/tags/${HERMES_TAG_PREFIX}${next_version}" >/dev/null 2>&1; then
        fail "tag ${HERMES_TAG_PREFIX}${next_version} already exists on origin"
      fi
    )
    echo "Releasing Forge Hermes plugin ${current_version} -> ${next_version}"
    write_release_versions "${next_version}"
  fi
  RELEASE_TARGET_VERSION="${next_version}"
  verify_version_alignment "${next_version}"
  run_verification_suite
  run_temp_install_smoke
  if ! is_publish_from_tag_mode; then
    create_release_commit "${next_version}"
    push_release "${next_version}"
  fi
  if [[ "${SKIP_UPLOAD}" == "1" ]]; then
    cat <<EOF
Release checks complete.

Skipped PyPI upload because FORGE_RELEASE_SKIP_UPLOAD=1.
Target package version: forge-hermes-plugin==${next_version}
EOF
    return 0
  fi
  if is_prepare_mode; then
    cat <<EOF
Release prepared.

Pushed tag: ${HERMES_TAG_PREFIX}${next_version}
CI should publish forge-hermes-plugin==${next_version}.
EOF
    return 0
  fi

  publish_package

  if is_publish_from_tag_mode; then
    cat <<EOF
Release complete.

Released Hermes plugin version: ${next_version}
PyPI package: forge-hermes-plugin==${next_version}
EOF
    return 0
  fi

  cat <<EOF
Release complete.

Released Hermes plugin version: ${next_version}
Forge git commit: $(git -C "${FORGE_DIR}" rev-parse --short HEAD)
Forge git tag: ${HERMES_TAG_PREFIX}${next_version}
PyPI package: forge-hermes-plugin==${next_version}
Editable install:
  ~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
  ~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable ${HERMES_PLUGIN_DIR}
EOF
}

main "$@"
