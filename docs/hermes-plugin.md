# Forge Hermes Plugin

Forge ships a repo-local Hermes plugin alongside the published OpenClaw plugin.

The Hermes adapter follows the native Hermes plugin guide structure:

- `plugin.yaml`
- `__init__.py`
- `schemas.py`
- `tools.py`
- bundled `skill.md`

Its job is to expose the same curated Forge operating surface as the OpenClaw plugin:

- operator overview and operator context
- live onboarding contract
- Psyche, XP, weekly review, and current-work reads
- batch search, create, update, delete, and restore
- explicit work adjustments, retroactive work logging, and task-run controls
- calendar overview, work-block creation, and task timeboxing helpers
- visual handoff to the Forge UI when the UI is genuinely the better surface

## Install

From the Forge repo:

```bash
npm install
./plugins/forge-hermes/scripts/install.sh
```

That creates:

- `~/.hermes/plugins/forge -> <repo>/plugins/forge-hermes`
- `~/.hermes/forge/config.json`

The symlinked install is the recommended path because the Hermes plugin currently reuses
the repo's tested Forge local-runtime helper instead of carrying a second bundled
runtime copy.

The generated config file is also the durable user-editable settings surface for the
Hermes plugin. By default it gives Forge its own runtime storage root at
`~/.hermes/forge`, so the local Hermes adapter does not write into the repo working
directory by accident.

## Configuration

Supported settings, either in `~/.hermes/forge/config.json` or as environment
variables:

- `FORGE_ORIGIN`
- `FORGE_PORT`
- `FORGE_API_TOKEN`
- `FORGE_ACTOR_LABEL`
- `FORGE_TIMEOUT_MS`
- `FORGE_DATA_ROOT`

Defaults:

- origin: `http://127.0.0.1`
- port: `4317` unless a preferred relocated localhost port was learned by the shared runtime helper
- actor label: `hermes`
- timeout: `15000`
- data root: `~/.hermes/forge`

If you want to move the data elsewhere, either edit `~/.hermes/forge/config.json` or
rerun the installer with:

```bash
./plugins/forge-hermes/scripts/install.sh --data-root /absolute/path/to/forge-data
```

If you want a repo-level helper that behaves more like the OpenClaw smoke/push script,
run:

```bash
npm run install:local-hermes-plugin
```

That links the local plugin into `~/.hermes/plugins/forge`, saves the previous Hermes
plugin/config snapshot, rewrites the active Forge data root to a temporary directory,
chooses a free localhost port for that pushed runtime, and runs the Hermes runtime
smoke path. Restore the previous snapshot with:

```bash
bash ./scripts/install-local-hermes-plugin.sh restore
```

For a real release, run the monorepo helper:

```bash
../scripts/release-forge-hermes-plugin.sh patch
```

That script bumps the Hermes plugin version in `plugin.yaml` and `tools.py`, runs the
Forge + Hermes verification suite, commits the nested Forge repo, and pushes a
Hermes-specific git tag such as `hermes-v0.2.19`.

If you want Hermes and OpenClaw to ship on the exact same version in one pass, use the
shared monorepo wrapper instead:

```bash
../scripts/release-forge-agent-plugins.sh patch
```

## Local runtime behavior

When the Forge target is local and the server is not already healthy, the Hermes plugin
calls the repo's existing Forge local-runtime bootstrap helper. That means Hermes gets
the same local port relocation and health-check behavior that the OpenClaw adapter
already uses, instead of maintaining a second custom startup path. The Hermes adapter
also inherits the same protection against silently attaching to a Forge runtime that is
using the wrong storage root.

## Notes

- the plugin installs its bundled Forge skill to `~/.hermes/skills/forge-hermes/SKILL.md` on first load if the user does not already have one there
- remote write calls still need `FORGE_API_TOKEN` unless the target supports trusted local or Tailscale operator-session bootstrap
- the curated Forge tool names stay identical to the OpenClaw adapter so the operating model does not drift between agent platforms
