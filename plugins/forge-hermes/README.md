# Forge Hermes Plugin

Hermes plugin for Forge.

This plugin follows the Hermes plugin guide directly:

- a Python package with a `hermes_agent.plugins` entry point for pip discovery
- a Hermes plugin manifest and registration module that expose Forge to Hermes
- bundled Forge runtime assets so Hermes can start Forge safely without repo-only runtime imports

It exposes the same curated Forge contract as the OpenClaw adapter, but through Hermes' Python plugin system.
It also bundles a Psyche interview playbook pack so Hermes can explore values,
patterns, behaviors, beliefs, modes, and trigger reports with active listening before
persisting them.
It now also exposes the first-class Preferences surface, including the
summary-first workspace read, the comparison-game starter, editable concept
lists, contextual profile slices, direct signals, and exact score overrides.
It also exposes Forge's wiki memory surface plus the sleep and sports review
models, so Hermes can inspect recent nights, review workout context, enrich
health sessions with reflective links, and work with file-first wiki pages.
It also exposes a dedicated `forge_get_doctor` diagnostic tool for runtime and
config-file health checks.

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
- defaults `FORGE_ACTOR_LABEL` to `aurel (hermes)`
- defaults `FORGE_DATA_ROOT` to `~/.hermes/forge`
- supports `FORGE_API_TOKEN` for remote or explicitly scoped access
- supports `FORGE_DATA_ROOT` when you want Forge to use a specific local data folder
- when Forge is local and not already running, the plugin calls the repo's tested Forge local-runtime bootstrap helper instead of maintaining a separate startup implementation
- the stable local web entrypoint stays `http://127.0.0.1:4317/forge/`; if the shared runtime is in dev mode it can supervise the Vite frontend behind that same URL instead of exposing `3027` directly
- when port `4317` is busy and not explicitly pinned, the shared runtime helper can move Forge to the next free localhost port and remember that preferred port
- if another Forge runtime is already serving the wrong storage root, startup fails loudly instead of attaching to the wrong database

## Doctor And forge.json

Hermes now reaches the same doctor surface through `forge_get_doctor`.

That doctor output covers:

- backend health and watchdog status
- the resolved Forge storage root, data directory, and database path
- `forge.json` validity, sync state, parse errors, and applied override keys
- onboarding and overview reachability from the Hermes adapter

Forge also maintains a runtime settings mirror at `<FORGE_DATA_ROOT>/forge.json`.
This is not the same file as the Hermes plugin config at `~/.hermes/forge/config.json`.

The split is intentional:

- `~/.hermes/forge/config.json` configures the Hermes adapter itself
- `<FORGE_DATA_ROOT>/forge.json` configures Forge runtime settings and mirrors the effective state

Behavior:

- Forge exports `forge.json` on startup when it is missing
- valid settings in `forge.json` override persisted DB values
- after applying precedence, Forge rewrites the file as a full snapshot
- UI and API settings changes also rewrite `forge.json`, so the file, DB, and UI stay aligned

## Shared Multi-user Forge

This plugin can participate in one shared Forge system with OpenClaw, Codex,
and the browser UI, but the runtime target needs to be aligned deliberately.

If you want Hermes to share the same Forge users and records:

- use the same `FORGE_ORIGIN`
- use the same `FORGE_PORT`
- use the same `FORGE_DATA_ROOT` for local shared storage
- give Hermes its own `FORGE_ACTOR_LABEL`, ideally a human-readable label such as `Albert (hermes)`

Forge's ownership model is explicit:

- users are typed as `human` or `bot`
- entity writes should set `userId` intentionally
- reads can use one `userId` or several `userIds`
- cross-user links are allowed

That is what lets a Hermes bot own its own tasks or strategies while still
supporting human-owned goals and projects in the same Forge runtime.

## Preferences Workspace

Forge Preferences is a first-class domain, not a hidden recommendation layer.
Hermes can now:

- read the full workspace with `forge_get_preferences_workspace`
- start the comparison flow with `forge_start_preferences_game`
- create, update, and delete `preference_catalog`, `preference_catalog_item`,
  `preference_context`, and `preference_item` through the same batch entity
  routes as other Forge entities
- merge contextual profiles with the dedicated action route when two contexts
  should collapse into one
- enqueue Forge entities directly into a preference domain
- submit pairwise judgments and direct signals
- override inferred scores when the user wants an explicit correction

This matches the current Forge UI:

- the `/preferences` landing page leads with what Forge already knows
- the comparison flow is a modal "Start the game" experience
- Forge-native domains can auto-seed from real Forge entities
- broader taste domains can seed from editable concept libraries such as food,
  activities, places, countries, fashion, people, media, and tools

## Wiki, Sleep, And Sports

Hermes now ships the same explicit coverage for these newer Forge surfaces:

- Wiki: `forge_get_wiki_settings`, `forge_list_wiki_pages`, `forge_get_wiki_page`, `forge_search_wiki`, `forge_upsert_wiki_page`, `forge_get_wiki_health`, `forge_sync_wiki_vault`, `forge_reindex_wiki_embeddings`, `forge_ingest_wiki_source`
- Sleep: `forge_get_sleep_overview`, `forge_update_sleep_session`
- Sports: `forge_get_sports_overview`, `forge_update_workout_session`

This matters because sleep and sports are not generic notes or tasks, and wiki
pages are not normal batch entities. Hermes uses the dedicated routes so the
health surfaces, markdown vault, backlinks, and metadata index stay aligned.

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
- the bundled skill pack is installed automatically on first plugin load under `~/.hermes/skills/forge-hermes/` if those files do not already exist
