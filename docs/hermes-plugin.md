# Forge Hermes Plugin

Forge ships a Hermes plugin alongside the published OpenClaw plugin.

The Hermes adapter now follows the native Hermes plugin guide structure end to end:

- `plugin.yaml`
- `__init__.py`
- `schemas.py`
- `tools.py`
- bundled `skill.md`
- `pyproject.toml` with a `hermes_agent.plugins` entry point

Its job is to expose the same curated Forge operating surface as the OpenClaw plugin:

- operator overview and operator context
- live onboarding contract
- Psyche, XP, weekly review, and current-work reads
- batch search, create, update, delete, and restore
- explicit work adjustments, retroactive work logging, and task-run controls
- calendar overview, work-block creation, and task timeboxing helpers
- visual handoff to the Forge UI when the UI is genuinely the better surface
- bundled Psyche interview playbooks so Hermes explores values, patterns, behaviors, beliefs, modes, and trigger reports with active listening before storing them

## Install

From the Forge repo:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade ./plugins/forge-hermes
```

That does three things:

- installs the plugin into Hermes' own Python environment through `pip`
- creates `~/.hermes/forge/config.json` automatically on first plugin load if it is missing
- loads Forge through the standard `hermes_agent.plugins` entry point on the next Hermes startup

Use Hermes' own runtime Python at `~/.hermes/hermes-agent/venv/bin/python` so the
plugin lives in the same environment Hermes actually runs.

If you want editable package mode while developing from this repo, use:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable ./plugins/forge-hermes
```

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

If you want to move the data elsewhere, edit `~/.hermes/forge/config.json`:

```json
{
  "dataRoot": "/absolute/path/to/forge-data"
}
```

For a real release, run the monorepo helper:

```bash
../scripts/release-forge-hermes-plugin.sh patch
```

That script bumps the Hermes plugin version in `plugin.yaml` and
`forge_hermes/version.py`, bundles the runtime payload, builds a wheel and sdist, runs
the Forge + Hermes verification suite, smoke-installs the wheel into a temporary
virtualenv, commits the nested Forge repo, and pushes a Hermes-specific git tag such as
`hermes-v0.2.19`.

If you want Hermes and OpenClaw to ship on the exact same version in one pass, use the
shared monorepo wrapper instead:

```bash
../scripts/release-forge-agent-plugins.sh patch
```

## Local runtime behavior

When the Forge target is local and the server is not already healthy, the Hermes plugin
calls the packaged Forge local-runtime bootstrap helper built from the same runtime code
OpenClaw ships. That means Hermes gets the same local port relocation, health checks,
and storage-root mismatch protection without depending on repo-only imports at runtime.

## Shared Multi-user Setup

Hermes works well as one participant in a shared Forge system, but the shared
runtime needs to be intentional.

If Hermes and OpenClaw are meant to see the same users, strategies, tasks, and
notes:

- point both at the same `origin`
- point both at the same `port`
- point both at the same `dataRoot` when using a local runtime
- give Hermes a clear `actorLabel`

Forge's multi-user model is explicit:

- every user is `human` or `bot`
- writes should set `userId` intentionally
- reads can scope with `userId` or repeated `userIds`
- cross-user links are valid

If Hermes is meant to operate as its own bot user inside that shared runtime,
create that bot in `Settings -> Users` and write records with that bot's
`userId` instead of defaulting to the human operator.

## Notes

- the plugin installs its bundled Forge skill pack to `~/.hermes/skills/forge-hermes/` on first load if the user does not already have those files there
- remote write calls still need `FORGE_API_TOKEN` unless the target supports trusted local or Tailscale operator-session bootstrap
- the curated Forge tool names stay identical to the OpenClaw adapter so the operating model does not drift between agent platforms
