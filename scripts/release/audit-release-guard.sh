#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

branch="$(git branch --show-current)"
[[ "$branch" == "main" ]] || fail "Forge must be on main, got '$branch'"

version_key() {
  python3 - "$1" <<'PY'
import re
import sys

version = sys.argv[1].strip()
parts = [int(p) for p in re.findall(r"\d+", version)]
while len(parts) < 3:
    parts.append(0)
print(".".join(f"{part:08d}" for part in parts[:4]))
PY
}

latest_tag="$(
  git tag -l 'ios-testflight-v*' \
    | sed -E 's/^ios-testflight-v//' \
    | awk '/^[0-9]+(\.[0-9]+)*$/ { print }' \
    | while read -r version; do
        printf '%s %s\n' "$(version_key "$version")" "$version"
      done \
    | sort \
    | tail -1 \
    | awk '{print $2}'
)"

release_file="apps/ios-companion/release/release.yml"
[[ -f "$release_file" ]] || fail "missing $release_file"

connectivity_package="packages/forge-connectivity-service/package.json"
connectivity_workflow=".github/workflows/release-connectivity-service.yml"
[[ -f "$connectivity_package" ]] || fail "missing $connectivity_package"
[[ -f "$connectivity_workflow" ]] || fail "missing $connectivity_workflow"

connectivity_version="$(
  node -e 'process.stdout.write(require(process.argv[1]).version)' "./$connectivity_package"
)"
[[ "$connectivity_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "invalid Forge Connectivity Service version $connectivity_version"

latest_connectivity_tag="$(
  git tag -l 'connectivity-v*' \
    | sed -E 's/^connectivity-v//' \
    | awk '/^[0-9]+\.[0-9]+\.[0-9]+$/ { print }' \
    | while read -r version; do
        printf '%s %s\n' "$(version_key "$version")" "$version"
      done \
    | sort \
    | tail -1 \
    | awk '{print $2}'
)"

if [[ -n "$latest_connectivity_tag" && "$(version_key "$connectivity_version")" < "$(version_key "$latest_connectivity_tag")" ]]; then
  fail "Forge Connectivity Service version $connectivity_version is older than release $latest_connectivity_tag"
fi

working_version="$(awk -F'"' '/marketing:/ { print $2; exit }' "$release_file")"
[[ -n "$working_version" ]] || fail "could not read marketing version from $release_file"

if [[ -n "$latest_tag" && "$(version_key "$working_version")" < "$(version_key "$latest_tag")" ]]; then
  fail "working release version $working_version is older than latest TestFlight tag $latest_tag"
fi

if git diff --cached --name-only -- "$release_file" | grep -qx "$release_file"; then
  staged_version="$(git show ":$release_file" | awk -F'"' '/marketing:/ { print $2; exit }')"
  [[ -n "$staged_version" ]] || fail "could not read staged marketing version from $release_file"
  if [[ -n "$latest_tag" && "$(version_key "$staged_version")" < "$(version_key "$latest_tag")" ]]; then
    fail "staged release version $staged_version is older than latest TestFlight tag $latest_tag"
  fi
fi

printf 'Forge release guard passed.\n'
