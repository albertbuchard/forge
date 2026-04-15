# Forge - Product Vision

Forge is a local-first life operating system that connects planning, execution, reflection,
health, movement, and agent collaboration in one runtime. It is meant to feel like a
serious operational tool, not a generic productivity dashboard with disconnected features.

Forge is built as a production-grade monorepo using React 19, TypeScript 5, Vite 6,
Tailwind CSS 4, Fastify 5, SQLite, generated OpenAPI contracts, OpenClaw/Hermes/Codex
adapter surfaces, and a Swift iPhone companion that syncs HealthKit and other phone-native
signals into the same canonical Forge data model.

## Main Product Shape

Forge is not one page. The planning side spans goals, strategies, projects, issues, tasks,
subtasks, and live task runs. The reflection side spans notes, Psyche, preferences, wiki,
and health. The companion side includes the iPhone app and related agent/tooling surfaces.
All of those pieces should use one shared entity language and one shared data model.

## Health And Sleep Direction

The sleep product should be night-first for normal use and evidence-first underneath.
The default view must center the canonical overnight sleep session for each wake-date,
with clear summary metrics, phase composition, timing, and weekly context.

Under that canonical night model, Forge should preserve a three-layer sleep stack:

1. raw provider records
2. normalized Forge sleep segments
3. canonical overnight sleep sessions

The main sleep UI should default to the canonical session. Raw data stays behind an
explicit reveal. Historical reconstructed nights may remain visible when true provider
raw records do not exist yet, but the product must describe them as historical raw data
or historical imported intervals rather than leaking repair or migration jargon into the UI.

## UX Constraints

Forge should preserve authored desktop and mobile layouts rather than collapsing into one
generic dashboard grid. Health pages should stay summary-first for everyday use and only
surface raw provider evidence when the user explicitly asks for it. Time-based health views
must render in the source-local timezone by default so summaries and drill-down evidence
agree with how the user experienced the day.
