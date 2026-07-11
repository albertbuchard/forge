# forge-memory

Single-command Forge install:

```bash
npx forge-memory
```

This is the preferred setup path for Forge. The command launches a guided CLI that installs the local Forge UI/runtime first, then discovers OpenClaw, Hermes, Codex, and Claude Code and offers to configure the detected adapters against the same Forge data folder.

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
npx forge-memory pair-ios
```

Codex and Claude Code use `npx forge-memory mcp` after configuration. That MCP entrypoint loads
the same curated Forge tool registry as the other Forge adapters, including
the wiki tools (`forge_search_wiki`, `forge_get_wiki_page`, and maintenance
tools). It also exposes `forge_memory_mcp_diagnostics` so adapter startup issues
show up as a tool result instead of a closed MCP transport.

`pair-ios` prefers Tailscale when it is installed, running, authenticated, and Forge
is reachable through the Mac's MagicDNS HTTPS URL. That gives the iPhone a normal
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
