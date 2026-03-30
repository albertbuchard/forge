# Forge

[GitHub Pages plugin site](https://albertbuchard.github.io/forge/)

Forge is a local-first life direction, execution, and reflection system with a full web UI, a Fastify API, and an OpenClaw plugin.

Forge gives the user and trusted agents one structured operating record for:

- life goals, projects, and Kanban tasks
- real timed work sessions
- linked Markdown notes
- XP, momentum, and weekly review
- Psyche records such as values, beliefs, patterns, modes, and trigger reports
- saved insights that can be accepted, applied, or dismissed

The repo contains three connected runtime surfaces:

- the Forge web app under `/forge/`
- the local Fastify API at `/api/v1/*`
- the OpenClaw plugin that exposes the curated agent-facing contract

The OpenClaw plugin complements the core product. It is not the whole product.

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

Normal local UI address:

- [http://127.0.0.1:4317/forge/](http://127.0.0.1:4317/forge/)

If `4317` is already occupied, the plugin-managed local runtime can move to the next free local port and remember that port for later runs.

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
- task detail pages
- `Notes`
- `Activity`
- `Insights`
- `Weekly Review`
- `Settings`
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

There is no separate top-level `/tasks` index route in the current app. Task navigation is detail-first from Today, Kanban, Projects, Goals, Overview, Activity, and Notes.

## Settings And Auth

Forge has settings and token management, but the current UI is not the older "Collaboration Settings" model.

What exists now:

- `Settings` for general runtime/profile preferences
- `Settings -> Agents` for local agent token issuing, rotation, revocation, and onboarding guidance
- `Settings -> Rewards` for reward-rule configuration
- `Settings -> Bin` for restore and hard-delete flows

For localhost and Tailscale use, Forge can bootstrap an operator session automatically.

For explicit agent auth, Forge also supports managed bearer tokens through the settings and API layer:

- `GET /api/v1/settings`
- `PATCH /api/v1/settings`
- `POST /api/v1/settings/tokens`

If you need a new token, the current UI path is `Settings -> Agents`, not `Collaboration Settings`.

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
- [`docs/openclaw-plugin-release-checklist.md`](docs/openclaw-plugin-release-checklist.md)
- [`docs/public-repo-workflow.md`](docs/public-repo-workflow.md)
