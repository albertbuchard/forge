# Forge - Product Vision

Forge is a local-first life operating system that connects planning, execution, reflection,
health, movement, and agent collaboration in one runtime. It is meant to feel like a
serious operational tool, not a generic productivity dashboard with disconnected features.

Forge is built as a production-grade monorepo using React 19, TypeScript 5, Vite 6,
Tailwind CSS 4, Fastify 5, SQLite, generated OpenAPI contracts,
OpenClaw/Hermes/Codex/Claude Code adapter surfaces, a repo-owned Rust Iroh
companion transport, and a Swift iPhone companion that syncs HealthKit and other
phone-native signals into the same canonical Forge data model.

The source tree makes those runtime boundaries explicit: the browser app is in
`apps/web`, the API and migrations are in `apps/api`, desktop and mobile shells
are under `apps/`, host adapters are under `plugins/`, public/shared packages
are under `packages/`, tests are under `tests/`, and public docs stay under
`docs/`. Internal goals, handoffs, audit reports, automation memory, and
conversation-derived planning notes are private operating material, not public
Forge source.

Forge-owned public code is licensed Apache-2.0 so the open-source project stays
permissive and patent-explicit while preserving a clean path for future closed-source
commercial Forge forks.

The companion connection should feel like a native Iroh pairing flow rather than a
fragile local address handoff: Forge generates a one-time payload with the desktop Iroh
node id, pairing token, optional relay hint, and ALPN `forge-companion/1`; direct HTTP, LAN, or
Tailscale URLs stay available as deliberate advanced choices.

Forge's progression layer uses that same stack: SQLite reward projections, Fastify API
read models, React surfaces, Framer Motion celebration effects, source-controlled catalog
data, small in-repo mascot previews, and optional per-style raster sprite archives hosted
as GitHub Release downloadable content. Heavy generated mascot, trophy, unlock, atlas, and
source sprites must stay out of the monorepo and out of the default npm/PyPI plugin
packages.

The progression layer's current product direction is canonical Forge Gamification. It should feel like
an enchanting blacksmith game interface wrapped around real Forge use: 144 authored
achievements/unlocks, one unique transparent icon per item per theme, 30 atlas-cropped Forge Smith mascot states, and a
single released catalog model that ignores stale pre-release unlock rows unless they match
current source-controlled catalog item IDs.

## Main Product Shape

Forge is not one page. The planning side spans goals, strategies, projects, issues, tasks,
subtasks, and live task runs. The reflection side spans notes, Psyche, preferences, wiki,
and health. The memory side also includes an Artifact Store for trusted files such as
spreadsheets, documents, PDFs, structured text, plain text, and images. Artifacts keep
precise metadata, provenance, static safety scans, danger scores, versions, audit history,
and human-only downloads while using the general Forge entity-link graph to connect files
to goals, projects, tasks, wiki pages, Psyche records, calendar records, and notes. The
chronological memory side includes Life Events for important personal events, with
calendar reconciliation, ticket artifact import, travel segments, status reads, and links
back into the same general Forge entity graph.
companion side includes the iPhone app and related agent/tooling surfaces. All of those
pieces should use one shared entity language and one shared data model.

The gamified layer should make the operating system feel consequential without turning it
into a toy. The Forge Smith mascot, level ring, XP progress, streak state, Trophy Hall,
and compact content-page HUDs should help the user see momentum at a glance. Trophies and
unlocks are visual recognition and cosmetic customization; they must never lock core work,
reflection, health, or agent functionality behind a game mechanic.

Gamification art is selectable independently from the shell theme. `Fantasy` is the
default lighthearted animated-mascot style, `Dark Fantasy` carries the dramatic black-iron
Forge Smith direction, and `Mind Locksmith` turns the blacksmith into a modern metaphorical
locksmith of the mind: smart, product-grade, and anchored in planning, memory, Psyche,
health evidence, and agent collaboration. Full sprite outputs should be transparent,
theme-specific, and installed only after explicit operator choice so trophies, unlocks,
and mascot states sit cleanly inside the real Forge UI without bloating the base package.

Trophies should mostly be earned from specific behaviors inside Forge rather than XP alone:
goal-linked execution, task runs, closeout reports, wiki pages and links, Psyche modes and
trigger reports, behavior patterns, flexible beliefs, habit consistency, Life Force and
health evidence, and agent collaboration. The mascot should become stronger with longer
streaks and visibly colder after absence, while remaining emotionally safe and non-graphic.

## Health And Sleep Direction

The sleep product should be night-first for normal use and evidence-first underneath.
The default view must center the canonical overnight sleep session for each wake-date,
with clear summary metrics, phase composition, timing, and weekly context.

The training-load product should be a separate cardiovascular intelligence surface rather
than an overloaded sports list. It uses the same provider-neutral health stack but answers
adaptation questions directly: recent load versus chronic base, zone distribution, threshold
exposure, VO2max and resting-HR context, sport contribution, and data-quality confidence.
The `/training-load` view and `/api/v1/health/training-load` read model should feel like an
elite-sport cockpit while staying local-first, legible on mobile, and honest about wearable
heart-rate limitations.

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
