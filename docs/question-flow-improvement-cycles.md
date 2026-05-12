# Forge Question Flow Improvement Cycles

Run date: 2026-05-08

This report records the three-cycle evaluation for Forge agent question flows. The
same full flow set was tested in each cycle so improvements were kept only where they
helped the entity or specialized surface.

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
