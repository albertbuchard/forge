# Forge Hermes Plugin

Hermes plugin for Forge.

This plugin follows the Hermes plugin guide directly:

- a Python package with a `hermes_agent.plugins` entry point for pip discovery
- a Hermes plugin manifest and registration module that expose Forge to Hermes
- bundled Forge runtime assets so Hermes can start Forge safely without repo-only runtime imports

It exposes the same curated Forge contract as the OpenClaw adapter, but through Hermes' Python plugin system.

## Install

From the Forge repo:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade ./plugins/forge-hermes
```

That installs the package into Hermes' own Python environment through `pip`, creates
`~/.hermes/forge/config.json` automatically on first plugin load if it is missing, and defaults the Forge runtime data root to
`~/.hermes/forge` so local Hermes usage does not write into the repo root.

Use `~/.hermes/hermes-agent/venv/bin/python` so the package lands in the Python
environment Hermes actually runs and Hermes can discover Forge through the package
entry point on the next startup.

If you want editable package mode while developing from this repo:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable ./plugins/forge-hermes
```

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

- the recommended install path is now pip-based Hermes entry-point discovery, not the old folder-plugin symlink
- edit `~/.hermes/forge/config.json` if you want to move the data root or pin a different local port
- the bundled skill is installed automatically on first plugin load if `~/.hermes/skills/forge-hermes/SKILL.md` does not already exist
