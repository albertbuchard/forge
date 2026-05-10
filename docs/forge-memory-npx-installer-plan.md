# `npx forge-memory` Installer Plan

## Package Name Check

Checked on 2026-05-10 with:

```bash
npm view forge-memory name version description
```

npm returned `404 Not Found`, so `forge-memory` appears available now. First implementation work should reserve the package immediately with a minimal public placeholder release before deeper CLI work begins.

## Goal

Make this the primary Forge install path:

```bash
npx forge-memory
```

The command should be the single public front door for every Forge setup path:

- Forge UI/runtime only
- Forge for OpenClaw
- Forge for Hermes
- Forge for Codex
- any combination of OpenClaw, Hermes, and Codex

The command should open a polished, dynamic terminal installer that runs automated discovery in the background, detects OpenClaw, Hermes, and Codex, asks a guided sequence of questions, offers to install the Forge adapter into the selected host runtimes, defaults to all detected runtimes, configures one shared Forge data folder, and optionally pairs the iOS app.

The Forge UI/runtime is always installed and is not presented as a plugin/adapter option. The selectable list is only for host adapters: OpenClaw, Hermes, and Codex.

Development installs should also go through the same package:

```bash
npx forge-memory --dev
```

`--dev` means "install Forge from this local/source checkout and wire host runtimes to the live development build" instead of installing the published runtime package.

The existing detailed OpenClaw, Hermes, Codex, data-root, and runtime docs should stay intact, but move behind Advanced Install, Adapter Details, Troubleshooting, and FAQ sections. The public quickstart should lead with `npx forge-memory`.

## User Experience Contract

`npx forge-memory` should feel like a first-class Forge product surface, not a thin script wrapper.

- Launch with a branded Forge splash, version, detected platform, and concise system status.
- Use a dynamic menu style at the same quality level as OpenClaw and Hermes: color, spacing, keyboard navigation, progress states, recoverable errors, and clear next actions.
- Start OpenClaw, Hermes, Codex, Forge runtime, port, and data-root discovery immediately in the background while the user is reading the welcome screen.
- Detect OpenClaw, Hermes, and Codex automatically.
- Ask which runtimes to configure with an OpenClaw-quality checkbox menu: all detected runtimes are selected by default, Space toggles each row, Enter confirms.
- Show missing runtimes as disabled rows with a clear "not found" status.
- Include a Skip option so the user can install the Forge UI/runtime first and configure adapters later.
- Always install and configure the Forge UI/runtime as the base layer; do not show it as a selectable adapter row.
- Ask whether to keep the default data folder or choose a custom folder.
- Confirm before moving or adopting existing Forge data.
- Install/configure each selected adapter.
- Start or restart the local Forge runtime when needed.
- Run a doctor pass before declaring success.
- Ask whether to pair the iOS companion now, defaulting to yes.
- If pairing is accepted, generate the existing mobile pairing session, show a terminal QR code, print the JSON payload as a fallback, and offer to open the Forge web settings page.

## CLI Surface

The publishable npm package should provide a `forge-memory` binary.

Primary commands:

```bash
npx forge-memory
npx forge-memory --dev
npx forge-memory install
npx forge-memory configure
npx forge-memory status
npx forge-memory ui
npx forge-memory doctor
npx forge-memory restart
npx forge-memory stop
npx forge-memory export
npx forge-memory uninstall
npx forge-memory start
npx forge-memory data
npx forge-memory pair-ios
npx forge-memory update
npx forge-memory logs
npx forge-memory help
```

Command behavior:

- `forge-memory` and `forge-memory install`: launch the guided installer.
- `forge-memory --dev`: launch the same guided installer in source/development mode.
- `configure`: reopen the full guided flow after install for adapters, data root, runtime settings, and iOS pairing, using the current config and detected runtime state as defaults.
- `status`: show runtime health, API URL, UI URL, data root, database path, installed adapters, adapter versions, and iOS pairing state.
- `ui`: start the runtime if needed and open the Forge browser UI.
- `doctor`: check Node, npm, package integrity, host runtimes, plugin configs, ports, database accessibility, migrations, and API health.
- `restart`: restart only the Forge-managed runtime, never an unrelated process on the same port.
- `start` / `stop`: manage the Forge runtime with PID ownership checks.
- `export`: write a portable backup of the resolved Forge data folder plus Forge Memory metadata.
- `uninstall`: stop Forge, remove the Forge Memory runtime manager/cache, optionally remove adapter mappings, and keep the Forge data folder unless `--remove-data` is passed.
- `data`: show or change the data root with backup prompts and config propagation.
- `pair-ios`: generate a pairing session and render the QR flow.
- `update`: update `forge-memory` and selected adapters to compatible versions.
- `logs`: print recent Forge runtime logs and adapter install logs.
- `help`: provide concise command help with links to advanced docs.

## Package Architecture

Create a new publishable package under:

```text
projects/forge/packages/forge-memory/
```

Package shape:

- package name: `forge-memory`
- binary: `forge-memory`
- module format: ESM
- runtime target: Node 22+
- TypeScript source with a built `dist/`
- public npm publish with provenance

Public install mode and dev mode should use the same UX and command router. The difference is only the source of the runtime and adapters:

- public mode installs published Forge runtime/adapters
- dev mode links to the local Forge checkout, source-backed web/server runtime, local OpenClaw plugin, editable Hermes package, and local Codex MCP bridge

Recommended CLI libraries:

- `@inquirer/prompts` for accessible interactive prompts
- `yoctocolors` for small color output
- `ora` or a tiny internal spinner abstraction for progress
- `boxen` for readable branded panels
- `execa` for host command execution
- `find-up` or small filesystem helpers for config discovery
- `yaml` for Hermes config edits
- `qrcode-terminal` for iOS pairing
- `open` for browser launch

Avoid hard-coded string edits for config files. Use JSON and YAML parsers, preserve unknown fields, and write only the keys Forge owns.

## Runtime Packaging

The installer must work even when OpenClaw, Hermes, or Codex are not installed. Therefore `forge-memory` needs its own way to run the Forge local runtime.

Implementation path:

1. Extract the runtime packaging assumptions currently duplicated across `openclaw-plugin/`, `plugins/forge-hermes/`, and `plugins/forge-codex/runtime/`.
2. Add a shared runtime build artifact that includes:
   - built React app
   - Fastify server
   - migrations
   - OpenAPI schema
   - runtime start/stop/health helpers
3. Have `forge-memory` package that artifact directly.
4. Keep adapters thin: they should point at the same runtime/data root instead of carrying divergent runtime logic.

If extraction is too large for the first PR, the MVP can copy the same runtime bundle that `openclaw-plugin` already ships, but the plan should immediately follow with a shared runtime package cleanup so the three adapters and `forge-memory` do not drift.

Dev mode runtime rules:

- `npx forge-memory --dev` should locate the nearest Forge checkout or ask for it.
- It should run the source-backed dev runtime instead of the packed runtime.
- It should configure adapters to use the source checkout where the host supports that:
  - OpenClaw uses the local `openclaw-plugin` with link/source mode.
  - Hermes uses editable install from `plugins/forge-hermes`.
  - Codex uses the local `plugins/forge-codex` MCP bridge.
- It should default to the operator's real shared Forge data root so dev mode immediately works with the same OpenClaw, Hermes, Codex, and UI memory.
- It should still make the data root explicit and offer a disposable test root as a secondary option for isolated experiments.
- It should show a clear "DEV MODE" marker in status, doctor output, and runtime logs.

## Detection Rules

OpenClaw detection:

- `openclaw --version` works
- `~/.openclaw/` exists
- OpenClaw plugin paths/config files exist
- installed plugin list contains `forge-openclaw-plugin`, when available

Hermes detection:

- `hermes --version` works, when available
- `~/.hermes/hermes-agent/venv/bin/python` exists
- `~/.hermes/config.yaml` exists
- `~/.hermes/forge/config.json` exists, when already configured
- Hermes plugin discovery can import `forge_hermes`, when already installed

Codex detection:

- `codex --version` works
- Codex config directory exists
- MCP config contains a Forge server entry, when already configured

Each detector should return:

- runtime name
- installed/not installed
- version, if known
- config path
- current Forge adapter status
- current Forge data root, if configured
- install/update action required

## Install Flow

### 1. Welcome And Preflight

- Show Forge branding and current `forge-memory` version.
- Check Node version.
- Check npm availability.
- Check write access to the target data root parent.
- Check whether the package is running from npm, local source, or a packed tarball.
- Detect existing Forge runtime and API health.

### 2. Host Selection

- Present OpenClaw, Hermes, and Codex as selectable adapter rows.
- Default selection: every detected runtime, already checked.
- Interaction model: Space selects/unselects a row, arrow keys move, Enter confirms, and each row shows detected version/status.
- Missing agents stay visible as disabled rows with a "not found" status and short install hint.
- A Skip option proceeds with Forge UI/runtime only and reminds the user that `npx forge-memory configure` can reopen the full flow later.
- Allow selecting unsupported/missing runtimes only when the installer can provide a clear install path.
- If the user unselects every adapter, the installer proceeds with Forge UI/runtime only because the UI/runtime is always part of the install.

### 2a. Reconfigure Mode

`npx forge-memory configure` should rerun the full guided flow rather than jumping into one narrow submenu. Every prompt should be prefilled from the current state:

- current Forge runtime mode and version
- current data root
- current origin and port
- currently installed/enabled OpenClaw adapter
- currently installed/enabled Hermes adapter
- currently installed/enabled Codex MCP bridge
- current iOS pairing state

The user can accept the current state quickly, change one section, or skip sections. The final summary should show only what changed before applying writes.

### 3. Data Folder

Default:

```text
~/.forge
```

Prompt:

- keep default
- use an existing Forge data folder
- choose a new folder
- in dev mode, use the real shared Forge data folder by default and offer disposable test data only as an explicit opt-in

Rules:

- show the final database path before writing: `<dataRoot>/forge.sqlite`
- create the folder if missing
- never merge databases automatically
- back up existing `forge.sqlite` before migrations or root changes
- propagate the selected `dataRoot`, `origin`, and `port` to every selected adapter

### 4. Runtime Setup

- Install or update the `forge-memory` runtime artifact.
- Write `~/.forge/config.json` with owned keys only.
- Pick a port with the existing Forge relocation behavior.
- Start the runtime.
- Run `/api/v1/health`.
- Run migrations through the normal runtime startup path.

### 5. OpenClaw Adapter

Normal user path:

```bash
openclaw plugins install --dangerously-force-unsafe-install forge-openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
openclaw gateway restart
```

Installer responsibilities:

- run the install command only after user confirmation
- update the plugin config with the shared `dataRoot`, origin, and port
- verify `openclaw forge health`
- show manual fallback instructions only when automated install fails

### 6. Hermes Adapter

Normal user path:

```bash
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade forge-hermes-plugin
```

Installer responsibilities:

- use Hermes' own Python environment
- create or update `~/.hermes/forge/config.json`
- update `~/.hermes/config.yaml` through YAML parsing
- ensure the Forge plugin/toolset is enabled using Hermes' plugin model
- verify that Hermes can import `forge_hermes`

### 7. Codex Adapter

Installer responsibilities:

- add or update the Forge MCP server entry in Codex config
- prefer a packaged runner so Codex does not need an absolute checkout path
- use a command shape equivalent to:

```bash
npx forge-memory mcp
```

- verify the MCP server starts and can return Forge health/status

### 8. iOS Pairing

Forge already has mobile pairing support through `/api/v1/health/pairing-sessions` and the settings page QR payload shape:

```json
{
  "apiBaseUrl": "...",
  "sessionId": "...",
  "pairingToken": "...",
  "expiresAt": "...",
  "capabilities": []
}
```

Installer flow:

- ask whether to pair Forge Companion now, with yes selected by default
- create a pairing session against the running local API
- render the QR code in the terminal
- print the payload as a fallback
- show expiration time
- offer to open `/forge/settings/mobile`
- return to `status` after pairing

## Documentation Plan

Rewrite the public docs around this order:

1. Quickstart: `npx forge-memory`
2. What the installer does
3. Guided setup paths: UI only, OpenClaw, Hermes, Codex, or all detected agents
4. CLI command reference
5. Data folder and backup model
6. iOS pairing
7. Dev mode with `npx forge-memory --dev`
8. Advanced install
9. OpenClaw adapter details
10. Hermes adapter details
11. Codex MCP details
12. Troubleshooting and FAQ
13. Developer install from source

Specific doc edits:

- Update `README.md` so the first install command is `npx forge-memory`.
- State that OpenClaw, Hermes, Codex, and UI-only installs all begin from `npx forge-memory`.
- Document `npx forge-memory --dev` as the preferred development install flow.
- Document `npx forge-memory configure` as the way to rerun adapter/data/iOS configuration after install.
- Explain that `configure` reopens the full flow and uses the current configuration as defaults.
- Keep the current OpenClaw, Hermes, and Codex command blocks, but move them under Advanced Install.
- Add a short command table for `configure`, `status`, `ui`, `doctor`, `restart`, `data`, `pair-ios`, `logs`, and `update`.
- Update `docs/openclaw-plugin.md` to say direct OpenClaw install is an advanced path; primary user install is `npx forge-memory`.
- Update `docs/hermes-plugin.md` the same way.
- Add a Codex MCP advanced install page or section if one does not already exist.
- Update GitHub Pages navigation to make `npx forge-memory` the first install path.
- Update `docs/release-cheat-sheet.md` with the `forge-memory` npm release flow.
- Add FAQ entries:
  - Can I still install the OpenClaw plugin manually?
  - Can OpenClaw, Hermes, and Codex share one database?
  - How do I change the data folder later?
  - What happens if a port is already in use?
  - How do I pair or revoke the iOS app?
  - How do I recover from a failed install?

Do not delete detailed docs. Reframe them as advanced/reference material.

## Release Plan

1. Locally implement and verify `packages/forge-memory` without publishing.
2. `forge-memory` has been reserved on npm; future releases should move through Trusted Publishing from versioned tags.
3. Add GitHub Actions npm Trusted Publishing for `packages/forge-memory`.
4. Add package smoke tests:

```bash
npm pack
npx --package ./forge-memory-*.tgz forge-memory --help
npx --package ./forge-memory-*.tgz forge-memory doctor --json
```

5. Use the shared Forge plugin release tag. `forge-memory` must stay on the
   same version as the OpenClaw plugin, Hermes plugin, and Codex runtime package:

```text
v0.2.62
```

6. Keep adapter versions compatible with the runtime artifact version.
7. Add a release guard that fails if `forge-memory` package metadata does not match the runtime/adapters being published.

## Goal Launch Notes

Use this plan as the implementation goal source. npm publishing is deliberately deferred when the operator cannot authenticate from the current device:

- do not run `npm publish` until `npm login` or GitHub npm Trusted Publishing is available
- reserve `forge-memory` as soon as publishing auth is available so the name is not lost
- after reservation, the implementation can proceed normally through the repo CLI/Forge task flow
- keep the first published placeholder minimal; do not ship an incomplete installer as the public quickstart until the guided flow, status, doctor, configure, and runtime packaging are verified

## Test Plan

Unit tests:

- detector results for OpenClaw, Hermes, Codex, and Forge-only
- config read/write for JSON and YAML
- data-root selection and backup planning
- port selection
- command routing
- doctor checks

CLI interaction tests:

- no host runtimes detected
- OpenClaw only
- Hermes only
- Codex only
- all runtimes detected
- missing runtimes shown as disabled rows
- adapter selection skipped, then rerun through `configure`
- configure mode preloads existing adapter/data/iOS defaults
- existing Forge data root
- custom data root
- declined iOS pairing
- accepted iOS pairing with mocked API

Integration tests:

- package builds
- package packs
- packed CLI prints help
- packed CLI runs `doctor --json`
- local runtime starts from packed package
- `/api/v1/health` responds
- `status` reports the live runtime

Manual verification:

- macOS clean user profile
- existing OpenClaw installation
- existing Hermes installation
- Codex MCP config update
- iOS pairing QR from terminal
- failed adapter install recovery path

## Safety Rules

- Do not overwrite existing Forge data without explicit confirmation.
- Always back up a detected `forge.sqlite` before migrations or data-root moves.
- Do not silently edit unrelated host config keys.
- Do not kill arbitrary processes on Forge's preferred port.
- Do not print tokens except the one-time iOS pairing payload during the explicit pairing flow.
- Keep `doctor --json` free of secrets.
- Every install step must be idempotent.

## Implementation Milestones

### Milestone 0: Reserve Package

- Create minimal `packages/forge-memory/package.json`.
- Publish placeholder package.
- Add release workflow skeleton.

### Milestone 1: CLI Skeleton

- Add command router.
- Add branded terminal components.
- Add `help`, `version`, `doctor --json`, `configure`, `--dev`, and non-interactive fallback.
- Add tests for command routing.

### Milestone 2: Detection And Status

- Implement OpenClaw, Hermes, Codex, and Forge runtime detectors.
- Add `status`.
- Add structured doctor checks.

### Milestone 3: Data Root And Runtime

- Add data-root prompt.
- Add config writer.
- Package runtime artifact.
- Add start/stop/restart/ui commands.
- Add dev-mode runtime wiring from source checkout.

### Milestone 4: Adapter Installation

- Implement OpenClaw install/update.
- Implement Hermes install/update.
- Implement Codex MCP install/update.
- Verify shared data-root propagation.

### Milestone 5: iOS Pairing

- Add `pair-ios`.
- Reuse the existing pairing session API.
- Render terminal QR.
- Add fallback payload output.

### Milestone 6: Docs And Release

- Rewrite README quickstart.
- Move detailed install docs into advanced/reference sections.
- Update release cheat sheet.
- Add GitHub Pages navigation.
- Publish first real `forge-memory` release.

## Open Decisions

- Exact install hints or links to show beside disabled "not found" OpenClaw, Hermes, and Codex rows.
- Whether Windows support is first-release or documented as later support.
- Whether the shared runtime artifact should become a separate internal package immediately or after the first `forge-memory` release.
- Exact Codex MCP config path and command shape for the currently installed Codex build.
- Whether the placeholder package should be `0.0.0` or the next aligned Forge version.
