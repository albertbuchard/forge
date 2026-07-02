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
- OpenClaw, Hermes, Codex, and Claude Code adapter layers
- Swift iPhone companion
- Swift 5 / SwiftUI watchOS companion command surface
- provider-neutral health adapters spanning Swift ingestion, Fastify normalization, and React read models
- transport-explicit mobile pairing: a secure HTTPS/Tailscale URL is preferred when the phone is connected through Tailscale; Iroh is used only for pairings whose active API/UI URLs are `forge-iroh://` logical endpoints; manual HTTP/LAN routing remains an explicit advanced option and must not silently downgrade a physical device to insecure non-loopback HTTP
- Apache-2.0 licensing for Forge-owned public code so open-source releases remain permissive, patent-explicit, and compatible with future closed-source commercial Forge forks

The repository architecture is now clean-break source-first. React/Vite source
and web public assets live in `apps/web`; Fastify source, OpenAPI, and SQLite
migrations live in `apps/api`; the Tauri shell lives in `apps/desktop-tauri`;
the native iPhone/watchOS companion lives in `apps/ios-companion`; OpenClaw,
Codex, and Hermes host adapters live under `plugins/`; npm/Rust packages live
under `packages/`; Playwright and shared fixtures live under `tests/`; and
operational tooling is grouped under `scripts/`. Generated Codex runtime output
and private planning artifacts are not public source.

Forge's preferred public onboarding path is a Node-based guided installer exposed as `npx forge-memory`. That installer should be the single front door for UI-only installs and OpenClaw, Hermes, Codex, and Claude Code adapter installs. It should always install the Forge UI/runtime as the base layer, run automated host/data discovery in the background, ask a polished guided question flow, show host adapters in an interactive checkbox menu with detected runtimes selected by default, missing runtimes shown as disabled "not found" rows, Space to toggle rows, and a Skip option, configure selected adapters against one shared data root, expose runtime commands such as `configure`, `status`, `ui`, `doctor`, `restart`, and `pair-ios`, make `configure` rerun the full flow with current config as defaults, default the iOS pairing prompt to yes, support source-backed development installs through `npx forge-memory --dev`, default dev mode to the real shared Forge data folder, and leave direct adapter installs as advanced/reference paths rather than the main user journey.

The gamified progression layer is part of the same production stack. It uses the existing Fastify reward ledger and SQLite persistence, React 19 UI surfaces, Framer Motion celebrations, source-controlled TypeScript trophy/unlock catalog data, small repo-owned mascot previews under `public/gamification-previews/`, and optional per-style raster sprite archives hosted as GitHub Release downloadable content. Heavy generated trophy, unlock, mascot, atlas, and source sprite files must not be part of the monorepo history or the default npm/PyPI plugin packages.

The current progression direction is Forge Gamification: one canonical source-controlled catalog with 144 achievements and cosmetic unlocks, generated transparent atlas-backed trophy and cosmetic sprites, 30 Forge Smith mascot states, selectable gamification art themes, selected-user-first metric evaluation, and cosmetic equipment that never gates core Forge functionality. Forge defaults to the lighthearted `Fantasy` style but does not download the full art pack until the operator opts in from the first-run prompt or settings. Forge does not maintain stale released-catalog forks; future catalog growth should happen through normal migrations and canonical ID changes when required.

Psyche flashcards are first-class Psyche records stored through shared batch CRUD. They hold one main therapeutic message plus retrieval cues such as tags, trigger sentence, trigger situation, optional compact title, and links to values, behaviors, patterns, beliefs, modes, or trigger reports. The web app should render them as polished flexible cards with selectable colors, typography, layout, visual tone, and optional images. OpenClaw, Hermes, Codex, and Claude Code skills should search flashcards when the user reports an urge or trigger, show the card message first, and then wrap it with brief psychotherapy-informed support.

The Artifact Store is a first-class specialized CRUD surface for trusted files. It stores spreadsheets, documents, presentations, PDFs, plain text, structured text, and images as content-addressed blobs with metadata rows, versions, static safety scans, danger scores, provenance, and audit events. Artifacts are linkable Forge entities, but their relationships must use the reusable `entity_links` model rather than an artifact-specific link table or schema. Agents may list, upload with trusted scoped authority, update metadata, replace generic entity links, rescan, request LLM metadata enrichment, and read versions or audit events. Agents must not download, open, execute, preview, or transform artifact bytes; downloads are a human web/API action only.

Life Events are a first-class chronological memory surface. They store important personal events in a linear timeline with start/end interval, place, type, importance, calendar relationship, artifact relationship, travel details, segments, extraction state, and generic links to other Forge entities. A Life Event can be a short event or a span lasting days, weeks, or months, such as a stay, festival, retreat, visit, vacation, work phase, health episode, course, or custom period. The web view must be virtualized and must use Forge guided modal flows for event creation, event editing, and ticket import. Life Events use shared batch CRUD for normal `life_event` record create, update, search, delete, restore, and generic links; they use a dedicated `/api/v1/life-events/*` route family for timeline reads, one-event reads, calendar reconciliation, marking a calendar event as a Life Event, trusted ticket artifact import, and travel-status reads.

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

Agent runtime identity is separate from Forge user ownership. OpenClaw, Hermes, Codex, and Claude Code each need one stable agent identity per machine/runtime installation, derived from provider, machine/data root, and persona rather than volatile session keys, cron IDs, WhatsApp threads, PIDs, or timestamps. Runtime sessions are history under that identity. Agent identities can link to one or several Forge users, including bot users with their own Kanban ownership, so spawned subagents are modeled as users or linked actors instead of duplicate top-level agents.

Separate code review and final audit skills are not part of this Forge PM workflow and should remain Codex concerns instead.

### 9A. watchOS Companion Command Surface

The watchOS companion is a wrist-first command and logging surface for the main Forge domains, not a second Forge data model. Its production stack is Swift 5, SwiftUI, URLSession direct HTTPS calls when a secure companion URL is reachable, WatchConnectivity relay fallback through the paired iPhone, WidgetKit/App Intents, compact Fastify snapshot endpoints, SQLite-backed command receipts, and the React/TypeScript Forge runtime as the canonical deep-editing surface. The iPhone companion still creates and refreshes the pairing, but the Watch receives scoped companion connection metadata and should submit commands directly to Forge over HTTPS/Tailscale whenever that route is reachable. WatchConnectivity remains the durable fallback for unreachable private URLs, offline watches, and paired-device state refresh.

The watch interaction grammar is fixed: the Digital Crown moves between main surfaces, left/right card navigation moves within the selected surface, and tapping a card opens a short action modal. Required surfaces are Now, Work/Kanban, Habits, Goals/Projects, Today, Health, Movement, Psyche, Inbox, and Sync. Every surface must provide a useful fast action or capture fallback even when its rich snapshot is temporarily empty.

Watch mutations flow through compact, idempotent command batches. Work actions use the existing task and task-run semantics: start, heartbeat, focus, complete, release, and status moves across `backlog`, `focus`, `in_progress`, `blocked`, and `done`. Habit actions preserve canonical `done`/`missed` storage while using polarity-aware watch labels such as Done/Missed for positive habits and Resisted/Performed for negative habits. Capture events for movement, Psyche, inbox prompts, health annotations, and moment notes carry stable dedupe keys so direct watch submission or phone-relay replay cannot duplicate user data.

Watch snapshots must be data-backed. A valid mobile pairing must receive compact watch data even if it was created before newer capability flags such as `watch-ready`; the bridge must not overwrite cached watch state with an empty snapshot merely because it is waiting for pairing or transport. Psyche watch prompts must be derived from Forge's actual event types, emotion definitions, values, behavior patterns, behaviors, modes, and recent trigger reports when those records exist. Watch Psyche captures should project into the canonical Psyche surfaces: trigger captures create trigger reports plus linked observed notes, and emotion/routine/moment captures create note-backed self-observation calendar entries.

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

### 10A. Artifact Store Contract

The Artifact Store is a local-first file evidence surface, not an execution sandbox. It must preserve user data without deleting, rewriting, or running file contents autonomously.

Artifact records must include precise durable metadata:

- `id`
- title
- short description
- long description
- original file name
- detected extension
- declared and detected MIME type
- content SHA-256
- byte size
- content-addressed storage key
- storage path
- source kind and source label
- uploader or acting actor provenance
- artifact state
- download policy
- danger score and danger level
- scan results
- enrichment results
- user metadata
- generic entity links
- created and updated timestamps

The supported create path is `POST /api/v1/artifacts`, which accepts trusted file bytes as base64 and immediately writes metadata, a content-addressed blob, a version row, static scan results, and an audit event. `GET /api/v1/artifacts` and `GET /api/v1/artifacts/:id` return metadata only. `PATCH /api/v1/artifacts/:id` changes metadata only. `POST /api/v1/artifacts/:id/links` replaces relationships through `entity_links` with the artifact as the source entity. `POST /api/v1/artifacts/:id/scan` reruns static scanning. `POST /api/v1/artifacts/:id/enrich` uses a configured LLM to fill missing title, descriptions, source/provenance notes, metadata, and risk explanation from safe metadata and scanner samples when requested. `POST /api/v1/artifacts/:id/trust` records explicit trusted state changes. `GET /api/v1/artifacts/:id/versions` and `GET /api/v1/artifacts/:id/audit` expose history. `GET /api/v1/artifacts/:id/download` is available only to an authenticated human operator session.

The static scanner must be deterministic and conservative. It should block disallowed extensions, flag size and MIME mismatches, inspect Office zip structure for macros, encryption, embedded objects, external relationships, hidden sheets, links, and formulas, inspect PDFs for JavaScript/actions/embedded files, inspect CSV/TSV formula-like cells, and validate structured text where possible. Optional LLM enrichment can add descriptions and risk explanation, but it must never lower the deterministic danger score.

Agent-facing surfaces must expose the same contract:

- OpenAPI documents every artifact route and the `EntityLink` / `EntityLinkInput` schemas.
- OpenClaw, Hermes, Codex, and Claude Code use a dedicated artifact route tool for artifact operations.
- Batch CRUD may search, update, soft-delete, restore, and hard-delete artifact metadata only; it must not create file artifacts or expose bytes.
- Agent tools must not expose the download route.
- Wiki and other entity surfaces may embed or reference artifacts through normal Forge links to `/artifacts/:id` and through general entity links, not through a separate artifact-link model.

### 10B. Life Events Contract

Life Events are the structured memory surface for important events in time. They are linked to the calendar but remain their own Forge entity because they preserve significance, context, evidence, travel details, and relationships beyond scheduling.

Life Event records must include durable metadata:

- title
- short description and long description
- event type
- status and importance
- start and end time, timezone, and all-day flag
- place label, address, timezone, and optional coordinates
- origin and destination labels, cities, countries, and optional coordinates
- transport mode
- primary calendar event id, sync state, and match confidence
- source kind, source artifact id, extraction status, and extraction summary
- travel details, display style, metadata, segments, ownership, timestamps, and deletion state
- generic entity links to calendar events, artifacts, wiki pages, goals, projects, tasks, Psyche records, notes, movement context, and other Forge entities

The supported route model is split deliberately:

- normal `life_event` create, update, search, soft delete, restore, hard delete, and generic links use shared batch entity routes
- `GET /api/v1/life-events/timeline` powers the virtualized chronology view
- `GET /api/v1/life-events/:id` reads one event with segments and links
- `POST /api/v1/life-events/:id/calendar-sync` links or creates the corresponding calendar event
- `POST /api/v1/life-events/from-calendar-event` creates or links a Life Event from an existing `calendar_event`
- `POST /api/v1/life-events/import-ticket` drafts or creates a travel Life Event from a trusted Artifact Store artifact
- `GET /api/v1/life-events/:id/travel-status` reads scheduled or provider-backed travel status

Life Event ticket import must start from a trusted Artifact Store artifact. Agents must not download, execute, decrypt, preview, transform, or independently parse stored artifact bytes. If LLM extraction is requested, it must use an approved configured extraction path and must expose when LLM extraction is unavailable rather than silently guessing.

The Life Events web app surface must:

- render a fast virtualized timeline that handles many events without crowding the UI
- show past, current, and future events clearly
- provide type-specific cards for travel, flights, train/car/boat trips, concerts, cinema, dates, friends/family, work or thesis milestones, health/admin events, celebrations, and custom events
- use guided modal forms for event creation and ticket import
- allow multiple ticket files in one import flow, with per-file review where missing information needs attention
- use calendar reconciliation both directions: Life Event to calendar and calendar event to Life Event
- keep maps and status detail lazy so the timeline stays responsive
- use generic entity links for all cross-entity relationships

### 11. Health Workout Adapter Contract

- Workout imports must not leak raw provider activity placeholders such as `activity_52` into the main product UI when the source system can resolve them.
- The canonical workout adapter contract must normalize provider-native activity identifiers into a structured descriptor:
  - `sourceSystem`
  - `providerActivityType`
  - `providerRawValue`
  - `canonicalKey`
  - `canonicalLabel`
- Workout sync is raw-evidence-first. The companion and backend must preserve workout-associated HealthKit evidence locally before computing derived analytics. Preserved evidence includes heart-rate samples, supported workout quantity samples, route points, workout events, activity phases/components, source/device metadata, scalar summaries, and partial-permission quality flags.
- Mobile HealthKit backfills must use resumable, byte-stable chunk uploads with large target sizes, optional deflate-compressed base64 wire payloads, and immediate workout-summary application so the user can see the workout count increase before the whole session completes. The one-time historical workout import must not block normal sync: movement, sleep, vitals, screen time, and recent workouts need their own completion path while older workouts continue in a separate import lane.
- Heart-rate zone analytics are computed by Forge, not assumed to exist as historical HealthKit zone totals. The default model is adaptive Heart Rate Reserve/Karvonen with resting HR, known or inferred max HR, optional physiology profile fields, confidence levels, and clear unavailable/low-confidence states when raw HR is missing.
- The Sports web surface must expose both aggregate training intelligence and per-workout drill-down: zone mix, training load, HR coverage, resting HR/VO2max context, route availability, dense HR timelines with zone bands, route maps with explicit tile-source configuration, events, phases, metrics, and polished missing-data states.
- Cardiovascular training-target analytics must have their own read-model surface separate from the general Sports cockpit. Forge exposes `/api/v1/health/training-load`, OpenAPI contract `TrainingLoadViewData`, OpenClaw/Hermes/Codex/Claude tool coverage through `forge_get_training_load_overview`, and the React `/training-load` view for acute 7-day load, chronic 28-day weekly load, acute:chronic ratio, monotony, strain, HRR zone distribution, Z4/Z5 threshold exposure, easy/moderate/hard intensity split, VO2max and resting-HR context, sport contribution, recent session signals, data-quality caveats, and target bands. The view must remain summary-first, responsive on desktop and mobile, and explicit that wearable HR and derived load are decision-support signals rather than clinical diagnosis.

### 12. Weight Loss And Nutrition Contract

The Weight Loss surface is a first-class Forge health cockpit, not an inline questionnaire or a simple food diary clone. Setup, food logging, body measurements, subjective check-ins, gut check-ins, appearance check-ins, and objective changes must use guided modal flows. The page itself should remain a dense dashboard for current targets, food ledger, body trend, sport-fuel context, micronutrient coverage, gut/energy/look signals, and hypothesis cards.

The calorie model must separate current body state, resting burn, active burn, and objective math. Forge pre-fills sex, age, height, latest weight, HealthKit basal energy, HealthKit active energy, workout energy, and movement-trip calories when known. Nutrition body check-ins are the editable weight source for this surface, but HealthKit `bodyMass` seeds the latest weight when no nutrition check-in exists yet. Forge uses Mifflin-St Jeor from stable profile inputs as the default resting-energy baseline for weight-loss targets because target setup must not depend on partial HealthKit sync windows. HealthKit `basalEnergyBurned` is preserved and shown as resting-energy calibration evidence only after Forge proves local-day coverage and plausibility; it may become an explicit reviewed user override, but it must not silently replace the formula baseline. Active calories come from HealthKit/workouts/movement and never change because the user chooses lose, gain, or maintain. The active baseline is the average of measured active-energy evidence from the prior seven days, excluding today and ignoring days with no measurements instead of treating missing sync as zero. Same-day active energy remains separate and can only create a positive activity buffer above the saved baseline. The objective only applies a signed deficit or surplus from the selected weekly weight-change rate: `target_kcal = formula_resting_kcal + active_burn_kcal + objective_daily_delta_kcal`, with any HealthKit resting-energy override recorded as an explicit source choice. The weekly-rate-to-calorie conversion uses the Hall/NIDDK linearized adult dynamic body-weight model over Forge's default 84-day planning horizon. The static `7700 kcal/kg` rule may remain visible as an audit comparison, but it must not be the primary target equation.

Nutrition targets must include all macros plus a detailed daily vitamin, mineral, trace-element, essential-fat, water, sodium-ceiling, and sport-loss view. Macro math must be internally consistent: protein is generated from g/kg goal posture using a sane reference weight rather than blindly multiplying current mass in every case, fat keeps a practical floor and AMDR context where possible, carbohydrates use remaining energy, and the 130 g/day carbohydrate DRI is shown as reference rather than forced when it would make total macro calories exceed the target. Sport losses are displayed as expected ranges for fluid, sodium, and potassium, calibrated from active/exercise evidence when possible and never presented as medical supplementation orders.

The insight layer must connect food to Forge context: workouts, movement places, sleep, vitals, Psyche observations, notes, calendar events, projects/tasks, energy, focus, cravings, gut symptoms, and private user-defined appearance metrics. AI food parsing uses the existing ChatGPT/Codex OAuth path, stores candidates as unconfirmed until accepted, and must not default to OpenAI Platform API billing.

Food logging must preserve reusable nutrition facts instead of creating name-only meal fragments. Forge keeps a local nutrition food catalog that includes public-source cache entries and user custom foods. Agents and UI flows should search that catalog before logging; when a match exists, they pass the catalog `foodId` into the food log so the same food can be reused. If no match exists, a custom food may be created only with at least calories plus protein, carbohydrate, and fat for the stated serving. Agents should research those nutrition facts from reliable internet or public nutrition sources before saving a custom food when the user does not provide them.

### 13. Gamification Achievement Contract

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
  - raw metric timelines
  - route points
  - workout events
  - workout components or phases
  - provider metadata
- Apple Health and HealthKit are the first production adapter path, but the architecture must stay modular so Android Health Connect, Garmin, and other providers can plug into the same backend and UI contract without forking the product model.
- The web sports surface must present friendly workout naming, provider provenance, and captured metrics/events/phases directly in the session UI instead of hiding them behind transport-only fields.

### 14. Psyche Daily Metrics

Psyche metrics are daily, local-first measurements derived from stored observations rather than live page-time scanners. Devrage is the first metric family: it stores conversation-day counts and daily metric rows for user-message swear count, swearing-message percentage, average per-thread max cumulative rage, and max cumulative rage, exposes those rows through a Psyche Metrics view, and renders them with the same history, coverage, baseline, delta, and sparkline treatment as Vitals. The cumulative rage score is intentionally simple: swear-bearing user messages add their swear count, clean user messages cool the thread score down by one, and Forge records the per-thread peak plus daily averages and maxima. If no conversations or stored metric rows exist, devrage-specific cards stay hidden while the generic Metrics route remains available for future Psyche measures.

### 15. Gamified Progression

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
