# Forge — Product Requirements Document

## Product Intent

Forge is a local-first operating system for goals, strategies, projects, execution, memory, health context, and agent collaboration. It should let one or more humans and bots move from long-range direction to concrete completed work without losing the chain of meaning in between.

The canonical planning and execution hierarchy is:

`Goal -> Strategy (high level) -> Project -> Strategy (lower level when useful) -> Issue -> Task -> Subtask`

## Production Stack

Forge is built as a production-grade monorepo application with:

- React 19
- TypeScript 5.x
- Vite 6
- Tailwind CSS 4
- Fastify 5
- SQLite
- SQLite-backed wiki/evidence memory through `notes`, wiki spaces, FTS, link edges, and optional embeddings
- generated OpenAPI
- OpenClaw, Hermes, and Codex adapter layers
- Swift iPhone companion
- provider-neutral health adapters spanning Swift ingestion, Fastify normalization, and React read models

The gamified progression layer is part of the same production stack. It uses the existing Fastify reward ledger and SQLite persistence, React 19 UI surfaces, Framer Motion celebrations, source-controlled TypeScript trophy/unlock catalog data, small repo-owned mascot previews under `public/gamification-previews/`, and optional per-style raster sprite archives hosted as GitHub Release downloadable content. Heavy generated trophy, unlock, mascot, atlas, and source sprite files must not be part of the monorepo history or the default npm/PyPI plugin packages.

The current progression direction is Forge Gamification: one canonical source-controlled catalog with 144 achievements and cosmetic unlocks, generated transparent atlas-backed trophy and cosmetic sprites, 30 Forge Smith mascot states, selectable gamification art themes, selected-user-first metric evaluation, and cosmetic equipment that never gates core Forge functionality. Forge defaults to the lighthearted `Fantasy` style but does not download the full art pack until the operator opts in from the first-run prompt or settings. Forge does not maintain stale released-catalog forks; future catalog growth should happen through normal migrations and canonical ID changes when required.

## Core Requirements

### 1. Project Management Hierarchy

- `goal`, `strategy`, and `project` remain first-class Forge entity families.
- The execution layer below projects is modeled through one generic work-item family with levels:
  - `issue`
  - `task`
  - `subtask`
- Parenting rules are strict:
  - issue under project
  - task under issue
  - subtask under task
- Strategy stays flexible and is not extended with `scopeType` or `scopeEntityId`.

### 2. PRD-Centered Projects

- Projects are long-term initiatives with a prominently presented PRD.
- Projects must expose:
  - linked goal
  - linked higher-level and lower-level strategies
  - linked issues, tasks, and subtasks
  - owner and assignees
  - project lifecycle state
  - board workflow state

### 3. Issues As Vertical Slices

- A PRD should be decomposed into issues that act as vertical slices or tracer bullets across the stack.
- Issues are classified as:
  - `AFK`
  - `HITL`
- Issue requirements:
  - `description` carries the end-to-end behavior narrative
  - `acceptanceCriteria` stores structured Given/When/Then criteria including error cases
  - blockers are optional references to Forge entities
  - “how to verify” may appear in authored description copy, but is not a dedicated schema field

### 4. Tasks As One AI Session

- Each issue breaks down into concrete ordered tasks.
- One task equals one focused AI session.
- If the work does not fit into one focused session, it must be split.
- Task instructions are written to the AI executor, not as vague human notes.
- `aiInstructions` is the dedicated structured task-execution field.
- File targets, existing patterns, and done-state guidance belong inside `aiInstructions`, not in separate schema fields.
- Typical generation order is:
  - Schema
  - Logic
  - API
  - UI
  - tests interleaved throughout

### 5. Lean Work Item Schema

`description` is the primary rich field for behavior, context, steps, and subtasks.

Only these structured workflow fields are added directly to work items:

- `executionMode`
- `acceptanceCriteria`
- `blockerLinks`
- `aiInstructions`
- `completionReport`

Explicit non-requirements:

- no `issueSpec`
- no `taskSpec`
- no `subtaskSpec`
- no `behaviorDescription`
- no `howToVerify`
- no `userStoryRefs`
- no `targetFiles`
- no `patternRefs`
- no `definitionOfDone`
- no `recommendedOrder`

### 6. Completion And Git Traceability

Completed work items, especially tasks, need a closeout contract:

`completionReport = { modifiedFiles[], workSummary, linkedGitRefIds[] }`

Git links are stored canonically as structured work-item git refs and may point to:

- commit
- branch
- pull request

`linkedGitRefIds[]` inside `completionReport` points to those canonical git refs.

Default workflow expectation:

- direct commits to `main`
- no default requirement to open feature branches
- no default requirement to open pull requests

### 7. Ownership, Assignment, And Tags

- Every relevant PM entity needs one canonical owner and one-or-many assignees.
- Both humans and bots are first-class assignable actors.
- Filtering must work cleanly for:
  - owners
  - assignees
  - humans
  - bots

Canonical execution tags must exist:

- `feature`
- `bug`
- `knowledge`

### 8. Project Management UX

Forge needs a proper PM workspace with tabs:

- Projects
- Board
- Hierarchy

Rules:

- use guided modal flows instead of inline forms
- preserve desktop and mobile quality together
- keep PRD presentation strong in project detail
- keep the hierarchy explicit in both app and docs

Board requirements:

- mixed-level board support
- selectable levels:
  - project
  - issue
  - task
  - subtask
- default selected levels:
  - task
  - subtask
- selected board levels can move lane-to-lane

Hierarchy requirements:

- goals at the top
- both strategy layers remain visible
- compact concise hierarchy explorer
- shared search/filter model with board

### 9. Skills And Agent Workflow

Forge-linked skills must understand and preserve the hierarchy:

- PRD authoring for projects
- PRD -> vertical-slice issues
- issue -> ordered tasks
- task -> subtasks when necessary
- task closeout with completion report

Agent skills must default to:

- direct commits to `main`
- no branch creation prompts
- no pull request prompts

Agent runtime identity is separate from Forge user ownership. OpenClaw, Hermes, and Codex each need one stable agent identity per machine/runtime installation, derived from provider, machine/data root, and persona rather than volatile session keys, cron IDs, WhatsApp threads, PIDs, or timestamps. Runtime sessions are history under that identity. Agent identities can link to one or several Forge users, including bot users with their own Kanban ownership, so spawned subagents are modeled as users or linked actors instead of duplicate top-level agents.

Separate code review and final audit skills are not part of this Forge PM workflow and should remain Codex concerns instead.

### 10. Documentation Contract

Public docs, GitHub Pages docs, README, and agent-facing docs must all explain:

- the full hierarchy
- PRD-centered projects
- vertical-slice issues
- one-session tasks
- mixed Kanban hierarchy controls
- hierarchy view
- owner + assignee model
- git refs + completion reports
- direct-to-`main` workflow

### 11. Health Workout Adapter Contract

- Workout imports must not leak raw provider activity placeholders such as `activity_52` into the main product UI when the source system can resolve them.
- The canonical workout adapter contract must normalize provider-native activity identifiers into a structured descriptor:
  - `sourceSystem`
  - `providerActivityType`
  - `providerRawValue`
  - `canonicalKey`
  - `canonicalLabel`

### 12. Gamification Achievement Contract

- Trophies are permanent achievements earned from meaningful Forge behavior, not decorative XP badges.
- Unlocks are cosmetic only: mascot skins, poses, HUD treatments, streak effects, trophy shelves, icon frames, and celebration variants.
- The gamification catalog must remain source-controlled TypeScript data with exactly 144 records in the current release: 96 trophies and 48 unlocks.
- Pure XP/level trophies must remain a small minority. Most achievements should come from real Forge entities and actions: tasks, task runs, projects, goals, wiki pages, notes, wiki links, modes, triggers, behaviors, behavior patterns, beliefs, habits, Life Force, health imports, and collaboration.
- The released catalog is canonical. Stale pre-release unlock rows must not unlock current items unless their item IDs match current source-controlled catalog IDs.
- Historical backfill may mark genuinely earned items as unlocked, but initial backfill celebrations should be treated as already seen so the user is not spammed.
- The Forge Smith mascot should react to current streak and absence state: stronger and more dramatic with longer presence, colder and more abandoned after missed days, while avoiding gore, cruelty, self-harm imagery, or clinically unsafe copy.
- Gamification art is themeable. The released themes are `Fantasy` for the default warmer lighthearted mascot-app style, `Dark Fantasy` for dramatic high-pressure forge art, and `Mind Locksmith` for a modern smart blacksmith-as-locksmith-of-the-mind metaphor grounded in Forge planning, memory, Psyche, health, and agent collaboration. Every theme must use transparent-ready cropped sprite outputs so the UI is not forced into square dark image cards. Each full style pack is distributed as a separate downloadable GitHub Release asset and installed into the local Forge data root after explicit operator choice.
  - `familyKey`
  - `familyLabel`
- The canonical contract must also preserve provider-captured workout evidence for drill-down:
  - scalar and aggregate metrics
  - workout events
  - workout components or phases
  - provider metadata
- Apple Health and HealthKit are the first production adapter path, but the architecture must stay modular so Android Health Connect, Garmin, and other providers can plug into the same backend and UI contract without forking the product model.
- The web sports surface must present friendly workout naming, provider provenance, and captured metrics/events/phases directly in the session UI instead of hiding them behind transport-only fields.

### 12. Gamified Progression

Forge should make user momentum visible through a selected-user-first XP and trophy system. The progression model must extend the existing reward ledger rather than duplicating it: XP totals, levels, streaks, trophies, unlocks, and celebrations are projections of auditable reward events.

Progression requirements:

- selected single-user progression is primary; when no single user is selected, Forge falls back to the primary operator user before aggregating
- levels use the canonical `smith-forge` curve: `100 + round(35 * (level - 1)^1.25)` XP to advance
- streak days are local calendar days with positive, non-reversed, non-manual qualifying reward events
- trophies and unlocks are source-controlled catalog records, not editable reward rules
- unlocks are cosmetic only and must never gate core app functionality
- the front page must show the Forge Smith mascot, current level, total XP, XP to the next level, consecutive days, next unlock, and newest trophy
- compact HUD indicators should make level, XP progress, and streak visible on execution/content pages without taking over the page
- celebration animations should be polished, queued, and respectful of reduced-motion preferences

The Forge Smith mascot is a dramatic blacksmith mentor with hard-pressure streak energy. It can look powerful, stern, wise, or abandoned depending on streak health, but the design must stay motivating and avoid unsafe or cruel imagery.
