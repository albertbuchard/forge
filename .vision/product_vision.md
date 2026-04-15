# Forge - Product Vision

Forge is a local-first life operating system for users who want one coherent place to
run long-range direction, concrete execution, reflective memory, health evidence, and
human-plus-bot collaboration. The product should help a user understand what matters,
what is active, what was actually done, what is drifting, and what the system has
learned about their behavior. It should feel serious and modern, not like a generic
checklist app with decorative AI around the edges.

Forge is built today as a production-grade monorepo application using React 19,
TypeScript 5, Vite 6, Tailwind CSS 4, Fastify 5, SQLite, generated OpenAPI contracts,
OpenClaw/Hermes/Codex adapter surfaces, and a Swift iPhone companion that syncs
HealthKit and other phone-native context back into the local Forge runtime.

## Product Shape

Forge is not one page. It is a connected set of operational surfaces that all need to
share one entity language and one sense of meaning.

The planning and execution side starts with goals, strategies, projects, issues, tasks,
subtasks, and timed task runs. The user should be able to move from strategic direction
to one concrete next action without guessing how the pieces fit together. Projects are
PRD-backed initiatives, issues are vertical slices, tasks are one focused AI execution
session each, and completion needs truthful evidence rather than vague "done" toggles.

The memory and reflection side includes notes, wiki, Psyche, preferences, and health.
These surfaces are not decorative sidecars. They exist so that work, patterns, context,
and outcomes can be linked instead of living in separate tools.

The companion and agent side includes the iPhone app, OpenClaw, Hermes, and Codex
integrations. Those surfaces should use the same canonical data model as the web app
instead of inventing private representations that the rest of Forge cannot understand.

## Main Surfaces

The Overview page is the orientation surface. It should explain what matters, what is
active, and what deserves attention without becoming a wall of disconnected metric
cards.

The Today and Kanban surfaces are the execution core. They should make it easy to pick
work, start work, move work between states, and understand how current action ties back
to bigger goals and projects.

The Projects, Strategies, and related PM surfaces should keep the hierarchy explicit.
Users must be able to see goals, strategies, PRD-backed projects, issues, tasks, and
subtasks as one connected structure across desktop and mobile layouts.

The Sleep page should be a canonical-night analytics surface, not a raw HealthKit row
browser. Its main view should open on a last-night hero with total sleep, time in bed,
score, regularity, bedtime, wake time, restorative share, and weekly comparison. The
main browsing surface should be a clickable calendar of canonical overnight sleep
sessions keyed by wake-date. Selecting a night should update an inline detail panel with
phase timing, stage composition, and exact start/end time. Reflection, notes, tags, and
entity links still belong on this page, but they are a secondary tab. Raw phone segment
data and repair logs must stay behind an explicit reveal such as Show raw data.

The Sports and Movement surfaces should be session-first and evidence-first. Workouts,
trips, stays, and places should feel like coherent Forge records with provenance, not
like opaque sync dumps.

The Psyche and Preferences surfaces should remain first-class domains. They should help
the user connect behaviors, values, patterns, beliefs, and preferences back to action
and outcomes rather than trapping that information in isolated reflection pages.

Workbench is the dedicated graph-flow AI workspace. It should consume real Forge
surfaces and contracts, not page-local ad hoc widgets.

## Design And UX Constraints

Forge should preserve its authored responsive layouts in both desktop and mobile views
instead of flattening everything into one dashboard grid. Large editors and setup flows
should use the shared step-based modal or sheet scaffolds. Navigation should keep the
previous route visible until the next route has enough data to render correctly. Health
surfaces should default to summary-first product views and only expose raw provider data
when the user explicitly asks for it.
