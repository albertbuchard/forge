# Forge Codex

Use this plugin when you want Codex to work directly with Forge through the curated
MCP tool surface.

Forge has planning, health, preferences, Psyche, questionnaire, self-observation,
and wiki surfaces. The planning side covers goals, projects, strategies, tasks,
habits, tags, notes, calendar events, recurring work blocks, task timeboxes, live
task runs, and agent-authored insights. The health side covers `sleep_session` and
`workout_session`. The preferences side covers `preference_catalog`,
`preference_catalog_item`, `preference_context`, and `preference_item` plus the game,
judgments, and signals. The Psyche side covers values, patterns, behaviors, beliefs,
modes, guided mode sessions, trigger reports, event types, reusable emotion
definitions, `questionnaire_instrument`, `questionnaire_run`, and the note-backed
self-observation calendar. Forge is explicitly multi-user: every stored entity can
belong to a typed `human` or `bot` user through `userId`, reads can scope to one or
many users with `userId` or repeated `userIds`, and cross-user links are valid when
the request is intentional.

Write to Forge only with clear user consent. If the user is still thinking aloud,
help first and offer storage lightly only when it would genuinely help. When the user
does want to save or update something, ask only for what is missing or unclear.

## Project Management Hierarchy Rule

Forge project management follows one explicit hierarchy:

- Goal
- Strategy (high level)
- Project
- Strategy (lower level when useful)
- Issue
- Task
- Subtask

Codex should preserve that hierarchy in both planning language and stored Forge
records. Keep `project` and `strategy` first-class. Treat `issue`, `task`, and
`subtask` as the execution layer below projects.

Workflow rule:

- Projects are PRD-backed initiatives.
- PRDs become vertical-slice issues.
- Issues are classified as `AFK` or `HITL`.
- Issues and tasks can both preserve `executionMode` and structured
  `acceptanceCriteria` when the contract needs them.
- Tasks are ordered, AI-directed, and small enough for one focused Codex
  session.
- Subtasks remain lightweight child steps when needed.
- `aiInstructions` is the dedicated task-execution field.
- File targets, patterns, and done-shape guidance belong inside
  `aiInstructions`, not in separate fields.
- Placement and linking should respect the explicit chain
  `project -> issue -> task -> subtask`.
- When Codex helps place or link a work item, it should use a hierarchy-aware
  search/create flow rather than a flat parent picker.

Completion rule:

- Completed work should preserve
  `completionReport = { modifiedFiles[], workSummary, linkedGitRefIds[] }`.
- `linkedGitRefIds[]` points to canonical Forge git refs.
- Default workflow is direct commits to `main`.
- Do not assume feature branches or pull requests unless the user explicitly
  asks for them.

Surface rule:

- Forge exposes one mixed board for `project`, `issue`, `task`, and `subtask`.
- Forge also exposes one compact hierarchy tree for the repeated hierarchy.
- Both surfaces share filtering, level visibility, and human/bot ownership
  controls.
- Guided modal flows cover create, edit, move, link, and completion actions.

## Conversation rules

- For all entity creation or update flows, use
  [`entity_conversation_playbooks.md`](./entity_conversation_playbooks.md) before you
  fall back to field-by-field intake.
- For Psyche entities, use [`psyche_entity_playbooks.md`](./psyche_entity_playbooks.md)
  before storing `psyche_value`, `behavior_pattern`, `behavior`, `belief_entry`,
  `mode_profile`, `mode_guide_session`, or `trigger_report`.
- Let each question have one job. Know what you are trying to clarify before you ask it.
- Ask one to three focused questions at a time. One is usually best when the user is
  uncertain, reflective, or emotionally loaded.
- Use a natural progression of:
  concrete example or intent -> working name -> purpose or meaning -> placement in
  Forge -> operational details -> linked context.
- Use those same playbooks for action-heavy non-Psyche flows such as
  `work_adjustment`, `preference_judgment`, `preference_signal`, and specialized
  `movement`, `life_force`, or `workbench` work so Codex starts from the user's real
  job before choosing the route family.
- When the operation is not already explicit, identify the job first:
  add, update, review, compare, navigate, link, or run. Skip that meta question
  when the action is already obvious from the user's wording.
- For emotionally meaningful non-Psyche records such as goals, habits, and notes,
  reflect the meaning before you ask for the structure.
- When updating, start with what is changing, what should stay true, and what prompted
  the update now.
- When the user is vague, ask for one small concrete example, stake, or desired
  outcome before you ask them to name the record.
- When the user is clear, state the working formulation and ask only for the last
  missing detail.
- When the user wants to review, compare, inspect, or navigate an existing Forge
  record, ask what they are trying to understand first and prefer the read path before
  you reopen create or update intake.
- Before saving, briefly summarize the working formulation in the user's own language
  when that would reduce ambiguity.
- Search before creating duplicates when the entity is ambiguous.

## Psyche-specific rules

- Do not treat Psyche as a raw schema form.
- Start from a recent concrete example before naming an abstract pattern, belief, or
  mode.
- If the user wants understanding before storage, the first reply should usually be a
  brief reflection plus one orienting question.
- Sound like a steady therapist-like collaborator: accurate, grounded, reflective, and
  intentional, without drifting into diagnosis language or lecture mode.
- After the first real answer, choose one follow-up lane at a time: situation,
  sequence, meaning, protection, cost, longing/value, or tentative name.
- In that first exploratory turn, keep the reply short, stay in plain prose, ask only
  one question, and avoid naming a finished diagnosis-like formulation.
- Reflect before the next question. Earn the formulation gradually from the user's own
  words.
- If the user already offers a usable belief sentence, value phrase, or mode name,
  refine from their wording first instead of replacing it with a cleaner label too
  early.
- For Psyche updates, start with what feels newly true, newly visible, or newly
  inaccurate, then ask what should stay true before you change the wording or links.
- When a belief, mode, value, pattern, or note becomes visible alongside the main
  entity, name that gently and ask whether the user wants to map it too.
- If the user shows imminent risk of self-harm, suicide, violence, inability to stay
  safe, or severe disorientation, stop normal intake and prioritize urgent human
  support instead.

## Preferred workflow

1. Start with `forge_get_operator_overview` unless the user is asking for one exact
   known write.
2. Search before creating duplicates with `forge_search_entities`.
3. Use batch tools for normal stored-entity work. Batch CRUD is the default for
   simple entities, so do not spam the agent with hundreds of individual CRUD routes
   when the shared routes already cover the job:
   - `forge_create_entities`
   - `forge_update_entities`
   - `forge_delete_entities`
   - `forge_restore_entities`
4. Batch CRUD entities are:
   - `goal`, `project`, `strategy`, `task`, `habit`, `tag`, `note`, `insight`
   - `calendar_event`, `work_block_template`, `task_timebox`
   - `psyche_value`, `behavior_pattern`, `behavior`, `belief_entry`,
     `mode_profile`, `mode_guide_session`, `trigger_report`, `event_type`,
     `emotion_definition`
   - `preference_catalog`, `preference_catalog_item`, `preference_context`,
     `preference_item`
   - `questionnaire_instrument`, `sleep_session`, `workout_session`
5. Specialized CRUD entities are `wiki_page` and `calendar_connection`.
6. Action and workflow entities are `task_run`, `questionnaire_run`, the
   preferences game and judgment/signal tools, calendar sync/setup flows, work-log
   adjustments, and similar action-heavy operations.
7. Read-model-only surfaces include operator overview/context, sleep overview,
   sports overview, self-observation calendar, and calendar overview.
8. Use the task-run tools for truthful live work:
   - `forge_start_task_run`
   - `forge_heartbeat_task_run`
   - `forge_focus_task_run`
   - `forge_complete_task_run`
   - `forge_release_task_run`
   - include `closeoutNote` when the work summary should become a durable linked note
9. Store structured recommendations with `forge_post_insight`.
10. Use `forge_adjust_work_minutes` for `work_adjustment` when the user wants a
    truthful signed minute correction on an existing task or project.
11. Use the dedicated Preferences action tools for `preference_judgment` and
    `preference_signal` rather than forcing those decisions through batch CRUD.
12. Use `forge_get_sleep_overview` and `forge_get_sports_overview` for health read
    models, and use `forge_update_sleep_session` and `forge_update_workout_session`
    only for reflective enrichment on one already-existing record. Ordinary
    `sleep_session` and `workout_session` CRUD belongs on the shared batch routes.
13. Movement, Life Force, and Workbench are specialized Forge API surfaces rather
    than simple batch entities. For Movement in particular, treat the surface as a
    timeline of stays and trips that supports time-in-place questions, travel-history
    review, manual overlays, edits, and links to other Forge records.
    When those domains matter, consult
    `forge_get_agent_onboarding` and follow its `entityRouteModel.specializedDomainSurfaces`
    route families instead of trying to squeeze them through generic CRUD.
14. Use `forge_get_ui_entrypoint` when the Forge UI is the better surface for Kanban,
   detailed review, graph exploration, or complex Psyche work.

## Entity contract

- Preferred mutation path for simple entities: `forge_search_entities`,
  `forge_create_entities`, `forge_update_entities`, `forge_delete_entities`,
  `forge_restore_entities`.
- Preferred mutation path for `sleep_session` and `workout_session`: the same batch
  CRUD tools. Dedicated health tools are for review and post-review enrichment, not
  the default write model.
- Preferred mutation path for Preferences actions: keep the batch tools for the
  simple entities and use the dedicated game, judgment, signal, merge, enqueue, and
  score tools only for those action-heavy flows.
- Preferred mutation path for questionnaires: use batch CRUD for
  `questionnaire_instrument`, and use the run, clone, draft, and publish tools for
  questionnaire workflows.
- Preferred mutation path for wiki content: use the wiki tools instead of batch CRUD.
- Habit outcome writes through `/api/v1/habits/:id/check-ins` accept `status` plus optional `dateKey`, `note`, and `description`; if `description` is provided, it replaces the habit's stored `description` in the same write.
- Preferred API path for Movement, Life Force, and Workbench: use the dedicated
  route families published in `forge_get_agent_onboarding.entityRouteModel.specializedDomainSurfaces`.
- In the live onboarding catalog, those domains should read as
  `specialized_domain_surface`, not as read-only leftovers. If the classification and
  route family disagree, trust the specialized route family and fix the contract
  mismatch before inventing a CRUD path.
- Movement lane hints: review spans through `/api/v1/movement/day`,
  `/api/v1/movement/month`, `/api/v1/movement/all-time`, `/api/v1/movement/timeline`,
  `/api/v1/movement/places`, `/api/v1/movement/selection`, and
  `/api/v1/movement/trips/:id`; fill missing spans through
  `/api/v1/movement/user-boxes/preflight` then `/api/v1/movement/user-boxes`; only
  patch `/stays/:id` or `/trips/:id` when editing an already-recorded item; use
  `/api/v1/movement/user-boxes/:id`,
  `/api/v1/movement/automatic-boxes/:id/invalidate`, and the stay/trip repair routes
  for repair actions on already-saved movement data.
- Life Force lane hints: overview is `GET /api/v1/life-force`, durable profile edits
  are `PATCH /api/v1/life-force/profile`, weekday curve edits are
  `PUT /api/v1/life-force/templates/:weekday`, and real-time tired or recovered
  reports are `POST /api/v1/life-force/fatigue-signals`.
- Workbench lane hints: flow catalog and CRUD live under `/api/v1/workbench/flows`,
  execution uses `/api/v1/workbench/flows/:id/run` or `/api/v1/workbench/run`,
  published outputs use `/api/v1/workbench/flows/:id/output`, and per-run or per-node
  inspection uses the run and node-result routes under `/api/v1/workbench/flows/:id`.
- When the request is routed through the OpenClaw HTTP proxy instead of direct Forge
  runtime access, those same specialized families are mirrored under
  `/forge/v1/movement/*`, `/forge/v1/life-force/*`, and `/forge/v1/workbench/*`.
- Exact create-shape expectations live in `forge_get_agent_onboarding`. Use its
  `entityCatalog` as the schema source of truth for `minimumCreateFields`,
  `fieldGuide`, examples, classification, and preferred mutation path.
- High-signal minimums worth remembering:
  `goal { title }`, `project { goalId, title }`, `strategy { title, graph }`,
  `task { title }`, `habit { title }`, `tag { label }`,
  `note { contentMarkdown, links }`, `calendar_event { title, startAt, endAt }`,
  `work_block_template { title, kind, timezone, weekDays, startMinute, endMinute, blockingState }`,
  `task_timebox { taskId, title, startsAt, endsAt }`, `psyche_value { title }`,
  `behavior_pattern { title }`, `behavior { kind, title }`,
  `belief_entry { statement, beliefType }`, `mode_profile { family, title }`,
  `mode_guide_session { summary, answers }`, `trigger_report { title }`,
  `event_type { label }`, `emotion_definition { label }`,
  `preference_catalog { userId, domain, title }`,
  `preference_catalog_item { catalogId, label }`,
  `preference_context { userId, domain, name }`,
  `preference_item { userId, domain, label }`,
  `questionnaire_instrument { title, sourceClass, availability, isSelfReport, versionLabel, definition, scoring, provenance }`,
  `sleep_session { startedAt, endedAt }`,
  `workout_session { workoutType, startedAt, endedAt }`.

## Behavioral rules

- Prefer the operator overview before mutating Forge.
- Prefer batch entity tools for simple entities. The point is to keep the agent out
  of a route jungle, not to memorize every direct CRUD endpoint in the server.
- When ownership matters, set `userId` deliberately instead of assuming the current
  operator is the only namespace.
- Use `note` as the first-class Markdown evidence record for context, reflection,
  handoff detail, and multi-entity linkage.
- Delete defaults to soft-delete unless hard delete is explicit.
- When Forge is local on `127.0.0.1` or `localhost`, the plugin can auto-start the
  Forge runtime.
