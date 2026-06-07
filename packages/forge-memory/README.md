# forge-memory

Single-command Forge install:

```bash
npx forge-memory
```

This is the preferred setup path for Forge. The command launches a guided CLI that installs the local Forge UI/runtime first, then discovers OpenClaw, Hermes, and Codex and offers to configure the detected adapters against the same Forge data folder.

Development install from a Forge checkout:

```bash
npx forge-memory --dev
```

The Forge UI/runtime is always installed. The adapter checkbox list only contains host integrations, with detected adapters selected by default and missing adapters shown as disabled rows. You can skip adapter setup during install and return later with `configure`.

Useful commands:

```bash
npx forge-memory configure
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

Codex uses `npx forge-memory mcp` after configuration. That MCP entrypoint loads
the same curated Forge tool registry as the OpenClaw/Codex adapters, including
the wiki tools (`forge_search_wiki`, `forge_get_wiki_page`, and maintenance
tools). It also exposes `forge_memory_mcp_diagnostics` so adapter startup issues
show up as a tool result instead of a closed MCP transport.

`pair-ios` prefers the Iroh QR. Forge starts a Rust Iroh host, prints a QR payload
with the desktop node id, pairing token, optional relay hint, ALPN
`forge-companion/1`, and the request URL as a direct fallback when it is
phone-reachable. The iPhone app connects through its native Rust bridge first and can
retry through URLSession when that bridge times out. The CLI renders a short-schema QR
to keep the terminal code scannable and saves the full manual payload under
`~/.forge/pairing/` so you can paste it into the iPhone app if the camera cannot scan.
Use `--manual-http` only when you intentionally want a LAN, Tailscale, or direct
HTTP/TCP route. For a real iPhone, pass a phone-reachable URL:

```bash
npx forge-memory pair-ios --manual-http --public-url https://your-mac.tailnet.ts.net/forge/
```

Without `--public-url`, manual HTTP may resolve to `127.0.0.1`, which is useful for
the iOS Simulator but not for a physical phone.

The base install stays one command on purpose. The detailed companion transport
reference lives in the Forge repo at `docs/companion-iroh.md` and in the published
docs at `https://albertbuchard.github.io/forge/companion-transport.html`. Forge
Memory ships prebuilt Iroh host binaries for common desktop platforms and a bundled
Rust source fallback for other machines. If neither a prebuilt host nor Cargo is
available, `pair-ios` stops with transport-specific repair guidance instead of
printing a localhost QR that a physical iPhone cannot use.

`configure` reruns the full guided flow using the current config as defaults.
Install and configure run Forge doctor before finishing. `doctor --repair` creates
missing local folders, starts or restarts the runtime when allowed, and prints concrete
next steps without deleting Forge data.
`export` writes a portable backup of the real Forge data folder. `uninstall` removes the Forge Memory runtime manager and cache while keeping the data folder by default; pass `--remove-data` only when you intentionally want the data deleted too.

Typical first run:

1. Run `npx forge-memory`.
2. Keep or change the real Forge data folder.
3. Select OpenClaw, Hermes, and Codex adapters with Space.
4. Pair the iOS companion when prompted, or skip and run `npx forge-memory pair-ios` later.

Manual OpenClaw, Hermes, and Codex commands still exist in the Forge repository for advanced recovery, source-linking, and adapter debugging. The normal user path should start here.
