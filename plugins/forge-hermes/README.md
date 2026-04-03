# Forge Hermes Plugin

Repo-local Hermes plugin for Forge.

This plugin follows the Hermes plugin layout directly: `plugin.yaml`, `__init__.py`, `schemas.py`, `tools.py`, and a bundled `skill.md`.

It exposes the same curated Forge contract as the OpenClaw adapter, but through Hermes' Python plugin system.

## Install

From the Forge repo:

```bash
npm install
./plugins/forge-hermes/scripts/install.sh
```

That creates a symlink at `~/.hermes/plugins/forge` pointing to this repo-local plugin folder.
It also creates `~/.hermes/forge/config.json` and defaults the Forge runtime data root
to `~/.hermes/forge` so local Hermes usage does not write into the repo root.

## Runtime behavior

- defaults to `FORGE_ORIGIN=http://127.0.0.1` and `FORGE_PORT=4317`
- defaults `FORGE_ACTOR_LABEL` to `hermes`
- defaults `FORGE_DATA_ROOT` to `~/.hermes/forge`
- supports `FORGE_API_TOKEN` for remote or explicitly scoped access
- supports `FORGE_DATA_ROOT` when you want Forge to use a specific local data folder
- when Forge is local and not already running, the plugin calls the repo's tested Forge local-runtime bootstrap helper instead of maintaining a separate startup implementation
- when port `4317` is busy and not explicitly pinned, the shared runtime helper can move Forge to the next free localhost port and remember that preferred port
- if another Forge runtime is already serving the wrong storage root, startup fails loudly instead of attaching to the wrong database

## Environment variables

- `FORGE_ORIGIN`
- `FORGE_PORT`
- `FORGE_API_TOKEN`
- `FORGE_ACTOR_LABEL`
- `FORGE_TIMEOUT_MS`
- `FORGE_DATA_ROOT`

## Notes

- the plugin is intentionally repo-local today, so the recommended install path is a symlink, not a detached copy
- edit `~/.hermes/forge/config.json` if you want to move the data root or pin a different local port
- the installer also supports `--data-root`, `--port`, `--origin`, `--actor-label`, `--api-token`, and `--timeout-ms`
- the bundled skill is installed automatically on first plugin load if `~/.hermes/skills/forge-hermes/SKILL.md` does not already exist
