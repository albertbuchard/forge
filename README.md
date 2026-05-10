# Forge

[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=06121c)](https://react.dev/)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-ffc131?logo=tauri&logoColor=1f2937)](https://tauri.app/)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6ba539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-8ab4ff)](https://albertbuchard.github.io/forge/)

Forge is a local-first workspace for planning, execution, memory, health context, and agent collaboration.

![Forge overview dashboard](./openclaw-plugin/docs/assets/forge-overview-dashboard.png)

It gives you one place to:

- turn goals into strategies, projects, issues, tasks, and subtasks
- run a mixed Kanban board and a compact hierarchy view
- keep notes, wiki pages, preferences, Psyche records, sleep, workouts, and movement context beside the work they explain
- let OpenClaw, Hermes, Codex, the browser app, and the iPhone companion use the same local Forge runtime
- keep the database local by default, with optional explicit data folders and backups in `Settings -> Data`

Forge is built with React 19, TypeScript 5.x, Vite 6, Tailwind CSS 4, Fastify 5, SQLite, generated OpenAPI, Tauri 2, OpenClaw, Hermes, Codex MCP, and a Swift iPhone companion.

## Start Here

### Install Forge

The preferred install for everyone is the guided CLI:

```bash
npx forge-memory
```

`forge-memory` always installs the local Forge UI/runtime first. In the same guided flow it discovers OpenClaw, Hermes, and Codex in the background, shows those host adapters in a checkbox menu, selects detected adapters by default, leaves missing adapters as disabled `not found` rows, lets Space toggle adapter rows, and can pair the iOS companion at the end.

Development installs use the same flow, but link adapters to this source checkout and default to the real shared Forge data folder:

```bash
npx forge-memory --dev
```

After install, reopen the full configuration flow with current settings as defaults:

```bash
npx forge-memory configure
```

Useful runtime commands:

```bash
npx forge-memory status
npx forge-memory doctor
npx forge-memory ui
npx forge-memory restart
npx forge-memory pair-ios
```

After install, the usual local addresses are:

- Web app: `http://127.0.0.1:4317/forge/`
- API: `http://127.0.0.1:4317/api/v1/`
- OpenAPI: `http://127.0.0.1:4317/api/v1/openapi.json`

Manual OpenClaw, Hermes, and Codex setup still exists for advanced cases in [`docs/openclaw-plugin.md`](./docs/openclaw-plugin.md), [`docs/hermes-plugin.md`](./docs/hermes-plugin.md), and [`plugins/forge-codex/README.md`](./plugins/forge-codex/README.md).

### Run The Source App Locally

Use this when you are developing Forge itself.

```bash
npm install
npm run dev
```

Open Forge through the backend URL:

```text
http://127.0.0.1:4317/forge/
```

Vite may also run on `3027` during development, but the stable app entrypoint is still the backend mount on `4317`.

### Install The Local OpenClaw Plugin While Developing

This is an advanced adapter-only path. Prefer `npx forge-memory --dev` unless you are specifically debugging OpenClaw's plugin installer.

From the Forge repo root:

```bash
openclaw plugins install --link --dangerously-force-unsafe-install ./openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
openclaw gateway restart
openclaw plugins inspect forge-openclaw-plugin --runtime
openclaw forge health
```

Use `--link` when you want OpenClaw to use this checkout directly. Omit `--link` when you want to test a copied package install.

### Hermes

This is an advanced adapter-only path. Prefer `npx forge-memory` for released installs and `npx forge-memory --dev` for source-backed installs.

Use the published PyPI package when you want Hermes to load the released plugin:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade pip
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade forge-hermes-plugin
```

Use this from the Forge repo instead when you want Hermes to follow local source edits:

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade pip
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable ./plugins/forge-hermes
```

### Codex

This is an advanced MCP-only path. Prefer `npx forge-memory`, which writes the Forge MCP entry through its guided configuration flow.

Codex uses the Forge MCP bridge from this repo:

```bash
codex mcp add forge \
  --env FORGE_ORIGIN=http://127.0.0.1 \
  --env FORGE_PORT=4317 \
  --env FORGE_ACTOR_LABEL=codex \
  --env FORGE_TIMEOUT_MS=15000 \
  -- /bin/zsh /absolute/path/to/forge/plugins/forge-codex/scripts/run-mcp.sh
codex mcp list
```

## What Forge Covers

- planning and execution: goals, strategies, projects, issues, tasks, subtasks, task runs, and habits
- memory: notes, wiki pages, search, ingest, backlinks, and linked Forge context
- reflection: preferences, Psyche values, behavior patterns, beliefs, modes, and trigger reports
- health: sleep nights, workouts, movement history, and iPhone HealthKit import
- collaboration: explicit human and bot users, owner/assignee filters, agent sessions, and audited actions
- progress: XP, levels, streaks, trophies, optional downloadable art packs, and local reward history

## Data Location And Backups

By default, local plugin installs store Forge data under `~/.forge`. You can choose another folder by setting `dataRoot` in the plugin config or by using `Settings -> Data` in the web app.

If OpenClaw, Hermes, Codex, and the browser should share one Forge system, point them at the same origin, port, and data root. Before moving or merging data folders, back up every candidate `forge.sqlite` and verify which database the live runtime has opened.

## Screenshots

| Surface | Screenshot |
| --- | --- |
| Projects | ![Forge projects board](./openclaw-plugin/docs/assets/forge-projects-board.png) |
| Execution board | ![Forge Kanban board](./openclaw-plugin/docs/assets/forge-kanban-board.png) |
| Knowledge and memory | ![Forge wiki memory](./openclaw-plugin/docs/assets/forge-wiki-memory.png) |
| Sleep and health | ![Forge sleep overview](./openclaw-plugin/docs/assets/forge-sleep-overview.png) |

## Documentation

- Docs home: [albertbuchard.github.io/forge](https://albertbuchard.github.io/forge/)
- Features: [albertbuchard.github.io/forge/features.html](https://albertbuchard.github.io/forge/features.html)
- Integrations: [albertbuchard.github.io/forge/integrations.html](https://albertbuchard.github.io/forge/integrations.html)
- API reference: [albertbuchard.github.io/forge/api/](https://albertbuchard.github.io/forge/api/)
- Repo docs: [`docs/`](./docs)

## Contributor Checks

```bash
npx tsc --noEmit
npm run test
npm run test:server
```

Contributor and runtime details live in the [Development guide](https://albertbuchard.github.io/forge/development.html) and [Engineering reference](https://albertbuchard.github.io/forge/engineering.html). The publishable OpenClaw package lives in [`openclaw-plugin/`](./openclaw-plugin), the Hermes adapter in [`plugins/forge-hermes/`](./plugins/forge-hermes), and the Codex adapter in [`plugins/forge-codex/`](./plugins/forge-codex).
