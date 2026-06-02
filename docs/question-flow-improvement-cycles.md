# Forge Question Flow Improvement Cycles

Latest run date: 2026-06-02

This report records the three-cycle evaluation for Forge agent question flows. The
same full flow set was tested in each cycle so improvements were kept only where they
helped the entity or specialized surface.

## 2026-06-02 Automation Pass

Setup verification:

- Confirmed the Forge worktree was on `main` before plugin work and edits.
- Read the prior automation memory and kept the existing Forge data root intact.
- Verified OpenClaw and Hermes configs both point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`; the live runtime on
  `127.0.0.1:4317` had
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open. No
  database, data root, backup, or user data was moved, merged, deleted, or
  overwritten.
- Built and reinstalled the repo-local OpenClaw plugin from `./openclaw-plugin`,
  enabled it, and restarted the gateway. The known duplicate plugin-id warning
  remains, with OpenClaw resolving to the config-selected repo-local plugin.
- Built the Hermes packaged runtime and reinstalled Hermes editable from
  `./plugins/forge-hermes`.
- Verified OpenClaw loads `forge-openclaw-plugin 0.2.99` from the repo-local dist and
  Hermes imports `forge-hermes-plugin 0.2.99` from the repo-local editable package.
- Verified live onboarding and OpenAPI before the cycles: 42 entity catalog entries,
  28 batch-CRUD entities, 14 read models, 23 Movement route keys, four Life Force
  route keys under both `lifeForce` and `life_force`, 16 Workbench route keys, and
  182 OpenAPI paths with the expected batch, Movement, Life Force, Workbench, and
  training-load families.

Every cycle retested the full current flow set: goal, project, strategy, task, habit,
tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item,
preference_judgment, preference_signal, questionnaire_instrument,
questionnaire_run, self_observation, sleep_session, sleep_overview,
workout_session, sports_overview, training_load, wiki_page, movement, life_force,
workbench, psyche_value, behavior_pattern, behavior, belief_entry, mode_profile,
mode_guide_session, flashcard, trigger_report, event_type, and
emotion_definition.

Specialized route scenarios covered all live Movement lanes for day, month, all-time,
timeline, places, box detail, trip detail, selected-span aggregate, settings,
settings updates, place create/update, user-box preflight/create/update/delete,
automatic-box invalidation, stay/trip update/delete, and trip-point update/delete;
Life Force overview, profile, weekday template, and fatigue signal; and Workbench
flow catalog, flow detail by id or slug, flow CRUD, saved-flow execution, one-off
execution, chat follow-up, run history, run detail, run nodes, node result, latest
node output, published output, and box catalog.

Cycle 1 tested all flows after the plugin refresh with extra attention to combined
requests such as "review this and fix it", "save the pattern and make me a card", and
"inspect the run and publish the output". Strengths: existing guidance was strong for
single add, update, review, and specialized route flows. Weakness: mixed-intent
requests did not yet have a clear sequence, so an agent could ask a broad route/menu
question even when the verbs already implied read-then-write or formulation-then-card.

What changed in Cycle 1:

- Added `Mixed-intent sequencing` to the shared entity playbook.
- Added Psyche-specific guidance for understanding-plus-support requests: formulate
  the primary Psyche record first, then derive the flashcard, note, link, task, or
  habit from accepted wording.
- Added `mixedIntentSequencingRule` to live onboarding, the TypeScript onboarding
  type, OpenAPI schema, OpenClaw/Hermes/Codex skill summaries, and regression tests.

What happened after retesting Cycle 1:

- The first retest found assertion line-wrap mismatches only; guidance and route
  posture were intact.
- After assertion adjustment, the full focused suite passed: 39 tests.
- The change improved combined flows without weakening batch-first or specialized
  route posture, so it was kept.

Cycle 2 retested the full matrix with attention to near-duplicate records and
add-versus-update ambiguity. Strengths: entity catalog search hints and tool docs
already told agents to search before creating duplicates. Weakness: the conversation
playbooks did not clearly say how to handle a likely match in user-facing language, so
agents could either create duplicate batch records or reopen full intake instead of
asking the narrow update/link/new-record question.

What changed in Cycle 2:

- Added `Search-before-write and existing-record disambiguation` to the shared entity
  playbook.
- Added Psyche-specific duplicate handling: similar beliefs, patterns, modes, trigger
  reports, values, and flashcards are formulation choices, not cold duplicate errors.
- Added `duplicateDisambiguationRule` to live onboarding, the TypeScript onboarding
  type, OpenAPI schema, OpenClaw/Hermes/Codex skill summaries, and regression tests.
- Kept specialized surfaces out of batch duplicate search: wiki/calendar use their
  dedicated search/list/read routes, while Movement, Life Force, and Workbench use
  their dedicated read lanes.

What happened after retesting Cycle 2:

- The first retest found one assertion wording mismatch between the Psyche Markdown
  playbook and live onboarding phrasing.
- After aligning the assertion to the playbook wording, the full focused suite passed:
  39 tests.
- The change improved duplicate handling and update/new-record disambiguation without
  adding extra questions when the user already chose a distinct new record, so it was
  kept.

Cycle 3 retested all flows with attention to destructive, replacement, and repair
actions. Strengths: several entity-specific sections already covered careful deletion,
especially Workbench flow deletion and Movement repair. Weakness: there was no general
question-flow rule for deleting, archiving, invalidating, disconnecting, overwriting,
or replacing records, so an agent could treat a destructive action as ordinary update
intake.

What changed in Cycle 3:

- Added `Destructive and replacement actions` to the shared entity playbook.
- Added Psyche-specific history preservation: do not delete old beliefs, patterns,
  modes, trigger interpretations, values, or flashcards just because a cleaner
  formulation exists; ask whether the old record should be updated, linked as history,
  archived, or kept distinct.
- Added `destructiveActionRule` to live onboarding, the TypeScript onboarding type,
  OpenAPI schema, OpenClaw/Hermes/Codex skill summaries, and regression tests.
- Clarified that Movement repair must distinguish user-defined overlay deletion from
  automatic-box invalidation and recorded stay/trip/point deletion, and that calendar
  connections, Workbench flows, wiki pages, and questionnaire instruments need a
  preservation check for downstream sync, published output, backlinks, run history, or
  completed runs.

What happened after retesting Cycle 3:

- The first retest found one line-wrap-sensitive top-level skill assertion.
- After assertion adjustment, the full focused suite passed: 39 tests.
- The change improved replacement and deletion safety without requiring ceremonial
  second confirmations when the user already confirmed the target and preservation
  choice, so it was kept. Nothing was reverted.

## 2026-06-01 Automation Pass

Setup verification:

- Confirmed the Forge worktree was on `main` before build, install, and edits.
- No prior automation memory file existed for this automation in the active Codex
  home; this run creates it at closeout.
- Verified the live Forge runtime on `127.0.0.1:4317` was healthy and had the
  canonical `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite`
  open. No Forge data root, SQLite database, backup, or user data was moved, merged,
  deleted, or overwritten.
- Built and reinstalled the repo-local OpenClaw plugin with
  `npm run build:openclaw-plugin`,
  `openclaw plugins install --link --dangerously-force-unsafe-install ./openclaw-plugin`,
  `openclaw plugins enable forge-openclaw-plugin`, and `openclaw gateway restart`.
- Built the Hermes packaged runtime with
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs` and reinstalled the
  Hermes plugin editable from `./plugins/forge-hermes`.
- Verified OpenClaw loads `forge-openclaw-plugin 0.2.99` from the repo-local plugin
  dist, and Hermes imports `forge-hermes-plugin 0.2.99` from the repo-local editable
  package.
- Verified live onboarding and OpenAPI before the cycles: 42 entity catalog entries,
  28 batch-CRUD entities, 14 read models, 23 Movement route keys, four Life Force
  route keys under both `lifeForce` and `life_force`, 16 Workbench route keys, and
  182 OpenAPI paths with five shared batch entity routes, 16 Movement paths, four Life
  Force paths, 13 Workbench paths, and `/api/v1/health/training-load`.

Every cycle retested the full current flow set: goal, project, strategy, task, habit,
tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item,
preference_judgment, preference_signal, questionnaire_instrument,
questionnaire_run, self_observation, sleep_session, sleep_overview,
workout_session, sports_overview, training_load, wiki_page, movement, life_force,
workbench, psyche_value, behavior_pattern, behavior, belief_entry, mode_profile,
mode_guide_session, flashcard, trigger_report, event_type, and
emotion_definition.

Specialized route scenarios covered Movement day, month, all-time, timeline, places,
box detail, trip detail, selected-span aggregate, settings reads and updates, place
create/update, user-box preflight/create/update/delete, automatic-box invalidation,
stay/trip/point update/delete; Life Force overview, profile update, weekday template,
and fatigue signal; and Workbench flow catalog, box catalog, flow CRUD, saved-flow
execution, one-off execution, chat follow-up, run history, run detail, run node list,
node result, published output, and latest node output.

Cycle 1 tested all entity and specialized-surface flows after the plugin refresh, with
extra attention to first-turn pacing. Strengths: the full suite already covered every
live catalog entry, Psyche flows, reflection-sensitive non-Psyche records, Movement,
Life Force, and Workbench. Weakness: a few operational openers still bundled name,
scope, and timing into one first question, which made calendar events, work blocks,
timeboxes, calendar connections, and questionnaire runs feel more like form intake
than missing-only guidance.

What changed in Cycle 1:

- Added a first-turn discipline rule: operational create flows should not bundle
  name, scope, and timing when the user has already supplied part of the answer.
- Tightened preferred openers for `calendar_event`, `work_block_template`,
  `task_timebox`, `calendar_connection`, and `questionnaire_run`.
- Mirrored the same wording into live onboarding and all bundled OpenClaw, Hermes, and
  Codex playbook copies.
- Updated question-flow assertions so the shorter operational openers remain
  protected.

What happened after retesting Cycle 1:

- The first retest found assertion wording mismatches only; provider handling and
  route posture were still present.
- After updating the assertions, the full question-flow, onboarding, tool, manifest,
  route parity, and playbook parity suite passed: 50 focused tests.
- The change improved operational pacing without weakening API clarity, so it was
  kept.

Cycle 2 retested the same full matrix with special attention to Psyche active
listening and interpretive hypotheses. Strengths: the Psyche playbook already
supported reflection, functional analysis, schema-theme routing, and correctable
hypotheses. Weakness: the guidance said to offer hypotheses, but did not provide a
compact enough wording shape for agents that rely on live onboarding and tend to stay
in indefinite reflective questioning.

What changed in Cycle 2:

- Added a `Hypothesis Wording Shape` section to the Psyche playbook: start from the
  user's concrete example, offer one testable interpretation, name the function
  without blame, and ask for correction.
- Added `psycheHypothesisRule` to the live onboarding `interactionGuidance` contract,
  TypeScript onboarding type, and OpenAPI schema.
- Mirrored the Psyche playbook into OpenClaw, Hermes, and Codex bundled skill copies.
- Added regression assertions requiring the new hypothesis shape in Markdown,
  onboarding, and OpenAPI coverage.

What happened after retesting Cycle 2:

- Re-ran the full focused suite. All 50 focused tests passed.
- The change strengthened Psyche formulation without changing batch CRUD posture for
  Psyche records, so it was kept.

Cycle 3 retested every flow and specialized route lane against live onboarding and
generated OpenAPI. Strengths: Movement, Life Force, and Workbench already exposed the
right route-key families and route examples. Weakness: the tests sampled and counted
specialized routes, but did not mechanically prove that every onboarding
`methodRoutes` entry existed in generated OpenAPI with the exact HTTP method.

What changed in Cycle 3:

- Added an onboarding-contract assertion that parses every specialized `methodRoutes`
  value for Movement, Life Force, `life_force`, and Workbench and verifies the exact
  method/path against generated OpenAPI.

What happened after retesting Cycle 3:

- Re-ran the full focused suite. All 50 focused tests passed.
- The new OpenAPI alignment guard improved API contract truthfulness without changing
  any user-facing flow, so it was kept. Nothing was reverted.

## 2026-05-31 Automation Pass

Setup verification:

- Read the prior automation memory and kept the existing Forge data root intact.
- Confirmed the monorepo and Forge worktree were on `main` before implementation.
- Confirmed OpenClaw config still points `forge-openclaw-plugin` at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge` and the live Forge process on
  `127.0.0.1:4317` had
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open. No Forge
  data root was deleted, moved, merged, or overwritten.
- Built and reinstalled the repo-local OpenClaw plugin with
  `npm run build:openclaw-plugin`,
  `openclaw plugins install --link --dangerously-force-unsafe-install ./openclaw-plugin`,
  `openclaw plugins enable forge-openclaw-plugin`, and `openclaw gateway restart`.
- Built the Hermes packaged runtime with
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs` and reinstalled the
  Hermes plugin editable from `./plugins/forge-hermes`.
- Verified OpenClaw loads the repo-local plugin path, and Hermes imports
  `forge-hermes-plugin 0.2.95` from the repo-local editable package.
- Verified live onboarding and OpenAPI before the cycles: 42 entity catalog entries,
  28 batch-CRUD entities, 14 read models, 23 Movement route keys, four Life Force
  route keys under both `lifeForce` and `life_force`, 16 Workbench route keys, and
  182 OpenAPI paths at `/api/v1/openapi.json`.

Every cycle retested the current full flow set: goal, project, strategy, task, habit,
tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item,
preference_judgment, preference_signal, questionnaire_instrument,
questionnaire_run, self_observation, sleep_session, sleep_overview,
workout_session, sports_overview, training_load, wiki_page, movement, life_force,
workbench, psyche_value, behavior_pattern, behavior, belief_entry, mode_profile,
mode_guide_session, flashcard, trigger_report, event_type, and
emotion_definition.

Specialized route scenarios covered Movement day, month, all-time, timeline, places,
trip detail, selected-span aggregate, settings, saved overlays, known places,
automatic-box repair, stay/trip/point repair actions; Life Force overview, profile
updates, weekday templates, and fatigue signals; and Workbench flow catalog, flow
CRUD, execution, run history, published outputs, node results, latest node outputs,
one-off runs, and chat.

Cycle 1 tested the full add, update, review, navigation, correction, and specialized
route-selection matrix after the local plugin refresh. Strengths: the main
conversation rules already pushed agents toward missing-only questions, active
listening, Psyche functional analysis, and specialized routing for Movement, Life
Force, and Workbench. Weakness: several agent-facing skill examples did not show how
to call dedicated Movement place CRUD, saved-overlay update/delete, or Workbench
run-node and node-result reads, so a new agent still had room to guess.

What changed in Cycle 1:

- Added route-key examples for Movement `placeCreate`, `placeUpdate`,
  `userBoxUpdate`, and `userBoxDelete`.
- Added route-key examples for Workbench `runNodes` and `nodeResult`.
- Added parity assertions so Codex and Hermes skill surfaces keep those dedicated
  route examples instead of falling back to vague endpoint guessing.

What happened after retesting Cycle 1:

- Re-ran the full question-flow simulation, quality, onboarding contract, and
  skill-playbook parity suite. All 39 focused tests passed.
- The change improved API-path clarity for Movement and Workbench without changing
  the user-facing question style, so it was kept.

Cycle 2 retested the same full flow matrix with special attention to records that are
reflective but not always Psyche records. Strengths: Psyche entities remained strong,
hypothesis-capable, and not minimized; normal stored entities stayed batch-first; and
action workflows kept their dedicated routes. Weakness: questionnaire runs,
self-observations, reflective notes/wiki pages, sleep and workout enrichments, and
preference signals needed a clearer middle lane: active listening without turning
every reflective fact into Psyche intake or a form-fill.

What changed in Cycle 2:

- Added a "Reflection-sensitive non-Psyche records" section to the shared entity
  conversation playbook.
- Synced that playbook into OpenClaw, Codex, Hermes source, and Hermes packaged
  skill surfaces.
- Added skill guidance telling agents to ask what the reflection should help the user
  understand, decide, notice, remember, or change later, while preserving exact route
  posture: batch CRUD for normal stored records, questionnaire-run actions for answer
  lifecycle, self-observation calendar plus observed-note writes, and wiki routes for
  wiki pages.
- Added regression assertions for the new reflection-sensitive guidance.

What happened after retesting Cycle 2:

- Re-ran the full focused suite. All 39 focused tests passed.
- The change improved reflective non-Psyche flow quality while leaving Psyche and
  specialized-surface routing intact, so it was kept.

Cycle 3 retested every flow again against the live onboarding contract. Strengths:
the skill/playbook files now expressed the right reflective middle lane, and all
specialized Movement, Life Force, and Workbench route families remained explicit.
Weakness: live `/api/v1/agents/onboarding` did not yet expose the new
reflection-sensitive guidance, so an agent relying only on live onboarding could miss
it.

What changed in Cycle 3:

- Added the reflection-sensitive non-Psyche record rule to the live onboarding
  `conversationRules` payload in `server/src/app.ts`.
- Added onboarding contract assertions requiring that live onboarding mention
  `questionnaire_run`, `self_observation`, `wiki_page`, `sleep_session`,
  `workout_session`, the "understand, decide, notice, remember, or change later"
  question, and the correct batch/action/self-observation/wiki API postures.

What happened after retesting Cycle 3:

- Re-ran the onboarding contract test alone first. All nine onboarding tests passed.
- Re-ran the full question-flow simulation, quality, onboarding contract, and
  skill-playbook parity suite. All 39 focused tests passed.
- The live-contract change aligned onboarding with the skills and did not make any
  entity or specialized surface worse, so it was kept and nothing was reverted.

## 2026-05-28 Automation Pass

Setup verification:

- Confirmed the monorepo and Forge worktree were on `main` before plugin work and
  edits.
- No prior automation memory file existed for
  `improvement-of-question-flows-in-forge` at the start of this run.
- Confirmed OpenClaw config still points `forge-openclaw-plugin` at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge` and the live process on
  `127.0.0.1:4317` had
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open. No Forge
  data root was changed, moved, merged, deleted, or overwritten.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`, linked it
  again with
  `openclaw plugins install --link --dangerously-force-unsafe-install ./openclaw-plugin`,
  and restarted the OpenClaw gateway. The known duplicate plugin-id warning remains,
  and OpenClaw resolves it in favor of the config-selected repo-local plugin.
- Built the Hermes packaged runtime with
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs` and reinstalled
  Hermes editable from `./plugins/forge-hermes`.
- Verified OpenClaw loads `forge-openclaw-plugin 0.2.94` from the repo-local
  `openclaw-plugin/dist/openclaw/index.js`, with recorded install version `0.2.94`.
- Verified Hermes imports `forge-hermes-plugin 0.2.95` from the repo-local editable
  package.
- Verified live Forge health, OpenClaw `forge health`, live onboarding, and live
  OpenAPI. Live onboarding published 42 catalog entries, 38 non-Psyche conversation
  playbooks, 10 Psyche playbooks, 23 Movement route keys, four Life Force route keys
  under both `lifeForce` and `life_force`, and 16 Workbench route keys. Live OpenAPI
  exposed 182 paths, including five shared batch entity routes, 16 Movement routes,
  four Life Force routes, 13 Workbench routes, and `/api/v1/health/training-load`.

Every cycle retested the full current flow set: goal, project, strategy, task, habit,
tag, note, insight, task_run, work_adjustment, calendar_event, work_block_template,
task_timebox, calendar_connection, preference_catalog, preference_catalog_item,
preference_context, preference_item, preference_judgment, preference_signal,
questionnaire_instrument, questionnaire_run, self_observation, sleep_session,
sleep_overview, workout_session, sports_overview, training_load, wiki_page, movement,
life_force, workbench, psyche_value, behavior_pattern, behavior, belief_entry,
mode_profile, mode_guide_session, flashcard, trigger_report, event_type, and
emotion_definition. Specialized route scenarios covered all live Movement keys
including places, saved overlays, automatic-box repair, stays, trips, and trip points;
all Life Force keys; and all Workbench catalog, CRUD, execution, run, node, published
output, latest-output, one-off, and chat keys.

Cycle 1 tested all entity and specialized-surface flows after the plugin refresh, with
emphasis on whether the live catalog had drifted since the previous automation run.
Strengths: the full simulation and onboarding contract suite already covered
`training_load` as a read-model-only health surface, and the Movement, Life Force, and
Workbench route-key maps matched live onboarding. Weakness: several top-level agent
summaries still introduced Health as sleep/sports only, so a new agent could anchor on
`sleep_session` and `workout_session` and miss the dedicated `training_load` read
model before reaching the deeper route matrix.

What changed in Cycle 1:

- Added `training_load` to the OpenClaw skill frontmatter description.
- Updated the OpenClaw, Hermes, Hermes packaged, and Codex skill summaries so Health
  explicitly includes the read-only training-load surface for cardiovascular load and
  HR zone review.
- Updated the Hermes read-model-only surface summary to name training load beside
  sleep, sports, self-observation, calendar, and operator reads.
- Added regression assertions that lock this top-level training-load wording into the
  agent-facing skills.

What happened after retesting Cycle 1:

- Re-ran the full question-flow simulation, onboarding contract, and skill parity
  suite. All 33 focused tests passed.
- The change improved first-pass API-path clarity for health review without changing
  Psyche pacing or normal batch CRUD guidance, so it was kept.

Cycle 2 retested the same full matrix with emphasis on API access and live contract
truthfulness after the prompt-summary fix. Strengths: live onboarding still published
batch CRUD as the default for normal stored entities, read-model-only posture for
`training_load`, and dedicated route-key tools for Movement, Life Force, and
Workbench. Weakness: this durable report still described the live catalog as 41
entries and did not consistently name `training_load` in the current-cycle setup and
flow coverage, which made the automation record less trustworthy than the live
contract.

What changed in Cycle 2:

- Updated this report's latest run date, setup verification, live catalog counts, and
  full flow inventory to match the current 42-entry onboarding catalog.
- Added the current OpenClaw and Hermes local install versions and live OpenAPI path
  counts to the setup record.
- Kept the existing historical notes intact, including older passes that explain when
  training-load coverage first entered the simulation matrix.

What happened after retesting Cycle 2:

- Re-ran the same focused suite. All 33 focused tests passed.
- No route guidance changed during this documentation correction, and the report now
  matches live onboarding/OpenAPI, so the update was kept.

Cycle 3 retested every flow again with emphasis on regression risk across all agent
surfaces. Strengths: Psyche flows remained active-listening and hypothesis-capable;
non-Psyche flows stayed concise and missing-only; Movement, Life Force, and Workbench
stayed specialized-route-first; `training_load` stayed a read-model-only surface that
routes to `/api/v1/health/training-load` or `forge_get_training_load_overview`.
Weakness: none found that warranted another behavior change in this cycle.

What changed in Cycle 3:

- No additional prompt, route, or OpenAPI changes were made. The Cycle 1 and Cycle 2
  changes were kept as the final improvements for this pass.

What happened after retesting Cycle 3:

- Re-ran the focused question-flow/contract suite again after the final report update.
  All 33 focused tests passed.
- No changes were reverted. Remaining work is qualitative: run occasional real
  OpenClaw, Hermes, and Codex conversations where a user combines Psyche meaning,
  owner ambiguity, health training-load review, and specialized Movement/Life
  Force/Workbench actions in one utterance.

## 2026-05-27 Automation Pass

Setup verification:

- Confirmed the Forge worktree was on `main` before plugin work and edits.
- No prior automation memory file existed for
  `improvement-of-question-flows-in-forge`; this run creates it after completion.
- Confirmed OpenClaw and Hermes configs both point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`. The live Forge process on
  `127.0.0.1:4317` had
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open. No Forge
  data root was changed, moved, merged, deleted, or overwritten.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin` and built
  the Hermes packaged runtime with `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from the local plugin folder. OpenClaw would have removed the
  data-root config on uninstall, so the stale installed extension directory was moved
  aside and the repo-local linked plugin was installed with
  `openclaw plugins install --link --dangerously-force-unsafe-install ./openclaw-plugin`.
  The plugin was then enabled and the gateway restarted.
- Reinstalled Hermes from the local plugin folder with
  `~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable
  ./plugins/forge-hermes`, which installed `forge-hermes-plugin 0.2.92` from the
  repo-local editable package.
- Verified OpenClaw loads `forge-openclaw-plugin 0.2.92` from
  `~/Documents/aurel-monorepo/projects/forge/openclaw-plugin/dist/openclaw/index.js`
  and exposes `forge_call_movement_route`, `forge_call_life_force_route`, and
  `forge_call_workbench_route`. The known duplicate plugin-id warning remains, with
  OpenClaw resolving it in favor of the explicit config-selected repo-local plugin.
- Verified Hermes imports `forge-hermes-plugin 0.2.92` from the local editable path
  and exposes 63 Forge tools, including the Movement, Life Force, and Workbench
  route-key tools.
- Verified live Forge health, OpenClaw `forge health`, live onboarding at
  `/api/v1/agents/onboarding`, and live OpenAPI. Live onboarding published 41 entity
  and domain catalog entries plus dedicated Movement, Life Force/`life_force`, and
  Workbench route-key maps. Live OpenAPI exposed 181 paths, including five shared
  batch entity routes, 16 Movement routes, four Life Force routes, and 13 Workbench
  routes.

Every cycle retested the full stored-entity and domain set: goal, project, strategy,
task, habit, tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item, preference_judgment,
preference_signal, questionnaire_instrument, questionnaire_run, self_observation,
sleep_session, workout_session, wiki_page, movement, life_force, workbench,
psyche_value, behavior_pattern, behavior, belief_entry, mode_profile,
mode_guide_session, flashcard, trigger_report, event_type, emotion_definition, plus
operator, calendar, sleep, and sports overview read models. Specialized route
scenarios covered Movement day/month/all-time/timeline/places/box detail/trip
detail/selection/settings/place CRUD/manual overlays/repair/delete actions, Life
Force overview/profile/weekday-template/fatigue-signal routes, and Workbench flow
catalog/detail/CRUD/execution/run history/run nodes/node result/published output/
latest node output/one-off execution/chat routes.

Cycle 1 tested all entity flows and specialized lanes with emphasis on Psyche.
Strengths: existing Psyche flows were already example-first, hypothesis-capable, and
batch-CRUD-correct after consent. Weakness: when one user utterance exposed several
Psyche containers at once, an agent could still ask the user to choose the entity type
too early instead of explaining the lived difference between one episode, one
recurring loop, one move, one belief sentence, one active mode, and one reusable
future label.

What changed in Cycle 1:

- Added a Psyche "Entity Contrast Check" to the shared OpenClaw/Hermes playbooks.
- Added guidance to reflect the lived difference before asking a container question,
  and to offer one careful hypothesis after one concrete example is visible.
- Updated the OpenClaw and Hermes bundled skill copies.
- Added regression coverage that checks the contrast for `trigger_report`,
  `behavior_pattern`, `behavior`, `belief_entry`, `mode_profile`,
  `mode_guide_session`, `event_type`, and `emotion_definition`.

What happened after retesting Cycle 1:

- The full focused suite passed across every entity and specialized surface.
- No Psyche flow became more form-like, and no normal entity route posture changed, so
  the Cycle 1 change was kept.

Cycle 2 retested the same full flow set with emphasis on multi-user and collaboration
scope. Strengths: the skill already documented `userId`, owners, and bot/human
assignment. Weakness: the question-flow playbooks did not explicitly say when to ask
for owner or user scope, so an agent could either skip an important human/bot owner
or ask "who owns this?" as a mechanical first field on ordinary records.

What changed in Cycle 2:

- Added an "Owner And User-Scope Checkpoint" to the entity conversation playbook.
- Updated live onboarding conversation rules so `userId`, owner, and human/bot
  assignees are treated as accountability and scope, not opening form fields.
- Updated OpenClaw and Hermes skill guidance to ask owner/user scope only when it
  changes visibility, review results, collaboration, automation behavior, or later
  filtering.
- Added regression coverage for late, purposeful owner/user-scope questioning.

What happened after retesting Cycle 2:

- The full focused suite passed again.
- The change improved multi-user clarity without making non-Psyche flows more
  administrative, so it was kept.

Cycle 3 retested every flow again with emphasis on specialized API paths. Strengths:
Movement, Life Force, and Workbench already had dedicated route families, method maps,
and route-key tools. Weakness: onboarding and skills had examples for the most common
specialized routes, but still lacked explicit examples for Movement known-place
create/update, saved-overlay update/delete, and Workbench run-node/node-result reads.
That left a route-key gap for new agents even though the method routes were present.

What changed in Cycle 3:

- Added live onboarding route-key examples for Movement `placeCreate`, `placeUpdate`,
  `userBoxUpdate`, and `userBoxDelete`.
- Added live onboarding route-key examples for Workbench `runNodes` and `nodeResult`.
- Added matching internal examples or route hints in OpenClaw and Hermes skill files.
- Added regression coverage proving the new examples are present in both the server
  onboarding source and the source skill.

What happened after retesting Cycle 3:

- The full focused suite passed with 20 tests.
- No changes were reverted. Remaining work is qualitative: periodically run real
  OpenClaw/Hermes conversations against user utterances that combine Psyche meaning,
  ownership ambiguity, and specialized Movement/Life Force/Workbench actions.

## 2026-05-26 Automation Pass

Setup verification:

- Confirmed the Forge worktree was on `main` before plugin work and edits.
- No prior automation memory existed for
  `improvement-of-question-flows-in-forge`.
- Confirmed OpenClaw config and Hermes config both point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`, and the live Forge process
  on `127.0.0.1:4317` had
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open. No data
  root was changed, moved, merged, deleted, or overwritten.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
  OpenClaw rejected a duplicate path install without force and rejects `--force` with
  `--link`, so the path-tracked plugin was refreshed through
  `openclaw plugins update forge-openclaw-plugin --dangerously-force-unsafe-install`,
  then enabled and the gateway was restarted.
- Reinstalled Hermes from the local plugin folder with
  `~/.hermes/hermes-agent/venv/bin/python -m pip install --upgrade --editable
  ./plugins/forge-hermes`, which installed `forge-hermes-plugin 0.2.91` from the
  repo-local editable package.
- Verified OpenClaw loads `forge-openclaw-plugin 0.2.91` from
  `~/Documents/aurel-monorepo/projects/forge/openclaw-plugin/dist/openclaw/index.js`
  and exposes the route-key tools `forge_call_movement_route`,
  `forge_call_life_force_route`, and `forge_call_workbench_route`. The known
  duplicate plugin-id warning remains and is resolved by OpenClaw in favor of the
  explicit config-selected repo-local plugin.
- Final gateway verification found a separate OpenClaw LaunchAgent issue: the service
  stayed loaded but repeatedly restarted before `127.0.0.1:18789` became reachable,
  with logs showing `signal SIGTERM received` shortly after `starting HTTP server`.
  The Forge backend on `127.0.0.1:4317`, the repo-local plugin inspection, and the
  live Forge onboarding/OpenAPI checks all remained healthy; the gateway bind loop is
  an operational follow-up rather than a question-flow contract regression.
- Verified live Forge health, OpenClaw `forge health`, live onboarding at
  `/api/v1/agents/onboarding`, and live OpenAPI. Live onboarding published the
  current entity catalog plus dedicated Movement, Life Force/`life_force`, and
  Workbench route-key maps. Live OpenAPI exposed Movement, Life Force, and Workbench
  route families separately from shared batch CRUD.

Every cycle retested the full stored-entity and domain set: goal, project, strategy,
task, habit, tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item, preference_judgment,
preference_signal, questionnaire_instrument, questionnaire_run, self_observation,
sleep_session, workout_session, wiki_page, movement, life_force, workbench,
psyche_value, behavior_pattern, behavior, belief_entry, mode_profile,
mode_guide_session, flashcard, trigger_report, event_type, emotion_definition, plus
the read-only operator, calendar, sleep, and sports overview surfaces. The simulated
scenarios covered adding, updating, reviewing, navigating, or acting on each flow,
including Movement day/month/all-time/timeline/places/trip detail/selection/settings
and repair routes, Life Force overview/profile/weekday-template/fatigue-signal
routes, and Workbench flow catalog/detail/CRUD/execution/run history/published
output/node/latest-node-output/one-off execution/chat routes.

Cycle 1 tested all entity flows and specialized lanes after the local plugin
reinstall. Strengths: Psyche remained example-first and hypothesis-capable; ordinary
stored records stayed batch-first; Movement, Life Force, and Workbench used dedicated
route-key families instead of generic CRUD. Weakness: Movement had correct
`placeCreate` and `placeUpdate` routes, but the conversation guidance did not say
enough about how to ask for a known place's label, boundary, and future use. That
could make agents treat a place cleanup like a tag, raw route action, or generic
entity write.

What changed in Cycle 1:

- Updated the Movement playbook to cover known-place creation and cleanup as a
  first-class lane.
- Added guidance to ask what the place should be called, what counts inside its
  boundary, and how future movement reads should use it before calling the dedicated
  place route.
- Updated live onboarding Movement search hints, route-selection questions, and notes
  with the same place-route guidance.
- Added focused regression coverage for the new place-label/boundary/future-use
  wording and the rule that known places use dedicated place routes, not tags or batch
  entity writes.

What happened after retesting Cycle 1:

- The first retest caught an over-specific assertion that expected the word `label`
  inside one direct-action bullet; the guidance existed across the Movement arc and
  action rules. The assertion was corrected to match the actual text shape.
- The full focused suite then passed across all tested entity flows and specialized
  route lanes, so the Cycle 1 Movement change was kept.

Cycle 2 retested the same complete flow set with emphasis on Life Force. Strengths:
the contract already separated overview, profile, weekday template, and fatigue
signal routes, including the `lifeForce` and `life_force` aliases. Weakness: durable
Life Force edits could still become a polished description of energy rather than a
useful model change. Agents needed stronger guidance to ask what planning decision
should change, such as workload, recovery time, timeboxes, meeting load, or task
choice.

What changed in Cycle 2:

- Updated the Life Force playbook to ask what planning decision the overview or
  correction should change before profile or weekday-template writes.
- Added a rule to use the overview first when the user only needs explanation or
  planning read, instead of mutating profile/template state.
- Updated both live onboarding keys, `lifeForce` and `life_force`, with matching
  route-selection questions and notes.
- Added regression coverage for planning-decision language and overview-first
  behavior.

What happened after retesting Cycle 2:

- The full focused suite passed. The change improved Life Force specificity without
  making normal records or Psyche flows more verbose, so it was kept.

Cycle 3 retested every flow again with emphasis on Workbench. Strengths: Workbench
already distinguished saved flows, flow CRUD, run history, node results, published
outputs, latest node output, saved-flow chat, and one-off execution. Weakness:
one-off execution still needed a clearer question-flow guard so agents do not create a
saved reusable flow when the user only wants a temporary input run.

What changed in Cycle 3:

- Updated the Workbench playbook to ask whether execution should remain a one-time
  input run or become a reusable saved flow before creating anything durable.
- Added a direct rule that one-off execution should use
  `POST /api/v1/workbench/run` and must not create a saved flow unless the user wants
  reuse.
- Updated live onboarding Workbench search hints, route-selection questions, and
  notes with the same saved-flow versus one-off distinction.
- Added live-onboarding regression coverage proving Movement place guidance, Life
  Force planning-decision guidance, and Workbench one-off execution guidance are
  present in the server contract, not only in Markdown playbooks.

What happened after retesting Cycle 3:

- The focused question-flow and live contract suite passed with 18 tests.
- No changes were reverted. Remaining work is mostly qualitative: periodically run
  live agent conversations against real user utterances to catch phrasing that still
  feels too generic despite the contract-level guards.

## 2026-05-25 Automation Pass

Setup verification:

- Confirmed the Forge worktree was on `main` before edits.
- Confirmed OpenClaw and Hermes configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`; the active listener on
  port 4317 had `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite`
  open. No data root was changed, moved, merged, deleted, or overwritten.
- Built and reinstalled both repo-local plugins before the evaluation cycles:
  `npm run build:openclaw-plugin`, `openclaw plugins install --force
  --dangerously-force-unsafe-install ./openclaw-plugin`, gateway enable/restart,
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs`, and Hermes
  editable reinstall from `./plugins/forge-hermes`.
- Verified OpenClaw loads `forge-openclaw-plugin` version `0.2.88` from
  `~/Documents/aurel-monorepo/projects/forge/openclaw-plugin/dist/openclaw/index.js`
  and Hermes imports version `0.2.88` from the repo-local editable package. The known
  duplicate plugin-id warning remains and is resolved by OpenClaw in favor of the
  explicit config-selected repo-local plugin.
- Verified live Forge health, OpenClaw `forge health`, OpenClaw `forge route-check`,
  live onboarding at `/api/v1/agents/onboarding`, live OpenAPI, Tailscale Serve, and
  Tailscale Funnel status. Route-check reported no missing plugin routes, no missing
  OpenAPI routes, and no unexpected mirrors.
- Live onboarding and OpenAPI still publish batch routes for normal stored entities
  and dedicated specialized route families for Movement, Life Force, and Workbench.
  Live OpenAPI reported 178 paths, including shared entity create/search/update/delete
  routes, Movement day/month/all-time/timeline/places/trip/detail/selection/settings
  and repair routes, Life Force overview/profile/weekday-template/fatigue-signal
  routes, and Workbench flow catalog/detail/CRUD/execution/history/output/node and
  one-off execution routes.

Every cycle retested the full stored-entity and domain set: goal, project, strategy,
task, habit, tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item, preference_judgment,
preference_signal, questionnaire_instrument, questionnaire_run, self_observation,
sleep_session, workout_session, wiki_page, movement, life_force, workbench,
psyche_value, behavior_pattern, behavior, belief_entry, mode_profile,
mode_guide_session, flashcard, trigger_report, event_type, emotion_definition, plus
the read-only operator, calendar, sleep, and sports overview surfaces. Specialized
surface scenarios covered Movement day/month/all-time/timeline/places/trip
detail/selection aggregates/repair actions, Life Force overview/profile updates/
weekday templates/fatigue signals, and Workbench flow catalog/flow CRUD/execution/run
history/published outputs/node results/latest node outputs/one-off input execution.

Cycle 1 tested all entity flows and specialized lanes after reinstalling both local
plugins. Strengths: Psyche stayed example-first and interpretive, normal stored
records stayed batch-first, and Movement/Life Force/Workbench stayed on dedicated
route families. Weaknesses: the task guidance still treated `task` as a generic
project/goal/standalone record instead of the actual work-item family of issue,
one-session task, and subtask. That made the question flow under-ask about hierarchy,
AI handoff instructions, acceptance criteria, and whether the item belonged under a
project, issue, or parent task. Workbench also exposed saved-flow execution and
history well, but lacked a clear one-off input execution example for
`POST /api/v1/workbench/run`, which could make agents guess or use generic entity
CRUD for a transient flow run.

What changed in Cycle 1:

- Updated live task catalog purpose, relationship rules, field guide, and
  conversation playbook to distinguish issue, one-session task, and subtask; ask for
  project/issue/parent-task placement only when unclear; and gather `aiInstructions`,
  `executionMode`, `acceptanceCriteria`, owner, and assignees only when needed.
- Updated the shared OpenClaw/Hermes/Codex playbooks and skill guidance with the same
  task hierarchy and AI-session handoff language.
- Added a Workbench `runByPayload` internal route-key example using `body.input` for
  one-off input execution through the dedicated Workbench family instead of batch
  CRUD or vague route guesses.

What happened after retesting Cycle 1:

- The first retest caught user-facing "payload" wording in the Workbench playbook.
  That was changed to "dedicated one-off execution lane" while keeping the internal
  route-key example precise.
- The focused suite then passed across all tested entity flows and specialized route
  lanes, so the Cycle 1 changes were kept.

Cycle 2 retested the same complete flow set with emphasis on project and task
collaboration. Strengths: the new task hierarchy improved question sequencing and
Workbench one-off execution no longer fell back to batch CRUD. Weakness: project and
work-item onboarding did not expose `assigneeUserIds` clearly enough. That meant an
agent could ask only for a single owner and miss the practical question of which
humans or bots should be assigned, especially for collaborative or automation-guided
work.

What changed in Cycle 2:

- Added `assigneeUserIds` to project and task field guides and relationship rules in
  live onboarding.
- Updated project and task playbooks to ask about human or bot assignees only after
  scope, hierarchy, and ownership are clear.
- Added tests so future agents see assignees as a first-class relationship without
  turning every intake into a mechanical assignment form.

What happened after retesting Cycle 2:

- The focused suite passed with the assignee guidance.
- No Psyche or specialized-surface flow got broader or more robotic, so the Cycle 2
  changes were kept.

Cycle 3 retested every flow again with emphasis on project management precision.
Strengths: question flows were now clearer for task hierarchy and assignees, and API
posture stayed aligned. Remaining weakness: `project` guidance still hid newer
project-management fields that matter when an agent is helping create or update a
serious project: `productRequirementsDocument`, `workflowStatus`, and
`schedulingRules`. Without those fields, agents could create thin projects while
missing the brief/PRD, workflow lane, or scheduling policy that should shape later
work.

What changed in Cycle 3:

- Added project relationship and field guidance for PRD-backed projects,
  `productRequirementsDocument`, `workflowStatus`, and `schedulingRules`.
- Updated project conversation playbooks across OpenClaw, Hermes, and Codex to ask
  for the product brief or PRD, workflow lane, scheduling rules, and assignees only
  after the basic project purpose is clear.
- Extended onboarding, playbook parity, and simulation tests so the durable contract
  covers task hierarchy, Workbench one-off execution, project/work-item assignees,
  project PRD/brief, workflow lane, and scheduling rules.

What happened after retesting Cycle 3:

- The focused question-flow and contract suite passed after the report and test
  updates.
- `npx tsc --noEmit` passed.
- Both adapters were rebuilt, OpenClaw was reinstalled/enabled/restarted from the
  repo-local path, Hermes was reinstalled editable/restarted, live Forge
  health/onboarding/OpenAPI/route-check were reverified, and all changes were kept.

## 2026-05-24 Automation Pass

Setup verification:

- Confirmed the Forge worktree was on `main` before edits.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
- Refreshed the existing repo-local OpenClaw path install. OpenClaw rejected
  `--force` with `--link`, so `openclaw plugins update forge-openclaw-plugin` was
  used for the path-tracked plugin, then the plugin was enabled and the gateway was
  restarted.
- Built the Hermes packaged runtime with
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs` and reinstalled
  Hermes editable from `./plugins/forge-hermes`.
- Verified `forge-hermes-plugin 0.2.88` imports from the repo-local editable package
  and OpenClaw loads version `0.2.88` from
  `~/Documents/aurel-monorepo/projects/forge/openclaw-plugin/dist/openclaw/index.js`.
- Verified Forge health at `http://127.0.0.1:4317/api/v1/health`, OpenClaw
  `forge health`, OpenClaw `forge doctor`, OpenClaw `forge route-check`, live
  onboarding, and live OpenAPI. The known duplicate plugin-id warning remains and is
  resolved by OpenClaw in favor of the explicit config-selected repo-local plugin.
- Verified OpenClaw and Hermes configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`. No data root was changed,
  moved, merged, deleted, or overwritten.
- Live onboarding reported 41 live entity catalog entries and dedicated specialized
  route-key/method maps for Movement, Life Force, the `life_force` alias, and
  Workbench. Live OpenAPI reported 178 paths, including shared batch entity routes,
  Movement day/month/all-time/timeline/places/trip/detail/selection/settings/repair
  routes, Life Force overview/profile/weekday-template/fatigue-signal routes, and
  Workbench flow catalog/detail/CRUD/execution/history/output/node routes.

Every cycle retested the full stored-entity and domain set: goal, project, strategy,
task, habit, tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item, preference_judgment,
preference_signal, questionnaire_instrument, questionnaire_run, self_observation,
sleep_session, workout_session, wiki_page, movement, life_force, workbench,
psyche_value, behavior_pattern, behavior, belief_entry, mode_profile,
mode_guide_session, flashcard, trigger_report, event_type, emotion_definition, plus
the read-only operator, calendar, sleep, and sports overview surfaces. Specialized
route-lane scenarios covered every live Movement, Life Force, and Workbench route key.

Cycle 1 tested all entity flows and specialized lanes against the installed local
plugins, live onboarding, OpenAPI, and the focused question-flow suite. Strengths:
normal stored records stayed batch-first, Movement/Life Force/Workbench stayed on
dedicated route families, and Psyche still started from lived experience rather than
fields. Weakness: the contract described good opening questions and route posture, but
was less explicit about the second turn after the user answered. That could let an
agent drift into another broad opener, a schema-field checklist, vague reflective
phrasing, or user-facing route language.

What changed in Cycle 1:

- Added `followUpQuestionRule` to live onboarding `interactionGuidance`: after a
  substantive answer, say what became clearer, choose one next lane, ask only the
  smallest decision-relevant question, and stop asking when nothing would change.
- Added `antiDriftRule` to live onboarding `interactionGuidance`: avoid vague
  reflective filler and route nouns such as surface, CRUD, payload, mutation path, or
  endpoint; use product nouns such as belief, pattern, wiki page, timeline, overlay,
  weekday template, flow, run, node result, or published output.
- Updated the shared OpenClaw/Hermes/Codex playbooks with matching second-turn
  discipline for non-Psyche and Psyche flows.
- Updated the TypeScript onboarding type, OpenAPI schema, and contract tests so the
  new guidance is visible to new agents through the live API.

What happened after retesting Cycle 1:

- The first retest exposed only a line-wrapping mismatch in a regex assertion around
  `record shape`; the assertion was corrected.
- The full focused suite then passed across all tested entity flows and specialized
  route lanes, so the Cycle 1 change was kept.

Cycle 2 retested the same complete flow set with extra attention to Psyche. Strengths:
the Markdown Psyche playbook already had a strong hypothesis map, and behavior
patterns, beliefs, modes, and trigger reports already published good live hypothesis
guidance. Weakness: the live onboarding playbooks were uneven. Some Psyche records
published concrete hypothesis guidance, while `psyche_value`, `behavior`, `flashcard`,
`event_type`, and `emotion_definition` leaned too much on the general rules. That
made a new agent more likely to keep reflecting instead of offering a useful,
testable interpretation once a concrete example was clear.

What changed in Cycle 2:

- Added entity-specific live hypothesis guidance for values, behaviors,
  mode-guide sessions, flashcards, event types, and emotion definitions.
- Locked the contract so every Psyche onboarding playbook includes hypothesis guidance
  while still requiring a concrete example before interpretation.
- Kept Psyche API posture unchanged: all Psyche records, including flashcards,
  event types, and emotion definitions, remain normal stored entities for shared
  batch CRUD after formulation and consent.

What happened after retesting Cycle 2:

- The full focused suite passed with the new hypothesis guidance.
- No entity got worse, so the Cycle 2 live-onboarding changes were kept.

Cycle 3 retested every flow again with emphasis on durable automation freshness. The
remaining weakness was process-level: this report was not checked by the simulation
suite, so a future automation pass could improve behavior without leaving a current
full-cycle record. The change made the durable report itself part of the Cycle 3
simulation retest.

What changed in Cycle 3:

- Added a simulation assertion that requires this report to name the latest run date,
  41 live entity catalog entries, all major entity families, Movement/Life Force/
  Workbench, the Cycle 1 `followUpQuestionRule` and `antiDriftRule` changes, the
  Cycle 2 hypothesis guidance change for every Psyche entity, and the Cycle 3 durable
  report plus rebuild posture.
- Updated this report with the setup verification, tested flow set, findings, changes,
  and retest result for all three cycles.

What happened after retesting Cycle 3:

- The full focused suite passed after the report update.
- The adapters were rebuilt again after source changes, Hermes was reinstalled
  editable, OpenClaw was re-enabled/restarted from the repo-local path, and live
  Forge health/onboarding/OpenAPI/route-check were reverified.

## 2026-05-22 Automation Pass

Setup verification:

- Read the existing automation memory and confirmed the previous run already covered
  41 live entity catalog entries and dedicated Movement, Life Force, `life_force`,
  and Workbench route keys.
- Confirmed the OpenClaw and Hermes Forge configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`. Live Node file handles also
  showed `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open. No
  Forge data root was moved, merged, deleted, or overwritten.
- Built the repo-local OpenClaw plugin and Hermes packaged runtime with
  `node plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin`, enabled `forge-openclaw-plugin`, and
  restarted the OpenClaw gateway. The current OpenClaw build does not support
  `--force` with `--link`, so the install replaced the package from the local folder
  while the config-selected repo-local source path remained active.
- Reinstalled Hermes editable from `./plugins/forge-hermes`, restarted the Hermes
  gateway, and verified `forge-hermes-plugin 0.2.80` imports from the repo-local
  editable package.
- Verified `openclaw forge health`, `openclaw forge route-check`, live onboarding,
  live OpenAPI, and the Forge web app runtime. Live OpenAPI reports `3.1.0` with 178
  paths. Live onboarding reports 41 entity catalog entries, 28 batch-CRUD entities,
  and dedicated route keys for Movement, Life Force, the `life_force` alias, and
  Workbench.
- The known OpenClaw duplicate plugin-id warning remains; OpenClaw resolves it in
  favor of the explicit config-selected repo-local plugin.

Every cycle retested the full stored-entity and domain set: goal, project, strategy,
task, habit, tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item, preference_judgment,
preference_signal, questionnaire_instrument, questionnaire_run, self_observation,
sleep_session, workout_session, wiki_page, flashcard, every psychologically
meaningful Psyche entity, Movement, Life Force, Workbench, and the read-only
operator, calendar, sleep, and sports overview surfaces. Specialized-surface
sub-scenarios covered every Movement, Life Force, and Workbench route lane published
by live onboarding.

Cycle 1 tested all flows and route examples against live onboarding and OpenAPI.
Question quality remained strong, but the Movement `selection` route example was an
API contract bug: the route is `POST /api/v1/movement/selection`, while onboarding
and bundled skills showed selected-span data in `query`. The change moved that
example to `body` in live onboarding plus the OpenClaw, Hermes, and Codex skill
copies, and added assertions rejecting the old query shape. Full retest passed, so
the change was kept.

Cycle 2 retested the full set with emphasis on Workbench. The route model exposed
`chatFlow`, and the Markdown playbook handled saved-flow chat follow-ups, but the live
onboarding Workbench ask sequence did not name that lane early enough. The change
added "follow-up message in a saved flow chat" to the Workbench onboarding sequence
and locked it with an onboarding contract assertion. Retest passed, so no wording was
reverted.

Cycle 3 retested every flow again with emphasis on automation freshness. The
remaining weakness was that the previous tests would catch the Movement selection
example only through specific string checks, not through a general route-method
shape rule. The change added a contract test that parses every specialized route-key
example, finds the matching live `methodRoutes` entry, and requires POST/PATCH/PUT
examples to put mutation or aggregate-read data in `body` while GET examples avoid
body data. Retest passed with 40 focused tests, so the automation improvement was
kept.

Final verification for this pass:

- `npm exec -- vitest run src/openclaw/question-flow-quality.test.ts
  src/openclaw/question-flow-simulation-cycles.test.ts
  src/openclaw/onboarding-contract.test.ts src/openclaw/skill-playbook-parity.test.ts
  src/openclaw/parity.test.ts` passed: 5 files, 40 tests.

## 2026-05-21 Automation Pass

Setup verification:

- No previous automation memory file existed for
  `improvement-of-question-flows-in-forge`.
- Confirmed the OpenClaw and Hermes Forge configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`. No data root was changed,
  merged, deleted, or overwritten.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
- Built the Hermes packaged runtime with
  `node plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin` with the forced local install path,
  enabled `forge-openclaw-plugin`, and restarted the OpenClaw gateway.
- Reinstalled Hermes editable from `./plugins/forge-hermes` and verified
  `forge-hermes-plugin 0.2.79` imports from the repo-local editable package.
- Verified `openclaw forge health`, `openclaw forge route-check`, live OpenAPI, live
  onboarding, and the Forge web app at `http://127.0.0.1:4317/forge/`.
- Live OpenAPI reports version `3.1.0` with 178 paths. Live onboarding reports 41
  entity catalog entries, 28 batch-CRUD entities, shared batch routes for ordinary
  stored entities, and dedicated route keys for Movement, Life Force, the
  `life_force` alias, and Workbench.
- Movement exposes the dedicated day, month, all-time, timeline, places, trip detail,
  selection, settings, overlay, and repair lanes. Life Force exposes overview,
  profile, weekday-template, and fatigue-signal lanes. Workbench exposes flow
  catalog/detail/CRUD, execution, run history, published output, node result,
  latest-node-output, box catalog, one-off input execution, and saved-flow chat lanes.

Every cycle retested the full stored-entity and domain set: goal, project, strategy,
task, habit, tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item, preference_judgment,
preference_signal, questionnaire_instrument, questionnaire_run, self_observation,
sleep_session, workout_session, wiki_page, flashcard, all psychologically meaningful
Psyche entities, Movement, Life Force, Workbench, and the read-only operator,
calendar, sleep, and sports overview surfaces. Scenarios covered adding, updating,
reviewing, navigating, and route-selecting each entity or surface, with Psyche
evaluated for therapist-like active listening and specialized surfaces evaluated for
exact API posture.

Cycle 1 tested every entity and specialized lane against the existing playbooks,
onboarding payload, and live OpenAPI route model. Strengths held: Psyche remained
example-first and hypothesis-capable, normal stored records stayed batch-first, and
Movement/Life Force/Workbench used dedicated route families. The weakness was
Workbench wording: a route-key-internal concept, `runByPayload`, still encouraged
some user-facing "payload" language. The change kept the route key intact but changed
agent-facing prose to "one-off input contract", "structured input details", and
"write shape". Retest showed Workbench remained route-clear while no longer leaking
payload wording to the user, so the change was kept.

Cycle 2 retested the same full set with emphasis on questionnaire and reflection
flows. Psyche and planning flows stayed strong, but `questionnaire_instrument` and
`questionnaire_run` still sounded too close to form authoring when compared with the
active-listening bar. The change made questionnaire instruments start from the honest
moment, pattern, or decision the instrument should help someone notice, then defer
item shape, scale, scoring, and provenance until purpose and use context are steady.
Questionnaire runs now ask whether the user wants to start, continue, review, or
finish, and only ask for the next answer or note that matters once the run's job is
clear. Retest caught two wording-line issues in the quality assertions; those were
fixed without weakening the intended behavior, and the change was kept.

Cycle 3 retested all flows again with emphasis on automation freshness. The remaining
risk was that the simulation matrix could drift behind live onboarding as Forge adds
or renames entities and specialized route lanes. The change added a live-onboarding
synchronization test that checks every live entity catalog entry has a simulated user
scenario and route-posture coverage, and checks Movement, Life Force, and Workbench
route keys against the specialized-surface scenarios. Retest passed, so the automation
coverage improvement was kept. No entity-specific wording was reverted in this cycle.

Final verification for this pass:

- `npm exec -- vitest run src/openclaw/question-flow-quality.test.ts
  src/openclaw/question-flow-simulation-cycles.test.ts
  src/openclaw/onboarding-contract.test.ts src/openclaw/skill-playbook-parity.test.ts
  src/openclaw/parity.test.ts` passed: 5 files, 39 tests.
- `npx tsc --noEmit` passed.
- `npm run check:openclaw-plugin` passed: 4 files, 29 tests.
- OpenClaw plugin runtime reports version `0.2.79`, source
  `~/Documents/aurel-monorepo/projects/forge/openclaw-plugin/dist/openclaw/index.js`,
  and all expected Forge tools.
- `openclaw forge route-check` reports no missing plugin routes, no missing OpenAPI
  routes, and no unexpected mirrors.
- The OpenClaw config still reports a duplicate plugin-id warning resolved in favor
  of the explicit config-selected repo-local plugin. This is a known environment
  warning, not a contract failure.

## 2026-05-19 Automation Pass

Setup verification:

- Confirmed OpenClaw and Hermes configs still point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`.
- Verified the live Forge process on `127.0.0.1:4317` has
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open. No data
  root was changed, merged, deleted, or overwritten.
- Built the repo-local OpenClaw plugin through
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs`, which runs the
  OpenClaw plugin build and refreshes the Hermes packaged runtime from the same local
  checkout.
- Verified OpenClaw is loaded from
  `~/Documents/aurel-monorepo/projects/forge/openclaw-plugin/dist/openclaw/index.js`
  at version `0.2.73`; re-enabled it and restarted the OpenClaw gateway.
- Reinstalled Hermes editable from `./plugins/forge-hermes`, restarted the Hermes
  gateway, and verified `forge-hermes-plugin 0.2.73` imports from the repo-local
  editable package.
- Verified live Forge health, OpenClaw `forge health`, live onboarding, and OpenAPI.
  Live onboarding publishes 41 entity/catalog entries, shared batch routes for normal
  entities, specialized route families for Movement, Life Force, and Workbench, and
  read-only surfaces for operator, calendar, self-observation, sleep, and sports.

Every cycle retested the full stored-entity and domain set: goal, project, strategy,
task, habit, tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item, preference_judgment,
preference_signal, questionnaire_instrument, questionnaire_run, self_observation,
sleep_session, workout_session, wiki_page, flashcard, every other Psyche entity,
Movement, Life Force, Workbench, and the read-only operator, calendar, sleep, and
sports overview surfaces. The specialized-surface sub-scenarios also covered every
Movement, Life Force, and Workbench route lane: day, month, all-time, timeline,
places, trip detail, selection aggregates, settings, overlays, repair actions,
overview, profile, weekday templates, fatigue signals, flow catalog/detail, flow
CRUD, execution, run history, published outputs, node results, latest node outputs,
and saved-flow chat.

Cycle 1 tested all flows with create, update, review, navigation, and specialized
route-selection scenarios. Strengths held: Psyche flows stayed active-listening and
hypothesis-capable, normal stored entities stayed batch-first, and Movement, Life
Force, and Workbench stayed off generic CRUD. The gap was API guidance rather than
tone: onboarding's OpenClaw connection guide still used a generic install/info
verification path, while the verified local development path is the repo-local
`--link` install with `--dangerously-force-unsafe-install` and
`openclaw plugins inspect forge-openclaw-plugin --runtime`. The change updated the
live onboarding guide and contract tests. The first retest caught one simulated
Workbench lane that used "payload" in user-facing wording; that was replaced with
"one-off input contract". Retest passed, so the change was kept.

Cycle 2 retested the same full set against onboarding, OpenAPI, OpenClaw tools, and
the static playbooks. Question quality remained stable, but the specialized API
contract could still drift because onboarding exposed `methodRoutes` while route-key
tools exposed their own enum lists. The change added explicit `routeKeys` arrays to
the Movement, Life Force, `life_force` alias, and Workbench onboarding surfaces,
updated the generated OpenAPI schema and shared TypeScript type, and added a
cross-check that OpenClaw tool route-key enums match onboarding `routeKeys`. Retest
passed, so the route-key contract was kept.

Cycle 3 retested all entities and specialized route lanes again with emphasis on
durable reporting and future automation freshness. The remaining weakness was this
report itself: it still named the prior run as latest and did not record the
41-entry catalog or the route-lane sub-scenarios. The change updated this report with
the setup verification, full flow set, findings, changes, and retest result for all
three cycles. Focused retest remained green, so no per-entity wording was reverted.

## 2026-05-18 Automation Pass

Setup verification:

- Confirmed OpenClaw and Hermes configs point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge`.
- Verified the live Forge process on `127.0.0.1:4317` has
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite` open. No data
  root was changed, merged, deleted, or overwritten.
- Built the repo-local OpenClaw plugin with `npm run build:openclaw-plugin`.
- Built the Hermes packaged runtime with
  `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Reinstalled OpenClaw from `./openclaw-plugin` with `--link`, enabled it, restarted
  the gateway, and verified `openclaw plugins info forge-openclaw-plugin` reports
  source path `~/Documents/aurel-monorepo/projects/forge/openclaw-plugin` and
  recorded version `0.2.69`.
- Reinstalled Hermes editable from `./plugins/forge-hermes`, restarted the Hermes
  gateway, and verified `forge-hermes-plugin 0.2.69` imports from the repo-local
  editable package.
- Verified live Forge health, OpenClaw `forge health`, live onboarding, and OpenAPI.
  Live onboarding publishes 40 entity/catalog entries, shared batch routes for normal
  entities, specialized route families for Movement, Life Force, and Workbench, and
  read-only surfaces for operator, calendar, self-observation, sleep, and sports.

Every cycle retested the full stored-entity and domain set: goal, project, strategy,
task, habit, tag, note, insight, task_run, work_adjustment, calendar_event,
work_block_template, task_timebox, calendar_connection, preference_catalog,
preference_catalog_item, preference_context, preference_item, preference_judgment,
preference_signal, questionnaire_instrument, questionnaire_run, self_observation,
sleep_session, workout_session, wiki_page, every Psyche entity, Movement, Life Force,
Workbench, and the read-only operator, calendar, sleep, and sports overview surfaces.

Cycle 1 tested all existing flows with create, update, review, and route-selection
scenarios. Strengths held: Psyche still starts from lived examples and functional
hypotheses, normal stored records stay batch-first, and Movement/Life Force/Workbench
use dedicated routes. The gap was automation freshness: live onboarding already exposed
`operator_overview`, `operator_context`, and `calendar_overview` as important
read-model surfaces, but the simulation matrix and playbook did not test them. The
change added Operator Overview, Operator Context, and Calendar Overview sections,
scenarios, preferred opening questions, route notes, and matrix entries. Retest passed,
so the expanded read-model coverage was kept.

Cycle 2 retested the expanded full set against live onboarding and OpenAPI. Question
quality improved for the three new read-only surfaces, but the live onboarding payload
still did not publish the same conversation playbooks and lacked the entity-style
`operator_context` alias beside `operatorContext`. That made the route model slightly
less self-contained for new agents. The change added the missing alias, added
onboarding conversation playbooks for `operator_overview`, `operator_context`, and
`calendar_overview`, and added contract tests to keep those surfaces explicit. Retest
passed, so the onboarding changes were kept.

Cycle 3 retested the full matrix again with emphasis on installed-agent parity. The
remaining weakness was bundled guidance drift: OpenClaw, Hermes, and Codex skill
copies did not all carry the expanded read-model language or the updated
entity-conversation playbook. The change synchronized the playbook copies, updated
OpenClaw/Hermes/Codex skill text to name `operatorOverview`, `operatorContext`,
`calendarOverview`, `sleepOverview`, `sportsOverview`, and the entity-style aliases,
and locked parity with skill-playbook tests. Retest passed across the focused
question-flow, onboarding-contract, skill-parity, and server onboarding tests. No
entity-specific regression was observed, so the parity changes were kept.

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
live catalog also contained read-model-only `sleep_overview`, `sports_overview`,
and later `training_load` surfaces that were not explicitly represented in the
simulation matrix. The change added Sleep Overview, Sports Overview, and Training
Load playbook sections, scenarios, route posture coverage, and tests. Retest across
the full suite passed, so the change was kept.

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
| operator_overview | Review Forge overall to decide what needs attention first. |
| operator_context | Inspect current work, risk, and next moves before changing anything. |
| calendar_event | Schedule a focused review call in local time. |
| work_block_template | Create a repeating protected writing block. |
| task_timebox | Reserve a future slot for an existing task. |
| calendar_overview | Review a week before creating a timebox or event. |
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
| training_load | Review cardiovascular zones and acute load before deciding to push or recover. |
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

## 2026-05-20 Automation Run

Setup:

- Built the OpenClaw plugin from the repo-local checkout with `npm run build:openclaw-plugin`.
- Built the Hermes packaged runtime with `node ./plugins/forge-hermes/scripts/build-package-runtime.mjs`.
- Confirmed OpenClaw and Hermes config/runtime evidence point at
  `/Users/omarclaw/Documents/aurel-monorepo/data/forge/forge.sqlite`.
- Re-enabled/restarted OpenClaw from `./openclaw-plugin`, reinstalled Hermes editable
  from `./plugins/forge-hermes`, restarted both gateways, and verified Forge health,
  live onboarding, OpenAPI, and dedicated Movement/Life Force/Workbench route families.

### Cycle 1

Tested:

- Re-ran the full simulation matrix for planning, calendar, preferences,
  questionnaires/reflection, health, wiki, all Psyche records, Movement, Life Force,
  and Workbench.
- Simulated add, update, review, correction, navigation, and specialized route
  selection scenarios for every flow in the matrix.
- Compared static playbooks, live onboarding, TypeScript types, and OpenAPI schema.

Found:

- Question quality and routing posture stayed strong across the full matrix.
- The live onboarding payload already exposed `recommendedPluginTools.specializedDomainWorkflow`
  and specialized route examples, but the shared TypeScript onboarding type omitted
  those fields.
- OpenAPI declared `interactionGuidance` with `additionalProperties: false` while
  omitting the live `specializedSurfaceRule`, `reviewShortcutRule`, and
  `readModelWriteRule` fields.

Changed:

- Added `specializedDomainWorkflow` and specialized route example fields to the shared
  TypeScript onboarding type.
- Added the missing interaction guidance fields to the generated OpenAPI schema.
- Added simulation/contract tests so future agents and generated clients see the same
  specialized route guidance as the live payload.

Retest:

- Re-ran question-flow quality, three-cycle simulation, onboarding contract, and
  skill-playbook parity tests.
- Result: all passed; the contract-alignment change was kept and nothing was reverted.

### Cycle 2

Tested:

- Re-ran the full flow matrix after Cycle 1.
- Inspected live `entityConversationPlaybooks` and `psycheCoachingPlaybooks` directly
  for every entity and domain surface.
- Focused on whether a new agent using only live onboarding would receive the same
  strong first-question guidance as the skill files.

Found:

- Non-Psyche live playbooks had explicit `openingQuestion` fields.
- Psyche playbooks had strong `exampleQuestions`, but no first-class
  `openingQuestion`, leaving Psyche first turns less explicit in the live contract.
- Route posture for Psyche still correctly remained shared batch CRUD after consent.

Changed:

- Promoted the first Psyche example question into a first-class live
  `openingQuestion`.
- Updated TypeScript and OpenAPI schema for `AgentOnboardingPsychePlaybook`.
- Added tests requiring every Psyche playbook to publish a concrete first question.

Retest:

- Re-ran the full suite.
- Result: all passed; the Psyche opening-question contract was kept.

### Cycle 3

Tested:

- Re-ran the full entity and specialized surface matrix after Cycle 2.
- Checked Psyche catalog coverage across live onboarding, TypeScript, and OpenAPI.
- Paid special attention to flashcards because they are psychologically meaningful
  records and are used during urges/triggers.

Found:

- Live onboarding correctly described `flashcard` in `psycheSubmoduleModel`.
- The TypeScript onboarding type and OpenAPI schema omitted the same `flashcard` key,
  creating a schema drift around a Psyche entity that agents must treat as first-class.

Changed:

- Added `flashcard` to the TypeScript `psycheSubmoduleModel` contract.
- Added `flashcard` to the OpenAPI `psycheSubmoduleModel` required/properties schema.
- Added tests that lock flashcard into the live Psyche submodule model and schema.

Retest:

- Re-ran question-flow quality, three-cycle simulation, onboarding contract, and
  skill-playbook parity tests.
- Result: all passed; the flashcard contract fix was kept and nothing was reverted.
