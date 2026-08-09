#!/bin/sh
set -eu

if [ -n "${FORGE_CARGO_AUDIT_DB:-}" ]; then
  case "$FORGE_CARGO_AUDIT_DB" in
    /*) ;;
    *)
      echo "FORGE_CARGO_AUDIT_DB must be an absolute path" >&2
      exit 1
      ;;
  esac
fi

for manifest in Cargo.toml fuzz/Cargo.toml; do
  active_tree="$(cargo tree --manifest-path "$manifest" --all-features --target all --prefix none --format '{p}')"
  case "$active_tree" in
    *"libcrux-chacha20poly1305 v"*)
      echo "refusing audit exception: vulnerable libcrux backend is active in $manifest" >&2
      exit 1
      ;;
  esac
done

audit_lockfile() {
  lockfile="$1"
  if [ -n "${FORGE_CARGO_AUDIT_DB:-}" ]; then
    cargo audit --db "$FORGE_CARGO_AUDIT_DB" --file "$lockfile" --ignore RUSTSEC-2026-0124
  else
    cargo audit --file "$lockfile" --ignore RUSTSEC-2026-0124
  fi
}

# hpke-rs 0.6.1 records its optional libcrux backend in Cargo.lock even though
# forge-peer enables only hpke-rs-rust-crypto. The graph check above makes this
# exception fail closed if that backend ever becomes active.
audit_lockfile Cargo.lock
audit_lockfile fuzz/Cargo.lock
