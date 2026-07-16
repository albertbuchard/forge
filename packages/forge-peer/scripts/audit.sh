#!/bin/sh
set -eu

for manifest in Cargo.toml fuzz/Cargo.toml; do
  active_tree="$(cargo tree --manifest-path "$manifest" --all-features --target all --prefix none --format '{p}')"
  case "$active_tree" in
    *"libcrux-chacha20poly1305 v"*)
      echo "refusing audit exception: vulnerable libcrux backend is active in $manifest" >&2
      exit 1
      ;;
  esac
done

# hpke-rs 0.6.1 records its optional libcrux backend in Cargo.lock even though
# forge-peer enables only hpke-rs-rust-crypto. The graph check above makes this
# exception fail closed if that backend ever becomes active.
cargo audit --file Cargo.lock --ignore RUSTSEC-2026-0124
cargo audit --file fuzz/Cargo.lock --ignore RUSTSEC-2026-0124
