# Forge Documentation

Forge is a local-first workspace for planning, execution, memory, health context,
reflection, and agent collaboration. These docs explain why Forge exists, how its main
systems fit together, how to install it, and where to find the detailed reference pages.

## Table Of Contents

- [Why Forge](#why-forge)
- [How Forge Solves It](#how-forge-solves-it)
- [Install Forge](#install-forge)
- [Current References](#current-references)
- [Release References](#release-references)

## Why Forge

Work rarely fails because one task is missing from one list. It usually fails because the
chain between intention, strategy, concrete action, evidence, health context, and review
gets split across too many places. Notes drift away from projects. AI agent work lands in
chat logs. Calendar constraints, sleep, workouts, movement, preferences, and Psyche
patterns stay outside the planning system even when they explain why work moves or stalls.

Forge exists to keep that chain visible. It gives the user and their agents one
local-first runtime where the work, the reasons for the work, the context around the work,
and the record of what changed can point at the same entities.

Forge complements the unstructured memory of agent harnesses such as OpenClaw, Codex,
Hermes, and Claude Code instead of replacing it. Notes and wiki pages keep the original
prose; goals, beliefs, project decisions, trigger reports, tasks, preferences, sleep,
workouts, movement, and evidence can become structured memory with identity, links,
state, and history when they need to be reviewed, compared, updated, or acted on.

## How Forge Solves It

Forge uses one shared entity model across the web app, API, OpenClaw, Hermes, Codex,
Claude Code, and the iPhone companion. The model is the structured layer behind the
prose, so work records, Psyche records, preferences, calendar records, sleep, workouts,
movement, Life Events, and evidence can stay linked instead of being trapped inside
chat history.

The planning hierarchy is explicit:

```text
Goal -> Strategy -> Project -> Strategy -> Issue -> Task -> Subtask
```

Forge keeps that hierarchy connected to:

- task runs, completion summaries, and linked git refs
- notes, wiki pages, search, backlinks, and ingest
- trusted file artifacts with precise metadata, provenance, static scans, danger scores, versions, audit history, human-only downloads, and general entity links
- preferences, judgments, signals, and context-specific profiles
- Psyche values, beliefs, behavior patterns, modes, flashcards, and trigger reports
- calendar events, Life Events, work blocks, and task timeboxes
- sleep nights, workouts, movement history, training load, and nutrition context
- human and bot users with explicit ownership, assignment, and agent-session history

Forge is built as a modern local-first stack: React 19, TypeScript 5.x, Vite 6,
Tailwind CSS 4, Fastify 5, SQLite, generated OpenAPI, Tauri 2, OpenClaw, Hermes,
Codex MCP, Claude Code MCP, a Rust Iroh companion transport, and a Swift iPhone
companion.

## Install Forge

The normal install path requires Node.js 22 or newer and one guided command:

```bash
npx forge-memory
```

Follow the complete numbered [installation guide](./installation.md) for the exact
adapter choices, data-folder prompt, success checks, platform differences, remote-browser
approval, and iPhone pairing steps.

The short path is:

1. Run `npx forge-memory` as your normal operating-system user.
2. Keep or change the detected Codex, OpenClaw, Hermes, and Claude Code adapters.
3. Confirm the Forge data folder.
4. Keep optional Forge-to-Forge sharing off unless you need it.
5. Pair the iPhone now or skip it and run `npx forge-memory pair-ios` later.
6. Wait for `Forge Memory configured and checked.` and `Doctor: passed`.
7. Open Forge with `npx forge-memory ui`.

The optional iPhone step requires Forge Companion to be installed already. The app is
currently distributed to invited TestFlight testers; the CLI creates pairing material
but does not install or enroll the app.

Use the same command whether you want the browser UI, one agent host, or all supported
hosts sharing one local Forge system. Development installs use the same flow but link
adapters to this checkout:

```bash
npx forge-memory --dev
```

After install, reopen the setup flow with current settings as defaults:

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

After install, the usual local addresses are:

- Web app: `http://127.0.0.1:4317/forge/`
- API: `http://127.0.0.1:4317/api/v1/`
- OpenAPI: `http://127.0.0.1:4317/api/v1/openapi.json`

Use [`../README.md`](../README.md) for the project overview, source-development commands,
manual adapter setup, data-location guidance, screenshots, and contributor checks.

## Current References

- [Companion Iroh transport](./reference/companion-iroh.md): iOS pairing, Iroh, manual HTTP, and phone-safe URLs.
- [Operator settings and recovery](./reference/operator-settings-and-recovery.md): data-root safety, identities, model health, pairing recovery, and preserve-data install contracts.
- [OpenClaw plugin](./reference/openclaw-plugin.md): advanced OpenClaw adapter setup and runtime behavior.
- [Hermes plugin](./reference/hermes-plugin.md): advanced Hermes adapter setup and release notes.
- [Claude Code adapter](./reference/claude-code-adapter.md): advanced Claude MCP setup and recovery.
- [Codex MCP](../plugins/codex/README.md): Codex adapter setup and MCP bridge behavior.
- [Claude Code MCP](./reference/claude-code-adapter.md): Claude Code adapter setup and MCP bridge behavior.
- [Calendar provider setup](./reference/calendar-provider-setup.md): Google Calendar and OAuth configuration.
- [Multi-user and strategies](./reference/multi-user-and-strategies.md): shared runtime, identity, and strategy model notes.
- [Preferences system](./reference/preferences-system.md): preference storage and agent-facing preference behavior.
- [Psyche event and emotion vocabularies](./reference/psyche-vocabularies.md): reusable report labels, owner scope, raw wording, and batch API behavior.
- [People and peer sharing](./reference/people-and-peer-sharing.md): Person records, typed questions, agent scopes, and human-only consent controls.
- [Gamification and XP](./reference/gamification.md): reward rules, scoped XP reads, timezone behavior, idempotency, and optional art packs.
- [Today priority](./reference/today-priority.md): one bounded decision for next work, active-run conflicts, task timeboxes, and capacity states.
- [Artifact Store](./reference/artifact-store.md): trusted file storage, metadata, safety scans, generic entity links, and human-only downloads.
- [KarpaWiki browse and search](./reference/karpawiki.md): durable wiki documents, ranked retrieval, pagination, and access rules.
- [Life Events](./reference/life-events.md): chronological life-event records, calendar reconciliation, ticket import, and agent route rules.
- [User stories and use cases](./reference/user-stories-and-use-cases.md): complete product-surface inventory, current limits, API ownership, quality gates, and improvement tracking.
- [Pins and recent records](./reference/entity-navigation.md): canonical cross-surface pins, actor-scoped recents, and agent trust boundaries.
- [Public repo workflow](./reference/public-repo-workflow.md): public repository and publication workflow.
- [Repository structure](./reference/repository-structure.md): top-level tree, package boundaries, release-sensitive paths, and generated-output rules.

## Release References

- [Release cheat sheet](./release/release-cheat-sheet.md): tag-driven plugin, package, and iOS release flow.
- [OpenClaw plugin release checklist](./release/openclaw-plugin-release-checklist.md): OpenClaw-specific release guardrails.
