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
- generated OpenAPI
- OpenClaw, Hermes, and Codex adapter layers
- Swift iPhone companion
- provider-neutral health adapters spanning Swift ingestion, Fastify normalization, and React read models

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
  - `familyKey`
  - `familyLabel`
- The canonical contract must also preserve provider-captured workout evidence for drill-down:
  - scalar and aggregate metrics
  - workout events
  - workout components or phases
  - provider metadata
- Apple Health and HealthKit are the first production adapter path, but the architecture must stay modular so Android Health Connect, Garmin, and other providers can plug into the same backend and UI contract without forking the product model.
- The web sports surface must present friendly workout naming, provider provenance, and captured metrics/events/phases directly in the session UI instead of hiding them behind transport-only fields.
