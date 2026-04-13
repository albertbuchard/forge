# Forge — Goal Alignment

## Executive Summary

Forge is a local-first structured memory system for life direction and execution, built
for people who are trying
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
Forge is also no longer allowed to assume that one human is the only actor in the
system. The production model must support multiple Forge users, and each Forge user
must be explicitly typed as either `human` or `bot`.

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
Seventh, it must support collaborative multi-user work between humans and bots. A
human-owned project may legitimately link to bot-owned tasks, a bot may hold its own
goals and strategies, and the user must be able to intentionally widen search or list
views to other users instead of being trapped inside one invisible owner namespace.
Eighth, it must support a native iPhone companion that can pair securely with a local
Forge runtime, request Apple permissions directly, import HealthKit sleep and workout
data plus Screen Time usage, and turn that mobile-native context into structured Forge
records instead of opaque wellness blobs. After pairing, that companion should default
to Forge itself in a full-screen embedded web view, with native iOS controls reserved
for permissions, sync, and device-specific settings. Runtime discovery for that
companion should work on trusted same-Wi-Fi networks and through Tailscale, with the
Forge runtime advertising itself over Bonjour and publishing its Tailscale Serve URL
when available. Screen Time sync must use Apple's Device Activity report-extension
pipeline with the Family Controls App and Website Usage entitlement present on both the
app and report-extension targets, shared app-group snapshot transport, and truthful
first-capture readiness handling instead of assuming authorization alone means captured
usage data already exists.
Ninth, it must support Preferences as a first-class domain. Forge should be able to
learn and store what a user prefers across concrete domains and contexts through a
fully algorithmic system of pairwise comparisons, direct preference signals, explicit
uncertainty, inspectable inferred scores, and editable overrides without depending on
LLMs for the inference loop. That preference system must now be arrival-first: show
what Forge knows before asking for setup work, admit clearly when evidence is still
thin, and launch comparison rounds through one simple Start the game flow that chooses
a domain or concept area and then auto-populates the candidates.
Tenth, it must support Movement as a first-class domain across the backend, web app,
and iPhone companion. Forge should be able to passively detect stays, trips, stops,
and known places with explicit permission onboarding, publish those movement records as
structured evidence rather than opaque GPS blobs, and let the user review their
mobility through day, month, all-time, and one native full-screen Life Timeline view
that connects movement to notes, work, health, and Psyche context. That timeline must
load canonical history from Forge, overlay the current live local stay or trip from the
iPhone, paginate indefinitely into the past, and support canonical edits to stays,
trips, places, labels, tags, and timing rather than trapping corrections in a
phone-only cache.
Eleventh, it must support one shared surface-arrangement runtime across the entire web
app without forcing every page through one size-managed dashboard grid. Every routed
page must keep its authored responsive mobile and desktop layout in normal viewing
mode, while the layout editor only controls box visibility, ordering, and whether a
box spans the full route width on larger screens.
Twelfth, it must support Workbench as the canonical graph-flow system rather than
page-local AI widgets. A Workbench flow must be able to consume registered Forge boxes
from any view, use box snapshots and tool adapters as graph inputs, run as a functor
or chat flow, persist run history and optional conversation memory, and publish outputs
through dedicated Workbench API routes while older connector routes remain temporary
compatibility aliases. Workbench boxes and AI nodes must publish semantic input and
output contracts with truthful key names and typed model metadata, not generic
`primary` or `content` placeholders. The graph editor must show those contracts clearly
through collapsed previews, tooltips, and explicit tool argument schemas so a user can
understand what a node consumes, what it emits, and what tools it can call before
running the flow. The editor must also autosave draft changes within a few seconds,
save the current draft before every Run attempt, and stop treating a simple node click
as an implicit command to open a modal. Selecting a node and editing a node are
different actions. The node card itself must expose explicit affordances for editing,
contract inspection, and parameter editing without blocking richer in-node controls.
Workbench must also expose a real top-level public input contract for every flow. A
flow is not allowed to depend only on an implicit `userInput` blob when it is meant to
be called through the API or reused by agents. Public flow inputs must declare their
key, label, description, kind, required flag, semantic model metadata, optional shape,
and optional default value, then bind those public inputs explicitly to node inputs or
node parameters. The Run modal and the public Workbench API must both treat those
declared public inputs as the primary contract, with generic context fields reserved as
an advanced escape hatch rather than the default surface.
Workbench must also expose stable run-scoped and node-scoped result APIs instead of
hiding node outputs inside a debug-only trace. A caller should be able to run a flow,
retrieve the published whole-flow output, list the semantic outputs of every node for
that run, fetch one specific node result, and ask for the latest successful output of
one node without reverse-engineering internal trace structures. Those node results must
carry resolved inputs, semantic output maps, payloads, tool exposure, logs, timing, and
plain-language error state. Debug traces may still exist for diagnostics, but they are
not the canonical API.
Workbench must also ship with a dedicated mock runtime for local development and tests.
That mock runtime is not a production model provider. It exists so Forge can exercise
full graph execution, conversation continuity, tool-calling behavior, error paths, and
structured outputs through the same execution seam in automated tests and local manual
QA. The product should be able to verify Workbench behavior end to end without relying
on ad hoc fetch monkeypatches or a live external LLM provider.
Thirteenth, it must enforce a smooth route-handoff contract across the whole web app.
When the user switches views, Forge should keep the previous page visible until the
next page has finished the route-critical fetch work needed for first render. The
background activity bar is the truthful loading indicator for this work. Skeletons,
empty states, and route chrome must not flash as a substitute for stable navigation.
Fourteenth, it must enforce one consistent step-based modal standard for substantial
flows and editors across the app. Large forms, configuration editors, and setup
experiences must use the shared paged modal system or sheet scaffold with proper body
scrolling, persistent navigation controls, and explicit progress. A one-off custom
dialog that traps long content in a non-scrollable panel is misaligned with Forge's UX
contract and should be treated as a regression to correct.

## Product Concepts That Must Be Explained Clearly

Forge has a small set of core entity types, and these must keep the same names,
colors, icons, and meaning across the whole product. The app should never rename them
with markety substitutes just to fill space.

A life goal is a long-horizon direction the user cares about, such as building a
durable body, shipping meaningful creative work, or strengthening shared life systems.
A goal is not a task. It is the strategic destination that gives meaning to lower
levels of work.

A user is the first-class owner identity for Forge records. Every user must be either
`human` or `bot`. A user has a stable id, a display label, a type, and descriptive
metadata that helps the UI and agents explain who owns a record. The runtime must be
able to list users directly. The access model must be prepared for future per-user
policy or sharing controls, but the current production default is permissive: every
authenticated Forge user can list all other users and can read other users' records
when the route or query explicitly asks for them.

A project is a concrete ongoing body of work that serves one life goal. Projects are
how a goal becomes actionable. A project should feel like a real initiative with its
own progress, health, and active tasks. Projects also need a real lifecycle: active,
suspended, finished, and deleted. In the live data model that lifecycle remains
status-driven with the canonical API values `active`, `paused`, and `completed`, plus
soft or hard delete through the normal delete flows.

A task is a specific unit of action. Tasks live inside projects, can move through
states such as backlog, focus, in progress, blocked, and done, and can be started as
real timed work sessions.

A strategy is a durable planning record that sits above day-to-day execution but below
wishful abstraction. A strategy has one or more linked goals or projects as its target
outcome, a free-text overview, a free-text end-state description, optional links to
other Forge entities, and a structured non-cyclic directed graph of task or project
steps. The graph can branch, but it must remain a DAG with a sensible initial side and
an end-state side. Strategies are how Forge represents “how this unfolds over time,”
not just “what exists right now.”

A preference profile is the top-level record for one user's preferences within one
domain. It owns contexts, comparable items, judgments, direct signals, inferred item
scores, interpretable dimensions, and snapshots of the learned model over time. A
preference profile is not a vague recommendation blob. It is an auditable model state
that answers what Forge currently thinks the user likes, in what context, with what
confidence.

A preference context is a named mode inside one preference profile, such as Work,
Personal, Discovery, or Deep Research. Contexts let the same user express different
preferences under different operating conditions. A context can be active or disabled,
can be the default for a profile, and can inherit or isolate evidence depending on
its configured sharing mode.

A preference item is a comparable object inside a preference profile. It can be a
standalone item described directly in the Preferences workspace, or it can be linked
to another Forge entity such as a goal, project, task, strategy, habit, note, or
calendar event. Preference items carry tags, interpretable dimension weights, and
free-text explanation fields so the user can inspect or correct what the model is
learning from.

A preference concept library is the editable source list that Forge can use to seed
comparison candidates for one preference profile and domain. Some libraries come from
Forge entities, while others begin as hardcoded starter concept lists such as food,
activities, places, countries, media, fashion, or person-style concepts. Once loaded
into Forge they become ordinary user-editable records, because the system should not
trap the user inside an unchangeable default taxonomy.

A pairwise judgment is a single comparison between two preference items inside a
context. It records which side won, whether the judgment was strong, tied, skipped,
or uncertain, optional reason tags, response time, and source attribution.

An absolute signal is a direct preference action such as favorite, veto, must-have,
bookmark, neutral, or compare-later. These signals matter because some preferences are
constraints rather than rankings.

An item score is the inferred state of one preference item inside one context. It
stores latent score, confidence, uncertainty, evidence count, derived status,
dominant dimensions, and optional manual overrides or locks. This is the state the UI
should explain, not hide.

A preference snapshot is a stored checkpoint of the inferred model for a context at a
moment in time. Snapshots make preference drift, flips, and stale evidence visible.

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

A calendar connection links Forge to an external provider or host calendar substrate.
In the current production implementation that means Google Calendar, Calendars On This
Mac through EventKit, Apple Calendar, Exchange Online through Microsoft Graph, or
custom CalDAV.
Google setup now uses one local Google OAuth desktop-app client for the Forge
runtime. End users do not create their own Google app or paste a refresh token
into Forge. They sign in with their own Google accounts through a guided
Authorization Code + PKCE localhost flow, Forge stores the PKCE verifier and
state on the backend, Forge exchanges the authorization code on the backend, and
Forge stores a per-user refresh token plus granted scopes for long-term sync.
This local Google flow does not use `GOOGLE_CLIENT_SECRET`. The browser must be
running on localhost on the same machine as Forge, because the callback returns
to localhost on that machine. If the browser is opened remotely while the
callback still points to localhost, Forge must explain that Google would
redirect to localhost on that other device rather than back to the Forge server.
Apple setup starts from `https://caldav.icloud.com` and autodiscovers the principal,
calendar home, and writable calendars instead of asking the user to paste hidden
calendar collection URLs. The macOS-local provider uses EventKit against the host
calendar store so Forge can reuse the calendars already configured in Calendar.app,
including grouped account sources such as iCloud, Google, Exchange, local, and other
host-managed calendars when available. The duplicate-prevention rule is account and
calendar canonicalization, not ongoing per-event duplicate checks: if the same
upstream account is already connected through a remote provider, Forge should replace
that older connection and expose only one visible copy of the account's calendars.
Writable providers share one canonical Forge write target across the runtime for
publishing work blocks and task timeboxes. Forge should reuse an already-selected
target when a new writable connection is added, and only ask to create or select a
Forge calendar when no active write target exists yet. Exchange Online is currently
read-only in Forge: it mirrors
the selected Microsoft calendars into Forge but does not publish Forge-owned work
blocks or timeboxes back to Microsoft. In the current self-hosted local runtime,
Microsoft setup uses a guided MSAL public-client sign-in flow with PKCE, so the user
does not paste a client secret or refresh token into the UI. The Microsoft client ID,
tenant, and redirect URI belong to the local Settings surface for that Forge runtime
rather than to backend env vars as the primary user configuration path. The default
calendar name for the dedicated write surface remains `Forge`, and provider
credentials must be managed from the Settings area rather than from the execution
calendar page.

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
Calendar events now also need future-ready place structure. A readable location string
is still useful, but Forge must also preserve a structured place label, address,
timezone, coordinates when known, and future provider identifiers so location-aware
planning and travel reasoning can build on the existing event system.

Sleep sessions are now first-class Forge records imported from the iOS companion. A
sleep session records start and end, total sleep, time in bed, stage breakdown when
available, derived recovery and regularity metrics, annotations, provenance, and links
back to goals, projects, tasks, habits, notes, and Psyche entities.

Workout sessions are now first-class Forge records imported from the iOS companion or
generated from habits. A workout session records its type, timing, energy, distance,
heart-rate context when available, subjective annotations, provenance, and links back
to Forge and Psyche records. Imported HealthKit workouts and habit-generated workouts
must reconcile rather than piling up as duplicate sessions.

Movement places are now first-class Forge records shared between the iPhone companion
and the web app. A place records a label, aliases, coordinates, radius, semantic tags,
optional wiki linkage, and optional links to people or other Forge entities. The tag
system must stay open-ended: Forge should seed and recognize important canonical tags
such as `home`, `workplace`, `gym`, `holiday`, `grocery`, or `nature` for downstream
reasoning, while still letting the user define arbitrary additional tags. Places are
the canonical anchors for movement reasoning; wiki frontmatter can mirror that
metadata, but the place record is the system of record.

Movement stays are first-class Forge records representing a span of time spent at one
place or inside one stationary cluster. A stay records start and end time, center
coordinates, effective place match, stationary classification, timing and duration
metrics, optional published evidence note, and provenance from the companion sync.

Movement trips are first-class Forge records representing motion between places. A trip
records start and end, distance, moving and idle time, travel mode, activity type,
speed and MET summaries, optional calorie estimate, simplified trajectory data, stop
anchors, labels, tags, linked entities, linked people, and optional published evidence
note. Trips may also create bounded XP rewards and may produce a workout candidate when
that would not duplicate an existing imported workout.

Movement timeline segments are a first-class cross-surface read model derived from
canonical stays and trips. A timeline segment can represent either a stay or a trip,
must preserve exact timestamps and real duration, and must expose the visual lane and
connector metadata needed by the native iPhone Life Timeline without turning the phone
into the source of truth. The canonical movement API therefore has to support paginated
timeline reads plus canonical stay and trip patch routes so the companion and future
web timeline surfaces can edit movement history through the same shared contract.

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

That document layer must now grow into a first-class KarpaWiki memory system instead of
remaining only an evidence log. Forge needs a dedicated KarpaWiki workspace where canonical
knowledge lives as local markdown files plus media assets on disk, while Forge keeps a
synced SQLite metadata, backlink, and search index on top. Evidence notes and richer
wiki pages are two kinds of the same local-first document system, not two unrelated
products. Wiki pages must support `[[page]]` links, links to Forge entities,
backlinks, per-user and shared spaces, and optional semantic search driven by
user-configured embedding profiles, while lexical search and entity-linked search
remain available even when embeddings are disabled.
That wiki surface must be reading-first. The space home is an `index` page, not an
editor. The primary browse surface should present a hierarchical page index on the
left, article content in the center, and article-authored metadata infoboxes rendered
from markdown directives rather than generic app chrome.

Forge also needs an auto-ingest path into that Wiki layer. The current production
runtime can begin with raw text, local-path, and URL ingest, but the product
direction is explicitly multimodal: documents, images, audio, and video should flow
into stored media assets, compiled wiki pages, and suggested Forge entities through
LLM-backed ingestion profiles. The ingest flow must remain file-first and
inspection-first so the user can always see and manage the resulting artifacts.

Psyche is Forge's structured reflection domain. It contains values, beliefs and
schemas, behaviors, modes, patterns, reports, and the goal map. These records help the
user understand why they behave as they do, which patterns repeat, which values matter,
and where reflection should connect back to real projects or tasks.
Psyche now also includes questionnaires as a first-class assessment surface. A
questionnaire instrument is a versioned self-report definition stored in SQLite with
metadata, sections, items, provenance, and a scoring model. A questionnaire run is one
time-stamped administration of one exact questionnaire version, with raw answers,
persisted computed scores, optional subscores, and longitudinal history.

Insights are structured interpretations, observations, or recommendations that can be
stored by the user or trusted agents. They should never replace the raw operating
record, but they should help the user make sense of it.
Accepting an insight should mean keeping it as an acknowledged recommendation. Applying
an insight should mean turning it into a concrete Forge record such as a task, project,
goal, or linked note. Dismissing an insight should remove it rather than leaving dead
cards behind in the main feed.

## Required Product Behavior

Forge must feel like one coherent structured memory system, not a bundle of disconnected modules. A
task should always remain legible in context: which project it belongs to, which life
goal that project serves, whether it is active right now, how much time has been spent
on it, and what changed recently. The user should not have to open multiple surfaces
just to reconstruct why a task matters.
That same legibility now includes ownership. The product must show which Forge user owns
the current goal, project, task, note, strategy, or Psyche record, and search or link
controls must make it clear when the user is reaching across to another human or bot.

Cross-user linkage is part of the product contract. Forge must not block a human-owned
project from linking to a bot-owned task, a bot-owned strategy from pointing at a
human-owned goal, or a note from referencing entities across user boundaries. Ownership
and relationship are separate ideas: ownership answers “whose record is this,” while
links answer “what does this record connect to.”
That same rule applies inside Preferences. A human user must be able to create a
preference item that points at a bot-owned strategy or task if that is what they are
actually evaluating. The preference record belongs to the evaluating user, while the
linked entity can belong to another user.

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
That same requirement now applies to the companion architecture: the iOS app is not a
web wrapper. It is a native SwiftUI and Apple-framework surface designed around phone
permissions, background sync, location capture, and watch sync, while the main Forge
web runtime remains the primary reflective workspace. The watch companion is now part
of that contract too. It is not allowed to become a tiny second Forge client. Its job
is to act as a micro-capture layer for habits, state check-ins, prompt confirmations,
and short semantic annotations that would otherwise never make it into the system.

Multi-user behavior is also part of the contract. The main list routes, snapshot
payloads, entity detail routes, and search routes must all understand explicit user
scope. Forge needs a first-class user list route plus user-aware query parameters or
payload fields so a caller can ask for one specific user, multiple users, the current
active user only, or all visible users when a shared or comparative view is intended.

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
That now includes owner provenance. The API and every curated skill surface must expose
the owning `userId` and enough user metadata to let an agent understand whether it is
reading or mutating a human-owned or bot-owned record. Search and create flows must be
able to target another user intentionally rather than relying on ambient assumptions.
The live onboarding contract must therefore expose exact tool input shapes, valid enum
values, per-entity field guides, and relationship rules so an agent can use Forge
without guessing or inventing fields. That includes making project lifecycle guidance
explicit: suspend, finish, and restart are status patches on `project.status`, delete
is soft by default unless hard mode is explicitly requested, and finishing a project
auto-completes linked unfinished tasks through the standard task-completion path.
For Psyche work, the agent contract must go further than raw schema help. It must tell
the agent to explore values, behaviors, beliefs, patterns, modes, guided mode sessions,
and trigger reports through active listening and gradual evidence gathering before
storing them. Pattern work should follow a CBT-style functional analysis, value work
should separate directions from goals, and belief or mode work should emerge naturally
from the conversation rather than being demanded as a form fill. When one Psyche entity
reveals an adjacent one, the agent should notice that and help the user decide whether
to map the linked belief, mode, value, or pattern too.
That same contract now extends to questionnaire work. The versioned API must let the UI
and trusted agents list questionnaire instruments, inspect seeded provenance, create or
clone drafts, publish immutable versions, start or resume runs, autosave answers, and
fetch stored result history without recomputing scores ad hoc in the client.

## Technical Stack And Architecture

Forge currently runs as a React 19.1 + TypeScript 5.8 + Vite 6.3 web application with
Tailwind CSS 4 styling, app-local shadcn-style UI primitives, React Router 7 for
navigation, and a front-end state architecture that is actively consolidating around
Redux Toolkit slices plus RTK Query for server-state ownership and cache invalidation.
TanStack Query remains present as a temporary migration bridge on routes that have not
yet moved to RTK Query. Forms and validation use React Hook Form and Zod, board
interactions use dnd-kit, motion uses Framer Motion, charts use Recharts, connector
graphs use `@xyflow/react`, the Knowledge Graph uses Sigma 3 + Graphology +
ForceAtlas2 workers for large-network rendering, and Lucide provides the entity iconography. The server
runtime is a Fastify 5 API served from `server/src`, started with `tsx`, and exposed
locally on port `4317` by default with the web app mounted under `/forge/`. The public
contract is a versioned REST API with an OpenAPI 3.1 document at `/api/v1/openapi.json`.
Agent adapters currently span the published
OpenClaw plugin, a Hermes Agent plugin packaged as a Python distribution with a
`hermes_agent.plugins` entry point plus bundled runtime assets, and a repo-local Codex
MCP plugin. The KarpaWiki memory layer is part of that same stack: markdown and media files
are canonical on the local filesystem, while Fastify and SQLite provide metadata,
backlinks, search indexes, ingest jobs, and optional embedding-profile state.
Project documentation is also part of the production stack now. Forge publishes an
engineering-first GitHub Pages site from `openclaw-plugin/docs`, and that static docs
artifact includes a rendered API reference driven by the same generated OpenAPI
document rather than by a second hand-maintained specification.
The questionnaire workspace is part of this same production stack. Questionnaire
definitions, version records, runs, answer rows, and score rows live in migration-backed
SQLite tables. Scoring is not freeform code execution: the server evaluates a safe JSON
AST that can express arithmetic, item references, score references, filtered counts,
conditional logic, and dependent subscores while keeping the runtime auditable.
The Apple companion stack is now explicit too. Forge ships a native SwiftUI iOS
companion and a paired SwiftUI watchOS companion under `ios-companion/`, bridged with
WatchConnectivity and using WidgetKit plus App Intents for watch launch surfaces. The
iPhone app owns pairing-session credentials, mobile API calls, retries, and bootstrap
publication. The watch stays stateless with respect to Forge auth and only queues fast
habit, check-in, prompt, and note-capture actions for the phone to forward.
The iPhone companion also owns a native SwiftUI Life Timeline surface for movement
history. That surface is not a web wrapper: it renders canonical paginated movement
segments, overlays the current local stay or trip, and writes corrections back through
the same Fastify movement contract the web app can reuse later.

Forge also has a long-term canonical desktop architecture that remains binding even
while the current Node bridge is in place. That canonical architecture is Tauri 2 with
Rust services built on Axum, Tokio, SQLx, and SQLite. The data layer is expected to be
local-first, migration-backed, and auditable. SQLite features such as WAL mode, JSON1,
FTS5, and append-oriented history are part of the intended foundation. GraphQL and
Electron are not aligned with this product direction.

The live SQLite schema must now become multi-user-aware. Core user-owned records must
carry a first-class `userId` or equivalent owner foreign key instead of relying on raw
display strings such as `owner` or `actor` alone. Legacy display labels may still
exist for UX or audit readability, but they are not allowed to be the sole source of
identity anymore. Search, snapshot assembly, and entity CRUD must all flow from the
real user model.

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
