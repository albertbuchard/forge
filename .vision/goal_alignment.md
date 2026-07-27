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

Forge should also distinguish stable agent identity from user ownership. OpenClaw, Hermes, Codex, and Claude Code are durable agent runtimes that may reconnect many times, create bot users, or spawn subagents, but repeated runtime sessions must not become repeated top-level agents. A stable agent ID can link to one or several human or bot users, and each linked bot user can own its own Kanban work.

Forge should provide an Artifact Store for trusted stored files that belong in the same memory graph as goals, projects, tasks, wiki pages, Psyche records, calendar records, and notes. Artifacts are files such as spreadsheets, documents, PDFs, structured text, plain text, and images. Forge stores their bytes content-addressably, records precise title, short description, long description, file identity, provenance, source, state, scan results, danger score, versions, and audit events, and links them to other Forge records through the general `entity_links` model. Agents may create artifacts only when they are trusted and scoped, and they must not autonomously download, open, execute, preview, or transform stored file bytes.

Forge should provide Life Events as a first-class chronological memory surface for important personal events. A Life Event is a structured record for something meaningful that happened or will happen in time, connected to the calendar when appropriate but not reduced to a calendar block. Life Events can be short moments or intervals lasting days, weeks, or months, including travel, flights, trains, car trips, stays, lodging, holidays, vacations, visits, moves, festivals, retreats, conferences, concerts, cinema, dates, friends, family, work phases, work milestones, thesis milestones, health episodes, administrative events, celebrations, memories, and custom events. They should link to calendar events, ticket artifacts, wiki pages, notes, goals, projects, tasks, Psyche records, movement context, and other Forge entities through the general `entity_links` model.

Forge should provide People as owner-scoped structured memory for the people in a user's life. A Person is separate from a Forge User, agent, peer identity, device, or sharing grant and links to the rest of Forge through the general `entity_links` model. Two independently operated Forge installations can pair through a human-confirmed invitation and exchange only registered projections covered by a signed directional grant. Direct, Iroh, Tor when locally supported, and an optional self-hosted ciphertext mailbox are interchangeable transport providers behind the same protocol. Transport reachability never creates consent, and trusted agents can use existing scoped grants without gaining any pairing, device, or permission-management authority.

Forge should provide one bounded Attention surface for existing records and operational evidence that need a next move. It derives actor-scoped items from decisions, unreviewed insights, blocked or overdue work, companion sync problems, and stale agent runtimes; it does not create a second source of truth. Items expose stable ids, severity, reason, target, and allowed actions. Snooze and dismiss are reversible per actor, changed source evidence reactivates an item, and blocked or overdue work cannot be hidden through dismissal.

Forge should provide Courses as structured learning paths through first-class Concept entities. A concept owns its canonical definition, prerequisites, related concepts, cross-course appearances, multidimensional mastery evidence, misconceptions, remediation links, and spaced-review schedule. A course owns modules, daily teaching sequences, interleaved checkpoints, activities, rubrics, and ordering without duplicating concept identity. Each lesson should teach one idea at a time, show a complete worked example, model proof construction before independent proof writing, and check understanding through free-text feedback before required new material appears. Written mathematics uses Forge's configured model connection against an explicit rubric and hidden instructor reference. If the model is unavailable, Forge saves the work and withholds the grade and continuation rather than fabricating understanding.

Forge should stay modern and production-grade:

- React 19
- TypeScript 5.x
- Vite 6
- Tailwind CSS 4
- Fastify 5
- SQLite
- generated OpenAPI
- a Rust 2024 `forge-peer` daemon and companion Iroh transport
- an optional Node 24 Forge Connectivity Service for end-to-end encrypted offline delivery
- OpenClaw, Hermes, Codex, and Claude Code adapter surfaces
- Swift iPhone companion
- SwiftUI watchOS companion command surface
- optional GitHub Release-hosted gamification art packs installed into the local Forge data root

The source checkout should stay organized around explicit production ownership
boundaries: `apps/web` for the React/Vite app, `apps/api` for the Fastify API
and migrations, `apps/desktop-tauri` for the desktop shell,
`apps/ios-companion` for the native companion, `plugins/openclaw`,
`plugins/codex`, and `plugins/hermes` for host adapters, `packages/forge-memory`
and `packages/companion-iroh` for public/shared packages, `tests` for E2E and
shared fixtures, `scripts` for grouped operational tooling, `docs` for public
references, and `assets` for source-owned visual inputs. Private goal prompts,
handoffs, automation memory, internal audits, private model-response captures,
and conversation-derived planning notes must remain outside the public Forge
repo.

Forge should also make progress feel alive through a selected-user-first gamified layer. XP, levels, streaks, trophies, cosmetic unlocks, and the Forge Smith mascot should be grounded in the existing auditable reward ledger, not in a disconnected points game. The mascot should feel like a dramatic blacksmith mentor: visually enchanting, sometimes wise, sometimes stern, and forceful enough to make streak drift visible without becoming unsafe or cruel.

Forge should make `npx forge-memory` the preferred public install path for UI-only use and for OpenClaw, Hermes, Codex, and Claude Code. The installer should feel like a polished Forge surface, always install the Forge UI/runtime as the base layer, run automated discovery in the background, ask a guided question flow, show an OpenClaw-quality checkbox menu for host adapters only with every detected runtime selected by default, missing runtimes as disabled rows, Space to toggle rows, and a Skip option, route selected runtimes to one shared data folder, expose configure/status/doctor/runtime commands, make `configure` rerun the full flow with the current state as defaults, support source-backed development installs through `npx forge-memory --dev` that default to the real shared Forge data folder, and offer iOS companion pairing with yes selected by default before falling back to advanced manual adapter docs.

## 2. What It Shouldn't Be

Forge should not collapse into a generic todo app, a flat corporate project tracker, or a decorative “AI productivity” shell.

Forge should not hide strategy above or below projects, should not reduce issues to single-layer tickets, and should not force tasks to become long vague work logs that can no longer fit inside one focused AI session.

Forge should not default to PR-based agent workflow inside this monorepo. The default operational model is direct work on `main`, with commits linked back into Forge records. Branches and PR links may exist as optional references, but skills must not assume them.

Forge should not rely on sprawling schemas for work items. The main contract should stay lean, with rich `description` plus a small set of structured fields that materially help filtering, automation, and closeout.

## 3. What It Is Now

Forge already has strong foundations:

- goals, projects, strategies, tasks, task runs, habits, notes, wiki, preferences, health, movement, and Psyche surfaces
- an Artifact Store for trusted human-download-only files with precise metadata, provenance, static scans, danger scoring, versions, audit history, optional LLM metadata enrichment, a dedicated web view, and relationships stored through general entity links
- Life Events for chronological personal event memory, including short events and longer stays or periods, with calendar reconciliation, ticket artifact import, travel segments, status reads, a virtualized web timeline, guided modal creation/import flows, and relationships stored through general entity links
- People records with guided web flows, general entity links, Wiki association, owner-scoped private fields, and secure selective Forge-to-Forge sharing through human-confirmed pairing, directional grants, typed questions, encrypted transport providers, and a privacy-bounded iPhone/watch companion surface
- an actor-scoped Attention queue with bounded pagination, reversible snooze/dismiss/restore state, source-change reactivation, a responsive web view, agent route contracts, and compact iPhone/watch Inbox summaries
- a modular Course package contract, immutable course releases and activity revisions, first-class Concept records, course and concept libraries, an immersive full-page lesson workspace, progressive model-reviewed checkpoints, cross-course mastery and recall scheduling, course grades and points, and safe rubric-based written assessment through the existing Forge model provider
- canonical shared or user-owned entity pins plus actor-scoped recent-view history, exposed through the existing Action Bar, a compact iPhone/watch snapshot, and agent-safe list/touch routes while human operators alone control pin state
- Psyche flashcards as batch CRUD records for therapeutic reminder cards that can be retrieved by tags, trigger wording, title, or linked Psyche context during urge and trigger support
- one active responsive web route tree at a time, a measured monotonic shell grow/close animation that fully reopens at the top on desktop and mobile, semantic theme tokens across shared and domain surfaces, prefetched route handoffs without an artificial loading delay, a compact visible Forge Smith and real trophy art on Overview, and bounded responsive Trophy Hall previews with complete search results
- a React web app mounted under `/forge/`
- a Fastify API under `/api/v1/`
- local-first SQLite persistence, including SQLite-backed wiki and evidence memory
- OpenClaw, Hermes, Codex, and Claude Code integrations
- guided modal flows for many important entity edits

Forge also already has existing project and strategy models, user ownership, task execution surfaces, and a strong documentation surface.

Forge also already has a real health layer. Sleep in particular now needs to stay canonical-night-first across the iPhone companion, backend, and web app: one overnight session per wake-date as the main product object, with raw platform segments preserved underneath for drill-down instead of leaking transport fragments into the main UI.

Forge workout imports also now need to stay provider-native underneath but canonical in the product surface. Apple Health and HealthKit data should flow through one provider-neutral workout adapter contract so the iPhone companion, Fastify backend, OpenAPI schema, and React sports UI all agree on friendly activity labels, activity families, source provenance, and preserved metrics/events/components for drill-down. Workout sync is raw-evidence-first: Forge should preserve workout-associated heart-rate timelines, other HealthKit quantity timelines, route points, events, activities, and scalar summaries locally before deriving HRR zones, training load, HR coverage, and route summaries for the Sports cockpit.

Forge's watchOS companion is a wrist-first command and logging surface, not a miniature web app and not a standalone data owner. It uses Swift 5, SwiftUI, direct URLSession HTTPS calls when the paired companion URL is reachable, WatchConnectivity as a durable phone-relay fallback, WidgetKit/App Intents, compact Fastify snapshots, and idempotent SQLite-backed command receipts. The Digital Crown selects the active Forge surface, horizontal card navigation selects the entity or subcomponent inside that surface, and taps open short action modals for work, habits, goals/projects, today, health, movement, Psyche, inbox, sync, and now. The iPhone companion owns pairing creation and publishes scoped connection metadata, but Watch actions should hit Forge directly over HTTPS/Tailscale whenever that route is reachable; deep editing remains in the Forge web and iPhone surfaces. Watch surfaces must be backed by real Forge snapshots, including legacy mobile pairings that predate the `watch-ready` flag, and Psyche prompts must come from canonical Forge Psyche entities rather than invented static watch-only categories.

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
- public installation docs that lead with `npx forge-memory` while preserving OpenClaw, Hermes, Codex, Claude Code, and data-root details as advanced reference material

Forge also needs the progression layer to behave like a real achievement system, not a decorative XP readout:

- Progression uses one canonical gamification catalog with 96 trophies and 48 cosmetic unlocks in the current release.
- trophy requirements should be hard, behavior-specific, and evaluated from real Forge data: tasks, task runs, projects, goals, wiki/notes, links, Psyche values/modes/triggers/behaviors/patterns/beliefs, habits, Life Force, health imports, and collaboration.
- cosmetic unlocks can change mascot skins, poses, HUD treatment, streak flame, trophy shelf, icon frame, and celebration effects, but core Forge functionality must never be locked.
- selected-user XP, streak, level, next targets, mascot state, and latest trophies should be visible on the front page.
- the Trophy Hall should show large unique icon art, locked progress, near-completion rails, recently earned rewards, Mascot Armory equipment, and Streak Forge power/absence states.
- gamification art should be selectable in Settings, starting with `Fantasy`, `Dark Fantasy`, and `Mind Locksmith`, and every theme should use clean transparent sprite outputs rather than opaque image-card backgrounds. Heavy trophy, unlock, and mascot sprites must not live in the monorepo package by default; they are downloadable per-style assets, with `Fantasy` as the default lighthearted style.
- Stale pre-release unlock rows may stay in SQLite for audit, but only current source-controlled catalog item IDs may unlock current trophies or cosmetics.
