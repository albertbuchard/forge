#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_PATH="${IOS_DIR}/.release.env"
REQUIRE_ASC_AUTH=0
DEFAULT_TEAM_ID="${FORGE_APPLE_TEAM_ID_DEFAULT:-KZ65F7924F}"

usage() {
  cat <<'EOF'
Usage:
  ./ios-companion/scripts/write-release-env.sh [target_path] [--require-asc-auth]

Supported inputs:
  1. FORGE_IOS_RELEASE_ENV_BASE64 with a base64-encoded .release.env payload
  2. FORGE_IOS_RELEASE_ENV with a raw multiline .release.env payload
  3. Individual FORGE_ASC_* and FORGE_APPLE_TEAM_ID environment variables
EOF
}

fail() {
  printf '[forge-release] %s\n' "$1" >&2
  exit 1
}

decode_base64_to_file() {
  local output_path="$1"
  if printf '%s' "${FORGE_IOS_RELEASE_ENV_BASE64}" | base64 --decode >"${output_path}" 2>/dev/null; then
    return 0
  fi
  printf '%s' "${FORGE_IOS_RELEASE_ENV_BASE64}" | base64 -D >"${output_path}"
}

while (($# > 0)); do
  case "$1" in
    --require-asc-auth)
      REQUIRE_ASC_AUTH=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      [[ "${TARGET_PATH}" == "${IOS_DIR}/.release.env" ]] || fail "Unexpected extra argument '$1'."
      TARGET_PATH="$1"
      ;;
  esac
  shift
done

mkdir -p "$(dirname "${TARGET_PATH}")"

has_direct_release_env_values=0
if [[ -n "${FORGE_ASC_KEY_ID:-}" || -n "${FORGE_ASC_ISSUER_ID:-}" || -n "${FORGE_ASC_KEY_PATH:-}" || -n "${FORGE_ASC_KEY_CONTENT_BASE64:-}" || -n "${FORGE_APPLE_TEAM_ID:-}" || -n "${FORGE_RELEASE_SKIP_REMOTE_VALIDATION:-}" ]]; then
  has_direct_release_env_values=1
fi

if [[ "${has_direct_release_env_values}" == "1" ]]; then
  printf '[forge-release] Using individual FORGE_ASC_* / FORGE_APPLE_TEAM_ID values to write %s\n' "${TARGET_PATH}"
elif [[ -n "${FORGE_IOS_RELEASE_ENV_BASE64:-}" ]]; then
  printf '[forge-release] Using FORGE_IOS_RELEASE_ENV_BASE64 to write %s\n' "${TARGET_PATH}"
  decode_base64_to_file "${TARGET_PATH}"
elif [[ -n "${FORGE_IOS_RELEASE_ENV:-}" ]]; then
  printf '[forge-release] Using FORGE_IOS_RELEASE_ENV to write %s\n' "${TARGET_PATH}"
  printf '%s\n' "${FORGE_IOS_RELEASE_ENV}" >"${TARGET_PATH}"
fi

if [[ "${has_direct_release_env_values}" != "1" && -f "${TARGET_PATH}" ]]; then
  set -a
  source "${TARGET_PATH}"
  set +a
fi

: "${FORGE_APPLE_TEAM_ID:=${DEFAULT_TEAM_ID}}"
: "${FORGE_RELEASE_SKIP_REMOTE_VALIDATION:=0}"

missing=()
needs_app_store_connect=0
if [[ "${REQUIRE_ASC_AUTH}" == "1" || "${FORGE_RELEASE_SKIP_REMOTE_VALIDATION}" != "1" ]]; then
  needs_app_store_connect=1
fi

if [[ "${needs_app_store_connect}" == "1" ]]; then
  [[ -n "${FORGE_ASC_KEY_ID:-}" ]] || missing+=("FORGE_ASC_KEY_ID")
  [[ -n "${FORGE_ASC_ISSUER_ID:-}" ]] || missing+=("FORGE_ASC_ISSUER_ID")
  if [[ -z "${FORGE_ASC_KEY_PATH:-}" && -z "${FORGE_ASC_KEY_CONTENT_BASE64:-}" ]]; then
    missing+=("FORGE_ASC_KEY_PATH or FORGE_ASC_KEY_CONTENT_BASE64")
  fi
fi

if (( ${#missing[@]} > 0 )); then
  fail "Missing required release values: ${missing[*]}. Provide FORGE_IOS_RELEASE_ENV(_BASE64) or the individual env vars."
fi

if [[ -n "${FORGE_ASC_KEY_PATH:-}" && ! -f "${FORGE_ASC_KEY_PATH}" ]]; then
  fail "FORGE_ASC_KEY_PATH points to a missing file: ${FORGE_ASC_KEY_PATH}"
fi

{
  if [[ -n "${FORGE_ASC_KEY_ID:-}" ]]; then
    printf 'FORGE_ASC_KEY_ID=%s\n' "${FORGE_ASC_KEY_ID}"
  fi
  if [[ -n "${FORGE_ASC_ISSUER_ID:-}" ]]; then
    printf 'FORGE_ASC_ISSUER_ID=%s\n' "${FORGE_ASC_ISSUER_ID}"
  fi
  if [[ -n "${FORGE_ASC_KEY_PATH:-}" ]]; then
    printf 'FORGE_ASC_KEY_PATH=%s\n' "${FORGE_ASC_KEY_PATH}"
  fi
  if [[ -n "${FORGE_ASC_KEY_CONTENT_BASE64:-}" ]]; then
    printf 'FORGE_ASC_KEY_CONTENT_BASE64=%s\n' "${FORGE_ASC_KEY_CONTENT_BASE64}"
  fi
  printf 'FORGE_APPLE_TEAM_ID=%s\n' "${FORGE_APPLE_TEAM_ID}"
  printf 'FORGE_RELEASE_SKIP_REMOTE_VALIDATION=%s\n' "${FORGE_RELEASE_SKIP_REMOTE_VALIDATION}"
} >"${TARGET_PATH}"
