# Forge — Goal Alignment

## Goal

Forge is a premium life operating system for ambitious people.

Its job is to turn long-horizon life direction into daily action, visible momentum,
trustworthy evidence, and structured reflection.

Forge is not:
- a generic task app
- a corporate project board
- a toy RPG wrapper over checklists

Forge must unify:
- life goals
- projects and tasks
- daily execution
- gamified momentum and rewards
- the Psyche reflection domain
- a serious agent-facing API

## Core product promise

The product should help the user answer, at any moment:
- What matters most right now?
- What should I do next?
- What is moving, drifting, or blocked?
- What progress actually happened?
- What patterns or triggers are affecting my behavior?

Forge succeeds when strategy, execution, motivation, and auditability feel like one system.

## Product pillars

### Life goals first

The primary hierarchy is:
- values or domains
- goals
- projects
- tasks
- evidence

Tasks should always remain legible in context: what they are, why they matter, and what they advance.

### Flagship execution

Execution is a core product surface, not a side feature.

Forge must ship:
- a premium Kanban board
- strong Today and list flows
- quick, low-friction capture and editing
- clear next-action framing

### Gamified momentum

Gamification is product logic, not decoration.

Forge uses:
- XP
- levels
- streaks
- momentum
- quests
- milestone rewards
- achievements

Rewards must stay tasteful, explainable, and tied to real user action.

### Premium command-center design

Forge should feel like a luxury instrument:
- precise
- calm
- kinetic
- premium
- trustworthy

Responsive behavior is part of the product contract. Mobile cannot be treated as follow-up polish.

### Psyche as action-linked reflection

Psyche is Forge's sensitive domain for values-led behavior change.

It must help the user:
- define valued directions
- identify loops and triggers
- capture beliefs, behaviors, and reports
- turn reflection into committed action when useful

It must not pretend to replace clinical care or emergency support.

### Agent-native collaboration

Forge must expose a stable API and OpenClaw integration so trusted agents can:
- inspect operating context
- read momentum and priorities
- create and update work
- log evidence
- store structured insights

All agent work must remain scoped, auditable, and provenance-backed.

## Binding constraints

- local-first architecture
- canonical production stack: React 19 + TypeScript 5 + Vite 6 + Tailwind CSS 4 + Tauri 2 + Rust + Axum + Tokio + SQLx + SQLite
- current live bridge: Node/Fastify server under `/api/v1`
- stable REST + OpenAPI 3.1 contract
- SQLite with migrations, FTS5, JSON1, WAL mode, and append-only event logging
- soft delete by default, restore via settings bin, hard delete only when explicit
- no GraphQL
- no Electron

## Architecture contract

Forge is manager-first.

Required layering:
- contract layer
- manager layer
- adapter layer
- persistence/runtime layer
- presentation layer

Pages, routes, jobs, and plugin tools depend on managers.
Managers own policy and orchestration.
Adapters hide infrastructure details.

## Release bar

Forge is only aligned when:
- desktop and mobile are both intentional and usable
- the flagship routes are visually distinctive and operationally clear
- the API and plugin mirror real product capability
- every important action remains inspectable, explainable, and recoverable
