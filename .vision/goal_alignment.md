# Forge — Goal Alignment

## 1. What The Project Should Be

Forge should be a local-first personal operating system that connects long-range direction, structured planning, truthful execution, reflective memory, health context, and agent collaboration inside one coherent runtime.

Forge should make the full planning ladder explicit:

- Goal
- Strategy (high level)
- Project
- Strategy (lower level when useful)
- Issue
- Task
- Subtask

Forge should treat projects as PRD-backed initiatives, issues as vertical slices across the stack, tasks as one focused AI session each, and subtasks as lightweight granular child steps. The product should support humans and bots as first-class collaborators with one owner plus one-or-many assignees, and the web app should let users explore the hierarchy through both a mixed Kanban board and a compact hierarchy view.

Forge should also distinguish stable agent identity from user ownership. OpenClaw, Hermes, and Codex are durable agent runtimes that may reconnect many times, create bot users, or spawn subagents, but repeated runtime sessions must not become repeated top-level agents. A stable agent ID can link to one or several human or bot users, and each linked bot user can own its own Kanban work.

Forge should stay modern and production-grade:

- React 19
- TypeScript 5.x
- Vite 6
- Tailwind CSS 4
- Fastify 5
- SQLite
- generated OpenAPI
- OpenClaw, Hermes, and Codex adapter surfaces
- Swift iPhone companion

## 2. What It Shouldn't Be

Forge should not collapse into a generic todo app, a flat corporate project tracker, or a decorative “AI productivity” shell.

Forge should not hide strategy above or below projects, should not reduce issues to single-layer tickets, and should not force tasks to become long vague work logs that can no longer fit inside one focused AI session.

Forge should not default to PR-based agent workflow inside this monorepo. The default operational model is direct work on `main`, with commits linked back into Forge records. Branches and PR links may exist as optional references, but skills must not assume them.

Forge should not rely on sprawling schemas for work items. The main contract should stay lean, with rich `description` plus a small set of structured fields that materially help filtering, automation, and closeout.

## 3. What It Is Now

Forge already has strong foundations:

- goals, projects, strategies, tasks, task runs, habits, notes, wiki, preferences, health, movement, and Psyche surfaces
- a React web app mounted under `/forge/`
- a Fastify API under `/api/v1/`
- local-first SQLite persistence, including SQLite-backed wiki and evidence memory
- OpenClaw, Hermes, and Codex integrations
- guided modal flows for many important entity edits

Forge also already has existing project and strategy models, user ownership, task execution surfaces, and a strong documentation surface.

Forge also already has a real health layer. Sleep in particular now needs to stay canonical-night-first across the iPhone companion, backend, and web app: one overnight session per wake-date as the main product object, with raw platform segments preserved underneath for drill-down instead of leaking transport fragments into the main UI.

Forge workout imports also now need to stay provider-native underneath but canonical in the product surface. Apple Health and HealthKit data should flow through one provider-neutral workout adapter contract so the iPhone companion, Fastify backend, OpenAPI schema, and React sports UI all agree on friendly activity labels, activity families, source provenance, and preserved metrics/events/components for drill-down.

Before this pass, however, the project-management hierarchy was still too shallow and too task-centric. The product did not yet fully expose the explicit `Goal -> Strategy -> Project -> Strategy -> Issue -> Task -> Subtask` stack across backend, UI, skills, and docs.

## 4. What Is Missing

Forge still needs the hierarchy model to be explicit and consistent everywhere:

- work items below projects need to operate as `issue | task | subtask`
- projects need board workflow state alongside lifecycle state
- issues need AFK/HITL plus structured acceptance criteria and blocker links
- tasks need direct `aiInstructions`
- completion needs `completionReport = { modifiedFiles[], workSummary, linkedGitRefIds[] }`
- canonical git refs need to link structured commits, branches, and pull requests back to work items

Forge also needs the user-facing product management experience to become hierarchy-aware:

- a mixed-level Kanban board with level multiselect and lane movement
- a hierarchy tab with goals at the top and both strategy layers visible
- stronger owner and assignee filtering across humans and bots
- canonical execution tags such as `feature`, `bug`, and `knowledge`

Finally, Forge still needs the workflow and documentation layer to match the runtime:

- `.vision/product_requirements_document.md` to replace `.vision/product_vision.md`, with the PRD becoming the canonical project requirements surface
- `goal_alignment.md` in this exact four-part format
- skill flows for PRD authoring, PRD -> issues, issues -> tasks, and task closeout
- public docs that explicitly describe the full hierarchy and the direct-to-`main` workflow
