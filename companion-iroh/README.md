# Forge Companion Iroh Transport

`forge-companion-iroh` is Forge-owned Rust code for the web app to iOS companion
transport. It hosts an Iroh endpoint, exposes Forge's ALPN `forge-companion/1`,
authenticates the first stream frame with the QR pairing token, and
forwards framed Forge HTTP requests into the local Fastify runtime.

The crate also builds as a `staticlib` for the Swift iOS app. The Swift layer calls the
C ABI in `src/lib.rs` and sends Forge request envelopes over the same Iroh/QUIC stream
shape instead of using a LAN URL or Tailscale address by default.

## Runtime Shape

The desktop side runs:

```bash
forge-companion-iroh host \
  --state-dir ~/.forge/companion-iroh \
  --local-base-url http://127.0.0.1:4317
```

The host state directory contains the Iroh identity key and pairing token. Keeping the
identity stable lets the phone keep dialing the same desktop node id even when the
machine changes network and gets a different IP address.

When the host is ready it writes one JSON line to stdout:

```json
{
  "event": "ready",
  "pairPayload": {
    "v": 1,
    "node_id": "<desktop-node-id>",
    "token": "<pairing-token>",
    "host_name": "desktop-name",
    "relay": "https://relay.example"
  },
  "alpn": "forge-companion/1"
}
```

The Fastify service parses that line and puts the payload into the Forge mobile QR.

## Stream Shape

Each bidirectional QUIC stream uses length-prefixed JSON frames:

1. Client sends `BridgeRequest::Connect` with `v`, `token`, and agent `forge`.
2. Host validates the token from the QR payload.
3. Host replies with `BridgeResponse::ok()`.
4. Client sends `ForgeHttpRequest` with method, path, headers, and optional base64 body.
5. Host proxies to the local Fastify runtime and replies with `ForgeHttpResponse`.

The `probe` subcommand exercises the same path:

```bash
forge-companion-iroh probe \
  --node-id <desktop-node-id> \
  --token <pairing-token> \
  --path /api/v1/health
```

## Relay And Discovery Reality

Iroh still uses public rendezvous and relay infrastructure. That is how the phone
finds the desktop's current route after the desktop has connected outward and published
its endpoint reachability. The relay is not a Forge application backend and does not
store Forge data; it helps the endpoints connect and can carry encrypted QUIC traffic
when direct NAT traversal fails.

Forge's default endpoint builder uses Iroh's `presets::N0` configuration. Production
operators can move to dedicated or self-hosted Iroh relays without changing
`forge-companion/1`.

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

More context for users and operators lives in `docs/companion-iroh.md`.
