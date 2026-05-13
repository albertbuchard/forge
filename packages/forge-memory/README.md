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
npx forge-memory ui
npx forge-memory restart
npx forge-memory stop
npx forge-memory export
npx forge-memory uninstall
npx forge-memory pair-ios
```

`pair-ios` prefers the Iroh QR. Forge starts a Rust Iroh host, prints a QR payload
with the desktop node id, pairing token, optional relay hint, and ALPN
`forge-companion/1`, and the iPhone app connects through its native Rust bridge. Use
`--manual-http` only when you intentionally want a LAN, Tailscale, or direct HTTP/TCP
route.

The base install stays one command on purpose. The detailed companion transport
reference lives in the Forge repo at `docs/companion-iroh.md` and in the published
docs at `https://albertbuchard.github.io/forge/companion-transport.html`.

`configure` reruns the full guided flow using the current config as defaults.
`export` writes a portable backup of the real Forge data folder. `uninstall` removes the Forge Memory runtime manager and cache while keeping the data folder by default; pass `--remove-data` only when you intentionally want the data deleted too.

Typical first run:

1. Run `npx forge-memory`.
2. Keep or change the real Forge data folder.
3. Select OpenClaw, Hermes, and Codex adapters with Space.
4. Pair the iOS companion when prompted, or skip and run `npx forge-memory pair-ios` later.

Manual OpenClaw, Hermes, and Codex commands still exist in the Forge repository for advanced recovery, source-linking, and adapter debugging. The normal user path should start here.
