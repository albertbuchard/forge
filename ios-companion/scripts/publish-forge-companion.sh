#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
FORGE_DIR="$(cd "${IOS_DIR}/.." && pwd)"
MODE="${1:-}"

fail() {
  printf '\n[forge-release] %s\n' "$1" >&2
  exit 1
}

info() {
  printf '[forge-release] %s\n' "$1"
}

ensure_rubygems_source() {
  local ruby_bin="$1"
  if ! "${ruby_bin}" -S gem sources --list 2>/dev/null | grep -q 'https://rubygems.org'; then
    info "Adding https://rubygems.org as a gem source for ${ruby_bin}."
    "${ruby_bin}" -S gem sources --add https://rubygems.org >/dev/null
  fi
}

unlock_release_keychain_if_configured() {
  command -v security >/dev/null 2>&1 || return 0

  local keychain_path="${FORGE_IOS_KEYCHAIN_PATH:-${FORGE_IOS_SIGNING_KEYCHAIN_PATH:-$HOME/Library/Keychains/login.keychain-db}}"
  [[ -f "${keychain_path}" ]] || return 0

  if [[ "${FORGE_IOS_KEYCHAIN_PASSWORD+x}" == "x" ]]; then
    info "Unlocking keychain ${keychain_path} for release signing."
    security unlock-keychain -p "${FORGE_IOS_KEYCHAIN_PASSWORD}" "${keychain_path}"
  fi
}

usage() {
  cat <<'EOF'
Usage:
  ./ios-companion/scripts/publish-forge-companion.sh validate
  ./ios-companion/scripts/publish-forge-companion.sh testflight
  ./ios-companion/scripts/publish-forge-companion.sh app-store

This is the single public release entrypoint for Forge Companion.
EOF
}

[[ -n "${MODE}" ]] || {
  usage
  fail "Missing release mode."
}

case "${MODE}" in
  validate|testflight|app-store) ;;
  *)
    usage
    fail "Unsupported mode '${MODE}'."
    ;;
esac

ENV_FILE="${IOS_DIR}/.release.env"
[[ -f "${ENV_FILE}" ]] || fail "Missing ${ENV_FILE}. Copy ${IOS_DIR}/.release.env.example first."

set -a
source "${ENV_FILE}"
set +a

: "${FORGE_APPLE_TEAM_ID:=KZ65F7924F}"

if [[ "${FORGE_RELEASE_SKIP_REMOTE_VALIDATION:-0}" != "1" ]]; then
  [[ -n "${FORGE_ASC_KEY_ID:-}" ]] || fail "Missing FORGE_ASC_KEY_ID in ${ENV_FILE}."
  [[ -n "${FORGE_ASC_ISSUER_ID:-}" ]] || fail "Missing FORGE_ASC_ISSUER_ID in ${ENV_FILE}."
  if [[ -z "${FORGE_ASC_KEY_PATH:-}" && -z "${FORGE_ASC_KEY_CONTENT_BASE64:-}" ]]; then
    fail "Set either FORGE_ASC_KEY_PATH or FORGE_ASC_KEY_CONTENT_BASE64 in ${ENV_FILE}."
  fi
  if [[ -n "${FORGE_ASC_KEY_PATH:-}" && ! -f "${FORGE_ASC_KEY_PATH}" ]]; then
    fail "FORGE_ASC_KEY_PATH points to a missing file: ${FORGE_ASC_KEY_PATH}"
  fi
fi

command -v xcodebuild >/dev/null 2>&1 || fail "xcodebuild is required."
command -v node >/dev/null 2>&1 || fail "Node.js is required for Forge release checks."
command -v npm >/dev/null 2>&1 || fail "npm is required for Forge release checks."

if [[ -x "/opt/homebrew/opt/ruby/bin/ruby" ]]; then
  RUBY_BIN="/opt/homebrew/opt/ruby/bin/ruby"
elif [[ -x "/usr/local/opt/ruby/bin/ruby" ]]; then
  RUBY_BIN="/usr/local/opt/ruby/bin/ruby"
else
  command -v brew >/dev/null 2>&1 || fail "Homebrew is required only when no modern Ruby is already installed."
  info "Installing Homebrew Ruby because release automation requires a modern Ruby runtime."
  brew list ruby >/dev/null 2>&1 || brew install ruby
  RUBY_PREFIX="$(brew --prefix ruby)"
  RUBY_BIN="${RUBY_PREFIX}/bin/ruby"
fi

[[ -x "${RUBY_BIN}" ]] || fail "Could not find a usable Ruby binary after Homebrew setup."

"${RUBY_BIN}" -e 'required = Gem::Version.new("2.7.0"); current = Gem::Version.new(RUBY_VERSION); exit(current >= required ? 0 : 1)' \
  || fail "Ruby ${RUBY_BIN} is too old for the release toolchain."

ensure_rubygems_source "${RUBY_BIN}"

if ! "${RUBY_BIN}" -S bundle -v >/dev/null 2>&1; then
  info "Installing Bundler for the release toolchain."
  "${RUBY_BIN}" -S gem install bundler --no-document
fi

unlock_release_keychain_if_configured

info "Installing Fastlane gems locally under ios-companion/vendor/bundle."
(
  cd "${IOS_DIR}"
  BUNDLE_GEMFILE="${IOS_DIR}/Gemfile" \
  BUNDLE_PATH="${IOS_DIR}/vendor/bundle" \
  "${RUBY_BIN}" -S bundle install
)

if [[ "${FORGE_IOS_SKIP_REPO_RELEASE_CHECKS:-0}" == "1" ]]; then
  info "Skipping Forge repo release checks for this iOS-only release flow."
else
  info "Running Forge repo release checks."
  (
    cd "${FORGE_DIR}"
    npx tsc --noEmit
    npm run build
  )
fi

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="${IOS_DIR}/.artifacts/releases/${MODE}-${TIMESTAMP}"
mkdir -p "${ARTIFACT_DIR}"

FASTLANE_LANE="validate_release"
case "${MODE}" in
  validate) FASTLANE_LANE="validate_release" ;;
  testflight) FASTLANE_LANE="testflight_release" ;;
  app-store) FASTLANE_LANE="app_store_release" ;;
esac

info "Running Fastlane lane '${FASTLANE_LANE}'. Artifacts will be written to ${ARTIFACT_DIR}."
(
  cd "${IOS_DIR}"
  BUNDLE_GEMFILE="${IOS_DIR}/Gemfile" \
  BUNDLE_PATH="${IOS_DIR}/vendor/bundle" \
  FORGE_RELEASE_ARTIFACT_DIR="${ARTIFACT_DIR}" \
  FASTLANE_SKIP_UPDATE_CHECK=1 \
  "${RUBY_BIN}" -S bundle exec fastlane ios "${FASTLANE_LANE}" artifact_dir:"${ARTIFACT_DIR}" mode:"${MODE}"
)

info "Release flow completed."
info "Artifacts: ${ARTIFACT_DIR}"
if [[ -f "${ARTIFACT_DIR}/release-summary.json" ]]; then
  info "Summary: ${ARTIFACT_DIR}/release-summary.json"
fi
