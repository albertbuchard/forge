# Forge Companion Transport

Forge Companion pairs to the desktop through one active transport at a time. Tailscale
HTTPS is preferred when it is installed, authenticated, and Forge is reachable through
the Mac's MagicDNS URL. Iroh is the fallback when Tailscale is unavailable, declined, or
not reachable. The base user path stays deliberately small:

```bash
npx forge-memory
```

or, after Forge is already installed:

```bash
npx forge-memory pair-ios
```

Those commands start the local Forge runtime and show a compact QR code for the iPhone
app. When Tailscale is healthy, the QR uses the Tailscale API/UI URL as the primary
direct transport and does not include Iroh node metadata. When Tailscale is unavailable,
the QR uses Forge's Iroh/QUIC transport. The CLI also saves the compact payload under
`~/.forge/pairing/` so it can be pasted into the iPhone app when a terminal QR is too
large or the camera cannot scan it.

Manual HTTP/TCP remains available for explicit LAN, Tailscale, or debugging setups. A
physical iPhone needs a phone-reachable URL:

```bash
npx forge-memory pair-ios --public-url https://your-mac.tailnet.ts.net/forge/
```

Loopback URLs such as `127.0.0.1` are useful for the iOS Simulator but are rejected for
physical-phone pairing.

## What The Iroh Fallback Is

When Iroh is selected, the path is not an HTTPS tunnel and it is not the Alleycat
protocol. Forge uses its own Rust crate, `companion-iroh`, with its own protocol label:

```text
forge-companion/1
```

The stack is:

```text
Forge Companion Swift app
  -> native Rust bridge
  -> Forge JSON frames
  -> Iroh QUIC streams
  -> Forge Rust host
  -> local Fastify runtime at http://127.0.0.1:4317
```

Iroh supplies the endpoint identity, QUIC connection, relay-assisted NAT traversal,
and stream transport. Forge supplies the application protocol, pairing token,
request envelopes, and local API proxy behavior.

## How The Phone Finds The Desktop

The phone does not scan the internet for a changing IP address. The desktop starts
an Iroh endpoint and gets a stable public-key identity, called the node id in the
Forge pairing payload. That identity can stay the same even when the laptop changes
Wi-Fi, moves behind another NAT, or gets a different public IP.

The QR code gives the iPhone:

- the desktop node id
- the pairing token
- the Forge protocol label, `forge-companion/1`
- the optional relay hint
- the active API and UI URLs
- the Iroh transport payload used for the first request attempt

Iroh then resolves and dials that endpoint identity. It can try direct QUIC when the
network allows it. When direct connectivity fails, Iroh can keep the encrypted QUIC
traffic moving through a relay. That means Forge does not require Tailscale for the
default first attempt, but it still depends on Iroh discovery/relay infrastructure for
reliable internet pairing. If that bridge fails and the pairing was created from a
phone-reachable Forge URL, the iPhone falls back to the preserved direct route.

## What The Relay Does

The relay is the public meeting point and fallback packet path. It is not the Forge
application server, and it does not need Forge's database.

In the normal flow:

1. Forge starts the Rust Iroh host.
2. The host connects outward to Iroh relay/discovery infrastructure.
3. The iPhone scans a QR payload containing the desktop node id.
4. The iPhone dials that node id with ALPN `forge-companion/1`.
5. Iroh attempts direct QUIC and falls back to encrypted relayed QUIC when needed.
6. Forge validates the first stream frame with the QR pairing token.
7. The iPhone sends Forge API requests over the authenticated stream.

The default Iroh endpoint is created with Iroh's `presets::N0` configuration. That is
appropriate for local development and beta use. Production deployments can move to
dedicated or self-hosted Iroh relay infrastructure without changing the Forge
application protocol.

## Pairing Payload Shape

The Forge pairing response keeps the normal app fields while adding transport
metadata. A simplified Iroh payload looks like:

```json
{
  "apiBaseUrl": "https://your-mac.tailnet.ts.net/api/v1",
  "uiBaseUrl": "https://your-mac.tailnet.ts.net/forge/",
  "transportMode": "iroh",
  "transport": {
    "protocol": "iroh",
    "provider": "forge-companion-iroh",
    "status": "ready",
    "publicBaseUrl": "https://your-mac.tailnet.ts.net/api/v1",
    "localBaseUrl": "http://127.0.0.1:4317",
    "nodeId": "<node-id>",
    "relay": "https://relay.example",
    "alpn": "forge-companion/1",
    "agent": "forge",
    "pairPayload": {
      "v": 1,
      "node_id": "<node-id>",
      "token": "<pairing-token>",
      "host_name": "desktop-name",
      "relay": "https://relay.example"
    },
    "recreateCommand": "forge-companion-iroh host --state-dir ... --local-base-url http://127.0.0.1:4317"
  }
}
```

The `recreateCommand` is there for diagnostics and recovery. The normal user does not
need to run it directly.

## Stream Protocol

Each QUIC stream uses length-prefixed JSON frames. The first frame is always a Forge
bridge request with the pairing token:

```json
{
  "op": "connect",
  "v": 1,
  "token": "<pairing-token>",
  "agent": "forge"
}
```

If the token is valid, the host replies with an OK frame. The iPhone can then send a
Forge HTTP request envelope:

```json
{
  "v": 1,
  "method": "POST",
  "path": "/api/v1/mobile/healthkit/sync",
  "headers": [{ "name": "content-type", "value": "application/json" }],
  "body_base64": "..."
}
```

The Rust host forwards that request into the local Fastify runtime and returns:

```json
{
  "v": 1,
  "status": 200,
  "headers": [{ "name": "content-type", "value": "application/json" }],
  "body_base64": "..."
}
```

That lets Forge keep the same backend routes while replacing the phone-to-desktop
wire transport.

## How The Host Is Delivered

The published npm runtime ships Forge's Rust source and lockfile for the companion
Iroh host under `companion-iroh-src/`. It does not bundle native desktop host
binaries. That keeps the package small and avoids shipping one binary per target
platform.

`npx forge-memory install`, `npx forge-memory configure`, and
`npx forge-memory pair-ios` prepare the Iroh transport only when Tailscale/direct
pairing is not selected. The installer checks for an existing host binary, checks for
Cargo, offers to install the minimal Rust toolchain when it can do so on the current
platform, and then runs:

```bash
cargo build --release --manifest-path <companion-iroh-src/Cargo.toml> --bin forge-companion-iroh
```

At runtime Forge resolves the host in this order:

1. explicit `FORGE_COMPANION_IROH_BIN`
2. source checkout build outputs for development installs
3. source-built package outputs under `companion-iroh-src/target/`
4. packaged Rust source fallback through `cargo run --manifest-path ...`

If none of those paths can run, the installer and `pair-ios` must fail with clear
Rust/Cargo install guidance. They must not print a QR code that falls back to
`127.0.0.1` for a physical iPhone. Manual HTTP remains available only when the user
explicitly passes a phone-reachable `--public-url`.

## Where The Code Lives

- `companion-iroh/`: Forge-owned Rust host binary and iOS static library.
- `server/src/services/companion-iroh.ts`: starts the host, parses readiness, and
  builds the QR transport payload.
- `server/src/discovery-advertiser.ts`: advertises Bonjour/Tailscale discovery
  hints; Iroh discovery uses phone-reachable HTTPS/Tailscale URLs when available
  instead of synthetic `forge-iroh://` API bases.
- `server/src/app.ts`: exposes mobile pairing routes and companion Iroh status.
- `src/pages/settings-mobile-page.tsx`: web settings UI for Iroh QR generation and
  manual HTTP fallback.
- `ios-companion/ForgeCompanion/ForgeCompanion/ForgeSyncClient.swift`: sends mobile
  API calls over Iroh when the pairing payload is Iroh and retries through URLSession
  when the Iroh bridge times out and the pairing has an HTTP(S) fallback URL.
- `ios-companion/ForgeCompanion/ForgeCompanion/ForgeWebView.swift`: registers the
  `forge-iroh://` scheme for the embedded Forge web app.
- `ios-companion/RustBridge/build-for-xcode.sh`: builds the Rust static library for
  iOS simulator and device targets.

## License And Upstream Boundary

Forge-owned public code is Apache-2.0. That is intentional: it keeps the public
project permissive, patent-explicit, and compatible with future closed-source
commercial Forge forks.

Alleycat and KittyLitter were useful references for the Iroh pairing pattern, but
Forge does not vendor, link, copy, or name its protocol after Alleycat. Forge uses
`forge-companion/1` because this is a Forge protocol, not KittyLitter's agent
multiplexer.

## Verification

Use these checks when changing the transport:

```bash
cargo fmt --manifest-path companion-iroh/Cargo.toml --check
cargo test --manifest-path companion-iroh/Cargo.toml
cargo build --release --manifest-path companion-iroh/Cargo.toml --bin forge-companion-iroh
npx tsc --noEmit
npm run check:server
npm run test:forge-memory
```

For iOS bridge changes, also build and test the generated Xcode project:

```bash
xcodebuild -project ios-companion/ForgeCompanion.xcodeproj \
  -scheme ForgeCompanion \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO build

xcodebuild -project ios-companion/ForgeCompanion.xcodeproj \
  -scheme ForgeCompanion \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:ForgeCompanionTests \
  CODE_SIGNING_ALLOWED=NO test
```

Do not run dependency installs casually while verifying this path. Existing local
dependencies are enough for most checks; release workflows install through the
repo's Safe Chain setup where that package manager surface is supported.
