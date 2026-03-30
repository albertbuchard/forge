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
isolated notebook.

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
own progress, health, and active tasks.

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

Rewards are the structured XP outcomes attached to meaningful behavior. Starting work,
sustaining work, completing work, and preserving momentum should all create explainable
reward events. XP is not decoration. It is a legible reward ledger that should always
come from real product data.

Notes are first-class Markdown evidence records. A note can link to one or many goals,
projects, tasks, Psyche records, or reports. Notes are where the user or an agent
should capture what changed, what was learned, what was worked on, or what contextual
detail should remain attached to the operating record without polluting the main entity
schema.

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

The live timer system must stay visible in app chrome. Starting work, pausing work,
switching focus, and completing work should all be easy from the global app bar. When
no work is active, the app chrome should clearly show that and offer a strong Start
work action. When work is active, the current task and the live timer should be easy to
read at a glance, including in the compact collapsed header state.

Responsive behavior is part of the product contract. Every web-facing surface must be
designed for both desktop and mobile at the same time. A mobile screen is not allowed
to be a broken or compressed version of desktop. If a surface contains dense data, the
mobile version must intentionally reorganize it rather than letting it overflow.

## API And Agent Contract

Forge is also an agent-facing product. The API and the OpenClaw integration must allow
trusted agents to inspect current context, search entities before creating duplicates,
create and update goals, projects, tasks, notes, tags, and Psyche records, control
task timers, and write structured insights. Notes must be linkable to one or many
entities, batch-manageable, searchable, and creatable inline when a parent entity is
created. These capabilities must match the real product. If the UI can do something
important, the versioned API and the curated agent surface should expose it too unless
there is a deliberate safety reason not to.

The agent contract must stay explicit and auditable. Mutations should be scoped,
recoverable where appropriate, and visible in the product afterward. Forge should help
the user collaborate with agents without giving up provenance or control.
The live onboarding contract must therefore expose exact tool input shapes, valid enum
values, per-entity field guides, and relationship rules so an agent can use Forge
without guessing or inventing fields.

## Technical Stack And Architecture

Forge currently runs as a React 19.1 + TypeScript 5.8 + Vite 6.3 web application with
Tailwind CSS 4 styling, TanStack Query for server-state coordination, React Router 7
for navigation, React Hook Form and Zod for forms and validation, dnd-kit for board
interactions, Framer Motion for motion, Recharts for charts, and Lucide icons for the
entity iconography. The server runtime is a Fastify 5 API served from `server/src`,
started with `tsx`, and exposed locally on port `4317` by default with the web app
mounted under `/forge/`. The public contract is a versioned REST API with an OpenAPI
3.1 document at `/api/v1/openapi.json`.

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
