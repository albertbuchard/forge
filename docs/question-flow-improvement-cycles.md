# Forge Question Flow Improvement Cycles

Latest run date: 2026-05-17

This report records the three-cycle evaluation for Forge agent question flows. The
same full flow set was tested in each cycle so improvements were kept only where they
helped the entity or specialized surface.

## 2026-05-17 Automation Pass

Setup verification:

- Read prior automation memory and kept the May 13 self-observation, health-session
  enrichment, mode-profile, and restore-route improvements as regression expectations.
- Confirmed OpenClaw and Hermes configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`, and verified the live
  `forge.sqlite` handle was open there. No data-root repair, merge, deletion, or
  overwrite was performed.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
- Built the Hermes packaged runtime with
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin` with `--link`, enabled the plugin, and
  restarted the OpenClaw gateway.
- Reinstalled Hermes editable from `./plugins/forge-hermes` and verified the local
  package import path.
- Verified live Forge health, live onboarding, OpenAPI, OpenClaw runtime tool exposure,
  and specialized route families for Movement, Life Force, and Workbench before the
  improvement cycles.

Every cycle retested the full flow set below: planning and collaboration, calendar,
preferences, questionnaires and reflection, health, wiki, all Psyche entities, and
the Movement, Life Force, and Workbench specialized surfaces. Scenarios included
adding, updating, reviewing, navigating, and route-selecting each entity or domain
surface, with Psyche evaluated for therapist-like active listening and specialized
surfaces evaluated for exact API posture.

Cycle 1 baseline strength was broad: normal stored entities stayed batch-first, Psyche
flows still used concrete lived examples before interpretation, Movement and Life
Force had dedicated route lanes, and Workbench read/run lanes were clear. The gap was
Workbench flow lifecycle work. The playbooks and onboarding made it easy to inspect or
run flows, but less clear how an agent should ask about creating, editing, or deleting
a flow without starting with raw JSON or route-shaped wording. The change added a
Workbench CRUD arc: clarify the flow job, stable inputs, expected public output, and
smallest structural change; confirm deletion lifecycle effects and whether published
outputs or run history need preservation; and publish `createFlow`, `updateFlow`, and
`deleteFlow` route-key examples across onboarding, OpenClaw, Hermes, and Codex skills.
First retest exposed two wording mismatches in tests, which were corrected. The second
retest passed across the full focused suite, so the change was kept.

Cycle 2 retested every entity and surface with emphasis on Movement. Question quality
was strong for timeline, day/month/all-time reads, trips, places, selection
aggregates, overlays, and repair actions, but live OpenAPI also exposes Movement
settings and the question guidance did not make that lane explicit. That could make an
agent treat passive capture, publish mode, retention, or companion readiness as place,
stay, trip, or batch CRUD work. The change added Movement settings as its own lane in
the playbooks, onboarding route-selection questions, route notes, and skill examples:
`settings` for `GET /api/v1/movement/settings` and `settingsUpdate` for
`PATCH /api/v1/movement/settings`. Retest first caught one old regex that assumed the
old Movement route list; after updating it, the full focused suite passed. The change
was kept.

Cycle 3 retested the full matrix again with emphasis on Workbench route completeness.
The live Workbench API exposes `POST /api/v1/workbench/flows/:id/chat`, but the agent
contract did not make saved-flow chat follow-ups a first-class lane. That risked
turning a flow-specific follow-up into a new run, a note, or a generic entity update.
The change added a flow-chat arc, lane-to-route mapping, ready-to-act condition, and
guardrail in the shared playbook; added `chatFlow` to live route-key examples and
onboarding route-selection questions; and updated OpenClaw, Hermes, packaged Hermes,
and Codex skill docs with the concrete route-key example and `POST` path. The first
retest found that the playbook named the path without the `POST` method; after adding
the method and refreshing plugin copies, retest passed across all 36 focused
question-flow and contract assertions. The change was kept.

## 2026-05-13 Automation Pass

Setup verification:

- Read the prior automation memory and kept the May 9, May 10, and May 12 changes as
  regression expectations.
- Confirmed OpenClaw and Hermes configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`, and verified the live
  `forge.sqlite` handle was open there. No data-root repair, merge, or data deletion
  was performed.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
- Built the Hermes packaged runtime with
  `node plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin` with `--link` and reinstalled Hermes
  editable from `./plugins/forge-hermes`.
- Restarted both gateways, verified `openclaw plugins info forge-openclaw-plugin`,
  `openclaw forge health`, Hermes editable import path, live onboarding, and OpenAPI.

Cycle 1 tested every listed stored entity and specialized surface: planning and
collaboration, calendar, preferences, questionnaires and reflection, health, wiki,
every Psyche entity, Movement, Life Force, and Workbench. Baseline tests passed, but
the live `self_observation` entity catalog still classified the flow as
`read_model_only_surface` even though the playbooks and route model describe it as a
note-backed action workflow. That could make an agent read the calendar and then
hesitate to create or update the observed note. The change reclassified
`self_observation` as `action_workflow_entity`, published the tool path
`forge_get_self_observation_calendar | forge_create_entities |
forge_update_entities`, and made `sleep_session` and `workout_session` mention their
reflective enrichment helpers while keeping ordinary health-session CRUD on shared
batch routes. Retest across the full suite passed, so the change was kept.

Cycle 2 retested the full flow set with emphasis on Psyche quality. The baseline was
strong for values, patterns, beliefs, trigger reports, event types, and emotion
definitions, but live `mode_profile` onboarding still placed mode-family selection too
early in the sequence. The change moved family selection after lived description,
protective job, fear, and burden, and added a candidate formulation step in the
user's language. Retest passed, so the mode-profile change was kept.

Cycle 3 retested the full flow set with emphasis on API completeness. The shared
batch route model and tools exposed restore, but the entity-catalog preferred mutation
path for normal stored entities omitted `/api/v1/entities/restore`. The change added
restore to the published preferred batch mutation path and locked it with onboarding
contract coverage. Retest passed, so the route-completeness change was kept.

## 2026-05-12 Automation Pass

Setup verification:

- Confirmed OpenClaw and Hermes configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge` and verified the live
  `forge.sqlite` handle was open there, preserving existing data.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
- Built the Hermes packaged runtime with
  `node plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin` with `--link` and reinstalled Hermes
  editable from `./plugins/forge-hermes`.
- Restarted both gateways, verified `openclaw plugins info forge-openclaw-plugin`,
  `openclaw forge health`, Hermes editable import path, live onboarding, and OpenAPI.

Cycle 1 tested every stored entity and specialized surface: planning and
collaboration, calendar, preferences, questionnaires and reflection, health, wiki,
every Psyche entity, Movement, Life Force, and Workbench. The suite passed, but the
live catalog also contained read-model-only `sleep_overview` and `sports_overview`
surfaces that were not explicitly represented in the simulation matrix. The change
added Sleep Overview and Sports Overview playbook sections, scenarios, route posture
coverage, and tests. Retest across the full suite passed, so the change was kept.

Cycle 2 retested the expanded full set with emphasis on API path clarity. The new
health overview question flows were good, but live onboarding exposed the read model
paths only as `sleepOverview` and `sportsOverview`, while the entity catalog names are
`sleep_overview` and `sports_overview`. That forced unnecessary key translation. The
change added entity-style aliases to `entityRouteModel.readModelOnlySurfaces` and
locked them in onboarding and server tests. Retest passed, so the alias change was
kept.

Cycle 3 retested the expanded full set again with emphasis on parity across skills,
onboarding, and OpenAPI. The remaining weakness was skill prose: OpenClaw, Hermes,
and Codex mentioned sleep and sports overviews but did not explicitly point agents to
`entityRouteModel.readModelOnlySurfaces` or the new entity-style aliases. The change
updated all three skill surfaces and packaged copies, then added parity assertions.
Retest passed, so the guidance was kept.

## 2026-05-10 Automation Pass

Setup verification:

- Confirmed OpenClaw and Hermes configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge` and verified the live SQLite
  handle was open there, preserving existing Forge data.
- Rebuilt the local OpenClaw plugin and Hermes runtime with
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin` with `--link` and reinstalled Hermes
  editable from `./plugins/forge-hermes`.
- Restarted both gateways, verified `openclaw forge health`, verified Hermes imports
  from the repo-local editable package, and verified live onboarding plus OpenAPI for
  batch entities and the Movement, Life Force, and Workbench route families.

Cycle 1 retested the complete flow set: planning and collaboration records, calendar
records, preference records, questionnaire and reflection records, health records,
wiki pages, every Psyche record, and Movement, Life Force, and Workbench. The main
weakness was entity-specific: `event_type` and `emotion_definition` were present in
both general and Psyche playbooks, and the general entries were too taxonomy-shaped.
That could make an agent collect a label before helping the user clarify a lived
episode, felt signature, meaning, and Psyche connection. The change strengthened the
general playbooks and live onboarding entries so both records explicitly bridge into
Psyche-quality intake, preserve active-listening sequencing, and still store through
shared batch CRUD. Retest across the full suite improved those flows without harming
non-Psyche entities, so the change was kept.

Cycle 2 retested the same full set with emphasis on API access clarity. Question
quality remained good, but the specialized-domain contract exposed route-key path
maps without one canonical route-key-to-`METHOD path` map. That made POST read lanes
like Movement `selection` and mutation or repair paths easier to misread. The change
added `methodRoutes` to the live onboarding payload, shared TypeScript type, OpenAPI
schema, and contract tests for Movement, Life Force, the `life_force` alias, and
Workbench. Retest confirmed normal Forge entities still default to shared batch CRUD,
while Movement, Life Force, and Workbench now expose exact specialized methods and
paths without guessing, so the change was kept.

Cycle 3 retested the full flow set again with emphasis on whether a new OpenClaw,
Hermes, or Codex agent would actually see the new method contract in its skill
instructions. The remaining weakness was documentation parity: skills mentioned
route-key schemas but did not point agents at live onboarding `methodRoutes` as the
method source of truth. The change updated OpenClaw, Hermes, packaged Hermes, and
Codex skill route-posture guidance to name `methodRoutes`, call out POST aggregate
reads such as Movement `selection`, and call out DELETE repair paths. Retest kept the
change because it improved specialized API accuracy without making user-facing
questions more route-heavy.

## 2026-05-09 Follow-Up Automation Pass

Setup verification:

- Rebuilt the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
- Rebuilt the Hermes packaged runtime with
  `node plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin` with `--link` and the explicit unsafe
  install approval flag required by OpenClaw's scanner.
- Reinstalled Hermes as an editable package from `./plugins/forge-hermes`.
- Verified OpenClaw loads `forge-openclaw-plugin` from the repo-local plugin path.
- Verified Hermes imports `forge_hermes` from the repo-local editable package.
- Verified Forge backend health at `127.0.0.1:4317`.
- Verified the live process has
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open.
- Verified live onboarding and OpenAPI still expose normal stored entities through
  batch CRUD and Movement, Life Force, and Workbench through dedicated route families.

Cycle 1 tested the complete flow set again: every planning, calendar, preferences,
questionnaire, health, wiki, Psyche, Movement, Life Force, and Workbench scenario in
the table below. The baseline passed, but the specialized-surface lane guidance could
still let a new agent turn route keys into user-facing menus. The change kept the
exact Movement, Life Force, and Workbench route keys internal while adding
plain-language lane translation: time window/place/span for Movement, current
state/durable assumption/weekday rhythm/right-now state for Life Force, and saved
flow/input contract/run/node/public result for Workbench. Retest passed, so the
change was kept.

Cycle 2 re-ran every flow with emphasis on Psyche. Psyche hypotheses were already
supported, but useful interpretations could remain reflective prose instead of
becoming a saveable Forge record. The change added a hypothesis-to-record bridge:
after one concrete example and a landed or corrected hypothesis, the agent should name
the record shape, translate the hypothesis into the smallest useful fields, ask one
accuracy question, and then write through shared batch entity routes after consent.
Retest passed, so the change was kept.

Cycle 3 re-ran every flow with emphasis on API contract fidelity. The live onboarding
payload and OpenAPI correctly exposed Movement, Life Force, and Workbench, but the
shared TypeScript onboarding type did not explicitly include `movement`, `lifeForce`,
and `workbench` in `conceptModel`, and its specialized-domain type omitted
`classification`, `aliases`, and `summary`. The change aligned the shared type with
the live contract and locked it with question-flow simulation assertions. Retest
passed, so the change was kept.

## Setup Verification

- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
- Built the Hermes packaged runtime with `node plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin` with `--link` and reinstalled Hermes
  as editable from `./plugins/forge-hermes`.
- Verified OpenClaw loaded `forge-openclaw-plugin` from the repo-local plugin path.
- Verified Hermes imports `forge_hermes` from the repo-local editable package.
- Verified the live Forge backend on `127.0.0.1:4317` is healthy and opened
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite`.
- Verified live onboarding and OpenAPI expose Movement, Life Force, and Workbench as
  dedicated route families rather than normal batch CRUD.

## Full Flow Set

Every cycle simulated creation, update, review, or navigation around these flows:

| Flow | Simulated user scenario |
| --- | --- |
| goal | Save a goal about rebuilding clinical writing confidence. |
| project | Turn a vague thesis-support idea into a bounded project. |
| strategy | Move from rough literature notes to a defensible chapter. |
| task | Add the next one-session AI task under a project. |
| habit | Track avoidance of difficult writing as a negative habit. |
| tag | Create a professional identity repair tag. |
| note | Preserve a reflection without over-structuring it. |
| insight | Save a pattern from recent blocked work sessions. |
| task_run | Start live work on the current task. |
| work_adjustment | Add real minutes that happened outside a live run. |
| calendar_event | Schedule a focused review call in local time. |
| work_block_template | Create a repeating protected writing block. |
| task_timebox | Reserve a future slot for an existing task. |
| calendar_connection | Connect a calendar for read/write planning. |
| preference_catalog | Create a comparison pool for places to work. |
| preference_catalog_item | Add one cafe candidate without ambiguity. |
| preference_context | Define a tired-state preference context. |
| preference_item | Save one preference candidate. |
| preference_judgment | Record a pairwise environment choice. |
| preference_signal | Mark a cafe as a veto for serious writing. |
| questionnaire_instrument | Draft a reusable post-session questionnaire. |
| questionnaire_run | Continue and finish an in-progress reflection run. |
| self_observation | Log the moment before disengagement. |
| sleep_session | Attach reflective context to last night's sleep. |
| workout_session | Link a hard workout to mood and recovery. |
| sleep_overview | Review recent nights to understand whether recovery is improving. |
| sports_overview | Review recent workouts to understand whether training load helps or drains. |
| wiki_page | Create a durable research-method reference page. |
| movement | Correct a missing movement span and review the timeline. |
| life_force | Update the model for Monday post-lunch crashes. |
| workbench | Inspect a failed flow run and latest node output. |
| psyche_value | Clarify why professional courage matters now. |
| behavior_pattern | Map freezing after critical feedback. |
| behavior | Understand over-editing instead of submitting. |
| belief_entry | Save the belief that work will be exposed as unserious. |
| mode_profile | Describe the part that takes over near judgment. |
| mode_guide_session | Guide a present-moment mode inquiry after shame. |
| trigger_report | Capture today's emotionally meaningful meeting episode. |
| event_type | Name recurring feedback-as-danger moments. |
| emotion_definition | Define dread versus ordinary anxiety. |

## Cycle 1

Tested:

- Ran the full simulation suite across all flows above.
- Checked question tone, missing-only sequencing, Psyche active listening, and route
  posture for batch CRUD, specialized CRUD, action workflows, and specialized domains.
- Verified live onboarding and OpenAPI route presence for Movement, Life Force, and
  Workbench.

Found:

- The baseline was already strong: full-flow simulations passed and the playbooks
  were not field-collection scripts.
- Life Force used route key `overview`, but a new agent could still infer a nonexistent
  `/api/v1/life-force/overview` route from the word overview.
- Workbench catalog wording did not clearly distinguish saved flow catalog reads from
  box/input catalog reads.
- Movement aggregate examples emphasized timeline and missing-stay correction but did
  not give enough route-key examples for all-time, selected-span aggregate, and trip
  detail work.

Changed:

- Added onboarding route-key examples for Movement `allTime`, `selection`, and
  `tripDetail`.
- Added Life Force `overview`, `profile`, `weekdayTemplate`, and `fatigueSignal`
  examples and an explicit warning that overview maps to `GET /api/v1/life-force`.
- Added Workbench `listFlows`, `boxCatalog`, `publishedOutput`, `runDetail`,
  `latestNodeOutput`, and `runFlow` examples.
- Updated OpenClaw, Hermes, and Codex skill guidance with the same concrete examples.
- Updated question-flow and onboarding tests to lock these examples into the contract.

Retest:

- Re-ran the full question-flow, skill-parity, and onboarding contract suite.
- Result: kept all Cycle 1 changes. No regressions; no reverts.

## Cycle 2

Tested:

- Re-ran all flows after Cycle 1 and compared the live onboarding payload against the
  static playbooks and skill surfaces.
- Focused on whether a new agent using only `forge_get_agent_onboarding` would ask
  the same high-quality questions and choose the same API families.
- Rechecked Psyche flows for active listening plus useful interpretation hypotheses,
  especially behavior patterns, beliefs, modes, trigger reports, event types, and
  emotion definitions.

Found:

- Static skill files now had clearer route examples, but the live per-surface
  onboarding ask sequences still needed the same route-key precision.
- Psyche guidance supported hypotheses, but it could be more direct that agents
  should not leave all interpretation work to the user once a concrete example exists.

Changed:

- Added live onboarding ask-sequence guidance that Movement `allTime`, `selection`,
  and `tripDetail` mean different read jobs.
- Added live onboarding guidance that Life Force `overview` is `GET /api/v1/life-force`,
  not `/api/v1/life-force/overview`.
- Added live onboarding guidance that Workbench `listFlows` is the saved flow catalog
  and `boxCatalog` is the input-box contract catalog.
- Strengthened Psyche playbooks: hypotheses are for supported function, prediction,
  protection, payoff, cost, or value conflict, not decorative reassurance; after one
  concrete example, offer one careful hypothesis and one question that tests it.

Retest:

- Re-ran the same full suite across every flow.
- Result: kept all Cycle 2 changes. No wording got broader or more robotic; no
  routing regression was observed.

## Cycle 3

Tested:

- Re-ran the full entity and specialized-surface suite with emphasis on process risk:
  whether each cycle truly covers every flow and whether settled formulations are
  allowed to close instead of reopening intake.
- Rechecked route posture matrix coverage for normal stored entities, specialized
  CRUD, action workflows, read-model-only surfaces, and specialized domains.

Found:

- The harness listed full scenarios, but it did not explicitly assert that Cycle 1,
  Cycle 2, and Cycle 3 each cover the whole flow set.
- Existing closeout guidance was good, so no per-entity wording needed to be reverted.

Changed:

- Added a per-cycle coverage guard to `question-flow-simulation-cycles.test.ts` so
  future changes cannot silently test only a subset of entities in any cycle.
- Added this report as a durable record of what was tested, found, changed, kept, and
  retested.

Retest:

- Re-ran the full suite after the coverage guard.
- Result: kept the Cycle 3 guard and report. No reverts.

## Final State

- Normal stored entities default to shared batch entity routes.
- `wiki_page` and `calendar_connection` stay on specialized CRUD surfaces.
- `task_run`, `work_adjustment`, `questionnaire_run`, `preference_judgment`,
  `preference_signal`, and `self_observation` stay on action or note-backed workflows.
- Movement, Life Force, and Workbench are explicitly specialized domain surfaces with
  exact route families, route-key examples, and OpenAPI coverage.
- Psyche records remain therapeutically guided while still using batch CRUD for API
  storage once formulation and consent are clear.
