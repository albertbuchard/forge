# Forge

[GitHub Pages plugin site](https://albertbuchard.github.io/forge/)

Forge is a local-first life direction, execution, and reflection system with a full web UI, a Fastify API, and curated agent integrations for OpenClaw, Hermes, and Codex.

Forge gives the user and trusted agents one structured operating record for:

- life goals, projects, and Kanban tasks
- real timed work sessions and signed retrospective minute corrections
- linked Markdown notes
- XP, momentum, and weekly review
- Psyche records such as values, beliefs, patterns, modes, and trigger reports
- saved insights that can be accepted, applied, or dismissed

Project lifecycle is status-driven and shared across UI, API, and agent tools:

- `active` means the project is in play
- `paused` is the suspended state
- `completed` is the finished state
- setting a project to `completed` automatically closes linked unfinished tasks through the normal task-completion path
- project delete defaults to soft removal, with restore and hard delete available through the normal delete/bin flows

The repo contains the Forge app and API plus three agent-facing adapter surfaces:

- the Forge web app under `/forge/`
- the local Fastify API at `/api/v1/*`
- the published OpenClaw plugin under [`openclaw-plugin/`](./openclaw-plugin)
- the Hermes plugin package under [`plugins/forge-hermes/`](./plugins/forge-hermes)
- the repo-local Codex plugin under [`plugins/forge-codex/`](./plugins/forge-codex)

The agent plugins connect Forge to OpenClaw and Hermes while the web app and API remain the main workspace.

## Install Forge In OpenClaw

For most people, this is the important path.

Install the published plugin:

```bash
openclaw plugins install forge-openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
openclaw forge status
```

Then open `OpenClaw -> Agents`, select the agent you want to use with Forge,
and allow all tool cards under `forge-openclaw-plugin`. If the Forge plugin is
installed but those tool toggles stay off, the agent may act like it cannot
read Forge at all even though the runtime is healthy.

Why the `node -e ...` step is there:

- current OpenClaw builds can leave the plugin enabled but not present in `plugins.allow`
- if that happens, the plugin is installed but its entrypoint does not actually load
- the command above preserves the rest of the allow list and appends `forge-openclaw-plugin` if it is missing

For release-parity local development from this repo:

```bash
openclaw plugins install ./openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
openclaw forge status
```

The same tool-permission step still applies for repo-local installs: open
`OpenClaw -> Agents`, choose your agent, and allow every
`forge-openclaw-plugin` tool card.

## Install Forge In Hermes

Forge also ships a Hermes plugin that follows Hermes' native plugin layout and the
docs-recommended Python entry-point distribution model.

From this repo:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade ./plugins/forge-hermes
```

That installs the packaged Hermes plugin into Hermes' own runtime environment through
`pip` and creates a persisted config at
`~/.hermes/forge/config.json` automatically on first plugin load if it is missing.

The Hermes plugin uses the same curated Forge tool contract as the OpenClaw adapter and
installs a bundled Forge skill on first load. By default it stores its runtime data in
`~/.hermes/forge`, so local Hermes usage does not fall back to the repo root or
overwrite another Forge runtime accidentally.

The recommended target is Hermes' own runtime Python at
`~/.hermes/hermes-agent/venv/bin/python`. That keeps the plugin inside Hermes'
managed environment and lets Hermes discover Forge through the standard pip
entry-point path.

Default config behavior:

- origin defaults to `http://127.0.0.1`
- port defaults to `4317` but can auto-relocate to the next free local port when it is not explicitly pinned
- actor label defaults to `hermes`
- data root defaults to `~/.hermes/forge`

You can change the data folder or pin a different port by editing
`~/.hermes/forge/config.json`:

```json
{
  "dataRoot": "/absolute/path/to/forge-data"
}
```

If you want editable package mode while working on the Hermes adapter from this repo,
use:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable ./plugins/forge-hermes
```

For an actual Hermes release from the monorepo root, use:

```bash
../scripts/release-forge-hermes-plugin.sh patch
```

If you want Hermes and OpenClaw released together on one shared version, use:

```bash
../scripts/release-forge-agent-plugins.sh patch
```

Supported overrides:

- `FORGE_API_TOKEN`
- `FORGE_TIMEOUT_MS`
- `FORGE_DATA_ROOT`
- `FORGE_PORT`
- `FORGE_ORIGIN`
- `FORGE_ACTOR_LABEL`

When the target is local and Forge is not already running, the Hermes plugin reuses the
same packaged Forge local-runtime bootstrap path that OpenClaw ships. That means it
gets the same health checks, preferred-port memory, conflict detection, and data-root
mismatch protection without depending on repo-only imports once installed.

Forge now has three distinct work-accounting paths:

- live work uses task runs
- completion-style retroactive work uses `/api/v1/operator/log-work`
- signed minute corrections on existing tasks or projects use `/api/v1/work-adjustments`

Forge also now has a first-class calendar execution layer:

- Google Calendar, Apple Calendar, Exchange Online, and custom CalDAV connections
- native Forge calendar events that exist even without a provider connection
- mirrored external events plus a dedicated Forge calendar per connection
- Exchange Online uses Microsoft Graph and is currently read-only in Forge, with local Settings-managed Microsoft client ID, tenant, and redirect URI fields followed by a guided Microsoft sign-in flow instead of manual user-entered OAuth secrets
- canonical internal events with separate provider source mappings and Forge links
- recurring half-day work blocks such as Main Activity, Secondary Activity, Third Activity, Rest, or Custom
- task and project scheduling rules stored on the normal entity records
- future task timeboxes and live task-run to timebox synchronization
- blocked start protection with explicit override reasons when work must still begin

Normal local UI address:

- [http://127.0.0.1:4317/forge/](http://127.0.0.1:4317/forge/)

If `4317` is already occupied, the plugin-managed local runtime can move to the next free local port and remember that port for later runs.

If the agent refuses to tell you about Forge information, check the OpenClaw
agent tool page before debugging the runtime. The most common cause is that the
Forge plugin is installed and healthy, but the agent does not have the
`forge-openclaw-plugin` tools allowed in `OpenClaw -> Agents`.

## What The Plugin Gives You

The OpenClaw plugin exposes both runtime control and agent-facing checks:

```bash
openclaw forge health
openclaw forge overview
openclaw forge onboarding
openclaw forge ui
openclaw forge start
openclaw forge stop
openclaw forge restart
openclaw forge status
openclaw forge doctor
openclaw forge route-check
```

Important behavior:

- `start`, `stop`, `restart`, and `status` manage Forge when the runtime was auto-started by the plugin
- `doctor` checks plugin connectivity and curated route coverage
- `ui` prints the current Forge UI entrypoint
- `overview` and `onboarding` expose the current operator snapshot and the agent contract

## What Forge Includes Today

The current app surface in this repo includes:

- `Overview`: high-level control room for active work, streaks, rewards, and direction
- `Today`: daily execution surface
- `Kanban`: task board with task movement and work-start actions
- `Habits`: recurring commitments and recurring slips with explicit XP consequences, linked to goals, projects, tasks, values, patterns, behaviors, beliefs, modes, and trigger reports
- `Goals` and goal detail pages
- `Projects` and project detail pages
  Projects now default to the active collection, expose suspended/finished/all lifecycle filters, and support a tokenized search bar that mixes free text with goal, task, tag, status, and lightweight project-type chips.
- `Calendar`
  The calendar workspace is now display-first: the week view sits at the top, native Forge events and provider events appear beside Forge work blocks and timeboxes, drag-and-drop rescheduling stays available, and guided actions open modals for native events, work blocks, task scheduling rules, and task timeboxing.
- `Settings -> Calendar`
  Provider setup and connection management now live in Settings, with a guided connection flow plus a step-by-step setup guide for Google Calendar, Apple Calendar autodiscovery, Exchange Online through Microsoft Graph sign-in after local app-registration setup, and custom CalDAV.
- task detail pages with `Adjust work` for signed minute corrections
  Task detail now also exposes calendar scheduling rules, planned duration, and a live “allowed now / blocked now” calendar status.
- project detail pages now expose project-level scheduling defaults that tasks can inherit or override
- goal, project, and task creation flows that can attach linked Markdown creation notes inline
- `Notes`
- `Activity`
- `Insights`
- `Weekly Review` with a real one-click finalize flow that awards the review bonus exactly once per week and records the closure in the activity and reward ledgers
- `Settings`
- `Settings -> Calendar`
- `Settings -> Agents`
- `Settings -> Rewards`
  The rewards surface now includes an audited manual bonus workflow with validated entity selection across habits, goals, projects, tasks, and durable Psyche records.
- `Settings -> Bin`
- `Psyche`
- `Psyche -> Values`
- `Psyche -> Patterns`
- `Psyche -> Behaviors`
- `Psyche -> Reports`
- `Psyche -> Goal Map`
- `Psyche -> Schemas & Beliefs`
- `Psyche -> Modes`
- `Psyche -> Mode Guide`

The Psyche side is explicitly influenced by third-wave CBT, ACT, and schema-therapy-style work. It is meant to give the agent a durable place to store values, beliefs, modes, patterns, and trigger reports in a structured form instead of leaving them scattered in chat.

Time accounting is intentionally split by truth source:

- use live task runs when the work is happening now
- use `operator/log-work` when the work already happened and should be recorded as a finished work item
- use `work-adjustments` when a task or project already exists and only the tracked minutes need to be added or corrected

There is no separate top-level `/tasks` index route in the current app. Task navigation is detail-first from Today, Kanban, Projects, Goals, Overview, Activity, and Notes.

## Settings And Auth

Forge has settings and token management, but the current UI is not the older "Collaboration Settings" model.

What exists now:

- `Settings` for general runtime/profile preferences
- `Settings -> Calendar` for provider connections, setup guidance, and connection health
- `Settings -> Agents` for local agent token issuing, rotation, revocation, and onboarding guidance
- `Settings -> Rewards` for reward-rule configuration
- `Settings -> Bin` for restore and hard-delete flows

For localhost and Tailscale use, Forge can bootstrap an operator session automatically.

For explicit agent auth, Forge also supports managed bearer tokens through the settings and API layer:

- `GET /api/v1/settings`
- `PATCH /api/v1/settings`
- `POST /api/v1/settings/tokens`

If you need a new token, the current UI path is `Settings -> Agents`, not `Collaboration Settings`.

Calendar provider setup is documented in:

- [`docs/calendar-provider-setup.md`](./docs/calendar-provider-setup.md)

## Data And Logs

Typical data location:

- published plugin install: `~/.openclaw/extensions/forge-openclaw-plugin/data/forge.sqlite`
- repo-local plugin install: `<repo>/openclaw-plugin/data/forge.sqlite`
- repo app runtime: `<repo>/data/forge.sqlite`

If you want a different data root, set `dataRoot` in the plugin config and restart the gateway.

If the plugin-managed local runtime fails to start, check:

```text
~/.openclaw/logs/forge-openclaw-plugin/<host>-<port>.log
```

That log is the fastest place to catch port conflicts, dependency issues, or runtime crashes.

## Run Forge From The Repo Without OpenClaw

This is the secondary path.

Install dependencies:

```bash
npm install
```

Run the full local development setup:

```bash
npm run dev
```

That starts:

- the backend/runtime on `127.0.0.1:4317`
- the Vite frontend on `127.0.0.1:3027`

If you want the dev frontend to use the same `/forge/` base path as the built app:

```bash
FORGE_BASE_PATH=/forge/ npm run dev
```

Production-style local run:

```bash
npm run start
```

Useful URLs:

- built app: [http://127.0.0.1:4317/forge/](http://127.0.0.1:4317/forge/)
- API health: [http://127.0.0.1:4317/api/v1/health](http://127.0.0.1:4317/api/v1/health)
- OpenAPI: [http://127.0.0.1:4317/api/v1/openapi.json](http://127.0.0.1:4317/api/v1/openapi.json)
- Vite dev frontend: [http://127.0.0.1:3027](http://127.0.0.1:3027)

If you want the repo app to run against the OpenClaw plugin data folder directly:

```bash
npm run dev:openclaw-data
npm run start:openclaw-data
```

## Demo Data

Fresh runtimes stay empty by default. Forge does not invent personal goals, projects, tasks, or activity on startup.

If you want explicit showcase data in a fresh runtime:

```bash
FORGE_DATA_ROOT=/absolute/path/to/forge-demo npm run demo:seed
```

For the linked OpenClaw plugin data root:

```bash
npm run demo:seed:openclaw-data
```

## Useful Repo Commands

```bash
npm run check
npm run check:server
npm test
npm run test:server
npm run build:openclaw-plugin
npm run check:openclaw-plugin
```

## Related Docs

- [`openclaw-plugin/README.md`](openclaw-plugin/README.md)
- [`docs/openclaw-plugin.md`](docs/openclaw-plugin.md)
- [`plugins/forge-hermes/README.md`](plugins/forge-hermes/README.md)
- [`docs/hermes-plugin.md`](docs/hermes-plugin.md)
- [`docs/openclaw-plugin-release-checklist.md`](docs/openclaw-plugin-release-checklist.md)
- [`docs/public-repo-workflow.md`](docs/public-repo-workflow.md)
