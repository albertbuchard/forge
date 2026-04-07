# Forge — Product Vision

Forge is a local-first execution and reflection product for a user who wants one place
to run life direction, projects, tasks, live work sessions, rewards, and psychological
self-observation without splitting that operating model across several tools. The
experience should feel serious, modern, and emotionally literate. When the user opens
Forge, the product should help them understand what matters, what is moving, what has
earned momentum, what should happen next, and how their patterns of behavior are
helping or interfering.

The product should not hide behind abstract slogans or invented category names. Each
view should say exactly what it is showing. If a page is about goals, it should say
Goals. If it is about projects, it should say Projects. If it is about Psyche reports,
it should say Reports. The subtitle can add nuance, but the primary title must name the
entity or function clearly. The user should not need to decode the product's language
before they can use it.

## The Product As A Whole

Forge is built around a hierarchy of meaning and execution. Life goals express the
directions the user wants to move toward over months or years. Projects convert those
directions into concrete, active bodies of work. Tasks break projects into executable
units. Task runs capture real timed effort. XP, streaks, momentum, quests, and rewards
make progress visible and emotionally tangible. Psyche records help the user understand
values, triggers, modes, beliefs, patterns, and reports that influence how they live
and work. Insights help synthesize what the system is learning.

All of these layers must work together. A task should not feel detached from its
project. A project should not feel detached from its goal. A Psyche observation should
be able to connect back to a project or task when relevant. A reward should be
traceable to actual behavior. This is what makes Forge one coherent structured memory
product rather than just a set of pages.

That operating model must now be explicitly multi-user. Forge should support multiple
Forge users in one runtime, and every Forge user must be marked as either `human` or
`bot`. Ownership has to be visible across the product: a project card, task detail, or
search result should make it clear who owns the record without turning the interface
into a permissions dashboard.

Forge also needs one new planning layer above projects: Strategy. A strategy is a real
entity, not a note convention. It exists to describe how one or more goals or projects
will be reached over time through a directed, non-cyclic graph of project and task
steps. Strategies should give the user a truthful plan view instead of forcing all
long-range sequencing into flat project descriptions.

Forge also needs a first-class Preferences workspace. Preferences are not just settings
or recommendation metadata. They are a stored, inspectable, algorithmic model of what
one user prefers within a domain and a context. The product should be able to learn
from pairwise comparisons, direct signals such as favorite or veto, and explicit
feature dimensions without using LLM inference to guess the result.

Notes are part of that operating model. A note is not a decorative comment field
inside another record. It is a first-class Markdown entity that can attach to one or
many goals, projects, tasks, and Psyche records so the user can preserve progress
evidence, close-out summaries, and contextual explanation without fragmenting the data
model. Notes should support note-owned tags so the user can classify them with custom
labels or with explicit cognitive memory-system labels such as working memory,
short-term memory, episodic memory, semantic memory, and procedural memory. Notes
should also be able to act as ephemeral scratch memory: when the user sets a destroy
time, Forge should automatically remove the note once that time passes.

That document model must also scale into a first-class Wiki workspace. Forge should
offer a file-first wiki where richer long-form pages, media assets, and evidence notes
all live inside the same explicit local memory system. The wiki should combine the
flexibility of markdown and backlinks with structured Forge entity links, shared and
per-user spaces, and optional semantic search driven by user-configured embedding
profiles. Embeddings are additive, not foundational: free-text search and entity-linked
search must remain useful even when semantic indexing is disabled.

Habits should be first-class recurring records, not tasks in disguise. They need their
own navigation entry and management page, with frequency rules, positive and negative
variants, and XP logic that makes completion and omission feel materially different.
They should also link back to Psyche behaviors so the system can connect action to the
underlying pattern rather than treating habit tracking as a detached checklist.
Habits now also need an optional generation layer for health records. A habit like
Morning Sport Routine or Evening Mobility should be able to create a structured workout
or recovery session in Forge when completed, with source attribution showing that the
record came from a habit first and may later reconcile with a HealthKit import.

## What The Main Views Are Supposed To Do

The Overview page is the user's high-level control room. It should summarize the state
of goals, projects, active work, momentum, and recent evidence without becoming a wall
of status boxes. Its purpose is orientation. The user should be able to land there,
understand the state of the system, and choose where to go next.

The Today page is the user's daily execution page. It should explain today's meaningful
work in plain language, show XP and reward context prominently, surface the tasks that
deserve action now, and let the user start work with minimal friction. This view should
not speak in vague metaphors. It should behave like a daily operating page.

The Kanban page is the flagship task-execution board. It should show the current task
lanes, let the user drag tasks between states, and make it easy to start work directly
from the board. The board must remain structurally stable. Columns should not overlap,
cards should wrap text cleanly, and the selected-task panel should emphasize raw task
data and actions over decorative prose.

The Goals page should explain what each life goal is, how much progress it has made,
which projects are carrying it forward, and whether the direction is active or drifting.
The page should help the user understand strategic direction in a way that is still tied
to concrete work. It should also make ownership visible and let the user intentionally
filter or widen the view to other humans or bots.

The Goal detail page should focus on one life goal. It should explain the goal itself,
show the projects attached to it, summarize progress and health in a compact way, and
let the user move naturally from long-term direction to current execution.

The Projects page should present projects as real initiatives that serve goals. It
should let the user see project status, active work, progress, and relationships to
goals without burying the meaning of the project behind jargon. The page should default
to the active project collection, but it must also make suspended and finished work
easy to bring back with explicit lifecycle filters. It should expose a prominent search
surface that mixes free text with searchable goal, task, tag, status, and lightweight
project-type chips so a user can narrow the project list without losing context.
That search surface must now be user-aware. The user should be able to tell whether a
matching project belongs to a human or a bot, and should be able to search or filter by
owner explicitly instead of assuming the current operator is the only namespace.

The Strategies page should be the plan-and-sequencing surface for Forge. It should list
strategies, show which goals or projects each strategy is trying to reach, surface
alignment metrics based on the completion state of linked task and project nodes, and
let the user inspect the graph structure in a way that remains understandable on both
desktop and mobile. The detail view should show the overview, end-state description,
linked entities, graph branches, available next nodes, and current alignment with the
strategy. Strategy creation should use the same large, guided, multi-step question-flow
standard as other important Forge entities rather than a cramped all-fields sheet. The
final creation step should focus on the actual sequence: search goals, projects, and
tasks clearly, reorder selected project and task steps directly, create missing tasks on
the fly, and keep the branching model understandable instead of exposing raw graph jargon.
After save, the strategy detail page should present the plan as a collapsible hierarchy
of sequential phases and parallel branches so the user can refine or extend the plan
without reverse-engineering a DAG from scratch.

The Preferences page should be a first-class workspace with its own icon in the main
navigation and its own internal tabs. The landing view must start with what Forge
currently knows about one user's preferences inside the selected domain: learned shape,
confidence, uncertainty, context, and obvious gaps. If evidence is still thin, the page
should say so plainly and center one prominent call to action such as Start the game
instead of forcing the user to assemble comparison sets by hand.

The compare interaction itself should no longer live as a crowded permanent page block.
Starting the game should open a focused modal: first choose the broad domain or concept
area, then let Forge bring the comparison candidates automatically. If the user chooses
a Forge-native domain such as projects, tasks, strategies, or habits, Forge should draw
from the relevant entity pool directly. If the user chooses a broader taste domain such
as food, places, people, countries, fashion, media, or activities, Forge should draw
from a seeded concept library instead of asking the user to type every option.

Preferences therefore need an editable concept-library layer. Forge should ship with a
large hardcoded starter catalog of concept lists across non-Forge domains, but those
lists must become real user-editable records once loaded. The user should be able to
inspect the known concept lists, create new lists, add items, rename them, and delete
ones they do not want. These libraries exist to make the game useful immediately while
still leaving the model open to correction and extension.

The actual pairwise interaction should stay visually simple. On desktop the game should
show two large cards side by side; on mobile it should stack them vertically. Choosing a
side should be as simple as clicking or tapping the preferred card. The card contents
should stay sparse, usually just the title plus a short line when needed, because the
goal is fast judgment rather than reading a wall of metadata.

Outside the game, the Map tab should show a global 2D preference map with score and
uncertainty overlays. The Table tab should expose exact item-level scores, confidence,
evidence, status, and manual overrides. The History tab should show recent judgments,
score movement, drift, stale evidence, and model flips. The Contexts tab should let the
user create, rename, merge, enable, disable, and set defaults for preference contexts
inside a domain. Forge should also expose a dedicated Concepts tab so the user can audit
and edit the starter libraries that power automatic comparison rounds.

The Calendar page should be a first-class execution surface. It should show mirrored
provider events, recurring work blocks, and task timeboxes together in one readable
week or day view. It should make provider connection state obvious, support fast
creation of half-day presets such as Main Activity, Secondary Activity, Third
Activity, Rest, Holiday, or Custom, and make future task scheduling feel direct
rather than administrative. Work blocks must support optional start and end dates,
repeat indefinitely when no end date is set, and be editable or removable from the
visible calendar through a small submenu on the rendered block card. Holiday planning
should use this same work-block system instead of creating fake repeated events. The
week view should be the priority layout on desktop, while small screens should
intentionally restack it into one readable day row at a time instead of leaving a
crushed multi-column grid. The page should not carry raw provider setup forms inline.
Provider configuration belongs in Settings, while the Calendar page itself should offer
display-first visibility plus guided action flows for work blocks, task-rule editing,
timebox planning, and native event creation. A user must be able to create a Forge
calendar event even without any provider connected, link it to goals, projects, tasks,
or habits, and later choose whether that event should project out to a writable remote
calendar. The current provider roster should explicitly cover Google Calendar, Apple
Calendar, Exchange Online, and custom CalDAV. Apple must rely on autodiscovery from
`https://caldav.icloud.com` instead of asking for raw collection URLs. Exchange Online
must use Microsoft Graph and be clearly marked as read-only for now, meaning it
mirrors selected calendars into Forge but does not receive Forge-owned work blocks,
timeboxes, or native event projections yet. In the current self-hosted local Forge
runtime, its setup path should be a guided Microsoft public-client sign-in flow with
PKCE in Settings rather than a user-facing form for client secrets or refresh
tokens. For self-hosted local Forge, the Microsoft client ID, tenant, and redirect
URI should be configurable from the Calendar settings UI itself so the operator does
not have to treat backend env vars as the primary setup surface.
Calendar event editing now also needs a structured place model. The user should be able
to enter a readable place label plus address and timezone fields, with room for future
coordinates or provider place identifiers, so location-aware planning can build on the
existing calendar surface instead of replacing it.

The Sleep page is a first-class reflective surface. It should show recent nights,
derived sleep quality and regularity, stage breakdown when available, bedtime and wake
timing, and user-authored reflective context. Each night should stay linkable to goals,
projects, tasks, habits, notes, values, beliefs, patterns, reports, and calendar
context. The page exists to help the user reason about sleep as part of their real life
operating system, not as an isolated wearable dashboard.

The Sports page is a first-class execution and reflection surface for workouts. It
should show training volume, workout types, energy and distance where relevant, and a
session-first browser that also supports subjective effort, mood, meaning, and links
back to projects, values, routines, Psyche patterns, and sleep outcomes. Imported
HealthKit workouts and habit-generated sessions should feel like one coherent Forge
record model with visible provenance.

The Project detail page should be board-first and action-first. The main task board for
the project should dominate the page, because that is the work surface. Project status,
progress, tracked-time summary, signed work-adjustment controls, and evidence should
support that execution surface rather than crowd it out. Suspend, finish, restart, and
delete actions should be explicit on this page, with delete defaulting to soft removal
and finish behaving like a real project close-out rather than a cosmetic status flip.

The Task detail page should present a task plainly. The title, status, project, goal,
owner, due date, time tracked, active timer state, and clear actions such as Start
work, Pause, Complete, Adjust work, Edit, and Delete should appear before filler text.
If a user wants to understand or act on a task, this page should make that obvious
immediately.
Task detail also needs to show the Forge user owner clearly and make cross-user links
legible when the task belongs to one user but supports a project, goal, or strategy
owned by another.
Core entity detail pages and major browse surfaces should also expose a light handoff
into Preferences so the user can explicitly send a goal, project, task, strategy, or
habit into the compare queue or preference item list when they want Forge to learn from
that object.
At the bottom of each main detail page, Forge should show a coherent notes surface that
renders Markdown cleanly, supports quick authoring with preview, and makes linked work
evidence feel native instead of bolted on.
Forge should also have a dedicated Notes page that treats notes as first-class entities:
searchable, editable, deletable, filterable by linked entities, note tags, date, and
free-text chips, and able to create standalone linked notes without forcing the user
through some other entity flow first. The Notes page and the inline note surfaces on
detail pages should both expose memory-tag presets, custom tag entry, and ephemeral
destroy-time controls instead of reserving that metadata for a hidden advanced editor.
The Notes page search and link pickers must make cross-user linking explicit so the user
can intentionally attach a note to another user's project, task, strategy, or Psyche
record.

Forge should now also have a dedicated Wiki page in the main navigation. That workspace
should feel like an explicit memory vault, not a note editor stretched too far. The
user should land on a seeded `index` home page, browse a hierarchical page tree,
open article routes by slug, search by text, entity, or semantic recall in a focused
modal, inspect backlinks, open canonical page files, and move into separate `/wiki/new`
or `/wiki/edit/:id` writing routes when they actually want to edit. Wiki article
metadata should be authored inside markdown through directive blocks such as
`:::forge-infobox`, while standard admonitions and Forge-specific blocks remain part of
the same Markdown-first authoring model. The Wiki settings surface should let the user
manage spaces, parse profiles, embedding profiles, vault sync, and reindexing without
dropping to the filesystem.

Auto-ingest belongs inside that wiki operating model. Forge should accept raw text, URL,
and local-path sources immediately and be ready to expand toward multimodal document,
image, audio, and video ingest through LLM-backed profiles. The output should be
explicitly inspectable: generated wiki pages, stored media assets, backlinks, and any
suggested Forge entities should all remain visible and editable by the user.

The Weekly Review page should help the user examine what moved, what stalled, what was
learned, and where next adjustments are needed. It should turn the operating record into
a readable review ritual, not just another dashboard.

The Activity page should act as a historical timeline of meaningful events. It should
show what happened, when it happened, and which entities changed. It must behave like a
clear activity log rather than a vague “stream.”

The Insights page should present structured observations, interpretations, or proposals
that the user or trusted agents have stored. It should help with synthesis while staying
grounded in the real data and entities already in Forge.
Its action model must be explicit: Accept keeps a recommendation acknowledged, Apply
turns it into a real Forge record such as a task, project, goal, or linked note, and
Dismiss removes it from the active feed.

The Settings area should explain the current configuration of the runtime, rewards,
agents, token flows, multitasking limits, time-accounting mode, recovery tools, and
operator controls in a calm and explicit way. It should not feel cramped or like a
developer-only panel. Calendar provider setup and connection health also belong here
under a dedicated Calendar section, including a guided connection modal and a step-
by-step setup guide that names the exact credentials and URLs Forge needs. Settings
must be legible on mobile and desktop.
Settings also needs a user-management surface. The product should be able to list human
and bot users, create or edit them, show their labels and types clearly, and expose the
current permissive sharing posture while leaving room for future policy controls.
That surface should also show a directed relationship graph where each arrow answers
what one user or agent can see, link, plan, or affect on another user, and it should
show per-user XP so collaboration still has visible individual reward traces.
Settings now also needs a Mobile section. That section owns Forge Companion pairing,
shows QR onboarding, shows companion connection state such as connected, stale,
permission denied, or healthy sync, and explains what data is being imported from the
iPhone runtime.
The paired iPhone companion itself should use Forge as the main surface. Once pairing
is complete, the default screen should be a full-screen embedded Forge web view rather
than a second native dashboard. Native iOS controls should sit behind a floating
companion button that opens a clear control center for HealthKit permissions, sync,
device state, and logout.

The Psyche hub is the entry point into the reflective part of Forge. It should explain
what the Psyche module contains, how it relates to goals and behavior, and where the
user can go next.

The Psyche Values page should let the user define the values they care about and inspect
how those values relate to action. The Psyche Beliefs and Schemas page should let the
user record beliefs or schema-like rules that shape behavior. The Behaviors page should
capture recurring actions or habits. The Modes page should describe recurring internal
states or strategies the user enters. The Mode Guide page should help explain those
modes clearly. The Patterns page should connect values, beliefs, modes, and behaviors
into repeatable loops. The Reports page should capture observed events, incidents, or
reflections. The Psyche Report detail page should let the user inspect one report in
full. The Goal Map page should visualize how goals connect to related entities through a
graph that uses the same identity system as the rest of the app.
The Psyche Questionnaires page should act as a rich assessment library, not a raw table.
It should let the user browse seeded self-report instruments, search by title or alias,
pin facet chips for domain and source class, open a detail surface with provenance and
history, and move straight into a guided run or builder draft. The guided runner should
feel immersive and focused, using single-question flow for short tools and grouped
batched Likert flow for long inventories such as YSQ-R. Questionnaire results should
stay longitudinal: raw answers, computed totals, subscores, bands, and prior run trend
points should remain explorable over time on the detail and run-result surfaces.
These Psyche surfaces and the matching agent tools should guide the user through
active-listening exploration rather than dumping raw fields. Value work should clarify
direction and committed action. Pattern work should slow down into a functional
analysis. Behavior work should map cues, payoffs, and replacement moves. Belief work
should surface the exact sentence and test flexibility gently. Mode work should name
the part's job, fear, and burden. Trigger reports should capture one episode clearly
enough to learn from it. When a conversation reveals linked beliefs, modes, patterns,
or values, Forge should help the user map those adjacent entities without losing the
natural flow of the session.

Forge must not introduce alternate product names for existing entities. Projects are
projects. Goals are goals. Values, beliefs, behaviors, modes, patterns, reports,
insights, rewards, and tasks should keep those exact names. If an old compatibility
route such as `/campaigns` still exists, it must remain a deprecated redirect or API
alias only. The user-facing product should not present campaigns as a separate concept
when the real underlying entity is a project.

Preferences should keep the same explicit naming discipline. A profile is a profile, a
context is a context, a preference item is a preference item, a judgment is a
judgment, and a signal is a signal. The product should not rename them into abstract
marketing language.

## The Core Interaction Model

Forge should make creation and editing feel guided rather than administrative. When the
user is creating a task, project, pattern, report, or related record, the form should
help them think rather than dump raw schema fields at them. Linked-entity fields should
use searchable multi-select controls with creation on the fly when that relationship
makes sense. The user should be able to create a missing belief, pattern, mode, or
other related entity without abandoning the current form.
Strategies need an even stronger version of this posture: metadata and objective should
be separated from sequence building, the last step should behave like a plan composer
rather than a database editor, and post-save strategy UI should make parallel work legible
enough that the user can add or refine branches intentionally.
Those forms now also need to make ownership explicit. Creating a goal, project, task,
habit, note, calendar event, or strategy must let the user choose which human or bot
owns the new record, while linked-entity controls must remain capable of reaching
across user boundaries when that is intentional.

Starting work must feel frictionless. The app bar should contain the global timer rail,
which is where the user can see active work, start new work, switch focus, pause work,
or complete work. The Kanban page and task detail page should also offer direct Start
work actions. Starting a task should move it into `in_progress`, start a real task run,
and visibly update the timer state.

Calendar-aware work gating must be explicit. Projects hold default scheduling rules,
tasks may inherit or override them, and starting blocked work should fail cleanly
unless the caller provides an override reason that remains attached to the resulting
task run or timebox.

Calendar events must use Forge identity first. The canonical event record lives inside
Forge, source mappings to Google, Apple, or custom CalDAV live in a separate sync
layer, and links from events to goals, projects, tasks, habits, notes, or other Forge
records live in a separate relationship layer. The product should behave as if Forge is
the calendar system, with external providers acting as synchronized projections rather
than the primary source of meaning.

Project lifecycle must stay truthful across UI and API. Suspending a project means
setting its status to `paused`. Finishing a project means setting its status to
`completed`, which should automatically close linked unfinished tasks through the same
task-completion path that rewards and activity logging already use. Restarting a
project means setting its status back to `active` without reopening the finished tasks.
Collection views should hide suspended and finished projects by default, but selection
surfaces and search should still be able to reach them.

Strategy lifecycle and metrics must also stay truthful. A strategy is aligned when the
real state of its linked projects and tasks matches the path the graph describes. The
product should compute alignment from real completion and in-flight status, not from a
manual “aligned” toggle. Available next nodes should come from graph predecessors that
are already complete, and the strategy graph must reject cycles. The graph itself
should be visually explorable in the UI, and alignment should break down into plan
coverage, sequencing, scope discipline, and quality so the user can see why a strategy
is drifting instead of only seeing one opaque score.

Forge should expose three explicit execution-accounting paths and keep them separate in
both the UI and the API. Live work uses task runs. Completion-style retrospective work
uses the operator work-log flow when the work already happened and should be recorded
as a finished item. Signed minute corrections on existing tasks or projects use the
work-adjustment flow so tracked time can be repaired without pretending a live session
occurred.

XP should be visible, emotionally legible, and tightly bound to real behavior. Starting
work, sustaining work, finishing work, and completing meaningful tasks should all earn
or adjust XP in explainable ways. Every XP gain or loss should create a lightweight
snackbar or similar feedback so the reward system feels alive. On smaller screens, XP
should be treated as important product information, not hidden behind secondary controls.

## Design Language

Forge should look premium, but the premium quality should come from clarity, hierarchy,
spacing, motion, and consistency rather than from confusing labels. Entity identity is
part of the design system. Goals, projects, tasks, values, beliefs, behaviors, modes,
patterns, reports, insights, and rewards should keep consistent colors, icons, and
surface treatments across the app, including graphs and compact chips. A user should be
able to recognize what something is from its label, icon, and tone without relearning
that identity on every page.

Help should be lightweight and contextual. When the product uses a concept that may not
be obvious, such as momentum, split time accounting, modes, patterns, or beliefs, the
UI should offer a tooltip or concise explanation. Help should clarify, not overwhelm.

## Mobile And Desktop Expectations

Forge must be designed for both desktop and mobile simultaneously. Desktop surfaces can
take advantage of wider layouts, persistent side navigation, richer board views, and
multi-panel detail arrangements. Mobile surfaces must reorganize content intentionally:
stack panels, simplify density, preserve access to primary actions, and avoid overflow.
The mobile experience should still allow the user to understand active work, inspect
tasks, start timers, read rewards, and navigate Psyche records without feeling like
they are using a broken fallback interface.

## Runtime, Stack, And Delivery

Forge currently ships as a React 19.1 and TypeScript 5.8 application built with Vite
6.3 and Tailwind CSS 4.1. The front end uses React Router 7 for navigation, TanStack
Query for server-state synchronization, React Hook Form and Zod for forms, dnd-kit for
Kanban interactions, Framer Motion for motion, Recharts for charts, and Lucide React
for iconography. The API runtime is Fastify 5, started through `tsx`, and served
locally on port `4317` by default. The web application lives under the `/forge/` base
path, and the versioned REST contract is documented through OpenAPI 3.1 at
`/api/v1/openapi.json`. The current agent-integration stack spans the published
OpenClaw adapter, a Hermes plugin packaged as a Python distribution with Hermes
entry-point discovery, and a repo-local Codex MCP adapter. Forge also publishes an
engineering-first GitHub Pages site from `openclaw-plugin/docs`, and that static docs
artifact includes a rendered API reference generated from the same OpenAPI document so
the public documentation surface does not drift from the runtime contract. Calendar
provider sync runs inside this live runtime today,
with Google Calendar, Apple Calendar, and custom CalDAV adapters, encrypted provider
credentials, migration-backed calendar tables, and a dedicated Forge calendar per
connection. Apple setup is discovery-first from `https://caldav.icloud.com` rather

The Wiki memory system is part of this same production stack. Markdown pages and media
assets are canonical files on the local filesystem, while Fastify and SQLite manage
metadata, backlinks, lexical search, embedding chunks, ingest jobs, and profile
configuration. That file-over-app posture is a product requirement, not an implementation
accident.
Questionnaire delivery belongs in that same stack. The library, builder, runner, and
history surfaces are React routes backed by Fastify endpoints and SQLite tables for
questionnaire instruments, versions, runs, answers, and score rows. The scoring layer is
a safe JSON-AST evaluator on the server, not freeform string execution in the browser,
so mathematical score formulas, dependent subscores, and threshold labels remain
inspectable and reproducible.
than raw calendar-URL entry. The canonical event layer is local-first: Forge events,
event-source mappings, and event links all live in the local database and are then
reconciled outward to connected providers.
Forge now also includes a native iOS companion scaffold in `ios-companion/`, built with
SwiftUI on iOS 17+, using HealthKit for sleep and workout access, BackgroundTasks for
refresh hooks, AVFoundation for QR scanning, Core Location as a future-ready capability,
and WatchConnectivity as the intended watch bridge. The iOS companion talks to the same
Fastify runtime through pairing-session tokens and dedicated mobile health sync routes,
while imported sleep and workout records are stored in Forge-owned SQLite tables with
provenance, derived metrics, annotations, and reconciliation support.

That live runtime must now carry a first-class `users` table plus user-aware ownership
columns on the core user-authored entities. Search, snapshot assembly, detail views,
and batch CRUD need explicit user-scope fields. Strategy also needs its own
migration-backed storage and validation layer, including DAG validation for the graph
payload.

Fresh production databases must start empty of fake user goals, projects, and tasks.
Demo or showcase content is allowed only through explicit bootstrap paths, fixtures, or
test-only seeding. The live runtime is expected to show truthful empty states until the
user creates real records. In the current implementation, demo fixtures are only loaded
through the dedicated `npm run demo:seed` command against a fresh runtime root.

Forge also carries a binding long-term stack direction for a local desktop product. The
canonical target stack is Tauri 2 with Rust, Axum, Tokio, SQLx, and SQLite. The data
model is expected to remain local-first, migration-backed, recoverable, and auditable.
The current Fastify bridge should be treated as the live runtime path today, not as a
license to become architecturally vague.

## Agent And API Vision

Forge should be a product that trusted agents can use competently. The API and the
curated agent adapters should expose the real entity model, timer controls, settings
controls, insight flows, and Psyche operations in a curated but complete way. Today
that includes the published OpenClaw plugin plus a pip-installable Hermes adapter and a
repo-local Codex adapter.
Each of those integrations should help an agent understand the app itself, the meaning
of each entity, the expected workflow, and when to use the UI instead of mutating data
directly. The user should feel that agent help is natural language on top of a real
structured memory system, not a parallel product with different rules.
That now includes multi-user behavior. OpenClaw, Hermes, and Codex should all be able
to list Forge users, understand whether a record belongs to a human or a bot, search
across explicit user scopes, and create or update records for the intended owner
without guessing. The curated skills must explain when cross-user linking is legitimate
and how Strategy records should be created, searched, updated, and interpreted.
Agents should be explicitly guided to use notes for progress explanations, task
close-out context, and multi-entity evidence capture, including nested `notes` during
entity creation and explicit close-out notes when work is completed or logged.
Core entity descriptions should be treated as Markdown documentation fields, not tiny
plain-text captions, and the main entity surfaces should render them accordingly.
That means the onboarding and skill surfaces must include exact route-facing field
names, payload shapes, enums, relationship rules, and examples. High-level guidance is
not enough if it leaves the agent guessing about what the routes actually accept.
For Psyche entities specifically, the onboarding and skill surfaces should also ship
step-by-step interview playbooks so OpenClaw, Hermes, and Codex ask like a careful
collaborative interviewer rather than like a form wizard.

## Quality Standard

Forge is only at the intended quality bar when the product explains itself clearly,
keeps identity consistent, makes active work obvious, keeps the UI responsive and
readable on both desktop and mobile, and supports both human and agent workflows with
the same underlying truth. If a view is stylish but vague, it fails. If a workflow is
powerful in the API but awkward in the UI, it fails. If the terminology drifts from one
surface to another, it fails. The product vision is a demand for clarity, coherence,
and operational usefulness.
