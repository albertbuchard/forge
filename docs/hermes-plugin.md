# Forge Hermes Plugin

Forge ships a Hermes plugin alongside the published OpenClaw plugin.

## Project Management Workflow

Hermes should follow Forge's explicit planning hierarchy:

- Goal
- Strategy (high level)
- Project
- Strategy (lower level when useful)
- Issue
- Task
- Subtask

Projects are PRD-backed. Issues are vertical slices classified as `AFK` or `HITL`.
Issues and tasks can both preserve `executionMode` and `acceptanceCriteria` when the
delivery contract needs them. Tasks are one focused AI session each and should carry
direct `aiInstructions`. Subtasks stay lightweight and derive most of their detail
from `description`.

When Hermes helps close out completed work, it should preserve Forge's structured
completion contract:

`completionReport = { modifiedFiles[], workSummary, linkedGitRefIds[] }`

Hermes should assume direct commits to `main` by default and must not ask for
feature branches or pull requests unless the user explicitly wants them.

Hermes should also understand the current PM surface model:

- one mixed Kanban board for `project`, `issue`, `task`, and `subtask`
- one compact hierarchy view with shared search and filtering
- guided modal flows for create, edit, link, move, and closeout
- hierarchy-aware linking that can select or create a goal, project, issue, or parent
  work item from one search-first modal flow

The Hermes adapter now follows the native Hermes plugin guide structure end to end:

- `plugin.yaml`
- `__init__.py`
- `schemas.py`
- `tools.py`
- bundled plugin skills with native registration when supported
- `pyproject.toml` with a `hermes_agent.plugins` entry point
- session-boundary hooks that warm and clear one cached Forge overview per
  Hermes session, plus a `pre_llm_call` hook that injects that cached summary on
  every turn

Its job is to expose the same curated Forge operating surface as the OpenClaw plugin:

- operator overview and operator context
- live onboarding contract
- Psyche, XP, weekly review, and current-work reads
- batch search, create, update, delete, and restore
- explicit work adjustments, retroactive work logging, and task-run controls
- calendar overview, work-block creation, and task timeboxing helpers
- wiki memory reads, search, ingest, health checks, and page upserts
- sleep and sports overview reads plus reflective metadata updates on individual sessions
- visual handoff to the Forge UI when the UI is genuinely the better surface
- bundled Psyche interview playbooks so Hermes explores values, patterns, behaviors, beliefs, modes, and trigger reports with active listening before storing them

## Install

From the Forge repo:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip uninstall -y forge-hermes-plugin
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable ./plugins/forge-hermes
```

That does three things:

- installs the plugin into Hermes' own Python environment through `pip`
- keeps Hermes pointed at the local Forge dev folder in editable mode
- creates `~/.hermes/forge/config.json` automatically on first plugin load if it is missing
- loads Forge through the standard `hermes_agent.plugins` entry point on the next Hermes startup

Use Hermes' own runtime Python at `~/.hermes/hermes-agent/venv/bin/python` so the
plugin lives in the same environment Hermes actually runs.

If you want a non-editable install instead, use:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip uninstall -y forge-hermes-plugin
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade ./plugins/forge-hermes
```

The generated config file is also the durable user-editable settings surface for the
Hermes plugin. By default it points at the shared local Forge home at
`~/.forge`, so Hermes can collaborate with OpenClaw, Codex, and the browser
without extra per-adapter storage setup.

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
- actor label: blank, which means "inherit the trusted local operator label when available"
- timeout: `15000`
- data root: `~/.forge`

If you want to move the data elsewhere, edit `~/.hermes/forge/config.json`:

```json
{
  "dataRoot": "/absolute/path/to/forge-data"
}
```

For a real release, the recommended prep flow from a clean checkout on `main` is:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release-forge-hermes-plugin.sh patch
```

That script bumps the Hermes plugin version in `plugin.yaml` and
`forge_hermes/version.py`, bundles the runtime payload, builds a wheel and sdist, runs
the Forge + Hermes verification suite, smoke-installs the wheel into a temporary
virtualenv, commits the nested Forge repo, and pushes a Hermes-specific git tag such as
`hermes-v0.2.19`. The `.github/workflows/release-hermes-plugin.yml` workflow then
builds the release artifacts from that tag and publishes them to PyPI through Trusted
Publishing.

One-time PyPI setup for CI:

- configure the `forge-hermes-plugin` project on PyPI with this GitHub repository as a
  trusted publisher
- leave the publish job on a GitHub-hosted Linux runner, which is the supported path
  for `pypa/gh-action-pypi-publish`

For the full cross-registry release reference, including tag names and GitHub secret
names, use `docs/release-cheat-sheet.md`.

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

The plugin also uses Hermes' documented session hooks to warm one compact Forge
summary when a session starts, then injects that cached summary through
`pre_llm_call` on every turn. That matches Hermes' actual hook contract:
`on_session_start` can initialize session state, while `pre_llm_call` is the
only general-plugin hook that can inject context into the active turn. Telegram
therefore gets Forge overview and current-work context before the tool loop
starts on a fresh `/new`, and later turns keep the same cached grounding
without refetching a brand-new overview from Forge.

The same session hooks now also register Hermes sessions into Forge's live
agent-session registry. Forge can therefore keep a provider-aware session list,
mark Hermes sessions stale when they stop heartbeating, preserve a short event
timeline, and show reconnect guidance directly in `Settings -> Agents`.

## Shared Multi-user Setup

Hermes works well as one participant in a shared Forge system, but the shared
runtime needs to be intentional.

If Hermes and OpenClaw are meant to see the same users, strategies, tasks, and
notes:

- point both at the same `origin`
- point both at the same `port`
- point both at the same `dataRoot` when using a local runtime, or simply leave the default `~/.forge`
- leave `actorLabel` blank when Hermes should inherit the local operator
- set `actorLabel` only when Hermes or a spawned sub-agent should act as a specific bot

Forge's multi-user model is explicit:

- every user is `human` or `bot`
- writes should set `userId` intentionally
- reads can scope with `userId` or repeated `userIds`
- cross-user links are valid

Forge's newer wiki and health surfaces follow the same rule:

- wiki pages live in the same shared Forge memory system and should use the dedicated wiki tools, not the generic entity batch routes
- sleep and sports sessions stay linkable across human and bot-owned goals, projects, habits, notes, and Psyche records
- the sports UI route is `/sports`, but the backend overview route remains `/api/v1/health/fitness`
- Hermes' curated route surface now mirrors the dedicated wiki and health APIs directly: `/api/v1/wiki/settings`, `/api/v1/wiki/pages`, `/api/v1/wiki/pages/:id`, `/api/v1/wiki/search`, `/api/v1/wiki/health`, `/api/v1/wiki/sync`, `/api/v1/wiki/reindex`, `/api/v1/wiki/ingest-jobs`, `/api/v1/health/sleep`, `/api/v1/health/sleep/:id`, `/api/v1/health/fitness`, and `/api/v1/health/workouts/:id`

If Hermes is meant to operate as its own bot user inside that shared runtime,
create that bot in `Settings -> Users` and write records with that bot's
`userId` instead of defaulting to the human operator.

## Bundled skills

The current Forge Hermes plugin now prefers the newer Hermes plugin-skill model:

- if the runtime exposes `ctx.register_skill(...)`, Forge registers its bundled
  skills natively as plugin skills
- if the runtime is older and does not expose that method yet, Forge falls back
  to copying the skill bundle into `~/.hermes/skills/forge-hermes/`

That keeps installs smooth on current Hermes builds while matching the newer
plugin guidance as closely as possible.

## Notes

- bundled skills use native plugin registration when available and only use `~/.hermes/skills/forge-hermes/` as a compatibility fallback
- remote write calls still need `FORGE_API_TOKEN` unless the target supports trusted local or Tailscale operator-session bootstrap
- the curated Forge tool names stay identical to the OpenClaw adapter so the operating model does not drift between agent platforms
