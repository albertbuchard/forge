# Forge — Goal Alignment

## Executive Summary

Forge is a local-first life and execution operating system for people who are trying
to run serious personal and professional lives with more structure than a normal task
app can provide. The product exists to connect long-term direction, current projects,
concrete tasks, daily execution, earned rewards, and reflective self-understanding in
one coherent system. A user should be able to open Forge and understand, in plain
language, what matters, what is active, what is drifting, what deserves attention
today, and what progress was actually made.

Forge is not meant to behave like a generic checklist manager, a corporate PM tool,
or a decorative habit tracker. It is supposed to help the user turn life goals into
projects, projects into tasks, tasks into active work sessions, and work sessions into
visible evidence, momentum, and reflection. It should support high-agency users who
want clarity and accountability without losing nuance, emotion, or long-term meaning.

The app is successful when a user can use it to decide what to do, do it, track the
time spent doing it, understand how that work supports a larger goal, and later review
what happened without guessing or reconstructing context from memory.

## What Forge Is Actually For

Forge is designed to answer a small set of real operating questions. The user should
be able to see what life goals they are pursuing, which projects currently express
those goals, which tasks are ready to move, which tasks are blocked, which work is
actively being timed, and which rewards or penalties were earned from actual behavior.
The app must reduce ambiguity instead of adding it.

The product therefore has to support five linked jobs. First, it must help the user
define enduring direction through life goals and related projects. Second, it must
help the user execute that direction through a clear task system, a usable Kanban
board, and a focused Today view. Third, it must help the user run live work sessions
with an obvious timer surface, not hidden run controls. Fourth, it must help the user
feel progress through XP, momentum, streaks, quests, and other tasteful reward loops.
Fifth, it must support the Psyche module, where reflection on values, beliefs,
behaviors, modes, patterns, and reports can inform action rather than living as an
isolated notebook. Sixth, it must make execution calendar-aware by syncing provider
calendars, defining recurring work blocks, enforcing task and project eligibility
rules, and planning real timeboxes before work begins.

## Product Concepts That Must Be Explained Clearly

Forge has a small set of core entity types, and these must keep the same names,
colors, icons, and meaning across the whole product. The app should never rename them
with markety substitutes just to fill space.

A life goal is a long-horizon direction the user cares about, such as building a
durable body, shipping meaningful creative work, or strengthening shared life systems.
A goal is not a task. It is the strategic destination that gives meaning to lower
levels of work.

A project is a concrete ongoing body of work that serves one life goal. Projects are
how a goal becomes actionable. A project should feel like a real initiative with its
own progress, health, and active tasks. Projects also need a real lifecycle: active,
suspended, finished, and deleted. In the live data model that lifecycle remains
status-driven with the canonical API values `active`, `paused`, and `completed`, plus
soft or hard delete through the normal delete flows.

A task is a specific unit of action. Tasks live inside projects, can move through
states such as backlog, focus, in progress, blocked, and done, and can be started as
real timed work sessions.

A habit is a recurring commitment tracked separately from tasks. Habits need their own
management surface, recurrence rules, and clear XP consequences so they do not become
just another task subtype. Positive habits should reward completion and penalize misses;
negative habits should invert that logic.

A task run is a live or historical work session attached to a task. It records when
work started, whether the session is planned or unlimited, how much wall time passed,
how much credited time was earned, and whether the run is the user's current focus.

A work adjustment is a signed retrospective minute correction attached to an existing
task or project. It is not a hidden task run. It exists so the user or a trusted
agent can truthfully add or remove tracked minutes after the fact, with the clamp and
XP effects remaining explicit and auditable.

A calendar connection links Forge to an external provider. In the current production
implementation that means Google Calendar, Apple Calendar, Exchange Online through
Microsoft Graph, or custom CalDAV.
Apple setup starts from `https://caldav.icloud.com` and autodiscovers the principal,
calendar home, and writable calendars instead of asking the user to paste hidden
calendar collection URLs. Writable providers give Forge a dedicated Forge-owned
calendar for publishing work blocks and task timeboxes. Exchange Online is currently
read-only in Forge: it mirrors the selected Microsoft calendars into Forge but does
not publish Forge-owned work blocks or timeboxes back to Microsoft. In the current
self-hosted local runtime, Microsoft setup uses a guided MSAL public-client sign-in
flow with PKCE, so the user does not paste a client secret or refresh token into the
UI. The Microsoft client ID, tenant, and redirect URI belong to the local Settings
surface for that Forge runtime rather than to backend env vars as the primary user
configuration path. The default calendar name for the dedicated write surface remains
`Forge`, and provider credentials must be managed from the Settings area rather than
from the execution calendar page.

A work block is a compact recurring availability template such as Main Activity,
Secondary Activity, Third Activity, Rest, Holiday, or a user-defined custom block.
Work blocks can be marked as generally allowed or blocked, can optionally define
`startsOn` and `endsOn` date bounds, repeat indefinitely when no end date is set, and
must remain editable or removable from the calendar surface without exploding into one
stored event row per day. Holiday blocks are the same work-block system, not a separate
event type, and they exist so multi-day or open-ended time away can be represented as
truthful blocked context.

A task timebox is a planned or live calendar slot attached to a task. Timeboxes can be
created manually, confirmed from recommendations, or created automatically from live
task runs.

A calendar event is now also a first-class Forge entity. Forge must be able to hold a
native event even when no external provider is connected, then optionally project that
event into Google Calendar, Apple Calendar, or another CalDAV provider later. Provider
identities are therefore not the event itself. Forge keeps the canonical event record,
keeps provider source mappings separately, and keeps event-to-entity links separately
so calendar meaning can connect back to goals, projects, tasks, habits, notes, and
other Forge records without depending on remote provider payloads.

Rewards are the structured XP outcomes attached to meaningful behavior. Starting work,
sustaining work, completing work, and preserving momentum should all create explainable
reward events. XP is not decoration. It is a legible reward ledger that should always
come from real product data.

Notes are first-class Markdown evidence records. A note can link to one or many goals,
projects, tasks, Psyche records, or reports. Notes are where the user or an agent
should capture what changed, what was learned, what was worked on, or what contextual
detail should remain attached to the operating record without polluting the main entity
schema. Notes must also support note-owned tags so the user can classify them with
custom labels or with cognitive memory-system labels such as working memory,
short-term memory, episodic memory, semantic memory, and procedural memory. Notes may
also be durable or ephemeral: if a destroy time is set, Forge must automatically
remove the note once that time passes instead of leaving expired scratch context
behind indefinitely.

Psyche is Forge's structured reflection domain. It contains values, beliefs and
schemas, behaviors, modes, patterns, reports, and the goal map. These records help the
user understand why they behave as they do, which patterns repeat, which values matter,
and where reflection should connect back to real projects or tasks.

Insights are structured interpretations, observations, or recommendations that can be
stored by the user or trusted agents. They should never replace the raw operating
record, but they should help the user make sense of it.
Accepting an insight should mean keeping it as an acknowledged recommendation. Applying
an insight should mean turning it into a concrete Forge record such as a task, project,
goal, or linked note. Dismissing an insight should remove it rather than leaving dead
cards behind in the main feed.

## Required Product Behavior

Forge must feel like one operating system, not a bundle of disconnected modules. A
task should always remain legible in context: which project it belongs to, which life
goal that project serves, whether it is active right now, how much time has been spent
on it, and what changed recently. The user should not have to open multiple surfaces
just to reconstruct why a task matters.

The execution experience is a flagship responsibility. The Kanban board must be
stable, readable, responsive, and physically trustworthy. Columns must not overlap,
cards must wrap text cleanly, and direct actions such as starting work or changing task
state must be obvious. The Today view must explain today's work plainly, foreground XP
and priorities, and help the user choose or start the next useful task without vague
copy. The task detail page must put task data and task actions before commentary.
It must also expose truthful time-accounting controls: live task runs for work that is
happening now, completion-style retroactive logging for work that already happened, and
signed minute adjustments when existing tracked time needs correction without inventing
a fake live session.

The live timer system must stay visible in app chrome. Starting work, pausing work,
switching focus, and completing work should all be easy from the global app bar. When
no work is active, the app chrome should clearly show that and offer a strong Start
work action. When work is active, the current task and the live timer should be easy to
read at a glance, including in the compact collapsed header state.

Calendar-aware execution is also part of the contract. Forge must support connected
Google Calendar, Apple Calendar, and custom CalDAV providers, mirrored provider
events, recurring half-day work blocks, editable date-bounded holiday or availability
blocks, task and project scheduling rules, future task timeboxing, and live task-run
to timebox synchronization. Blocked calendar context should prevent a normal task
start, but the user or a trusted agent must still be able to proceed through an
explicit audited override reason. The Calendar page should prioritize seeing the week
clearly while also letting the user edit or delete visible work blocks in place, and
Settings should own provider setup, setup documentation, and durable connection
management. Calendar events must remain canonical inside Forge first, with provider
sync acting as an adapter layer rather than the primary identity of the event.

Responsive behavior is part of the product contract. Every web-facing surface must be
designed for both desktop and mobile at the same time. A mobile screen is not allowed
to be a broken or compressed version of desktop. If a surface contains dense data, the
mobile version must intentionally reorganize it rather than letting it overflow.

## API And Agent Contract

Forge is also an agent-facing product. The API and the curated agent integrations must
allow trusted agents to inspect current context, search entities before creating
duplicates, create and update goals, projects, tasks, notes, tags, and Psyche records,
control task timers, post signed minute work adjustments on tasks and projects, and
write structured insights. Today that means a published OpenClaw plugin, a repo-local
Hermes plugin, and a repo-local Codex MCP plugin, all of which should expose the same
curated Forge operating model rather than drifting into separate products. Notes must be
linkable to one or many entities, batch-manageable, searchable, taggable, optionally
ephemeral, and creatable inline when a parent entity is created. The real product
should also expose a first-class Notes workspace and render core entity descriptions as
long-form Markdown where detail matters. These capabilities must match the real product.
If the UI can do something important,
the versioned API and the curated agent surface should expose it too unless there is a
deliberate safety reason not to.

The agent contract must stay explicit and auditable. Mutations should be scoped,
recoverable where appropriate, and visible in the product afterward. Forge should help
the user collaborate with agents without giving up provenance or control.
The live onboarding contract must therefore expose exact tool input shapes, valid enum
values, per-entity field guides, and relationship rules so an agent can use Forge
without guessing or inventing fields. That includes making project lifecycle guidance
explicit: suspend, finish, and restart are status patches on `project.status`, delete
is soft by default unless hard mode is explicitly requested, and finishing a project
auto-completes linked unfinished tasks through the standard task-completion path.

## Technical Stack And Architecture

Forge currently runs as a React 19.1 + TypeScript 5.8 + Vite 6.3 web application with
Tailwind CSS 4 styling, TanStack Query for server-state coordination, React Router 7
for navigation, React Hook Form and Zod for forms and validation, dnd-kit for board
interactions, Framer Motion for motion, Recharts for charts, and Lucide icons for the
entity iconography. The server runtime is a Fastify 5 API served from `server/src`,
started with `tsx`, and exposed locally on port `4317` by default with the web app
mounted under `/forge/`. The public contract is a versioned REST API with an OpenAPI
3.1 document at `/api/v1/openapi.json`. Agent adapters currently span the published
OpenClaw plugin, a repo-local Hermes Agent plugin built with Hermes' Python plugin
format, and a repo-local Codex MCP plugin.

Forge also has a long-term canonical desktop architecture that remains binding even
while the current Node bridge is in place. That canonical architecture is Tauri 2 with
Rust services built on Axum, Tokio, SQLx, and SQLite. The data layer is expected to be
local-first, migration-backed, and auditable. SQLite features such as WAL mode, JSON1,
FTS5, and append-oriented history are part of the intended foundation. GraphQL and
Electron are not aligned with this product direction.

Architecturally, Forge is manager-first. The contract layer defines shapes and versioned
behavior. The manager layer owns orchestration and policy. Adapters isolate infrastructure
details. Persistence and runtime services implement storage and execution. The presentation
layer renders the product. Routes, pages, jobs, and plugin tools should depend on
managers instead of embedding policy ad hoc.

Fresh runtime storage must be truthful. A brand-new production database may include
system catalogs, settings defaults, and migration-backed support tables, but it must
not silently invent personal goals, projects, tasks, or activity just to make the UI
look populated. If sample content is needed for tests or demos, it must be opt-in and
explicitly marked as fixture data. In the current Forge runtime that means demo
content is only introduced through the explicit `npm run demo:seed` bootstrap path
against a fresh `FORGE_DATA_ROOT`, never during normal app startup.

## Quality Bar

These standards are binding. Forge is only aligned when the product explains itself in
plain language, keeps entity identity consistent across every view, supports live work
through a visible timer system, exposes matching API and agent functionality, and feels
intentional on both desktop and mobile. If a surface looks premium but confuses the
user about what something is, it is not aligned. If a feature exists in the data model
but is hidden behind awkward UX, it is not aligned. If the product sounds impressive
but does not make the user's next action clearer, it is not aligned.
