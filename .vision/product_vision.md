# Forge — Product Vision

## Product

Forge is a premium, gamified life-management system for high-agency users who want
their long-term direction, daily work, and reflective self-understanding in one place.

The product must feel:
- strategically clear
- operationally sharp
- motivating without cringe
- premium and deliberate
- trustworthy for both humans and agents

## Primary users

Forge is for people with multiple serious ambitions, for example:
- researchers
- founders
- engineers
- creators
- athletes
- self-directed learners

They want:
- long-horizon structure
- decisive daily execution
- visible momentum
- deep but uncluttered reflection
- agent collaboration without losing trust

## Core surfaces

The flagship product surfaces are:
- Overview
- Today
- Kanban
- Weekly Review
- Goal detail
- Project detail
- Task detail
- Psyche hub
- Psyche report detail
- Settings and operator setup

These surfaces must feel like action tools, not dashboard recaps.

## UX direction

### Execution

Execution should be fast, premium, and explicit.

Rules:
- Kanban is a flagship surface
- Today should show clear next-action state
- quick-add and editing should be guided and low-friction
- task, project, and goal data must outrank decorative summaries
- the live timer rail belongs in app chrome first

### Visual language

Forge should avoid generic SaaS repetition.

Rules:
- use strong hierarchy through spacing, type, surface shifts, and motion
- prefer literal labels over markety metaphors
- use canonical icons and color families for entity types
- keep unfamiliar concepts literal and explain them with lightweight help
- mobile layouts should be intentionally designed, not compressed desktop clones

### Guided flows

Meaningful creation and editing should be guided.

Rules:
- one to three questions at a time
- inline help for specialized concepts
- no raw ids, parser syntax, or schema-shaped forms in user-facing flows
- Psyche and insight capture should feel like guided working sessions, not admin forms

### Graphs and complex surfaces

Graphs should be readable instruments, not novelty widgets.

Rules:
- node labels must stay legible
- graphs must respect canonical entity identity
- click, hover, zoom, and pan should feel deliberate
- sparse states should still look structured

## Gamification vision

Gamification should make progress feel tangible, not childish.

Required loops:
- starting work
- sustaining work
- completing work
- streak continuation
- milestone rewards

Every reward should be explainable from structured product data.

## Psyche vision

Psyche is a first-class Forge domain for values-led behavior change.

It should help users:
- clarify values
- identify loops
- record beliefs, behaviors, and trigger reports
- connect reflection to action

It must remain:
- calm
- sensitive
- scoped
- provenance-backed

## Agent collaboration vision

Forge should support trusted collaboration with external agents.

The preferred agent workflow is:
- start from a one-shot operator overview
- search before creating duplicates
- use batch entity tools for normal multi-entity work
- store recommendations as structured insights
- use the Forge UI entrypoint when review, editing, Kanban movement, or Psyche exploration is better handled visually

Agent collaboration should feel helpful and low-pressure.
The main conversation comes first; saving to Forge should be an optional, non-intrusive offer.
The OpenClaw plugin should stay curated and professional: overview, onboarding, batch entity operations, insight posting, and UI entrypoint only.
For localhost targets, the plugin should self-host the Forge runtime so install and first use stay close to one step.

## Runtime and stack

Current live runtime:
- React 19 + TypeScript 5 + Vite 6 frontend
- Node/Fastify `/api/v1` bridge
- local default Forge runtime port `4317`, with the web app served at `/forge/`

Canonical long-term stack:
- Tauri 2
- Rust
- Axum
- Tokio
- SQLx
- SQLite

The web runtime under `/forge/` is the main product surface today.

## Quality bar

Forge is production-ready only when:
- UI quality feels premium on desktop and mobile
- flagship routes are coherent and distinctive
- deletes are safe and recoverable
- API, app, and plugin stay aligned
- provenance and auditability are preserved across all important actions
