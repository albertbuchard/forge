# Forge

[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=06121c)](https://react.dev/)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-ffc131?logo=tauri&logoColor=1f2937)](https://tauri.app/)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6ba539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-8ab4ff)](https://albertbuchard.github.io/forge/)

Forge is a local-first execution, planning, memory, health, and reflection system.
The repo contains the React web app, the Fastify API, the SQLite-backed runtime, the
file-first wiki layer, the OpenClaw and Hermes adapter packages, the Codex adapter,
and the iPhone companion.

## Getting Started

### OpenClaw

```bash
openclaw plugins install forge-openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
```

If the plugin installs but does not load, the missing piece is usually the
`plugins.allow` entry in `openclaw.json`.

Temporary bypass for some OpenClaw `2026.4.x` builds:

```bash
npm install -g forge-openclaw-plugin
node -e 'const cp=require("child_process"); const fs=require("fs"); const path=require("path"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); const pluginPath=path.join(cp.execSync("npm root -g",{encoding:"utf8"}).trim(),"forge-openclaw-plugin"); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); j.plugins.load ??= {}; j.plugins.load.paths = Array.from(new Set([...(j.plugins.load.paths || []), pluginPath])); j.plugins.entries ??= {}; j.plugins.entries["forge-openclaw-plugin"] = { enabled: true, config: { origin: "http://127.0.0.1", port: 4317, actorLabel: "aurel", timeoutMs: 15000 } }; fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n"); console.log("Configured", pluginPath);'
openclaw gateway restart
openclaw plugins info forge-openclaw-plugin
openclaw forge health
```

### Hermes

```bash
~/.hermes/hermes-agent/venv/bin/python -m ensurepip --upgrade
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade ./plugins/forge-hermes
```

### Standalone

```bash
npm install
npm run dev
```

Default local runtime addresses:

- UI: `http://127.0.0.1:4317/forge/`
- Vite dev frontend: `http://127.0.0.1:3027/forge/`
- API: `http://127.0.0.1:4317/api/v1/`
- OpenAPI: `http://127.0.0.1:4317/api/v1/openapi.json`

Forge should always be served through the backend on `4317`. In development, the
backend can proxy and autostart the hot-reloading Vite frontend on `3027`, but
shared routes such as Tailscale `/forge` should still point to
`http://127.0.0.1:4317/forge/`, not directly to the dev server.

When Forge runs inside this monorepo, the local runtime prefers the shared tracked
data root at `/Users/omarclaw/Documents/aurel-monorepo/data/forge` when it exists.
The canonical SQLite path inside a configured `dataRoot` is `forge.sqlite`, so this
monorepo default resolves to `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite`.
Set `FORGE_DATA_ROOT` or an explicit plugin `dataRoot` if you want another store.

## Table Of Contents

- [Documentation](#documentation)
- [What Forge Includes](#what-forge-includes)
- [Current Stack](#current-stack)
- [Runtime Surfaces](#runtime-surfaces)
- [Forge.json Config](#forgejson-config)
- [Repository Layout](#repository-layout)
- [Development](#development)
- [Verification](#verification)
- [Integration Notes](#integration-notes)

## Documentation

- GitHub Pages docs: [albertbuchard.github.io/forge](https://albertbuchard.github.io/forge/)
- API reference: [albertbuchard.github.io/forge/api/](https://albertbuchard.github.io/forge/api/)
- Engineering reference: [albertbuchard.github.io/forge/engineering.html](https://albertbuchard.github.io/forge/engineering.html)
- Development guide: [albertbuchard.github.io/forge/development.html](https://albertbuchard.github.io/forge/development.html)
- Integration guide: [albertbuchard.github.io/forge/integrations.html](https://albertbuchard.github.io/forge/integrations.html)
- Raw OpenAPI spec on Pages: [albertbuchard.github.io/forge/api/openapi.json](https://albertbuchard.github.io/forge/api/openapi.json)
- Repo guides: [`docs/`](./docs)

## What Forge Includes

- goals, projects, tasks, habits, strategies, and timed task runs
- a file-first wiki with search, ingest, health checks, and page-backed memory
- notes as first-class Markdown evidence records
- preferences with pairwise judgments, direct signals, and concept libraries
- Psyche entities such as values, beliefs, patterns, modes, reports, and questionnaires
- sleep and workout records linked back to Forge context
- explicit multi-user ownership across human and bot users
- OpenClaw, Hermes, and Codex adapter surfaces on top of the same runtime
- an iPhone companion for pairing and HealthKit import

![Forge overview](./openclaw-plugin/docs/assets/forge-overview-dashboard.png)

## Feature Gallery

Forge's web app has dedicated operational surfaces for execution, movement, and health,
not just a single dashboard shell.

| Surface | Screenshot |
| --- | --- |
| Kanban board | ![Forge Kanban board](./openclaw-plugin/docs/assets/forge-kanban-board.png) |
| Movement timeline | ![Forge Movement life timeline](./openclaw-plugin/docs/assets/forge-movement-life-timeline.png) |
| Sleep overview | ![Forge Sleep overview](./openclaw-plugin/docs/assets/forge-sleep-overview.png) |

Regenerate the docs screenshots against a running local Forge runtime with:

```bash
npm run media:web:docs-screenshots
```

## Current Stack

| Layer            | Stack                                            | Notes                                                 |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------- |
| Web UI           | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4 | Main app served under `/forge/`                       |
| Backend          | Fastify 5, TypeScript, generated OpenAPI 3.1     | Main API served under `/api/v1/`                      |
| Storage          | SQLite + file-backed wiki storage                | Local-first canonical store                           |
| Desktop / native | Tauri 2 + Swift iOS companion                    | Desktop shell and HealthKit path                      |
| Packages         | OpenClaw plugin, Hermes plugin, Codex adapter    | Shared runtime model across agent hosts               |
| Docs             | GitHub Pages + rendered OpenAPI reference        | Pages artifact includes engineering docs and API docs |

## Runtime Surfaces

- Web app: `/forge/`
- API root: `/api/v1/`
- OpenAPI JSON: `/api/v1/openapi.json`
- Doctor diagnostics: `/api/v1/doctor`
- Wiki routes: `/api/v1/wiki/*`
- Preferences routes: `/api/v1/preferences/*`
- Psyche routes: `/api/v1/psyche/*`
- Questionnaires: `/api/v1/psyche/questionnaires` and `/api/v1/psyche/questionnaire-runs/*`
- Health surfaces: `/api/v1/health/sleep`, `/api/v1/health/fitness`

The agent adapters intentionally expose a curated surface on top of this runtime
instead of mirroring every internal route one to one.

## Forge.json Config

Forge now keeps a runtime-level settings mirror at:

```text
<dataRoot>/forge.json
```

Examples:

- monorepo default: `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.json`
- Hermes default: `~/.hermes/forge/forge.json`
- OpenClaw with explicit plugin `dataRoot`: `<that dataRoot>/forge.json`

This file is part of the Forge runtime, not part of a specific adapter. If OpenClaw, Hermes, Codex, and the browser UI point at the same Forge `dataRoot`, they will all read and write the same `forge.json` and `forge.sqlite`.

Behavior:

- on startup, if `forge.json` is missing, Forge exports the current effective settings into it
- on every UI or API settings change, Forge updates the database and immediately rewrites `forge.json`
- on token and model-connection changes, Forge also rewrites `forge.json`
- on reads, valid settings present in `forge.json` take precedence over the persisted database values
- after precedence is applied, Forge rewrites the file as a full mirrored snapshot so the file, DB, and UI converge again

Important nuance:

- Forge mirrors the full settings payload into `forge.json`, including derived and operational fields such as integrity score, token lists, and active sessions
- only writable settings are honored as file overrides on startup and reads
- read-only or derived fields in `forge.json` are treated as mirrored output, not authoritative input

If `forge.json` is invalid JSON or fails schema validation:

- Forge does not apply file precedence
- Forge keeps serving the database-backed settings
- `/api/v1/doctor`, `openclaw forge doctor`, `forge_get_doctor`, and `npm run doctor` report the invalid file and the path that needs repair

Minimal example:

```json
{
  "profile": {
    "operatorName": "Albert"
  },
  "execution": {
    "maxActiveTasks": 3,
    "timeAccountingMode": "parallel"
  },
  "themePreference": "solar",
  "localePreference": "en"
}
```

The file may be partial, but Forge will rewrite it as a full snapshot after the next successful load.

Do not confuse this with adapter config files:

- Hermes plugin config lives at `~/.hermes/forge/config.json` and tells Hermes how to reach Forge
- OpenClaw plugin config lives in `~/.openclaw/openclaw.json` and tells OpenClaw how to reach Forge
- `forge.json` lives inside the Forge `dataRoot` and controls Forge runtime settings themselves

Useful diagnostics:

```bash
openclaw forge doctor
npm run doctor
~/.hermes/hermes-agent/venv/bin/python - <<'PY'
from forge_hermes.tools import build_handler
print(build_handler("forge_get_doctor")({}))
PY
```

## Repository Layout

| Path                                              | Purpose                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| [`src/`](./src)                                   | React app routes, components, page logic, and shared frontend libraries    |
| [`server/src/`](./server/src)                     | Fastify app, repositories, platform managers, OpenAPI generator, and tests |
| [`docs/`](./docs)                                 | Longer engineering guides kept as Markdown                                 |
| [`openclaw-plugin/`](./openclaw-plugin)           | Published OpenClaw package and GitHub Pages artifact                       |
| [`plugins/forge-hermes/`](./plugins/forge-hermes) | Hermes plugin package                                                      |
| [`plugins/forge-codex/`](./plugins/forge-codex)   | Repo-local Codex adapter                                                   |
| [`ios-companion/`](./ios-companion)               | Swift iPhone companion                                                     |
| [`src-tauri/`](./src-tauri)                       | Tauri desktop shell                                                        |

## Development

```bash
npm run dev
npx tsc --noEmit
npm run test
npm run test:server
npm run docs:openapi
```

Useful additional commands:

```bash
npm run build
npm run doctor
npm run build:openclaw-plugin
npm run check:openclaw-plugin
node --import tsx scripts/dedupe-wiki-pages.ts --apply
```

Forge is mounted under `/forge/`, so local and shared setups should preserve that
base path.

## Verification

Expected Forge verification after substantive changes:

```bash
npx tsc --noEmit
node --import tsx --test --test-concurrency=1 server/src/*.test.ts
npm run test
tailscale serve status
curl -I http://127.0.0.1:4317/api/v1/health
curl -I http://127.0.0.1:4317/forge/
```

If you are changing the public docs surface, also regenerate the Pages OpenAPI copy:

```bash
npm run docs:openapi
```

## Integration Notes

### Shared Runtime

If the browser, OpenClaw, Hermes, and Codex are meant to operate on the same Forge
system, keep these aligned:

- `origin`
- `port`
- `dataRoot`
- explicit `userId` on writes
- explicit `userIds` on cross-owner reads

### OpenClaw

Published package boundary:

- package: [`openclaw-plugin/`](./openclaw-plugin)
- Pages docs artifact: [`openclaw-plugin/docs/`](./openclaw-plugin/docs)

### Hermes

Hermes install path:

```bash
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade ./plugins/forge-hermes
```

### Codex

Codex uses the repo-local adapter under [`plugins/forge-codex/`](./plugins/forge-codex)
and shares the same runtime model rather than maintaining a separate data plane.
