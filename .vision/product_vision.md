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
traceable to actual behavior. This is what makes Forge an operating system rather than
just a set of pages.

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
to concrete work.

The Goal detail page should focus on one life goal. It should explain the goal itself,
show the projects attached to it, summarize progress and health in a compact way, and
let the user move naturally from long-term direction to current execution.

The Projects page should present projects as real initiatives that serve goals. It
should let the user see project status, active work, progress, and relationships to
goals without burying the meaning of the project behind jargon.

The Project detail page should be board-first and action-first. The main task board for
the project should dominate the page, because that is the work surface. Project status,
progress, and evidence should support that execution surface rather than crowd it out.

The Task detail page should present a task plainly. The title, status, project, goal,
owner, due date, time tracked, active timer state, and clear actions such as Start
work, Pause, Complete, Edit, and Delete should appear before filler text. If a user
wants to understand or act on a task, this page should make that obvious immediately.

The Weekly Review page should help the user examine what moved, what stalled, what was
learned, and where next adjustments are needed. It should turn the operating record into
a readable review ritual, not just another dashboard.

The Activity page should act as a historical timeline of meaningful events. It should
show what happened, when it happened, and which entities changed. It must behave like a
clear activity log rather than a vague “stream.”

The Insights page should present structured observations, interpretations, or proposals
that the user or trusted agents have stored. It should help with synthesis while staying
grounded in the real data and entities already in Forge.

The Settings area should explain the current configuration of the runtime, rewards,
agents, token flows, multitasking limits, time-accounting mode, recovery tools, and
operator controls in a calm and explicit way. It should not feel cramped or like a
developer-only panel. Settings must be legible on mobile and desktop.

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

The Campaigns page exists in the route tree and should eventually be treated as a
first-class planning surface rather than a placeholder. If it remains in the product,
its role must be explained clearly and not left vague.

## The Core Interaction Model

Forge should make creation and editing feel guided rather than administrative. When the
user is creating a task, project, pattern, report, or related record, the form should
help them think rather than dump raw schema fields at them. Linked-entity fields should
use searchable multi-select controls with creation on the fly when that relationship
makes sense. The user should be able to create a missing belief, pattern, mode, or
other related entity without abandoning the current form.

Starting work must feel frictionless. The app bar should contain the global timer rail,
which is where the user can see active work, start new work, switch focus, pause work,
or complete work. The Kanban page and task detail page should also offer direct Start
work actions. Starting a task should move it into `in_progress`, start a real task run,
and visibly update the timer state.

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
`/api/v1/openapi.json`.

Forge also carries a binding long-term stack direction for a local desktop product. The
canonical target stack is Tauri 2 with Rust, Axum, Tokio, SQLx, and SQLite. The data
model is expected to remain local-first, migration-backed, recoverable, and auditable.
The current Fastify bridge should be treated as the live runtime path today, not as a
license to become architecturally vague.

## Agent And API Vision

Forge should be a product that trusted agents can use competently. The API and the
OpenClaw integration should expose the real entity model, timer controls, settings
controls, insight flows, and Psyche operations in a curated but complete way. The
plugin should help an agent understand the app itself, the meaning of each entity, the
expected workflow, and when to use the UI instead of mutating data directly. The user
should feel that agent help is natural language on top of a real operating system, not a
parallel product with different rules.
That means the onboarding and skill surfaces must include exact route-facing field
names, payload shapes, enums, relationship rules, and examples. High-level guidance is
not enough if it leaves the agent guessing about what the routes actually accept.

## Quality Standard

Forge is only at the intended quality bar when the product explains itself clearly,
keeps identity consistent, makes active work obvious, keeps the UI responsive and
readable on both desktop and mobile, and supports both human and agent workflows with
the same underlying truth. If a view is stylish but vague, it fails. If a workflow is
powerful in the API but awkward in the UI, it fails. If the terminology drifts from one
surface to another, it fails. The product vision is a demand for clarity, coherence,
and operational usefulness.
