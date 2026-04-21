# Forge

[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=06121c)](https://react.dev/)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-ffc131?logo=tauri&logoColor=1f2937)](https://tauri.app/)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6ba539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-8ab4ff)](https://albertbuchard.github.io/forge/)

Forge is a local-first operating system for planning, execution, memory, health, and agent collaboration.

It brings the web app, API, SQLite runtime, file-backed wiki, OpenClaw adapter, Hermes adapter, Codex adapter, and iPhone companion into one shared system instead of splitting your work and context across disconnected tools.

Built with React 19, TypeScript 5.8, Vite 6, Fastify 5, SQLite, OpenAPI 3.1, Tauri 2, and a native iPhone companion.

## Getting Started

### OpenClaw

```bash
openclaw plugins install forge-openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
```

If the plugin installs but does not load, the usual missing step is `plugins.allow`. I re-verified on April 21, 2026 that OpenClaw `2026.4.15` still blocks the normal install path, so keep using the fallback flow in the [Integrations guide](https://albertbuchard.github.io/forge/integrations.html#openclaw) when `plugins install` is rejected by the scanner.

### Run Forge Locally

```bash
npm install
npm run dev
```

Primary local addresses:

- Web app: `http://127.0.0.1:4317/forge/`
- API: `http://127.0.0.1:4317/api/v1/`
- OpenAPI: `http://127.0.0.1:4317/api/v1/openapi.json`

In development, Vite may run on `3027`, but Forge should still be accessed through the backend mount on `4317`.

### Hermes And Codex

- Hermes install: `~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade ./plugins/forge-hermes`
- Codex install and MCP setup: [Integrations guide](https://albertbuchard.github.io/forge/integrations.html#codex)

## Documentation

- Docs home: [albertbuchard.github.io/forge](https://albertbuchard.github.io/forge/)
- Features: [albertbuchard.github.io/forge/features.html](https://albertbuchard.github.io/forge/features.html)
- Engineering: [albertbuchard.github.io/forge/engineering.html](https://albertbuchard.github.io/forge/engineering.html)
- Development: [albertbuchard.github.io/forge/development.html](https://albertbuchard.github.io/forge/development.html)
- Integrations: [albertbuchard.github.io/forge/integrations.html](https://albertbuchard.github.io/forge/integrations.html)
- API reference: [albertbuchard.github.io/forge/api/](https://albertbuchard.github.io/forge/api/)
- Support: [albertbuchard.github.io/forge/support.html](https://albertbuchard.github.io/forge/support.html)
- Repo docs: [`docs/`](./docs)

## What Forge Covers

- planning and execution with projects, issues, tasks, task runs, and habits
- notes, wiki memory, search, ingest, and long-form linked context
- preferences, reflective models, and structured Psyche records
- sleep, workouts, movement history, and iPhone HealthKit import
- multi-user collaboration across humans and bots
- OpenClaw, Hermes, Codex, browser, and mobile surfaces on one runtime

## Screenshots

| Surface | Screenshot |
| --- | --- |
| Overview | ![Forge overview dashboard](./openclaw-plugin/docs/assets/forge-overview-dashboard.png) |
| Execution board | ![Forge Kanban board](./openclaw-plugin/docs/assets/forge-kanban-board.png) |
| Knowledge and memory | ![Forge wiki memory](./openclaw-plugin/docs/assets/forge-wiki-memory.png) |
| Sleep and health | ![Forge sleep overview](./openclaw-plugin/docs/assets/forge-sleep-overview.png) |

More product screenshots live in the [Features guide](https://albertbuchard.github.io/forge/features.html) and the [Docs home](https://albertbuchard.github.io/forge/).

## For Contributors

```bash
npx tsc --noEmit
npm run test
npm run test:server
```

Contributor and runtime details live in the [Development guide](https://albertbuchard.github.io/forge/development.html) and [Engineering reference](https://albertbuchard.github.io/forge/engineering.html). The publishable OpenClaw package lives in [`openclaw-plugin/`](./openclaw-plugin), the Hermes adapter in [`plugins/forge-hermes/`](./plugins/forge-hermes), and the Codex adapter in [`plugins/forge-codex/`](./plugins/forge-codex).
