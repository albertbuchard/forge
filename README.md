<p align="center">
  <img src="https://raw.githubusercontent.com/albertbuchard/forge/main/plugins/openclaw/docs/assets/brand-icons/forge-logo-imagegen2-transparent-1280.png" alt="Forge" width="720" />
</p>

[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=06121c)](https://react.dev/)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-ffc131?logo=tauri&logoColor=1f2937)](https://tauri.app/)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6ba539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-8ab4ff)](https://albertbuchard.github.io/forge/)

# Forge

Forge is a local-first structured memory system for humans and AI agents.

It complements unstructured memory. OpenClaw, Codex, Hermes, Claude Code, notes, wiki
pages, and chat transcripts can keep prose, context, reasoning, and texture. Forge keeps
the parts that need identity, state, links, history, permissions, review, automation, or
future action.

When a conversation surfaces a belief, trigger, preference, decision, goal, task,
workout, sleep night, movement pattern, calendar plan, wiki page, file artifact, or
agent action, Forge can turn the useful part into a typed local record. That record can
be searched, linked, audited, updated in the web app, and reused by trusted agents
through the same local runtime.

Read the full published documentation on the
[Forge GitHub Pages docs](https://albertbuchard.github.io/forge/).

## Table Of Contents

- [Why Forge](#why-forge)
- [How Forge Solves It](#how-forge-solves-it)
- [Install Forge](#install-forge)
- [Run The Source App Locally](#run-the-source-app-locally)
- [Advanced Adapter Setup](#advanced-adapter-setup)
- [Data Location And Backups](#data-location-and-backups)
- [What Forge Covers](#what-forge-covers)
- [Screenshots](#screenshots)
- [Documentation](#documentation)
- [Contributor Checks](#contributor-checks)
- [License](#license)

## Why Forge

Unstructured memory is not enough by itself.

Agent harnesses are good at preserving what was said. They can remember the conversation,
the reasoning, the uncertainty, and the emotional texture. That matters, but a transcript
does not give an item an ID, owner, status, link graph, audit trail, danger score,
calendar slot, completion state, or recovery history.

Forge exists for the parts that need structure. It turns selected pieces of life and work
into records that can be inspected, linked, updated, compared, restored, embedded,
scheduled, assigned, reviewed, and acted on later.

That distinction is the product:

- unstructured memory keeps prose and context
- Forge keeps structured memory with identity, state, relationships, and history
- humans and trusted agents use both through one local runtime

This matters because a life with agents is not only a task list. A useful memory system
has to hold decisions, notes, meetings, values, beliefs, triggers, preferences, files,
calendar plans, sleep, workouts, movement, fatigue, food, health signals, and unfinished
reasoning. Without a structured layer, the user has to remember what each thing meant,
what changed, what evidence supported it, and what should happen next.

## How Forge Solves It

Forge uses one local runtime and one shared entity model. The model is the structured
layer behind the prose, so work records, Psyche records, preferences, calendar records,
sleep, workouts, movement, wiki pages, notes, artifacts, and agent actions can point at
each other instead of becoming isolated text fragments.

Forge stores:

- Psyche memory: values, beliefs, modes, behavior patterns, behaviors, trigger reports,
  emotion definitions, event types, flashcards, questionnaire runs, and
  self-observation notes
- knowledge memory: notes, wiki pages, backlinks, ingest jobs, search indexes, and
  evidence attached to the records it explains
- health and movement memory: sleep nights, workouts, HealthKit imports, training load,
  nutrition and weight-loss context, movement timelines, places, trips, and recovery
  context
- preference memory: catalogs, items, judgments, signals, contexts, comparisons, and
  score updates
- artifact memory: trusted spreadsheets, documents, PDFs, structured text, plain text,
  images, and other supported files with metadata, provenance, safety scans, danger
  scores, versions, audit events, and human-only downloads
- calendar memory: native events, mirrored calendar events, work block templates,
  task timeboxes, provider connections, sync state, and writable calendar projections
- work memory: goals, strategies, projects, issues, tasks, subtasks, task runs, habits,
  work adjustments, completion reports, and linked git refs
- collaboration memory: human users, bot users, agent runtime sessions, ownership,
  assignees, approvals, and audited agent actions

Planning and project management are one important surface, not the whole product. The
work hierarchy is explicit because structured work records need stable relationships:

```text
Goal -> Strategy -> Project -> Strategy -> Issue -> Task -> Subtask
```

Projects are PRD-backed initiatives. Issues are vertical slices across the stack. Tasks
are one focused AI session each. Subtasks are small child steps. Completion records can
preserve modified files, a work summary, and linked git refs, so agents leave behind a
truthful delivery trail instead of only changing a status field.

Psyche is just as central. A chat can mention a belief, trigger, mode, value, or
behavior pattern. Forge can store it as a connected record with links, dates,
descriptions, related notes, and future review paths. The same principle applies to
preferences, health, movement, files, calendar plans, work, and agent actions.

Artifacts use the same model. A stored file is not just a blob in a folder. It is a
typed artifact record with title, description, provenance, file identity, scan state,
danger score, versions, audit history, and generic links to the Forge records it
supports. Agents may help create, enrich, scan, and link artifacts when trusted and
scoped, but Forge does not let agents autonomously download, open, execute, preview, or
transform stored file bytes.

Health, movement, and recovery are also structured memory. Sleep nights, workouts,
training load, nutrition context, places, trips, and movement timelines can sit beside
the decisions, tasks, notes, and Psyche records they help explain instead of remaining
trapped on the phone.

The same records are used by the React web app, Fastify API, OpenClaw, Hermes, Codex,
Claude Code, the iPhone companion, and the watchOS command surface. The database stays
local by default, with explicit data-folder and backup controls in `Settings -> Data`.

Forge is built with React 19, TypeScript 5.x, Vite 6, Tailwind CSS 4, Fastify 5,
SQLite, generated OpenAPI, Tauri 2, OpenClaw, Hermes, Codex MCP, Claude Code MCP, a Rust
Iroh companion transport, and a Swift iPhone companion that links the same Rust transport
core natively.

## Install Forge

### Single-command Install

The preferred install for everyone is one guided command:

```bash
npx forge-memory
```

`forge-memory` is the front door for Forge. It installs the local Forge UI/runtime,
discovers OpenClaw, Hermes, Codex, and Claude Code in the background, shows detected host
adapters in a checkbox menu, selects every detected adapter by default, leaves missing
adapters visible as disabled `not found` rows, lets Space toggle adapter choices, and can
pair the iOS companion at the end.

Use the same command whether you want the browser UI, OpenClaw, Hermes, Codex, Claude
Code, or all of them sharing one local Forge memory system.

Development installs use the same flow, but link adapters to this source checkout and
default to the real shared Forge data folder:

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
npx forge-memory doctor --repair
npx forge-memory update
npx forge-memory ui
npx forge-memory restart
npx forge-memory stop
npx forge-memory export
npx forge-memory uninstall
npx forge-memory pair-ios
```

`doctor --repair` checks the local install, recreates missing local folders, starts or
restarts the runtime when allowed, and prints concrete next steps without deleting Forge
data.

`pair-ios` prefers Tailscale when it is installed, authenticated, and Forge is reachable
through the Mac's MagicDNS HTTPS URL. That gives the iPhone a normal phone-reachable Forge
URL for sync and the embedded WebView. If Tailscale is not available or is declined, Forge
falls back to an Iroh QR with the desktop Iroh node id, pairing token, optional relay hint,
and ALPN `forge-companion/1`. The CLI uses a compact QR and saves the same compact payload
under `~/.forge/pairing/` so you can paste it into the iPhone app if the camera cannot
scan.

Explicit direct HTTP/TCP pairing remains available for deliberate LAN, Tailscale, or
debugging setups. A physical iPhone needs a phone-reachable URL:

```bash
npx forge-memory pair-ios --public-url https://your-mac.tailnet.ts.net/forge/
```

Loopback URLs such as `127.0.0.1` are useful for the iOS Simulator but are rejected for
physical-phone pairing.

The short install path is intentionally the whole base setup. If you want the lower level
networking details, read the companion transport reference in
[`docs/reference/companion-iroh.md`](./docs/reference/companion-iroh.md) or the published
[Companion Transport guide](https://albertbuchard.github.io/forge/companion-transport.html).

`export` creates a portable backup of the real Forge data folder. `uninstall` removes the
Forge Memory runtime manager and cache but keeps the Forge data folder by default; use
`--remove-data` only when you explicitly want to delete the data too. `update` backs up
the Forge data folder when appropriate, refreshes the runtime and selected adapters,
preserves user data, and reports the backup location before making changes.

After install, the usual local addresses are:

- Web app: `http://127.0.0.1:4317/forge/`
- API: `http://127.0.0.1:4317/api/v1/`
- OpenAPI: `http://127.0.0.1:4317/api/v1/openapi.json`

Manual OpenClaw, Hermes, Codex, and Claude Code setup still exists for advanced cases in
[`docs/reference/openclaw-plugin.md`](./docs/reference/openclaw-plugin.md),
[`docs/reference/hermes-plugin.md`](./docs/reference/hermes-plugin.md),
[`plugins/codex/README.md`](./plugins/codex/README.md), and
[`docs/reference/claude-code-adapter.md`](./docs/reference/claude-code-adapter.md).

## Run The Source App Locally

Use this when you are developing Forge itself.

```bash
npm install
npm run dev
```

Open Forge through the backend URL:

```text
http://127.0.0.1:4317/forge/
```

Vite may also run on `3027` during development, but the stable app entrypoint is still
the backend mount on `4317`.

## Advanced Adapter Setup

The guided `npx forge-memory` flow is the normal path. Use these commands only for
adapter-specific debugging, local source-linking, or recovery.

### OpenClaw Plugin While Developing

From the Forge repo root:

```bash
openclaw plugins install --link --dangerously-force-unsafe-install ./plugins/openclaw
openclaw plugins enable forge-openclaw-plugin
openclaw gateway restart
openclaw plugins inspect forge-openclaw-plugin --runtime
openclaw forge health
```

Use `--link` when you want OpenClaw to use this checkout directly. Omit `--link` when you
want to test a copied package install.

### Hermes Adapter Commands

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
~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable ./plugins/hermes
```

### Codex MCP Commands

Prefer `npx forge-memory`, which writes the Forge MCP entry through its guided
configuration flow. Codex uses the Forge MCP bridge from this repo:

```bash
codex mcp add forge \
  --env FORGE_ORIGIN=http://127.0.0.1 \
  --env FORGE_PORT=4317 \
  --env FORGE_ACTOR_LABEL=codex \
  --env FORGE_TIMEOUT_MS=15000 \
  -- /bin/zsh /absolute/path/to/forge/plugins/codex/scripts/run-mcp.sh
codex mcp list
```

## Data Location And Backups

By default, local plugin installs store Forge data under `~/.forge`. You can choose
another folder by setting `dataRoot` in the plugin config or by using `Settings -> Data`
in the web app.

If OpenClaw, Hermes, Codex, Claude Code, and the browser should share one Forge system,
point them at the same origin, port, and data root. Before moving or merging data
folders, back up every candidate `forge.sqlite` and verify which database the live runtime
has opened.

## What Forge Covers

- Psyche and reflection: values, beliefs, modes, behavior patterns, behaviors, trigger reports, emotion definitions, event types, flashcards, questionnaire runs, and self-observation
- knowledge memory: notes, wiki pages, search, ingest, backlinks, evidence, and linked Forge context
- artifacts: trusted spreadsheets, documents, PDFs, structured text, text, and images with metadata, provenance, scans, versions, generic entity links, and human-only downloads
- health and body context: sleep nights, workouts, training load, movement history, nutrition and weight-loss context, HealthKit imports, and iPhone sync
- preferences: catalogs, contexts, preference items, judgments, signals, comparisons, and score updates
- calendar and time: native events, mirrored calendars, provider connections, work block templates, and task timeboxes
- planning and execution: goals, strategies, projects, issues, tasks, subtasks, task runs, habits, work adjustments, and git-linked completion reports
- agents and collaboration: OpenClaw, Hermes, Codex, Claude Code, explicit human and bot users, owner/assignee filters, runtime sessions, approvals, and audited actions
- progress: XP, levels, streaks, trophies, optional downloadable art packs, and local reward history

## Screenshots

| Surface              | Screenshot                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Overview             | ![Forge overview dashboard](./plugins/openclaw/docs/assets/forge-overview-dashboard.png) |
| Projects             | ![Forge projects board](./plugins/openclaw/docs/assets/forge-projects-board.png)         |
| Execution board      | ![Forge Kanban board](./plugins/openclaw/docs/assets/forge-kanban-board.png)             |
| Knowledge and memory | ![Forge wiki memory](./plugins/openclaw/docs/assets/forge-wiki-memory.png)               |
| Sleep and health     | ![Forge sleep overview](./plugins/openclaw/docs/assets/forge-sleep-overview.png)         |

## Documentation

Start with [`docs/README.md`](./docs/README.md). Durable setup and architecture
references live under [`docs/reference/`](./docs/reference/), release procedures live
under [`docs/release/`](./docs/release/). Private goals, automation reports, audit
handoffs, and conversation-derived planning notes do not belong in this public
repository.

New contributors should also read the
[`Repository Structure`](./docs/reference/repository-structure.md) reference before
moving files or changing release/package boundaries.

- Docs home: [albertbuchard.github.io/forge](https://albertbuchard.github.io/forge/)
- Features: [albertbuchard.github.io/forge/features.html](https://albertbuchard.github.io/forge/features.html)
- Integrations: [albertbuchard.github.io/forge/integrations.html](https://albertbuchard.github.io/forge/integrations.html)
- Companion transport: [albertbuchard.github.io/forge/companion-transport.html](https://albertbuchard.github.io/forge/companion-transport.html)
- API reference: [albertbuchard.github.io/forge/api/](https://albertbuchard.github.io/forge/api/)
- Repo docs: [`docs/`](./docs)

## Contributor Checks

```bash
npx tsc --noEmit
npm run test
npm run test:server
```

Contributor and runtime details live in the
[Development guide](https://albertbuchard.github.io/forge/development.html) and
[Engineering reference](https://albertbuchard.github.io/forge/engineering.html). The
publishable OpenClaw package lives in [`plugins/openclaw/`](./plugins/openclaw), the
Hermes adapter in [`plugins/hermes/`](./plugins/hermes), and the Codex and Claude Code
MCP adapters use Forge Memory's shared MCP entrypoint.

## License

Forge-owned public code is licensed under Apache-2.0. The license is permissive,
commercial-use friendly, and includes an explicit patent grant, which keeps a clean path
for future closed-source commercial Forge forks.
