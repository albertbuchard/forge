# Forge Companion Iroh Transport

`forge-companion-iroh` is Forge-owned Rust code for the web app to iOS companion
transport. It hosts an Iroh endpoint, exposes Forge's ALPN `forge-companion/1`,
authenticates the first stream frame with the QR pairing token, and
forwards framed Forge HTTP requests into the local Fastify runtime.

The crate also builds as a `staticlib` for the Swift iOS app. The Swift layer calls the
C ABI in `src/lib.rs` and sends Forge request envelopes over the same Iroh/QUIC stream
shape instead of using a LAN URL or Tailscale address by default.

## License and Attribution

This crate is Apache-2.0 licensed to keep Forge permissive, patent-explicit, and safe
for future closed-source commercial forks. It does not vendor, link, or copy upstream
Alleycat or KittyLitter source code. The public KittyLitter and Alleycat repositories
were used to understand the Iroh pairing pattern:

- Iroh QUIC endpoint
- ALPN-based protocol selection, with Forge using its own `forge-companion/1`
- pairing payload with version, node id, token, and optional relay
- length-prefixed JSON first frame with token auth

Upstream Alleycat is GPL-3.0-only. KittyLitter is GPLv3 with additional App Store and
Google Play distribution permission. Keeping this crate as a clean Forge implementation
avoids importing GPL code into Forge while preserving the Iroh behavior Forge needs.
