#!/usr/bin/env bash

set -euo pipefail

SAFE_CHAIN_VERSION="${SAFE_CHAIN_VERSION:-1.5.3}"
SAFE_CHAIN_INSTALLER_SHA256="${SAFE_CHAIN_INSTALLER_SHA256:-0107cbbbf90159379756157e902acae512d62ffbd174307e42c5fe9f266792d3}"
SAFE_CHAIN_HOME="${SAFE_CHAIN_HOME:-${HOME}/.safe-chain}"
SAFE_CHAIN_REQUIRED="${SAFE_CHAIN_REQUIRED:-0}"
SAFE_CHAIN_LOGGING="${SAFE_CHAIN_LOGGING:-silent}"
SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS="${SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS:-0}"

INSTALL_URL="https://github.com/AikidoSec/safe-chain/releases/download/${SAFE_CHAIN_VERSION}/install-safe-chain.sh"

warn() {
  printf 'safe-chain: %s\n' "$*" >&2
}

is_required() {
  case "${SAFE_CHAIN_REQUIRED}" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

if ! command -v curl >/dev/null 2>&1; then
  warn "curl is required to install Aikido Safe Chain"
  if is_required; then
    exit 1
  fi
  warn "continuing without Safe Chain because SAFE_CHAIN_REQUIRED is not enabled"
  exit 0
fi

installer_path="$(mktemp)"
trap 'rm -f "${installer_path}"' EXIT

if ! curl -fsSL "${INSTALL_URL}" -o "${installer_path}"; then
  warn "download failed for Aikido Safe Chain ${SAFE_CHAIN_VERSION}"
  if is_required; then
    exit 1
  fi
  warn "continuing without Safe Chain because SAFE_CHAIN_REQUIRED is not enabled"
  exit 0
fi

actual_sha256="$(shasum -a 256 "${installer_path}" | awk '{print $1}')"
if [[ "${actual_sha256}" != "${SAFE_CHAIN_INSTALLER_SHA256}" ]]; then
  warn "installer checksum mismatch for Aikido Safe Chain ${SAFE_CHAIN_VERSION}"
  warn "expected ${SAFE_CHAIN_INSTALLER_SHA256}, got ${actual_sha256}"
  if is_required; then
    exit 1
  fi
  warn "continuing without Safe Chain because SAFE_CHAIN_REQUIRED is not enabled"
  exit 0
fi

if ! sh "${installer_path}" --ci --install-dir "${SAFE_CHAIN_HOME}"; then
  warn "installer failed for Aikido Safe Chain ${SAFE_CHAIN_VERSION}"
  if is_required; then
    exit 1
  fi
  warn "continuing without Safe Chain because SAFE_CHAIN_REQUIRED is not enabled"
  exit 0
fi

export SAFE_CHAIN_LOGGING
export SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS
export PATH="${SAFE_CHAIN_HOME}/shims:${SAFE_CHAIN_HOME}/bin:${PATH}"

if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    printf 'SAFE_CHAIN_LOGGING=%s\n' "${SAFE_CHAIN_LOGGING}"
    printf 'SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS=%s\n' "${SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS}"
  } >> "${GITHUB_ENV}"
fi

if [[ -n "${GITHUB_PATH:-}" ]]; then
  {
    printf '%s/shims\n' "${SAFE_CHAIN_HOME}"
    printf '%s/bin\n' "${SAFE_CHAIN_HOME}"
  } >> "${GITHUB_PATH}"
fi

if command -v safe-chain >/dev/null 2>&1; then
  safe-chain --version || safe-chain -v || true
fi

printf 'safe-chain: enabled with SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS=%s\n' "${SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS}"
