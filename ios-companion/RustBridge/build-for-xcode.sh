#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
FORGE_DIR="$(cd "${IOS_DIR}/.." && pwd)"
MANIFEST_PATH="${FORGE_DIR}/companion-iroh/Cargo.toml"
LIB_NAME="libforge_companion_iroh.a"

fail() {
  printf '[forge-iroh-ios] %s\n' "$1" >&2
  exit 1
}

[[ -f "${MANIFEST_PATH}" ]] || fail "Missing ${MANIFEST_PATH}."
command -v cargo >/dev/null 2>&1 || fail "cargo is required to build the Forge Iroh iOS bridge."

platform="${PLATFORM_NAME:-iphonesimulator}"
raw_current_arch="${CURRENT_ARCH:-}"
configuration="${CONFIGURATION:-Debug}"

profile_dir="debug"
release_arg=""
if [[ "${configuration}" == "Release" ]]; then
  profile_dir="release"
  release_arg="--release"
fi

export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"

build_arch() {
  local arch="$1"
  local target=""

  case "${platform}:${arch}" in
    iphoneos:arm64) target="aarch64-apple-ios" ;;
    iphonesimulator:arm64) target="aarch64-apple-ios-sim" ;;
    iphonesimulator:x86_64) target="x86_64-apple-ios" ;;
    *)
      fail "Unsupported iOS Rust target for PLATFORM_NAME=${platform} CURRENT_ARCH=${arch}."
      ;;
  esac

  if ! rustup target list --installed | grep -qx "${target}"; then
    fail "Rust target ${target} is not installed. Run: rustup target add ${target}"
  fi

  cargo build \
    --manifest-path "${MANIFEST_PATH}" \
    --target "${target}" \
    --lib \
    ${release_arg}

  local source_lib="${FORGE_DIR}/companion-iroh/target/${target}/${profile_dir}/${LIB_NAME}"
  [[ -f "${source_lib}" ]] || fail "Expected Rust static library was not produced: ${source_lib}"

  local out_dir="${SCRIPT_DIR}/build/${platform}-${arch}"
  mkdir -p "${out_dir}"
  cp "${source_lib}" "${out_dir}/${LIB_NAME}"
  printf '[forge-iroh-ios] built %s\n' "${out_dir}/${LIB_NAME}"
}

if [[ -n "${raw_current_arch}" && "${raw_current_arch}" != "undefined_arch" ]]; then
  build_arch "${raw_current_arch}"
else
  archs="${ARCHS:-$(uname -m)}"
  built_first_arch=""
  for arch in ${archs}; do
    build_arch "${arch}"
    if [[ -z "${built_first_arch}" ]]; then
      built_first_arch="${arch}"
    fi
  done
  if [[ -n "${raw_current_arch}" && -n "${built_first_arch}" ]]; then
    compatibility_out_dir="${SCRIPT_DIR}/build/${platform}-${raw_current_arch}"
    mkdir -p "${compatibility_out_dir}"
    cp "${SCRIPT_DIR}/build/${platform}-${built_first_arch}/${LIB_NAME}" "${compatibility_out_dir}/${LIB_NAME}"
    printf '[forge-iroh-ios] mirrored %s\n' "${compatibility_out_dir}/${LIB_NAME}"
  fi
fi
