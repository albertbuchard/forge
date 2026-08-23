# forge-memory

Single-command Forge install:

```bash
npx forge-memory
```

You need Node.js 22 or newer. Check before installing:

```bash
node --version
npm --version
```

The exact first run is:

1. Run `npx forge-memory` as your normal operating-system user.
2. Keep or change the detected Codex, OpenClaw, Hermes, and Claude Code adapters.
3. Confirm the Forge data folder, normally `~/.forge`.
4. Leave optional Forge-to-Forge sharing off unless you need it.
5. Pair the iPhone now or skip it and run `npx forge-memory pair-ios` later.
6. Wait for `Forge Memory configured and checked.` and `Doctor: passed`.
7. Run `npx forge-memory ui`, then verify with `npx forge-memory status` and
   `npx forge-memory doctor`.

Forge Companion must already be installed before iPhone pairing. It is currently
distributed to invited testers through TestFlight; `forge-memory` creates the pairing
material but does not install the app or enroll a TestFlight account. Skip the phone
prompt if you do not already have Companion.

The complete [Forge installation guide](https://github.com/albertbuchard/forge/blob/main/docs/installation.md)
documents the exact prompts, platform differences, remote-browser approval, and recovery
path.

This is the preferred setup path for Forge. The command launches a guided CLI that installs the local Forge UI/runtime first, then discovers OpenClaw, Hermes, Codex, and Claude Code and offers to configure the detected adapters against the same Forge data folder.

Forge Memory also prepares the current operating-system user's local owner helper.
Selected local adapters authenticate through that helper automatically. No reusable API
key is written into Codex, Hermes, OpenClaw, or Claude Code configuration.

Use `npx forge-memory ui` to open the web app. On macOS, the installer registers an
owner-only `forge://` handler backed by the verified native owner helper. The browser
starts a short public transaction, retains its private proof key in memory, and receives
an HttpOnly session cookie after the operating-system owner check. No session credential
is placed in the URL, command arguments, or browser storage. Forge stores only the
separate, non-authenticating CSRF value in same-origin browser storage so later tabs can
write without another prompt. If the browser requires a user gesture before opening a
local protocol, Forge shows one pre-staged **Authorize this browser** link; this is the
only extra first-browser step.

If port 4317 is already served by a verified Forge source runtime started through
OpenClaw, `ui` now attempts the existing protected ownership transfer automatically so
the replacement starts with the current local-browser handler. The transfer verifies
the process, protected health identity, data root, and launch boundary before stopping
anything; a failed replacement is retried once and then restores the prior OpenClaw
runtime. Stale settings recorded for an adopted process do not block that safe transfer,
while Forge Memory still rejects real drift in a runtime it owns.

Tailscale reachability is never Forge authorization. Remote browsers and remote API
clients need a Forge-issued scoped credential even when Tailscale Serve and access
controls already restrict who can reach the machine. Remote authentication also requires
HTTPS. Forge does not need Tailscale Funnel.

Remote browser authorization is device-first. Forge tries the secure refresh cookie even
if disposable browser storage was cleared, then automatically checks for a discoverable
device passkey before offering another pairing request. After one approved pairing, the
browser asks for one Face ID, Touch ID, Windows Hello, or device-passcode verification to
create that passkey. Compatible browsers using the same credential provider and exact
Forge HTTPS host can then restore the same profile and scopes without another owner
approval. Declining or lacking passkeys keeps the paired browser session usable.

Development install from a Forge checkout:

```bash
npx forge-memory --dev
```

The Forge UI/runtime is always installed. The adapter checkbox list only contains host integrations, with detected adapters selected by default and missing adapters shown as disabled rows. You can skip adapter setup during install and return later with `configure`.

Useful commands:

```bash
npx forge-memory configure
npx forge-memory update
npx forge-memory status
npx forge-memory doctor
npx forge-memory doctor --repair
npx forge-memory ui
npx forge-memory restart
npx forge-memory stop
npx forge-memory export
npx forge-memory uninstall
npx forge-memory pairing
npx forge-memory pair-ios
```

## Enable Forge-to-Forge sharing

Peer sharing is disabled until the operator enables it. A new peer setup uses Iroh
by default, so 2 Forge installations can connect from different networks without a
shared Tailscale network or a server operated by the Forge maintainer:

```bash
npx forge-memory configure --enable-peer --enable-peer-iroh
npx forge-memory doctor
```

Iroh can connect directly when the networks allow it and can use its configured
relay infrastructure for encrypted transport when direct connectivity fails. No
public IP or direct endpoint is required for an Iroh-only setup.

A direct IP endpoint is optional. It must be a literal IPv4 address or bracketed
IPv6 address with a port:

```bash
npx forge-memory configure --enable-peer --peer-endpoint 192.0.2.10:4318
```

Use `--disable-peer-iroh` only when the host has a usable direct endpoint or another
configured provider. Forge does not silently change from a privacy-preserving mode
to a transport that exposes more network metadata. `status` and `doctor` report the
configured transports and whether the signed local `forge-peer` runtime is ready.

Enabling transport does not pair another Forge or share data. Pairing still requires
a one-use invitation and human confirmation. Every shared projection requires a
separate directional grant.

Codex and Claude Code use `npx forge-memory mcp` after configuration. That MCP entrypoint loads
the same curated Forge tool registry as the other Forge adapters, including
the wiki tools (`forge_search_wiki`, `forge_get_wiki_page`, and maintenance
tools). It also exposes `forge_memory_mcp_diagnostics` so adapter startup issues
show up as a tool result instead of a closed MCP transport. A local MCP client
also carries the verified browser-handler configuration into a runtime it may
start. If it finds a healthy runtime that lacks that handler, it performs the
same locked, identity-verified repair as `ui` instead of leaving local browsers
in a repeated `503` authorization loop.

When a remote browser, iPhone, Codex, Hermes, or OpenClaw asks to pair, every unlocked
local-owner Forge UI shows a notification that opens the complete pending-request
list. You can approve the matching request there with its short code, or use:

```bash
npx forge-memory pairing
```

The terminal command uses the verified local-owner helper, shows the exact client,
profile, scopes, and network boundary, and accepts the short code once. Denial does
not require a code that may have been lost with an abandoned requester. Elevated
grants still open Forge for the owner passkey check. `npx forge-memory pairing --json`
is a read-only request list for diagnostics; it cannot approve or deny anything.

`pair-ios` prefers Tailscale when it is installed, running, authenticated, and Forge
is reachable through the host's MagicDNS HTTPS URL. That gives the iPhone a normal
phone-reachable web URL for sync and the embedded Forge WebView. If Tailscale is
running but Forge is not served yet, the installer asks before configuring
`tailscale serve` for the local Forge runtime. If Tailscale is unavailable or
declined, Forge falls back to the Iroh QR: a Rust Iroh host with the desktop node id,
pairing token, optional relay hint, and ALPN `forge-companion/1`.

The CLI renders a short-schema QR to keep the terminal code scannable and saves the
full manual payload under `~/.forge/pairing/` so you can paste it into the iPhone app
if the camera cannot scan. Use `--public-url` when you intentionally want to force a
specific Tailscale, LAN, or fixed/private URL:

```bash
npx forge-memory pair-ios --public-url https://your-mac.tailnet.ts.net/forge/
```

`--manual-http` is still available as an explicit direct HTTP/TCP override. Loopback
URLs such as `127.0.0.1` and `localhost` are rejected for physical-phone pairing.

Phone pairing can ask before installing Tailscale, configuring Tailscale Serve,
installing the minimal Rust/Cargo toolchain for the Iroh fallback, compiling the bundled
native host, or restarting only the managed Forge runtime to bind its verified HTTPS
origin. Each conditional change is shown before it happens. Skip phone pairing if you do
not want those steps during the base install.

The base install stays one command on purpose. The detailed companion transport
reference lives in the Forge repo at `docs/reference/companion-iroh.md` and in the published
docs at `https://albertbuchard.github.io/forge/companion-transport.html`. Forge
Memory ships Forge's Iroh host source and lockfile, not native desktop binaries. When
the Iroh fallback is selected, the installer checks for Cargo, offers to install the
minimal Rust toolchain when the platform supports it, builds the local host from the
bundled source, then creates the QR. If Cargo cannot be installed automatically,
`install`, `configure`, and `pair-ios` stop with platform-specific steps instead of
printing a localhost QR that a physical iPhone cannot use.

`configure` reruns the full guided flow using the current config as defaults.
Install and configure run Forge doctor before finishing. `doctor --repair` creates
missing local folders, starts or restarts the runtime when allowed, and prints concrete
next steps without deleting Forge data.

`update` is the safe upgrade path:

```bash
npx forge-memory update
```

Before touching the runtime cache or adapters, it writes a pre-update backup under
`~/.forge/exports/forge-memory-pre-update-*.tar.gz` and prints the exact path. The
backup excludes disposable runtime folders (`runtime`, `run`, `logs`, and prior
`exports`) but preserves the real Forge data. If the source data is large, the CLI asks
before creating the backup; in non-interactive automation, pass `--yes` only after you
accept that backup. Existing Forge-related skill folders under Codex, OpenClaw, or
Hermes are hashed and backed up before adapter updates when Forge cannot prove they are
unchanged.

Agent prompt for Codex, Claude Code, Hermes, or OpenClaw:

```text
Run `npx forge-memory update --yes`, verify `npx forge-memory doctor`, and report the
backup path. Do not delete Forge data, do not remove adapters, and stop if the update
cannot create a backup first.
```

`export` writes a portable backup of the real Forge data folder. `uninstall` removes the Forge Memory runtime manager and cache while keeping the data folder by default; pass `--remove-data` only when you intentionally want the data deleted too.

The public [operator settings and recovery reference](../../docs/reference/operator-settings-and-recovery.md)
documents the matching web controls, data-root checks, token recovery, model
health, and mobile pairing recovery contract.

Typical first run:

1. Run `npx forge-memory`.
2. Keep or change the real Forge data folder.
3. Select OpenClaw, Hermes, Codex, and Claude Code adapters with Space.
4. Pair the iOS companion when prompted, or skip and run `npx forge-memory pair-ios` later.

Manual OpenClaw, Hermes, Codex, and Claude Code commands still exist in the Forge repository for advanced recovery, source-linking, and adapter debugging. The normal user path should start here.
