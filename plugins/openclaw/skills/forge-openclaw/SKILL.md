---
name: forge-openclaw-plugin
description: Use when the user wants to save, search, update, review, start, stop, reward, explain, compare, learn, or run Forge records, or when the conversation is clearly about a Forge entity or domain surface such as a goal, project, strategy, task, habit, person, People or peer sharing, note, wiki_page, artifact, calendar_event, calendar_connection, work_block_template, task_timebox, task_run, work_adjustment, insight, preference item, preference context, preference catalog, preference judgment, preference signal, questionnaire instrument, questionnaire run, self observation, operator_overview, operator_context, calendar_overview, sleep_overview, sports_overview, training_load, weight_loss, movement, life_force, workbench, course, concept, psyche_value, behavior_pattern, behavior, belief_entry, mode_profile, mode_guide_session, flashcard, trigger_report, event_type, emotion_definition, sleep_session, or workout_session. Start from live onboarding, use batch CRUD for normal entities and dedicated tools for specialized surfaces, ask only for blocking missing information, and guide exploratory Psyche work with active listening plus one discussable hypothesis after a concrete example.
---

Forge is the user's structured system for planning work, doing work, reflecting on patterns, and keeping a truthful record of what is happening. Use it when the user is clearly working inside that system, or when they are describing something that naturally belongs there and would benefit from being stored, updated, reviewed, or acted on in Forge. Keep the conversation natural first. Do not turn every message into intake. When a real Forge entity is clearly present, name the exact entity type plainly, help with the substance of the conversation, and then offer Forge once, lightly, if storing it would genuinely help.

## Live Contract And Missing-Information Gate

Before the first Forge read or write in a session, call
`forge_get_agent_onboarding`. Match the user's target to one exact
`entityCatalog[]` entry or one published specialized surface. Treat that live entry's
`classification`, `minimumCreateFields`, `fieldGuide`, `questionFlow`,
`preferredReadPath`, `preferredMutationPath`, and `preferredMutationTool` as the
current contract. The bundled playbooks guide the conversation; they do not override
the live schema or route map.

Build a private missing-information diff before asking anything:

- remove details the user already supplied
- remove optional fields and published defaults that do not change meaning,
  accountability, timing, retrieval, safety, or route selection
- on update, read the current record first and preserve every field the user did not
  ask to change
- ask one Psyche question at a time; for logistical records, one compact question may
  group inseparable details such as start, end, and timezone
- act when no blocking ambiguity remains instead of asking a polished extra question

If the target is absent from live onboarding, refresh once. If it is still absent,
report a Forge contract mismatch and do not invent an entity type, field, tool, or
nearby route.

## Project Management Hierarchy Rule

Forge project management is explicit and hierarchical:

- Goal
- Strategy (high level)
- Project
- Strategy (lower level when useful)
- Issue
- Task
- Subtask

Keep `project` and `strategy` as first-class Forge entities. Treat `issue`,
`task`, and `subtask` as the execution layer below projects. When the user is
working on a Forge project-management request, preserve that hierarchy in your
language and in the records you create.

`issue` and `subtask` are not standalone batch entity types. They are stored through
`entityType: "task"` with `data.level: "issue" | "task" | "subtask"`. Use
`projectId` and `parentWorkItemId` for placement. Never call batch CRUD with
`entityType: "issue"` or `entityType: "subtask"`.

Project-management workflow rule:

- Projects are PRD-backed initiatives.
- PRDs should break down into issues that are vertical slices across the stack.
- Every issue must be classified as `AFK` or `HITL`.
- Issues and tasks can both preserve `executionMode` and structured Given/When/Then
  `acceptanceCriteria` when that helps the delivery contract stay explicit.
- Issues keep end-to-end behavior in `description`.
- Tasks are one focused AI session each.
- If a task is too large for one focused AI session, split it.
- Task instructions belong in `aiInstructions`.
- File targets, patterns to follow, and done-shape guidance belong inside
  `aiInstructions`, not as separate schema fields.
- Use subtasks only as lightweight child steps under a task.
- Placement and linking should follow the hierarchy explicitly:
  project -> issue -> task -> subtask.
- When the user wants to link or place a work item, use a hierarchy-aware search flow
  that can select or create the relevant goal, project, issue, or parent work item
  instead of inventing a flat parent picker.

Task completion rule:

- When a task is finished, preserve
  `completionReport = { modifiedFiles[], workSummary, linkedGitRefIds[] }` and
  send the referenced canonical records in `gitRefs`.
- `modifiedFiles` supports at most 256 safe repository-relative paths of at most
  512 characters each. `workSummary` supports 8,000 characters.
  `linkedGitRefIds` supports at most 64 IDs of at most 128 characters each.
- `gitRefs` supports at most 64 commit, branch, or pull-request records. Each
  record requires `refType` and `refValue`; any `url` must use HTTP or HTTPS.
- Every `linkedGitRefIds` value must identify one of the resulting task Git refs.
- Completing a task run is atomic. Repeating the exact terminal closeout is
  idempotent; changing the report, Git refs, or closeout note on replay conflicts.
- A quick or native completion may truthfully leave `closeoutState: deferred`.
  Read the task back after completion and inspect `closeoutState`,
  `completionReport`, and `gitRefs` before claiming that closeout evidence exists.
- Releasing a task run accepts only `actor`, `note`, and `closeoutNote`. It does
  not accept completion evidence and does not complete the task.
- Forge defaults to direct commits on `main`.
- Do not ask the user to create a feature branch or pull request unless they
  explicitly want that workflow.

PM surface rule:

- Forge has one mixed Kanban board for `project`, `issue`, `task`, and `subtask`.
- Forge also has one compact hierarchy tab for the full repeated hierarchy.
- Both surfaces share search and filtering, including level visibility and
  human/bot ownership filters.
- Guided modal flows handle create, edit, move, link, and closeout actions.

Forge has four major stored-entity surfaces, read-model surfaces, specialized CRUD surfaces, and four specialized domain surfaces. The planning side covers goals, projects, strategies, tasks, habits, notes, calendar events, recurring work blocks, task timeboxes, live work sessions, and agent-authored insights. The Health side covers sleep sessions, sports and workout sessions, the read-only training-load surface for cardiovascular load and HR zone review, the weight-loss and nutrition workflow, companion pairing, and habit-generated workout records that should still stay linked to the broader Forge graph. The Preferences side covers contextual taste modeling, pairwise comparisons, direct signals, editable concept libraries, and preference items that can come from Forge entities or seeded concept domains such as food, activities, places, countries, fashion, people, media, and tools. The Psyche side covers values, patterns, behaviors, beliefs, modes, guided mode sessions, flashcards, trigger reports, event types, reusable emotion definitions, questionnaire instruments, questionnaire runs, and the note-backed self-observation calendar. Read-model surfaces include `operator_overview`, `operator_context`, `calendar_overview`, `sleep_overview`, `sports_overview`, `training_load`, `weight_loss`, and the self-observation calendar; ask what practical decision the read should support before adding write-shaped questions. The specialized domain surfaces are Movement, Life Events, Life Force, and Workbench; agents must use their dedicated route families for domain actions instead of guessing generic CRUD paths for those actions. Forge also has a SQLite-backed Wiki memory layer with explicit spaces, Markdown content in database rows, backlinks, optional embeddings, and structured links back to Forge entities. The Artifact Store is a specialized CRUD surface for trusted stored files such as spreadsheets, documents, PDFs, text, structured text, and images; artifact relationships use the general `entity_links` model, and agents must not download, decrypt, open, execute, preview, transform stored file bytes, or submit artifact passwords. Forge is also multi-user: every entity can belong to a typed `human` or `bot` user through `userId`, and read routes can scope to one or many users with `userId` or repeated `userIds`. The current access posture is configurable through a directional user graph, but the live default is still permissive: Forge can list users directly, every relationship edge starts open, and a user can read or affect another user's linked records when the route explicitly asks for them. Use `forge_get_user_directory` when owner identity or cross-user access matters. Strategies can also be locked into a contract with `isLocked`; once locked, do not mutate the graph or target structure unless the user explicitly wants the strategy unlocked first. The model should use the real entity names, not vague substitutes. Say `project`, not “initiative”. Say `behavior_pattern`, not “theme”. Say `trigger_report`, not “incident note”.
Preferences Workspace is a read-model-only explanation surface. Use it to ground an
inferred ranking in judgments, signals, overrides, evidence count, and uncertainty
before offering any dedicated Preferences action. A workspace read never initializes
or refreshes state; if it is missing, report that state and use an explicit Preferences
action only after the user chooses it.
Habits are a first-class recurring entity in the planning side.
NEGATIVE HABIT CHECK-IN RULE: for a `negative` habit, the correct aligned/resisted outcome is `missed`. `missed` means the bad habit was resisted, the user stayed aligned, and the habit should award its XP bonus.

## Entity Route Posture

Before asking for lower-level details, decide whether the user's request is normal
stored-entity CRUD, an action workflow, specialized CRUD, or a specialized domain
surface. Name the path plainly enough that another agent could follow it without
guessing.

Keep that route plan internal unless the user asks for implementation detail. Track
the intent, entity or dedicated domain lane, exact tool or route key, target
identifiers, and one missing detail privately; with the user, ask about the real
thing: the span, place, event, artifact, weekday, flow, run, node, belief sentence, parent record, or
save confirmation. Report product actions such as "saved the belief", "corrected the
missing stay", "updated the weekday energy pattern", or "read the failed node" before
any route-key or endpoint detail.

Use the known-target fast path when the user already supplied the object, action, and
likely lane. For normal entities, ask only for parent, owner, or duplicate-disambiguation that changes the write. For task hierarchy, ask only for the project,
issue, or parent task that changes placement. For Movement, ask only for the missing
interval, boundary, saved object, or confirmation. For Life Events, ask only for the missing event id, start/end span, place, calendar match, ticket artifact, travel status target, or confirmation. For Life Force, ask only for the
weekday, profile field, signal intensity, or planning effect. For Workbench, ask only
for the missing flow, run, node, input, output, or preservation choice. For direct
Psyche saves, ask one accuracy or consent question instead of restarting exploration.

Use the active-listening turn contract before deepening: reflect the specific stake,
working shape, or product object in one sentence; decide internally whether the next
answer would change wording, placement, timing, route scope, support action,
verification read, preservation choice, or consent; then ask one question. For Psyche,
name the felt stake, protection, prediction, payoff, cost, or value conflict, and when
a functional loop or belief sentence is already visible, offer one tentative
hypothesis plus one fit-or-correction question instead of another broad exploration.
For logistical records, keep the reflection short and ask for the operational detail.

Use the route execution handoff before any read, write, run, repair, or publish call:
freeze the accepted user-facing target, choose exactly one lane, use batch CRUD only
for catalog entities, use named tools or documented routes for specialized CRUD and
action workflows, and verify an action workflow's selected operation against live
onboarding `actionEntities.routeKeys`, `routeTools`, and `methodRoutes` before calling.
For every dedicated surface, including Movement, Life Events, Life Force, Workbench,
Course and Concept, Wiki, Calendar Connection, Artifact Store, Attention, Entity
Navigation, People, and bounded Peer reads, verify `routeKey`, route tool, method,
path, and `pathParams` from live onboarding `methodRoutes` before calling.
Never hide placeholders in `query` or `body`, and never guess a nearby path.

- Batch CRUD is the default for normal stored entities, including `goal`, `project`,
  `strategy`, `task`, `habit`, `tag`, `person`, `note`, `insight`, `calendar_event`, `life_event`,
  `work_block_template`, `task_timebox`, all main Psyche records, basic Preferences
  CRUD records, `questionnaire_instrument`, `sleep_session`, and `workout_session`.
- `person` is an owner-scoped local record about someone in the user's life. It is
  not a Forge `User`, agent identity, peer credential, pairing, or sharing grant.
  Search, create, update, soft-delete, restore, and replace its general `links`
  through `forge_search_entities`, `forge_create_entities`,
  `forge_update_entities`, `forge_delete_entities`, and
  `forge_restore_entities`. Search the intended owner by name or alias before
  creating a possible duplicate. Ask only for the accepted display name, owner, and
  context that serves the user's stated purpose. Do not ask for contact details,
  birthday data, private notes, or sensitive facts by default.
- `forge_call_people_route` exposes only these server operation IDs:
  `listPeopleReadModel`, `getPersonContext`, `scanPeopleWikiCandidates`,
  `previewPeopleWikiAssociations`, `applyPeopleWikiAssociations`,
  `interpretPersonQuestion`, `executePersonQuestion`, and
  `listPersonQuestionHistory`. Use the exact route-key variant schema. People reads
  require `people:read:basic`; private, contact, sensitive, and restricted fields
  need their narrower read scopes; Wiki association steps require the published
  People and Wiki scopes; typed questions require `people:read:basic` plus
  `peer:query`.
- `forge_call_peer_route` exposes only `listPeerRequests`,
  `listPeerRelationships`, `getPeerRelationship`, `listPeerDevices`,
  `listPeerGrants`, `getPeerSyncStatus`, and `getPeerDiagnostics`. These status
  reads require `peer:status`. Both People and peer tools require a configured
  local agent token with the listed scopes. An operator session does not substitute
  for that token.
- Pairing acceptance, invitation control, consent changes, grant acceptance,
  countering, widening or revocation, relationship revocation, device approval or
  removal, resync requests, approval credentials, and human-presence ceremonies are
  human-only. They are absent from agent tools. Never emulate them with batch CRUD or
  a nearby route.
- `wiki_page`, `calendar_connection`, and `artifact` are specialized CRUD surfaces.
  Use `forge_call_wiki_route` for the complete Wiki lifecycle, the narrower Wiki
  helpers for settled operations, `forge_call_calendar_connection_route` for the
  complete calendar connection lifecycle, the narrower calendar connect/sync helpers
  when those actions are already settled, and the Artifact Store route family for paged metadata listing,
  trusted file upload, metadata,
  static scan, LLM metadata enrichment, generic entity links, trust state, versions,
  and audit. Batch CRUD may search, update, delete, and restore artifact metadata, but
  it must not create file artifacts or access file bytes.
- `task_run`, `work_adjustment`, `questionnaire_run`, `preference_judgment`,
  `preference_signal`, and `self_observation` are action workflows. Use their
  dedicated tools or note-backed write model instead of generic entity create/update
  when the action route is the real product behavior.
- Attention is a bounded, actor-scoped read-and-action surface, not batch CRUD.
  Use `forge_call_attention_route` with `list` before acting unless the user supplied
  a stable item id from a current queue. Use only actions returned in
  `allowedActions`, pass the id through `pathParams.id`, and never dismiss blocked or
  overdue work. The runtime path is `/api/v1/attention-inbox`; the OpenClaw mirror is
  `/forge/v1/attention`.
- Pins and recently viewed records use `forge_call_entity_navigation_route`.
  `list` returns bounded canonical pins plus this agent actor's own recent history;
  `touch` records an exact in-scope entity only after the agent actually viewed it.
  Agents cannot pin or unpin. Those choices remain human-operator-only in the Forge
  Action Bar. The runtime path is `/api/v1/entity-navigation`; the OpenClaw mirror is
  `/forge/v1/entity-navigation`.
- Movement, Life Events, Life Force, and Workbench are specialized domain surfaces. Read
  `forge_get_agent_onboarding.entityRouteModel.specializedDomainSurfaces` and use
  the dedicated route families for timeline/overlay repair, Life Events chronology/calendar/ticket/status, energy templates/signals,
  and flow execution/results. When the adapter exposes `forge_call_movement_route`,
  `forge_call_life_event_route`, `forge_call_life_force_route`, or `forge_call_workbench_route`, use those
  route-key tools after the conversation has selected the lane; otherwise use the
  exact `/api/v1/*` route or OpenClaw `/forge/v1/*` mirror published in onboarding.
  Life Force may be keyed as `lifeForce` and as the entity-style alias `life_force`;
  both point to the same `/api/v1/life-force/*` route family.
- Artifact Store route keys live under
  `forge_get_agent_onboarding.entityRouteModel.specializedCrudEntities.artifact`.
  When the adapter exposes `forge_call_artifact_route`, use it for artifact list
  with `limit`/`offset`, trusted upload, metadata update, static rescan, LLM
  enrichment, generic entity-link replacement, trust state, versions, or audit.
  Use batch CRUD for artifact metadata delete/restore. Do not expose or call the
  download, password download, decrypt, or existing-artifact encryption routes from
  agent tools; password and byte routes are human-operator-only. Agents may read
  `contentProtection` metadata and password hints, but must not receive, store,
  submit, or route artifact passwords.
- Wiki page, calendar connection, and Artifact Store route keys and method/path maps
  all live under
  `forge_get_agent_onboarding.entityRouteModel.specializedCrudEntities`. Use the
  published `routeKeys` and `methodRoutes` for those specialized CRUD surfaces before
  calling lower-level routes, and cross-check OpenAPI when debugging a contract
  mismatch. Do not guess wiki, calendar connection, or artifact paths from memory.
- For `wiki_page`, prefer `forge_call_wiki_route` when the job needs the complete
  lifecycle, especially `readBySlug` or `delete`. Resolve and read the exact page
  before update or delete, pass `id` or `slug` through `pathParams`, and read the
  affected page, list, search, or health state back when verification matters.
- For `calendar_connection`, prefer `forge_call_calendar_connection_route` with the
  published `list`, `discover`, `discoverMacOSLocal`, `rediscover`, `create`, `update`,
  `sync`, or `delete` key. List first for existing-record changes unless an exact id
  came from a current read, pass that id through `pathParams.id`, and list again when
  read-back is needed to prove the intended result.
- The live onboarding `routeKeys` list, `methodRoutes` map, and specialized
  route-key tool schemas include the exact route-key to method/path map. Use
  `routeKeys` for the allowed names and `methodRoutes` as the
  route-key-to-`METHOD /api/v1/...` source of truth when checking specialized
  methods, especially POST aggregate reads such as Movement `selection` and DELETE
  repair paths. When a route key's exact path contains placeholders such as `:id`,
  `:weekday`, `:slug`, `:runId`, `:nodeId`, or `:pointId`, pass those values in
  `pathParams` using the placeholder names exactly. Do not place IDs inside
  `routeKey`, `query`, or `body`, invent a raw route string, or ask the user to
  choose an endpoint when the lane already selects one. If that schema and live
  onboarding disagree, trust the live onboarding for the current call and treat the
  disagreement as a Forge contract bug to fix, not as a reason to guess a nearby
  route.
- If a specialized route-key tool is unavailable, stale, or missing the needed route
  key, do not fall back to generic batch CRUD and do not invent a nearby raw path. Read
  live onboarding, use the exact `methodRoutes` entry for the selected Movement, Life Events, Life
  Force, or Workbench lane, and cross-check OpenAPI only to confirm the same method
  and path.
- Before every Movement, Life Events, Life Force, or Workbench call, run a route-contract
  handshake internally: select the product lane in plain language, verify the matching
  `routeKey` against live onboarding `routeKeys` and `methodRoutes`, fill any
  placeholders through `pathParams`, and ask the user only for the missing product
  noun that fills the placeholder. If the contract is missing a lane the product
  clearly supports, report a contract bug instead of silently using generic batch
  CRUD or a nearby route.

Concrete route-key examples for internal use:

- Attention active queue:
  `{"routeKey":"list","query":{"state":"active","limit":25,"offset":0}}`
- Attention snooze:
  `{"routeKey":"snooze","pathParams":{"id":"attn:insight:ins_123"},"body":{"until":"2026-07-11T09:00:00.000Z","note":"Review after the morning planning block."}}`
- Attention restore:
  `{"routeKey":"restore","pathParams":{"id":"attn:insight:ins_123"}}`
- Person search before create:
  `{"searches":[{"entityTypes":["person"],"query":"Jon","userIds":["user_operator"],"limit":20}]}`
- Person create after the user accepts the wording:
  `{"operations":[{"entityType":"person","data":{"userId":"user_operator","displayName":"Jon","relationshipCategory":"friend","shortDescription":"Friend I often cycle with."}}]}`
- People collection read:
  `{"routeKey":"listPeopleReadModel","query":{"userId":"user_operator","query":"Jon","limit":20}}`
- Calendar availability interpretation:
  `{"routeKey":"interpretPersonQuestion","pathParams":{"personId":"person_jon"},"body":{"question":"What is Jon doing next Monday?","timeZone":"Europe/Zurich"}}`
- Goal-horizon interpretation:
  `{"routeKey":"interpretPersonQuestion","pathParams":{"personId":"person_jon"},"body":{"question":"What are Jon's big goals for the next few months?","timeZone":"Europe/Zurich"}}`
- Cycling aggregate interpretation:
  `{"routeKey":"interpretPersonQuestion","pathParams":{"personId":"person_jon"},"body":{"question":"How much has Jon been cycling this month?","timeZone":"Europe/Zurich"}}`
- Typed question execution: pass the `interpretationId`, `interpretationHash`, and
  complete typed `query` returned by `interpretPersonQuestion` unchanged to
  `executePersonQuestion`. Do not hand-author a broader projection, interval, field
  list, or precision. The active directional grant still limits the result.
- Typed question reporting: preserve `result.state` and
  `result.metadata.source`, `asOf`, `receivedAt`, `validUntil`,
  `completeness`, `precision`, and `redactedFields`. Say when an answer is
  cached or stale, name material redactions, and never infer withheld fields.
- Existing peer relationship status:
  `{"routeKey":"getPeerRelationship","pathParams":{"relationshipId":"peer_relationship_123"}}`
- Movement all-time read:
  `{"routeKey":"allTime","query":{"userIds":["user_operator"]}}`
- Movement timeline read:
  `{"routeKey":"timeline","query":{"from":"2026-05-01T00:00:00.000Z","to":"2026-05-06T23:59:59.999Z","userIds":["user_operator"]}}`
- Movement selection aggregate:
  `{"routeKey":"selection","body":{"from":"2026-05-01T00:00:00.000Z","to":"2026-05-14T23:59:59.999Z","placeIds":["place_home"],"userIds":["user_operator"]}}`
- Movement trip detail:
  `{"routeKey":"tripDetail","pathParams":{"id":"trip_123"}}`
- Movement settings read:
  `{"routeKey":"settings","query":{"userIds":["user_operator"]}}`
- Movement settings update:
  `{"routeKey":"settingsUpdate","body":{"trackingEnabled":true,"publishMode":"draft_review","retentionMode":"aggregates_only"}}`
- Movement known-place creation:
  `{"routeKey":"placeCreate","body":{"label":"Home","centerLat":46.2044,"centerLon":6.1432,"radiusMeters":120,"userId":"user_operator","note":"Primary home boundary for future time-in-place reads."}}`
- Movement known-place update:
  `{"routeKey":"placeUpdate","pathParams":{"id":"place_home"},"body":{"label":"Home office","radiusMeters":90,"note":"Tighten the boundary so clinic visits do not count as home."}}`
- Movement missing-stay correction:
  first `{"routeKey":"userBoxPreflight","body":{"kind":"stay","startedAt":"2026-05-06T13:00:00.000Z","endedAt":"2026-05-06T15:00:00.000Z","placeLabel":"Home","userId":"user_operator"}}`,
  then `{"routeKey":"userBoxCreate","body":{"kind":"stay","startedAt":"2026-05-06T13:00:00.000Z","endedAt":"2026-05-06T15:00:00.000Z","placeLabel":"Home","userId":"user_operator","note":"Manual correction after reviewing the timeline."}}`
- Movement saved-overlay update:
  `{"routeKey":"userBoxUpdate","pathParams":{"id":"box_manual_123"},"body":{"endedAt":"2026-05-06T15:30:00.000Z","note":"Extended after checking the timeline detail."}}`
- Movement saved-overlay delete:
  `{"routeKey":"userBoxDelete","pathParams":{"id":"box_manual_123"}}`
- Life Events timeline read:
  `{"routeKey":"timeline","query":{"limit":100,"offset":0}}`
- Life Event detail read:
  `{"routeKey":"read","pathParams":{"id":"lifeevent_123"}}`
- Life Event calendar sync:
  `{"routeKey":"calendarSync","pathParams":{"id":"lifeevent_123"},"body":{"projection":"link_or_create"}}`
- Mark calendar event as Life Event:
  `{"routeKey":"fromCalendarEvent","body":{"calendarEventId":"cal_evt_123","eventType":"concert","importance":"meaningful"}}`
- Import ticket artifact into Life Events:
  `{"routeKey":"importTicket","body":{"artifactId":"artifact_ticket_123","createDraft":true,"useLlm":true}}`
- Life Event travel status:
  `{"routeKey":"travelStatus","pathParams":{"id":"lifeevent_123"}}`
- Life Force overview:
  `{"routeKey":"overview"}`
- Life Force profile edit:
  `{"routeKey":"profile","body":{"baselineDailyAp":24,"recoveryNotes":"Clinic-admin days need a lower expected afternoon load."}}`
- Life Force weekday template edit:
  `{"routeKey":"weekdayTemplate","pathParams":{"weekday":"monday"},"body":{"points":[{"hour":13,"freeAp":-4}]}}`
- Life Force fatigue signal:
  `{"routeKey":"fatigueSignal","body":{"signal":"tired","intensity":7,"note":"Sharp post-lunch dip after clinic admin."}}`
- Workbench flow catalog:
  `{"routeKey":"listFlows","query":{"status":"enabled","limit":24,"offset":0}}`
- Workbench flow detail:
  `{"routeKey":"flowDetail","pathParams":{"id":"flow_research_digest"}}`
- Workbench box catalog:
  `{"routeKey":"boxCatalog","query":{"limit":24,"offset":0}}`
- Workbench flow creation:
  `{"routeKey":"createFlow","body":{"title":"Research digest","slug":"research-digest","description":"Turn a topic into a cited digest with a stable published summary.","nodes":[],"edges":[]}}`
- Workbench flow edit:
  `{"routeKey":"updateFlow","pathParams":{"id":"flow_research_digest"},"body":{"description":"Keep the same input contract but add a stronger evidence-check node."}}`
- Workbench flow deletion:
  `{"routeKey":"deleteFlow","pathParams":{"id":"flow_research_digest"}}`
- Workbench run history:
  `{"routeKey":"runHistory","pathParams":{"id":"flow_research_digest"},"query":{"limit":10}}`
- Workbench run detail:
  `{"routeKey":"runDetail","pathParams":{"id":"flow_research_digest","runId":"run_123"}}`
- Workbench run nodes:
  `{"routeKey":"runNodes","pathParams":{"id":"flow_research_digest","runId":"run_123"}}`
- Workbench node result:
  `{"routeKey":"nodeResult","pathParams":{"id":"flow_research_digest","runId":"run_123","nodeId":"node_summary"}}`
- Workbench published output:
  `{"routeKey":"publishedOutput","pathParams":{"id":"flow_research_digest"}}`
- Workbench latest node output:
  `{"routeKey":"latestNodeOutput","pathParams":{"id":"flow_research_digest","nodeId":"node_summary"}}`
- Workbench run execution:
  `{"routeKey":"runFlow","pathParams":{"id":"flow_research_digest"},"body":{"input":{"topic":"question flow quality"},"timeoutMs":300000}}`
- Workbench active-run cancellation:
  `{"routeKey":"cancelRun","pathParams":{"id":"flow_research_digest","runId":"run_123"},"body":{"reason":"The operator stopped this run after the required result was already available."}}`
- Workbench one-off input execution:
  `{"routeKey":"runByPayload","body":{"flow":{"title":"One-off digest","nodes":[]},"input":{"topic":"question flow quality"}}}`
- Workbench flow chat follow-up:
  `{"routeKey":"chatFlow","pathParams":{"id":"flow_research_digest"},"body":{"message":"Refine the summary around API route risks and keep the published output stable."}}`
- Artifact metadata list:
  `{"routeKey":"list","query":{"query":"thesis budget","formatFamily":"spreadsheet","limit":20}}`
- Artifact trusted upload:
  `{"routeKey":"createWithBytes","body":{"idempotencyKey":"artifact-upload-budget-2026-07-16","originalFileName":"budget.xlsx","contentBase64":"<base64>","title":"Thesis budget workbook","sourceLabel":"Uploaded by the operator from local files","useLlmEnrichment":true,"links":[{"entityType":"project","entityId":"project_thesis","relationship":"evidence"}]}}`
  Keep that per-file `idempotencyKey` unchanged only when retrying the exact same upload after a timeout or interrupted response. Use a new key when bytes or metadata change; Forge derives agent provenance from the authenticated token.
- Artifact generic entity-link replacement:
  `{"routeKey":"replaceGenericLinks","pathParams":{"id":"artifact_123"},"body":{"links":[{"entityType":"wiki_page","entityId":"note_thesis_budget","relationship":"embedded_reference"}]}}`
- Artifact audit read:
  `{"routeKey":"audit","pathParams":{"id":"artifact_123"}}`
- Artifact forbidden agent action:
  do not call `/api/v1/artifacts/:id/download`, submit artifact passwords, or decrypt/open/preview/transform bytes; hand the human to the Forge web app for download.

Preferences rule:

- When the user wants to understand or refine taste, ranking, recommendation fit, or “what Forge thinks I like”, treat that as the Preferences surface rather than a normal planning intake.
- The default Preferences UX starts from what Forge already knows and then offers one prominent `Start the game` action.
- The comparison flow is visual and modal. Prefer opening the Forge UI when the user wants to play comparisons directly.
- For Forge-native domains, Forge can seed items from existing entities automatically.
- For broader domains such as food or activities, Forge can use seeded concept libraries that the user can later edit.

Wiki rule:

- Treat the Wiki as the canonical long-form memory surface, not as a loose note dump.
- Use a wiki page whenever the user wants to remember or reuse durable knowledge:
  a book, article, paper, source, concept, person, conversation, project reference,
  recurring explanation, or personal manual.
- Prefer `wiki_page` over `note` when the user is asking for durable memory,
  synthesis, reference, or something they will want to find again by topic.
- Use the wiki tools when the user wants SQLite-backed reference pages, backlink-aware recall, ingest from a URL or local file, or wiki maintenance work such as unresolved-link cleanup.
- `forge_ingest_wiki_source` now queues the ingest as background work; use the Forge UI handoff when the user wants to review or keep only selected wiki/entity candidates after the ingest finishes.
- Keep evidence notes and wiki pages conceptually distinct: evidence notes are linked operating records, while wiki pages are curated long-form memory.
- Ingestion policy for OpenClaw, Hermes, Codex, and Claude Code adapters:
  - Before ingesting, call `forge_get_wiki_settings` so the agent knows the available spaces, LLM profiles, and embedding profiles. Prefer the shared wiki space for durable shared knowledge unless the current settings or user request clearly require another space.
  - Use `forge_ingest_wiki_source` for raw text, local files, and URLs. Do not build an ad hoc importer or write raw source pages manually unless the Forge ingest tool is broken; if it is broken, fix the ingest path and tests before proceeding.
  - Preserve source/evidence artifacts for audit, but do not make the wiki a transcript dump, movement log, release log, or repetitive check-in archive. Evidence supports knowledge; canonical wiki pages should be curated, readable, structured articles.
  - Detect and propose durable pages for important people, organizations, projects, places, events, concepts, recurring relationship patterns, decisions, preferences, commitments, and timelines. A detected person or important concept should become or update a real wiki page, not disappear into one source note.
  - Merge duplicates deliberately into one canonical page per real concept/person/project. Do not merely rename a page, hide a duplicate, or keep competing partial pages. Combine the durable information, preserve aliases and backlinks, and link the original evidence/source pages from the canonical page.
  - Keep normal personal context when it is useful knowledge. Redact or omit actual secrets and security/payment credentials such as passwords, API keys, tokens, private auth links, card numbers, and similar material; do not over-redact ordinary names, relationships, work context, events, or preferences just because they are personal.
  - After ingest or merge work, run `forge_sync_wiki_vault`, then use `forge_get_wiki_health`, search/list checks, and spot reads to verify created and updated pages, duplicate candidates, unresolved links, missing summaries, evidence links, and whether source material is reachable from canonical pages.
  - Report what was created, updated, merged, left unresolved, and how evidence is preserved. If the user asked for reviewable candidates, hand off to the Forge UI ingest review instead of pretending the adapter can approve candidates inline.

Wiki navigation and search rule:

- The wiki has a stable top-level structure. The home page is `index`, and the default high-level branches are `people`, `projects`, `concepts`, `sources`, and `chronicle`.
- `people` is for durable person pages and relationship context. `projects` is for ongoing initiatives and bounded workstreams. `concepts` is for reusable ideas, methods, and frameworks. `sources` is for raw materials and imports. `chronicle` is for timeline-style logs and ongoing narrative.
- Treat `wiki` pages as canonical synthesis and `evidence` notes as supporting records. If the user wants the durable summary, search the wiki pages first. If they want raw supporting context or operational detail, evidence notes may be the better target.
- When the user wants a person, search the full name first, then obvious aliases, nicknames, or paired context such as collaborator names or city. Person pages often sit under the `people` branch but the reliable method is still search-first.
- When the user wants a conversation or chat, search the conversation name, the participant names, and any distinctive nickname used in the thread. Group-chat imports often become a durable synthesis page with a normalized title rather than the raw file name.
- When the user wants a concept, search the exact phrase first, then close variants, abbreviations, and adjacent terms. Concept pages often live under `concepts`, but search is still better than assuming the parent branch.
- When the user wants one exact page and already knows the title or slug, search that exact title or slug first, then open the best wiki page result instead of broad browsing.
- Use `forge_search_wiki` as the default wiki recall tool. It is the main route for people, conversations, concepts, and exact page lookup.
- Use `forge_list_wiki_pages` when the user wants to browse structure, inspect a branch, or understand how pages are organized rather than search by phrase.
- Use `forge_get_wiki_page` after search yields a likely hit, or when the user already identified the page to open.
- Use `forge_get_wiki_settings` or `forge_get_wiki_health` when the task is about wiki maintenance, indexing, unresolved links, ingest setup, or memory integrity rather than content recall.

Health rule:

- Sleep and sports records are first-class health surfaces, not generic notes or tasks.
- Use `forge_get_sleep_overview`, `forge_get_sports_overview`,
  `forge_get_training_load_overview`, and `forge_get_weight_loss_overview`
  for health review and trend reading.
- Use the dedicated nutrition tools for food/body work: `forge_search_foods`, `forge_search_nutrition_foods`,
  `forge_lookup_nutrition_barcode`, `forge_log_food`, `forge_update_food_log`,
  `forge_parse_food_log_with_chatgpt`, `forge_log_body_checkin`,
  `forge_log_appearance_checkin`, `forge_log_subjective_food_effect`,
  `forge_log_gut_checkin`, `forge_get_nutrition_patterns`,
  `forge_start_nutrition_experiment`, and `forge_update_nutrition_experiment`.
  Before logging food, search Forge's nutrition catalog first. If a result matches,
  pass that result's `id` as `item.foodId` to `forge_log_food` so Forge reuses the
  local/custom food database instead of creating a duplicate. If no result matches
  and you are creating a custom food, look up nutrition facts on the internet or
  another reliable public nutrition source before logging it. Custom/no-`foodId`
  items must include at least calories plus protein, carbohydrate, and fat
  (`caloriesKcal`, `proteinG`, `carbsG`, `fatG`); never save a name-only food.
  For a correction, read the weight-loss overview, resolve the exact existing
  log, and call `forge_update_food_log` with its `foodLogId` plus only the
  accepted changed fields.
  `forge_parse_food_log_with_chatgpt` must use Forge's configured `openai-codex`
  ChatGPT subscription connection, not a metered OpenAI Platform API path.
- In `forge_get_agent_onboarding.entityRouteModel.readModelOnlySurfaces`, Today priority, operator,
  calendar, Preferences, self-observation, sleep, sports, training-load, and weight-loss read models are published with
  both camelCase names and entity-style aliases where useful, including
  `todayPriority`, `operatorOverview`, `operatorContext`, `calendarOverview`, `sleepOverview`,
  `sportsOverview`, `trainingLoad`, `weightLoss`, `preferencesWorkspace`, `today_priority`, `operator_overview`, `operator_context`,
  `calendar_overview`, `self_observation`, `sleep_overview`,
  `sports_overview`, `training_load`, `weight_loss`, and `preferences_workspace`. Treat those as read-only surfaces,
  not batch CRUD entities.
- Use `forge_get_operator_overview` for a broad Forge status read, `forge_get_operator_context`
  for current work and risk, and `forge_get_calendar_overview` before calendar-aware
  planning or scheduling mutations.
- Use `forge_get_today_priority` when the user asks what to do next. Follow its
  explicit stop or continue state instead of selecting the first task in a lane.
  Its schedule evidence covers task timeboxes; read `forge_get_calendar_overview`
  separately when meetings or other calendar events matter.
- Use `forge_get_preferences_workspace` before explaining an inferred ranking. Ground
  the explanation in judgments, signals, overrides, evidence count, and uncertainty;
  switch to a dedicated Preferences action only after the user chooses a change.
- Use the shared batch entity tools for ordinary `sleep_session` and `workout_session` create, update, delete, and search work. Do not force agents into a large one-route-per-entity mental model when the batch routes already cover the record cleanly.
- Use `forge_update_sleep_session` and `forge_update_workout_session` only when the job is reflective enrichment on one existing health record after review, such as attaching notes, tags, mood, meaning, or Forge links.
- A direct manual `workout_session` needs only an accepted `workoutType`, offset-bearing `startedAt`, and `endedAt`. Resolve local clock wording with a timezone only when it changes the instants, check for a nearby type-and-time duplicate, and do not force calories, distance, heart rate, effort, mood, meaning, tags, or links.
- Read the exact workout before review, correction, enrichment, or deletion. Preserve provider-backed or habit-generated timing, metrics, source, and provenance unless the user explicitly corrects one field. Deletion is immediate, non-restorable, and bypasses the settings bin, so require the exact target and explicit confirmation; there is no restore lane.
- Habit-generated workouts and imported HealthKit workouts belong to the same workout record model, so do not invent a separate storage path for sport sessions.

Write to Forge only with clear user consent. If the user is just thinking aloud, helping first is usually better than writing immediately. After helping, you may offer one short Forge prompt if the match is strong. If the user agrees, ask only for the missing fields and exactly one focused question at a time. Do not offer Forge again after a decline unless the user reopens it.

Entity conversation rule:

- For all entity creation or update flows, use
  `forge_get_agent_onboarding.entityCatalog[].questionFlow` as the live compact
  source of truth for the opening question, coaching goal, readiness check, and
  route posture. Enforce `maxQuestionsPerTurn` and `reflectionBeforeQuestion`
  on every turn; when the Psyche hypothesis fields are published, also enforce
  `maxHypothesesPerTurn`, `hypothesisStyle`, and `requiresFitOrCorrection`.
  Use [`entity_conversation_playbooks.md`](./entity_conversation_playbooks.md)
  for deeper examples and pacing details.
- Calibrate depth before deepening: choose quick capture, guided formulation,
  review-first, or action-first. For quick capture, use the user's supplied wording,
  ask only the one structural, accuracy, or consent detail that changes the write, and
  do not force full exploration. For guided formulation, use active listening and
  Psyche hypotheses when the user is trying to understand or name charged material.
  For review-first, read before write-shaped questions. For action-first, act or ask
  only for the missing target, span, event, artifact, weekday, flow, run, node,
  correction, or consent.
- Ask only for what is missing or unclear. Do not walk through every schema field.
- Before asking another question, run the playbook's minimum save-readiness
  checkpoint: if accepted wording, meaningful body, route lane, target object or
  time scope, and any ownership/placement that changes later use are already clear,
  summarize once and write, read, run, or update instead of collecting optional
  fields. For Movement, Life Events, Life Force, and Workbench, interpret target
  object or time scope in the surface's own nouns: movement span/place/stay/trip,
  Life Event/calendar match/ticket/travel status, weekday/profile/fatigue signal,
  or Workbench flow/run/node/input/output.
- Run the no-question gate before every follow-up: ask only if the answer can change
  record type, accepted wording, hierarchy placement, owner/accountability, timing,
  route lane, target object, correction, link, verification read, run/publish/preserve
  action, or consent. If the question would only add warmth, completeness, optional
  metadata, or form polish, skip it, summarize what is clear, and act or close.
- Use the user-facing wording guard after openings, reads, writes, and confirmations:
  do not say "that sounds important" unless you name the specific stake; do not ask
  "what would you like to do with this?" when the user's verb or the read result
  already makes one next action visible; replace endpoint, payload, mutation, batch
  route, and route key language with product nouns such as missing stay, weekday
  energy curve, saved flow, failed run, node output, belief sentence, pattern,
  flashcard, wiki page, calendar connection, or task run; if no answer-changing
  uncertainty remains, summarize the product result and stop.
- Treat partial answers as progress. Before another follow-up, identify what is
  already usable: operation, entity or surface, target record or time span, working
  wording, owner or placement, route lane, and consent. Ask only for the first missing
  detail that changes the action: duplicate disambiguation, hierarchy parent, time
  window, weekday, flow, run, node, correction, link, or save consent.
- Do not ask for optional tags, priority, status, dates, color, links, or assignees
  when accepted wording and meaningful body are enough unless that metadata changes
  accountability, retrieval, or execution.
- After a read returns data and several next actions are plausible, choose the one
  most directly supported by what was learned and ask only for the missing detail
  that would permit that action. Do not hand the user a broad menu after the read has
  already narrowed the work.
- Make the read's decision value explicit before any follow-up: what the read rules
  in, what it rules out, and what one uncertainty remains. If no answer-changing
  uncertainty remains, close cleanly instead of asking another question.
- Let each question have one job. Know what you are trying to clarify before you ask it.
- Before you ask, decide the exact missing thing you need and how that answer will
  help you save, update, review, link, schedule, correct, run, publish, preserve,
  enrich, open the UI, or stop. If you cannot name what the user's answer would
  change, summarize and act instead of asking.
- Prefer a progression of:
  concrete example or intent -> working name -> purpose or meaning -> placement in Forge -> operational details -> linked context.
- Use those same playbooks for action-heavy non-Psyche flows such as `work_adjustment`, `preference_judgment`, `preference_signal`, and specialized `movement`, `life_force`, or `workbench` requests so the conversation starts from what the user is trying to understand, change, add, update, link, or run before you choose the route.
- When one message combines several jobs, sequence them instead of turning them into
  a broad menu: read before a correction when the current truth is uncertain,
  formulate the primary Psyche record before deriving a flashcard or note, and ask
  only for the missing span, wording, flow, run, node, weekday, or link that changes
  the next action.
- Before deleting, archiving, invalidating, disconnecting, or replacing a record, confirm
  the exact target and what should remain understandable; for Psyche records, preserve
  therapeutic history unless the user clearly wants removal.
- When the operation is not already explicit, identify the job first:
  add, update, review, compare, navigate, link, or run. Skip that meta question
  when the action is already obvious from the user's wording.
- Keep the operation lane explicit across every entity family. Normal stored entities
  can be added, updated, reviewed/navigated, linked, or placed; action workflows use
  verbs such as start, continue, complete, adjust, judge, signal, publish, sync, or
  observe; specialized CRUD uses lifecycle verbs; read models need a practical read
  question and scope; Movement, Life Events, Life Force, and Workbench use review, correct,
  repair, run, inspect, publish, preserve, calendar-sync, ticket-import, or status
  lanes through their dedicated route keys;
  and Psyche entities need formulation before storage when the user wants
  understanding rather than direct save.
- For emotionally meaningful non-Psyche records such as goals, habits, and notes, reflect the meaning before you ask for structure.
- When the user is vague, ask for one small concrete example, stake, or desired outcome before you ask them to name the record.
- When the user is clear, say what the record seems to be becoming and ask only for the last missing detail.
- Ground the reflection in one concrete detail from the user's own message. Do not
  narrate intake discipline with phrases such as "without widening the request,"
  "I will ask only," or "I will keep this bounded"; demonstrate that discipline by
  asking one useful question.
- Keep internal lane names, route keys, tool names, and field names out of the
  user-facing turn unless the user asks for implementation detail. Paraphrase
  labels such as `guided_design`, `read_only_review`, and `status_change` as natural
  actions such as shaping the recurrence, reviewing without changing it, or changing
  its status.
- When the user wants to review, compare, inspect, or navigate an existing Forge
  record, ask what they are trying to understand first and look up the existing record
  before you reopen create or update intake.
- For review-first requests, use the correct read posture before asking write-shaped
  questions: shared batch search or read hints for normal entities, wiki/calendar
  dedicated reads for specialized CRUD, read-model routes for overviews, and
  Movement, Life Events, Life Force, or Workbench dedicated reads for those domain surfaces. After
  the read, answer the practical question before asking for any save, correction,
  link, run, enrichment, or publish detail.
- After create, update, delete, restore, run, read, or repair actions, confirm the
  user-facing record, action, and result in the user's language instead of reopening
  intake. For batch creates and updates, confirm the working title or accepted wording,
  container, and owner or placement only when those changed retrieval, accountability,
  or execution; if optional tags, priority, status, color, links, dates, or assignees
  were left provisional, say that plainly once. For action workflows, confirm the real
  product action: task run started or completed, work adjustment applied, preference
  judgment or signal submitted, questionnaire run updated or completed, calendar
  connection synced, or self-observation note written. For Psyche saves, confirm the
  accepted wording and whether it was saved as a first version, update, link, archive,
  or distinct version; do not reopen origin, evidence, repair, or adjacent entity
  mapping after the save unless that next object is already visible and materially
  useful.
- When updating an entity, start with what is changing, what should stay true, and what prompted the update now.
- When enough is clear, briefly summarize what you heard in the user's own language before asking for the last missing structural detail.
- Treat `userId` and human/bot assignees as accountability and scope, not as opening form fields. Ask whose human or bot record it is only when ownership changes visibility, review scope, collaboration, automation behavior, or later filtering; for read requests, ask user scope only when the answer would differ across owners.
- Treat questionnaire runs, self-observations, reflective notes, wiki pages, sleep/workout enrichment, and preference signals as reflection-sensitive records: ask what the record should help the user understand, decide, notice, remember, or change later, then choose the right route. Do not flatten them into forms, but also do not automatically turn them into full Psyche intake unless a belief, mode, trigger report, or behavior pattern clearly emerges.
- The quick intake prompts later in this file are fallback checkpoints, not a script to read aloud.

Forge data location rule:

- never answer from a generic default. First check the actual configured `dataRoot` and, when possible, the live runtime file handle.
- the default local Forge data root is `~/.forge`, so the default database is `~/.forge/forge.sqlite`.
- the user can override that default. Determine the effective storage root from the active adapter config or runtime environment first: OpenClaw `plugins.entries["forge-openclaw-plugin"].config.dataRoot`, Hermes `~/.hermes/forge/config.json.dataRoot`, `FORGE_DATA_ROOT`, or the runtime's reported storage path.
- when `dataRoot` is set, Forge stores `forge.sqlite` directly inside that folder. That explicit setting overrides generic defaults.
- when a Forge server is running locally, verify the actual open database with a process/file-handle check such as `lsof -p <forge-pid> | rg 'forge.sqlite|forge.json'`.
- treat plugin extension folders, package-local `data/`, or adapter-local data folders as only possible candidates until config or live process evidence proves they are active.
- if the user wants to choose the data folder or configure backups from the UI, point them to Forge `Settings -> Data`. That page shows the live data folder, can move current data or adopt an existing Forge data folder, creates manual backups, enables recurring automatic backups, and lets the user choose how many days of automatic backups to keep.
- before changing data roots, restoring, or merging data, create backups of every candidate Forge database plus OpenClaw/Hermes config files. Do not merge side databases unless an ID/content-level audit proves relevant user data is missing from the selected active database.
- if the user asks where Forge data is stored, state both the configured path and the live verified database path, or say that the live path has not yet been verified.

Psyche interview rule:

- For `psyche_value`, `behavior_pattern`, `behavior`, `belief_entry`, `mode_profile`, `mode_guide_session`, `flashcard`, `trigger_report`, `event_type`, and `emotion_definition`, do not jump straight to raw field collection.
- Treat `event_type` and `emotion_definition` as psychologically meaningful Psyche records, not cold taxonomy labels; start from the repeated lived moment or felt signature before wording the reusable label.
- First use the active-listening playbooks in [`psyche_entity_playbooks.md`](./psyche_entity_playbooks.md).
- Ask permission before going deeper, ask one or two focused questions at a time, reflect back what you heard, and summarize before moving on.
- Start from a recent concrete example before naming an abstract pattern, belief, or mode.
- Sound professionally warm and therapist-like: grounded, accurate, reflective, and intentional, not clinical, vague, or lecture-like.
- After the first real answer, choose one follow-up lane at a time: situation, sequence, meaning, protection, cost, longing/value, or tentative name.
- Do not minimize functional analysis, trigger chains, behavior patterns, modes, beliefs, or schema themes. Once at least one concrete example is clear, offer one careful interpretive hypothesis when it would help the user understand the function, protection, cost, belief, mode, or schema theme.
- Phrase interpretive hypotheses as collaborative and testable, not as verdicts. A good hypothesis says what the reaction may be protecting, predicting, relieving, or costing, then asks whether that lands or needs correction.
- For Psyche hypotheses, reduce the formulation burden. After one concrete example, offer one tentative function, danger, protection, payoff, or cost hypothesis and ask one fit-or-correction question. Do not make the user prove the experience, list evidence, or design repair before the wording feels held.
- Use the Psyche hypothesis examples when one concrete episode, belief sentence,
  behavior, or mode voice is visible and another broad question would make the user do
  all the interpretation alone. Offer one testable formulation, ask one correction
  question, and then bridge to the saveable record if it lands.
- Use the hypothesis-versus-reflection gate: reflect when no concrete cue, sequence,
  belief sentence, behavior, body signal, mode voice, payoff, cost, or consequence is
  visible; offer one discussable hypothesis when the cue, meaning, protection, payoff,
  or cost is visible and another broad question would make the user carry the
  interpretation alone. The hypothesis must change saveable wording, the primary
  Psyche container, links, flashcard/support action, or the next question; otherwise
  keep listening.
- Do not keep asking broad exploratory Psyche questions after the cue, meaning, protection, payoff, or cost is already visible. For `behavior_pattern`, `belief_entry`, `mode_profile`, `mode_guide_session`, and `trigger_report`, the next helpful move is usually one active formulation plus one correction question, not another passive reflection.
- Do not leave the user with interpretation alone. Once the hypothesis lands or is
  corrected, name the primary Forge record it becomes and ask one accuracy or consent
  question that moves toward saving the corrected formulation.
- Use the hypothesis timing checkpoint before asking a second or third deepening question: offer a hypothesis when one concrete episode, body cue, belief sentence, behavior, or mode voice is visible and the hypothesis would change the record shape, wording, links, or next action. Do not hypothesize yet when no concrete moment is visible, the user only wants a direct mechanical save, the user is flooded or unsafe, or the only available interpretation would be diagnosis-like, an origin story, or a certainty claim.
- If several Psyche containers are plausible, do not ask the user to choose from a taxonomy menu first. Reflect the lived difference, offer one careful hypothesis when a concrete example is visible, then distinguish the options in plain language: one episode as a `trigger_report`, a recurring loop as a `behavior_pattern`, one repeated move as `behavior`, one sentence as `belief_entry`, a part-state as `mode_profile` or `mode_guide_session`, or reusable future-labeling as `event_type` or `emotion_definition`.
- For Psyche updates, start with what feels newly true, newly visible, or newly inaccurate, then ask what should stay true before changing the formulation.
- If a fresh episode is what made a Psyche update visible, anchor in that episode before renaming the durable belief, pattern, mode, or value.
- If the user says they want help understanding a Psyche issue before saving it, ask one orienting question first instead of jumping straight into a full interpretation, diagnosis-like label, save suggestion, replacement belief, or suggested title.
- In that first exploratory turn, keep the reflection to one or two short sentences, avoid numbered lists or schema dumps, and wait for the user's answer before offering a fuller formulation.
- In that first exploratory turn, stay in plain prose, end with one question, and do not mention Forge fields or save formatting yet unless the user interrupts to save immediately.
- In that first exploratory turn, keep the whole reply short, usually under 90 words, and anchor it in one concrete-example question rather than a conceptual lecture.
- In that first exploratory turn, ask only one question, do not search Forge or mention whether a matching entity exists, and avoid openings like "This sounds like" or "What you're describing is".
- In that first exploratory turn, prefer exactly two sentences: one brief empathic reflection and one concrete question. Avoid colons because they tend to trigger list-like answers.
- Follow the preferred opening-question patterns in [`psyche_entity_playbooks.md`](./psyche_entity_playbooks.md) when they fit the entity the user is exploring.
- After a Psyche formulation lands, use the Psyche save-readiness checkpoint from
  the playbook. If the belief sentence, functional loop, behavior move, part-state,
  trigger episode, value, event type, emotion definition, or flashcard cue/message is
  true enough to save, ask at most one accuracy question and then use shared batch
  CRUD.
- If the user already offers a usable belief sentence, value phrase, or mode name,
  refine from their wording first instead of replacing it with a cleaner label too
  early.
- If the user already offers a usable belief sentence, functional loop, part voice,
  trigger episode, value phrase, event kind, emotion signature, or flashcard message,
  treat it as real data and ask one accuracy or consent question instead of reopening
  origin, evidence, or repair.
- For direct Psyche saves, do not reopen origin, evidence, or repair when the user
  already supplied usable wording and asked to save it. Reflect the wording, ask one
  accuracy or consent question, and save when accepted.
- When the conversation reveals an adjacent entity such as a linked belief, mode, value, pattern, or note, name that gently and ask whether the user wants to map it too.
- If nuance matters, preserve it in a linked Markdown `note` instead of forcing every detail into normalized fields.
- If the user shows imminent risk of self-harm, suicide, violence, inability to stay safe, or severe disorientation, stop normal intake and prioritize urgent human support or emergency help instead.

Self-observation rule:

- Do not use `self_observation` as the default bucket for Psyche material.
- A self-observation is a lightweight observed episode, written as a note-backed
  calendar observation with `frontmatter.observedAt`.
- When the user describes an episode, help map the chain:
  situation -> cue -> emotion/body -> thought/meaning -> behavior/urge ->
  consequence.
- If the chain is one emotionally meaningful episode, prefer `trigger_report`.
- If it is a recurring loop, prefer `behavior_pattern` and do a functional analysis.
- If the core is one repeated action, prefer `behavior`.
- If the core is a sentence the user believes, prefer `belief_entry`.
- If a part-state, protector, critic, child state, or healthy-adult stance is active,
  prefer `mode_guide_session` or `mode_profile`.
- If the user needs a brief rehearsable message during an urge, trigger, belief
  activation, mode shift, or relapse-prevention moment, prefer `flashcard`.
- If a schema theme is visible, do not bury it in self-observation: preserve it as
  the belief, recurring pattern, active mode, guided mode session, trigger report, or
  wiki explanation that best matches the material.
- If the user wants durable memory about a book, article, concept, source, or personal
  manual, prefer `wiki_page`.

Use these exact entity meanings when deciding what the user is describing.

`goal` is a meaningful long-horizon direction or outcome. Use it for “be a great father”, “create meaningfully”, or “build a beautiful family”, not for one-off action items.

`project` is a bounded workstream under a goal. Use it for “launch Forge plugin”, “plan summer move”, or “repair relationship with X”. Project lifecycle is status-driven: `active` means in play, `paused` means suspended, and `completed` means finished. Setting a project to `completed` auto-completes linked unfinished tasks through Forge's normal task-completion path.

`task` is a concrete action item or deliverable. Use it for “draft the plugin README”, “call the landlord”, or “book therapy session”.

`task_run` is one truthful live work session on a task. It is not the same thing as task status.

`note` is a first-class Markdown entity that can link to one or many other entities. Use it for work summaries, context, progress logs, handoff explanations, wiki-style reference pages, or reflective detail that should stay searchable and attached to the right records. Notes also support note-owned `tags` for memory-system labels such as `Working memory`, `Short-term memory`, `Episodic memory`, `Semantic memory`, and `Procedural memory`, plus custom tags. Notes may be durable or ephemeral: if `destroyAt` is set, Forge will delete the note automatically after that time.

`sleep_session` is a first-class health record for one night. It can hold recovery metrics, stage breakdown, annotations, and links back to goals, projects, tasks, habits, notes, and Psyche records.

`workout_session` is a first-class sports record. It can come from HealthKit import or from a completed habit, and it can carry subjective effort, mood, meaning, tags, and links back into Forge.

`insight` is an agent-authored observation, recommendation, or warning grounded in Forge data. It does not replace a requested goal, project, task, pattern, belief, or trigger report.

`calendar_event` is a canonical Forge event record. It lives in Forge first and can later project to a writable provider calendar.

`work_block_template` is one compact recurring local-time availability rule, not a stored event per occurrence. Direct capture requires only a title, weekdays, and distinct start/end minutes; resolve human clock times yourself, preserve overnight meaning when end is earlier than start, and treat kind, color, date bounds, exclusions, activity settings, and owner as conditional. Read the exact template before review, update, or confirmed immediate non-restorable deletion.

`task_timebox` is a planned or live calendar slot attached to one exact task. It is scheduling structure, not proof that work started or finished. Direct capture requires only the task, a task-shaped title, and a valid offset-bearing interval; recommendations are read-only, and exact-record update or delete must preserve immutable task/source linkage and provider-cleanup truth.

`psyche_value` is a direction the user wants to live toward, such as honesty, courage, steadiness, compassion, or creativity.

`behavior_pattern` is a recurring loop across situations. Think in terms of cue, emotion, thought, action, short-term payoff, long-term cost, and preferred replacement response.

`behavior` is one recurring action tendency or move, such as withdrawing, appeasing, attacking, numbing out, or taking a regulating walk.

`belief_entry` is one explicit belief sentence the user carries, such as “If I disappoint people, they will leave me.”

`mode_profile` is one recurring state, voice, or inner role, such as inner critic, abandoned child, detached protector, overcontroller, or healthy adult.

`mode_guide_session` is a guided exploration record used to understand what mode may be active right now. It is a structured worksheet, not the final durable profile unless the user wants it that way.

`flashcard` is a small therapeutic reminder card. Use it when the user wants a sentence or short message that can be shown back during an urge, trigger, mode activation, belief activation, or values-based pivot. The message is the main content; title is optional and compact. Tags, trigger sentence, trigger situation, and Psyche links matter most for retrieval. Styling fields such as colors, typography, layout, visual tone, and image make the card easier to recognize but should come after the therapeutic sentence is clear.

When a user says something like "I feel the urge to drink" or "help me not do this", search existing `flashcard` records first with `forge_search_entities` using `entityTypes: ["flashcard"]` and the user's urge, trigger words, tags, and situation language. If a matching card exists, show the flashcard message first, then add brief psychotherapy-informed support around it: grounding, urge surfing, cognitive defusion, schema/mode-aware reflection, or a values pivot. If no card fits and the user wants one, create only after the cue or urge sentence and the short message are clear; postpone visual style, colors, tags, and optional links until the intervention sentence works.

`trigger_report` is one specific emotionally meaningful episode described as what happened, what was felt, what was thought, what was done, what happened next, and what would help next time.

`event_type` is a reusable category for trigger reports, such as rejection, criticism, conflict, uncertainty, or abandonment cue.

`emotion_definition` is a reusable emotion entry, such as fear, shame, anger, grief, relief, or disgust.

Minimum-field checkpoint, not a question script: use this only after the
conversation has enough shape to save or update something. Do not ask every listed
item. Choose the single missing lane that affects the write, and stop when the
record is clear enough to persist.

`goal`
Use for a meaningful direction over time.
Minimum field: `title`
Usually useful: `description`, `horizon`, `status`
Only ask if missing or unclear:

1. What should this goal be called?
2. Why does it matter to you?
3. Is this a quarter, year, or lifetime horizon?

`project`
Use for a bounded workstream under a goal.
Minimum field: `title`
Usually useful: `goalId`, `description`, `productRequirementsDocument`,
`status`, `workflowStatus`, `userId`, `assigneeUserIds`, `schedulingRules`
Only ask if missing or unclear:

1. What should this project be called?
2. Which goal does it support?
3. What outcome should it produce?

`task`
Use for one concrete work item; the same stored family carries `issue`, `task`, and
`subtask` levels.
Minimum field: `title`
Usually useful: `level`, `projectId`, `parentWorkItemId`, `aiInstructions`,
`executionMode`, `acceptanceCriteria`, `priority`, `dueDate`, `status`, `userId`,
`assigneeUserIds`
Only ask if missing or unclear:

1. What is the task in one concrete sentence?
2. Is this an issue, one-session task, or subtask?
3. Should it live under a project, issue, parent task, or intentional inbox?
4. Does it need agent instructions, acceptance criteria, a due date, priority, owner, or assignees?

`habit`
Use for a recurring commitment or recurring slip with explicit cadence and XP consequences.
Minimum field: `title`
Usually useful: `polarity`, `frequency`
CRITICAL NEGATIVE-HABIT CHECK-IN RULE:

- For a `negative` habit, the correct check-in outcome is `missed`.
- On a `negative` habit, `missed` means the habit was resisted, the user stayed aligned, and the habit earns its XP bonus.
- Do not treat `missed` on a `negative` habit as failure. In this case, `missed` is the successful outcome.
- In OpenClaw, official habit outcome logging should go through `forge_update_entities` on `entityType: "habit"` with `patch: { checkIn: { status, dateKey?, note?, description? } }`.
- Do not bypass the shared tool model with raw habit routes when the batch entity update already covers the write cleanly.
  Only ask if missing or unclear:

1. What is the recurring behavior in one concrete sentence?
2. Is doing it good (`positive`) or a slip (`negative`)?
3. What cadence should it follow?

`task_run`
Use for live work happening now.
Required fields to start: `taskId`, `actor`
Ask only what is needed to start the run, such as the task, the actor, and whether the run is planned or unlimited.

`psyche_value`
Use for a value or committed direction.
Minimum field: `title`
Usually useful: `description`, `valuedDirection`, `whyItMatters`, links to goals, projects, or tasks
Only ask if missing or unclear:

1. What feels deeply important here, and what would you call that value or direction?
2. If you were living it a little more this week, what would someone actually see?
3. Why does it matter now, and what one action would move toward it?

`behavior_pattern`
Use for a recurring loop across situations.
Minimum field: `title`
Usually useful: `description`, `targetBehavior`, `cueContexts`, `shortTermPayoff`, `longTermCost`, `preferredResponse`
Only ask if missing or unclear:

1. Can we slow this down using one recent example first?
2. What usually sets the loop off, and what tends to happen in thoughts, feelings, body, and actions next?
3. What does it do for you immediately, what does it cost later, and what belief, mode, or value seems bound up in it?

`behavior`
Use for one recurring move or action tendency.
Minimum fields: `kind`, `title`
Usually useful: `commonCues`, `urgeStory`, `shortTermPayoff`, `longTermCost`, `replacementMove`, `repairPlan`
Only ask if missing or unclear:

1. What does this behavior actually look like in plain language?
2. What cues or urges usually pull you toward it, and what does it do for you in the moment?
3. Is it an `away`, `committed`, or `recovery` behavior, and what move would you want available instead?

`belief_entry`
Use for one explicit belief sentence.
Minimum fields: `statement`, `beliefType`
Usually useful: `confidence`, `evidenceFor`, `evidenceAgainst`, `flexibleAlternative`, `originNote`
Only ask if missing or unclear:

1. If we turn that reaction into one sentence, what does the belief sound like in your own words?
2. Is it `absolute` or `conditional`, and how true does it feel from 0 to 100?
3. What seems to support it, what weakens it, where did you learn it, and what would be a more flexible alternative?

`mode_profile`
Use for a recurring part-state or inner role.
Minimum fields: `family`, `title`
Usually useful: `fear`, `burden`, `protectiveJob`, `originContext`, links to patterns, behaviors, and values
Only ask if missing or unclear:

1. When this part shows up, what is it like from the inside and what should it be called?
2. What kind of mode is this: `coping`, `child`, `critic_parent`, `healthy_adult`, or `happy_child`?
3. What does it fear, carry, or try to protect, and when did you first need it?

`mode_guide_session`
Use for guided exploration before or alongside a durable mode profile.
Minimum fields: `summary`, `answers`
Only ask if missing or unclear:

1. What just happened that brought this part online right now?
2. If it had a voice, what would it say, fear, or need?
3. Would it help if we suggested one or two candidate mode labels, with reasons, before deciding whether to store a durable profile?

`flashcard`
Use for a small therapeutic card to retrieve during an urge, trigger, mode activation, belief activation, or values-based pivot.
Minimum field: `message`
Usually useful: `triggerSentence`, `triggerSituation`, `tags`, optional compact `title`, visual styling, optional `imageUrl`, links to values, behaviors, patterns, beliefs, modes, or reports
Only ask if missing or unclear:

1. What exact urge sentence, trigger, or situation should bring this card up?
2. What one simple message should be centered on the card when that moment hits?
3. What tags or trigger wording will help us find it later, and only then what visual tone, colors, typography, or image should it use?

`trigger_report`
Use for one specific emotionally important episode.
Minimum field: `title`
Usually useful: `eventSituation`, `occurredAt`, `memoryClarity`, `bodyCues`, `emotions`, `thoughts`, `behaviors`, `consequences`, `reflection`, `nextMoves`, and links to values, beliefs, patterns, modes, goals, projects, or tasks. `hypothesis`, `hypothesisFit`, and `hypothesisCorrection` are optional and require explicit `interpretationConsent: true`.

Leave `memoryClarity` as `unspecified` when the user has not rated it. Use `clear`, `partial`, or `uncertain` only when the user has described the memory that way.
Only ask if missing or unclear:

1. What part of the moment needs attention first: immediate support, a partial draft, a retrospective map, or one correction to an existing report?
2. What happened, as concretely as you can say it, and how clear or incomplete is the memory?
3. What body cues and emotions appeared, what meaning arrived, what did you do or feel pulled to do, and what happened next?

Do not guess missing chain segments. Save a sparse `draft` when the user wants to pause. Offer at most one tentative, episode-bound hypothesis after enough of the chain is visible, ask whether it fits or needs correction, and store it only with explicit interpretation consent. Read the current report before updating and pass its `expectedRevision` so a stale edit cannot overwrite a newer one.

`event_type`
Use for a reusable trigger category.
Minimum field: `label`
Usually useful: `description`
Only ask if missing or unclear:

1. What kind of repeated moment or incident do you want future reports to name the same way?
2. What would count as inside this category, and what should stay outside it?
3. If the meaning is clear but the wording is not, would you like me to suggest a concise label?

`emotion_definition`
Use for a reusable emotion vocabulary entry.
Minimum field: `label`
Usually useful: `description`, `category`
Only ask if missing or unclear:

1. When this feeling is present, what tells you it is this feeling and not a nearby one?
2. What would you want a later trigger report to mean when it uses this label?
3. If the felt meaning is clear but the wording is not, would you like me to suggest a concise label or broader category?

Use these rules when choosing tools.

Read first with `forge_get_operator_overview`, `forge_get_operator_context`, or `forge_get_current_work` unless the user is clearly asking for one exact known record or one exact write.

When the user asks what to do next, call `forge_get_today_priority`. Follow its
explicit ready, continue-active, unresolved-active, overloaded,
capacity-limited, or no-work state instead of choosing the first focus, backlog,
or blocked task. Its schedule evidence covers task timeboxes. Read
`forge_get_calendar_overview` separately when meetings or other calendar events
matter.

Before creating or updating an ambiguous stored entity, use `forge_search_entities` to check for duplicates. If a likely match appears, ask whether the user wants to update that record, link to it, or save a separate new record; do not reopen the whole create flow.

Use the batch entity tools for stored records:
`forge_search_entities`, `forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, `forge_restore_entities`

These tools operate on:
`goal`, `project`, `strategy`, `task`, `habit`, `tag`, `note`, `insight`, `calendar_event`, `work_block_template`, `task_timebox`, `psyche_value`, `behavior_pattern`, `behavior`, `belief_entry`, `mode_profile`, `mode_guide_session`, `flashcard`, `trigger_report`, `event_type`, `emotion_definition`, `preference_catalog`, `preference_catalog_item`, `preference_context`, `preference_item`, `questionnaire_instrument`, `sleep_session`, `workout_session`

Use the wiki tools for SQLite-backed memory work:
`forge_call_wiki_route`, `forge_get_wiki_settings`, `forge_list_wiki_pages`, `forge_get_wiki_page`, `forge_search_wiki`, `forge_upsert_wiki_page`, `forge_get_wiki_health`, `forge_sync_wiki_vault`, `forge_reindex_wiki_embeddings`, `forge_ingest_wiki_source`

Use the health tools for review, reflective enrichment, and nutrition evidence capture:
`forge_get_sleep_overview`, `forge_get_sports_overview`, `forge_get_training_load_overview`, `forge_get_weight_loss_overview`, `forge_update_sleep_session`, `forge_update_workout_session`, `forge_search_foods`, `forge_search_nutrition_foods`, `forge_lookup_nutrition_barcode`, `forge_log_food`, `forge_update_food_log`, `forge_parse_food_log_with_chatgpt`, `forge_log_body_checkin`, `forge_log_appearance_checkin`, `forge_log_subjective_food_effect`, `forge_log_gut_checkin`, `forge_get_nutrition_patterns`, `forge_start_nutrition_experiment`, `forge_update_nutrition_experiment`

Use the dedicated domain routes for specialized surfaces that are not simple batch entities:

OpenClaw and Hermes expose route-key tools for these surfaces when available:
`forge_call_movement_route`, `forge_call_life_event_route`, `forge_call_life_force_route`, and
`forge_call_workbench_route`, plus `forge_call_course_route`. Choose the route key from live onboarding or the tool
schema after the user's job is clear. Do not send Movement, Life Events, Life Force, or Workbench
through `forge_create_entities` or `forge_update_entities`.

- Movement lives under `/api/v1/movement/*`. Treat it as a dedicated timeline of `stays` and `trips`, not as generic batch CRUD. A `stay` means the user remained in the same place for a span of time. A `trip` means the user traveled between places. Use the movement routes when the user wants to understand time in place, travel behavior, specific stays or trips, known places, or selected-span aggregates such as "how long was I at home in the past 2 weeks?" or "when did I travel last month?".
- In the live onboarding catalog, Movement, Life Events, Life Force, and Workbench should appear as `specialized_domain_surface`. If the classification and route family disagree, trust the specialized route family and fix the contract mismatch instead of inventing a batch CRUD path.
- Movement user actions are: query movement behavior, add a place or manual stay/trip overlay, update an existing stay/trip/place, or link a specific movement item to another Forge entity. Keep the explanation user-facing: where they stayed, when they traveled, what changed, and what this movement should be linked to.
- For movement review, choose the route that matches the user's question:
  `/api/v1/movement/day`, `/api/v1/movement/month`, `/api/v1/movement/all-time`,
  `/api/v1/movement/timeline`, `/api/v1/movement/places`,
  `/api/v1/movement/selection`, and `/api/v1/movement/trips/:id`.
- Use `GET /api/v1/movement/settings` and `PATCH /api/v1/movement/settings` when
  the user wants to inspect or change passive capture, publish mode, retention mode,
  or companion readiness. Do not treat movement settings as a place, stay, trip, or
  batch entity write.
- When the user is filling a missing-data gap, the default write path is a user-defined overlay box, not a raw stay or trip patch. Use `POST /api/v1/movement/user-boxes/preflight` if you need to confirm overlap or snap to the nearest missing interval, then `POST /api/v1/movement/user-boxes` with `kind: "stay"` or `kind: "trip"`.
- When the user is repairing already-saved movement data, use the repair routes that match the saved object:
  `PATCH /api/v1/movement/user-boxes/:id`,
  `POST /api/v1/movement/automatic-boxes/:id/invalidate`,
  `PATCH /api/v1/movement/stays/:id`,
  `PATCH /api/v1/movement/trips/:id`, or
  `PATCH /api/v1/movement/trips/:id/points/:pointId`.
- Use `PATCH /api/v1/movement/stays/:id` or `PATCH /api/v1/movement/trips/:id` only when the user is editing an existing recorded stay or recorded trip. Do not use those routes to fill a missing span.
- If the user says something as explicit as "that missing block was me staying home", do not reopen broad intake. Confirm the interval or place only if it is still ambiguous, then create the overlay and read the timeline back.
- Life Events store important chronological events or periods as normal `life_event` records. They can last hours, days, weeks, or months, including stays, festivals, visits, retreats, vacations, work phases, health episodes, and custom periods. Use shared batch CRUD for create, update, search, soft delete, restore, and generic entity links. Use `/api/v1/life-events/timeline` for the chronology view, `/api/v1/life-events/:id` for one event, `/api/v1/life-events/:id/calendar-sync` when an event should find or create its matching calendar event, `/api/v1/life-events/from-calendar-event` when the user marks an existing calendar event as a Life Event, `/api/v1/life-events/import-ticket` when a trusted Artifact Store ticket should draft a travel event, and `/api/v1/life-events/:id/travel-status` for scheduled or provider-backed travel status. Ticket import starts from an `artifactId`, must keep artifact relationships as generic `entity_links`, and must not execute or autonomously open stored file bytes.
- Life Force lives under `/api/v1/life-force*`. Use `GET /api/v1/life-force` for the current energy overview, `PATCH /api/v1/life-force/profile` for durable profile changes, `PUT /api/v1/life-force/templates/:weekday` for weekday curve edits, and `POST /api/v1/life-force/fatigue-signals` for real-time tired or recovered signals.
- Workbench lives under `/api/v1/workbench/*`. Use those dedicated routes for flow catalog reads, flow CRUD, runs, saved-flow chat follow-ups, published outputs, node results, and latest-node-output reads instead of trying to force Workbench through the batch entity routes.
- Course and Concept live under `/api/v1/courses*` and `/api/v1/concepts*`. Use `forge_call_course_route` for the exact `listCourses`, `courseDetail`, `learningSession`, `voiceLearningSession`, `submitAttempt`, `upgradeEnrollment`, `importCourse`, `exportCourse`, `listConcepts`, and `conceptDetail` lanes. Use learner-safe visual or voice sessions for coaching, read exact release state and obtain explicit learner acceptance before an enrollment upgrade, never expose hidden assessment fields, and never force Course or Concept through batch CRUD.
- If you need the OpenClaw HTTP mirror instead of the raw Forge runtime path, the
  same specialized families are exposed under `/forge/v1/movement/*`,
  `/forge/v1/life-events/*`, `/forge/v1/life-force/*`, `/forge/v1/workbench/*`,
  `/forge/v1/courses/*`, and `/forge/v1/concepts/*`.
- Workbench lane hints:
  use `GET /api/v1/workbench/flows` for compact bounded flow catalog pages with
  `q`, repeated `kind`, `homeSurfaceId`, and `status`, plus `limit` and `offset`;
  use `GET /api/v1/workbench/catalog/boxes` for bounded box pages with `q`,
  repeated `category`, `surfaceId`, and `source`; follow `hasMore` by adding the
  returned item count to `offset`, and use `status=enabled` or `status=disabled`
  because Workbench has no archive lifecycle;
  `POST /api/v1/workbench/flows` for flow creation,
  `PATCH /api/v1/workbench/flows/:id` and `DELETE /api/v1/workbench/flows/:id` for saved-flow edits or deletion,
  `/api/v1/workbench/flows/:id/run` or `/api/v1/workbench/run` for execution,
  `POST /api/v1/workbench/flows/:id/chat` for saved-flow chat follow-ups,
  `/api/v1/workbench/flows/:id/output` for published outputs, and the run/node routes
  under `/api/v1/workbench/flows/:id` for run history and node-level inspection.
- For Workbench flow creation or edits, clarify the stable input contract, intended
  published output, and smallest structural change before asking for raw JSON or node
  payloads. For deletion, confirm the saved flow and whether published outputs or run
  history need preservation elsewhere before using the delete route.
- For Workbench flow chat follow-ups, use `POST /api/v1/workbench/flows/:id/chat`
  only when the user wants flow-specific conversation. Do not turn that follow-up
  into a new run, note, or generic entity update unless the user asks for that.
- If you are unsure which specialized route family applies, check `forge_get_agent_onboarding` and use its `entityRouteModel.specializedDomainSurfaces` section before guessing.
- If the truth of the current Movement, Life Events, Life Force, or Workbench state is still unclear, prefer the dedicated read before the mutation so the correction stays truthful.
- After a concrete Movement, Life Events, Life Force, or Workbench correction, mutation, or result-producing run, read the relevant specialized view back when the user is trying to understand the result rather than only store it: timeline or place/settings detail for Movement, event detail or timeline for Life Events, the Life Force overview for energy-planning impact, and flow detail, run detail, node result, latest node output, published output, or run history for Workbench.
- After any dedicated Movement, Life Events, Life Force, or Workbench read, translate the result
  into one next action: no change, Movement overlay/place/settings/link, Life Event link/calendar/ticket/status/update, Life Force
  workload/recovery/timebox/meeting/task-choice change, or Workbench
  rerun/node-inspection/flow-edit/publish/preserve/stop. Ask only for the missing
  span, place, event, artifact, weekday, flow, run, node, output, correction, preservation choice, or
  confirmation that would change that action.

Use live work tools for `task_run`:
`forge_log_work`, `forge_start_task_run`, `forge_heartbeat_task_run`, `forge_focus_task_run`, `forge_complete_task_run`, `forge_release_task_run`

Use `forge_adjust_work_minutes` for `work_adjustment` when the user wants a truthful signed minute correction on an existing task or project rather than a fake live run or a retroactive new task.

Use the dedicated Preferences action tools for `preference_judgment` and `preference_signal`:
`forge_submit_preferences_judgment`, `forge_submit_preferences_signal`, `forge_update_preferences_score`

Use `forge_post_insight` for `insight`.
Use the calendar tools for provider sync and planning:
`forge_get_calendar_overview`, `forge_connect_calendar_provider`, `forge_sync_calendar_connection`, `forge_create_work_block_template`, `forge_recommend_task_timeboxes`, `forge_create_task_timebox`

Do not say you lack a creation path when these tools cover the request. Do not open the Forge UI or a browser for normal creation or updates that the tools already support. Use `forge_get_ui_entrypoint` only when visual review, Kanban movement, graph exploration, or complex multi-record editing would genuinely be easier there.

Use these exact payload expectations.

`forge_search_entities` expects a top-level `searches` array.

`forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, and `forge_restore_entities` expect a top-level `operations` array.

For create operations, each item must include `entityType` and `data`.

For `event_type` and `emotion_definition`, put the intended owner scope in each
`forge_search_entities.searches[].userIds` array. Put one stable
`operations[].idempotencyKey` on each intended create and reuse it only for an exact
retry of the same owner, entity type, and payload. Changed payload reuse conflicts; a
soft-deleted target must be restored, and hard deletion leaves the key terminal rather
than allowing recreation.

When Psyche authentication is enabled, dedicated event-type and emotion-definition
routes require `psyche.read` or `psyche.write`. Agent use through shared batch routes
also requires base `read` or `write` for search, or base `write` for mutations, plus
the corresponding Psyche scope.

Calendar entity CRUD uses these same batch tools:

- create a native event with `forge_create_entities` and `entityType: "calendar_event"`
- update or move an event with `forge_update_entities` and `entityType: "calendar_event"`
- delete an event with `forge_delete_entities` and `entityType: "calendar_event"`
- create, update, or delete recurring work blocks with `entityType: "work_block_template"`
- create, update, change status, or delete planned task slots with `entityType: "task_timebox"`

Forge still runs the downstream calendar behavior after these generic mutations. For `calendar_event`, that includes provider projection sync on create or update and remote projection deletion on delete. Work-block deletion removes future derived instances immediately. Provider-backed timebox deletion hides the slot immediately and keeps durable idempotent remote cleanup pending until acknowledged.
Calendar date/time rule: when the user gives a local time such as “1pm”, interpret it in the user's timezone, not UTC. Set the payload `timezone` to the user's real timezone and serialize `startAt`, `endAt`, `startsAt`, and `endsAt` so they represent that local wall-clock time correctly. Do not silently treat unspecified local times as `UTC+0`.
Calendar sync default: unless the user explicitly asks for Forge-only storage, do not set `preferredCalendarId` to `null`. Omit `preferredCalendarId` on event creation so Forge can use the default writable connected calendar automatically. Use `preferredCalendarId: null` only when the user clearly wants the event to stay Forge-only.

When creating `goal`, `project`, or `task`, the create payload may also include `notes: [{ contentMarkdown, author?, tags?, destroyAt?, links? }]`. Forge will create real linked `note` entities automatically and attach them to the new parent record.

To create a standalone note directly, use `forge_create_entities` with `entityType: "note"` and `data: { contentMarkdown, author?, tags?, destroyAt?, links }`. `links` should point at one or more real Forge entities so the note remains connected and searchable across the graph. Use `tags` for built-in memory-system labels or custom note labels. Use `destroyAt` only when the note should be ephemeral scratch memory that self-destructs later.

For update operations, each item must include `entityType`, `id`, and `patch`.

For project lifecycle changes, prefer generic updates:

- suspend a project with `forge_update_entities` and `patch: { status: "paused" }`
- finish a project with `forge_update_entities` and `patch: { status: "completed" }`
- restart a project with `forge_update_entities` and `patch: { status: "active" }`
- set project calendar defaults with `forge_update_entities` and `patch: { schedulingRules: ... }`
- set task-specific scheduling with `forge_update_entities` and `patch: { schedulingRules: ..., plannedDurationSeconds: ... }`

For delete operations, each item must include `entityType` and `id`. Delete is soft by default unless the user explicitly wants hard delete.

For project deletion and recovery, prefer the generic delete and restore tools:

- soft delete with `forge_delete_entities`
- hard delete only when the user is explicitly asking for permanent removal, using `mode: "hard"`
- restore with `forge_restore_entities`

For restore operations, each item must include `entityType` and `id`.

Batch tools do not create or control `task_run`.

Use the exact route-facing field names. Do not invent friendlier aliases. If a field name is unclear, use `forge_get_agent_onboarding` as the schema source of truth.

Use these live work rules.

A `task_run` is the truthful way to represent live work. Do not pretend that changing task status is the same as starting or stopping a work session.

Use `forge_start_task_run` to begin live work. Required fields: `taskId`, `actor`. If `timerMode` is `planned`, include `plannedDurationSeconds`. If `timerMode` is `unlimited`, omit `plannedDurationSeconds` or set it to null. If calendar rules currently block the task and the user still wants to proceed, include `overrideReason`.

Use `forge_heartbeat_task_run` to keep an active run alive.

Use `forge_focus_task_run` when one active run should become the current visible run.

Use `forge_complete_task_run` to finish live work. Send `completionReport` and
canonical `gitRefs` when the evidence is known. Include `closeoutNote` when the
work summary should become a real linked `note`; it supports the same note fields
as normal note creation, including `tags` and `destroyAt`. An exact terminal replay
is idempotent, while changed closeout evidence conflicts. Read the task back and
inspect `closeoutState`, `completionReport`, and `gitRefs`; quick or native
completion may correctly report `closeoutState: deferred` until evidence is added.

Use `forge_release_task_run` to stop live work without completing the task. Release
accepts only `actor`, `note`, and `closeoutNote`; it never accepts
`completionReport` or `gitRefs`. `closeoutNote` is available for handoff or pause
context, including note tags or an ephemeral destroy time when that handoff note
should self-delete later.

Use `forge_log_work` only for retroactive work that already happened. If the user explains the work in a way that should be preserved, include `closeoutNote`.

Use the calendar tools when the request is about planning or availability rather than entity storage:

- `forge_get_calendar_overview` to inspect mirrored events, work blocks, provider connections, and existing timeboxes
- `forge_call_calendar_connection_route` for the full connection lifecycle: list,
  provider discovery, macOS-local discovery, rediscovery, create, selected-calendar
  update, sync, and delete
- `forge_connect_calendar_provider` only when the operator explicitly wants a new Google, Apple, Exchange Online, or custom CalDAV connection and the discovery choices are already known
- `forge_sync_calendar_connection` after a provider connection is created or when the calendar needs a fresh pull/push cycle
- `forge_create_work_block_template` as a convenience helper for Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or Custom recurring blocks
- `forge_recommend_task_timeboxes` to find future slots that satisfy current rules when the user wants suggestions or when the agent needs help narrowing options
- `forge_create_task_timebox` as an optional create convenience once the slot is known; ordinary Task Timebox storage remains batch-first

Timebox planning rules for agents:

- prefer manual timeboxing when the agent already has enough calendar context to choose the slot itself
- use `forge_get_calendar_overview` first when the current day or week matters; reason over mirrored events, work blocks, existing timeboxes, and availability before placing the block
- use shared batch create by default for the manual path with explicit `startsAt` and `endsAt`; the named create helper is equivalent when it is simpler
- use `forge_recommend_task_timeboxes` only for the assisted path, then confirm one returned slot with `forge_create_task_timebox`
- keep recommendations read-only, request no more than 12 slots, and pass the optional IANA `timezone` only when it changes fallback wall-time windows
- when manually timeboxing, keep the title specific and task-shaped, not generic
- direct create requires `taskId`, `title`, `startsAt`, and `endsAt`; it also accepts `status`, `overrideReason`, `activityPresetKey`, `customSustainRateApPerHour`, and `userId`
- `activityPresetKey` must be one of `deep_work`, `admin`, `maintenance`, `meeting`, `recovery_break`, `holiday_leisure`, `light_context`, or `task_inherited`
- use `overrideReason` for an intentional rule or calendar conflict, not as a generic note field
- deleting a provider-backed timebox hides it from normal reads immediately and leaves durable provider cleanup pending until the remote delete is acknowledged; retries are safe
- use shared batch CRUD for ordinary timebox and work-block lifecycle work; the named create helpers are conveniences, not invented update or delete surfaces

Use the health tools when the request is about sleep or sports review:

- `forge_get_sleep_overview` to inspect recent nights, averages, regularity, stage breakdown, and linked reflective context
- `forge_get_sports_overview` to inspect training volume, workout types, effort trends, habit-generated sessions, and linked context
- `forge_get_training_load_overview` to inspect cardiovascular load, HR zone balance, zone-time buckets, smart training modes, acute/chronic stress, high-intensity pressure, VO2max context, next-workout guidance, and training target fit
- `forge_get_weight_loss_overview` to inspect calorie balance, protein/fiber targets, body trend, food quality, training fuel, subjective energy, gut comfort, aesthetic look, hypotheses, and experiments
- `forge_parse_food_log_with_chatgpt` to convert rough meal text or a photo description into a candidate food log through the configured `openai-codex` ChatGPT subscription connection
- `forge_log_food`, `forge_update_food_log`, `forge_log_body_checkin`, `forge_log_appearance_checkin`, `forge_log_subjective_food_effect`, and `forge_log_gut_checkin` to preserve the user's food, body-composition, visual-look, energy/craving/performance, and gut-health evidence. For `forge_log_food`, search first and reuse `item.foodId`; custom/no-`foodId` items require calories plus protein, carbohydrate, and fat, researched before logging when the user does not provide them. For `forge_update_food_log`, read the overview first, identify the exact `foodLogId`, and patch only the accepted difference.
- `forge_get_nutrition_patterns`, `forge_start_nutrition_experiment`, and `forge_update_nutrition_experiment` to turn repeated food/body observations into testable N-of-1 hypotheses
- `forge_update_sleep_session` to add sleep-quality notes, tags, or links back to Forge entities after review
- `forge_update_workout_session` to add subjective effort, mood, meaning, tags, or links on one workout after review
- remember that the UI route is `/sports` while the backend overview route is `/api/v1/health/fitness`; the dedicated training-load UI is `/training-load` and its backend route is `/api/v1/health/training-load`, including zone-time reporting and Combat/Base/Endurance smart modes

Use these exact health batch payload shapes when the user is creating or editing the stored records themselves:

- create a manual sleep session:
  `{"operations":[{"entityType":"sleep_session","data":{"startedAt":"2026-04-10T22:45:00.000Z","endedAt":"2026-04-11T06:45:00.000Z","qualitySummary":"Slept cleanly after a light evening.","links":[{"entityType":"habit","entityId":"habit_sleep_hygiene","relationshipType":"supports"}]}}]}`
- update a sleep session through batch CRUD:
  `{"operations":[{"entityType":"sleep_session","id":"sleep_123","patch":{"notes":"Woke once around 03:00 but settled quickly.","tags":["travel","recovered"]}}]}`
- create a manual workout session:
  `{"operations":[{"entityType":"workout_session","data":{"workoutType":"walk","startedAt":"2026-04-11T10:00:00.000Z","endedAt":"2026-04-11T10:45:00.000Z","subjectiveEffort":6,"meaningText":"Reset after a long planning block.","links":[{"entityType":"task","entityId":"task_123","relationshipType":"supports"}]}}]}`
- update a workout session through batch CRUD:
  `{"operations":[{"entityType":"workout_session","id":"workout_123","patch":{"moodAfter":"clear","tags":["zone2"]}}]}`

Work-block payload guidance:

- `kind` must be one of `main_activity`, `secondary_activity`, `third_activity`, `rest`, `holiday`, or `custom`
- `weekDays` uses Sunday=`0` through Saturday=`6`
- `startMinute` and `endMinute` are minutes from midnight in the selected `timezone`
- `startsOn` and `endsOn` are optional `YYYY-MM-DD` bounds on the recurring template
- if `endsOn` is omitted or null, the block repeats indefinitely
- holidays should usually use `kind: "holiday"`, `weekDays: [0,1,2,3,4,5,6]`, `startMinute: 0`, and `endMinute: 1440`
- work blocks are compact recurring templates inside Forge, not repeated stored events for every day

Provider-specific expectations:

- Google and Apple plus writable custom CalDAV connections can mirror selected calendars and publish Forge-owned work blocks or timeboxes into a dedicated `Forge` calendar.
- Exchange Online uses Microsoft Graph and is read-only in the current Forge implementation. It mirrors the selected calendars into Forge but does not publish work blocks, timeboxes, or native events back to Microsoft.
- Exchange Online connection setup is guided and interactive. In normal self-hosted local use, the operator must first save the Microsoft client ID, tenant, and redirect URI in `Settings -> Calendar`, then continue through the popup sign-in flow backed by a local MSAL public-client configuration.
- If an interactive Microsoft auth session has already been completed and the backend gave you an `authSessionId`, then `forge_connect_calendar_provider` accepts `provider: "microsoft"` with `label`, `authSessionId`, and `selectedCalendarUrls`.

Use these exact calendar batch payload shapes when working generically:

- create a native event:
  `{"operations":[{"entityType":"calendar_event","data":{"title":"Weekly research supervision","startAt":"2026-04-06T06:00:00.000Z","endAt":"2026-04-06T07:00:00.000Z","timezone":"Europe/Zurich","links":[{"entityType":"project","entityId":"project_123","relationshipType":"meeting_for"}]}}]}`
- update or move an event:
  `{"operations":[{"entityType":"calendar_event","id":"calevent_123","patch":{"startAt":"2026-04-06T06:30:00.000Z","endAt":"2026-04-06T07:30:00.000Z","timezone":"Europe/Zurich","preferredCalendarId":"calendar_123"}}]}`
- delete an event:
  `{"operations":[{"entityType":"calendar_event","id":"calevent_123"}]}`
- create a recurring work block:
  `{"operations":[{"entityType":"work_block_template","data":{"title":"Main Activity","kind":"main_activity","color":"#f97316","timezone":"Europe/Zurich","weekDays":[1,2,3,4,5],"startMinute":480,"endMinute":720,"startsOn":"2026-04-06","endsOn":null,"blockingState":"blocked"}}]}`
- create a holiday block:
  `{"operations":[{"entityType":"work_block_template","data":{"title":"Summer holiday","kind":"holiday","color":"#14b8a6","timezone":"Europe/Zurich","weekDays":[0,1,2,3,4,5,6],"startMinute":0,"endMinute":1440,"startsOn":"2026-08-01","endsOn":"2026-08-16","blockingState":"blocked"}}]}`
- create a planned task slot:
  `{"operations":[{"entityType":"task_timebox","data":{"taskId":"task_123","projectId":"project_456","title":"Draft the methods section","startsAt":"2026-04-03T06:00:00.000Z","endsAt":"2026-04-03T07:30:00.000Z","source":"suggested"}}]}`

Use these exact timebox helper payload shapes when the dedicated helper is simpler than batch CRUD:

- create a manual task timebox directly:
  `{"taskId":"task_123","projectId":"project_456","title":"Draft the methods section","startsAt":"2026-04-03T06:00:00.000Z","endsAt":"2026-04-03T07:30:00.000Z","source":"manual","overrideReason":"Protected writing block before clinic.","activityPresetKey":"deep_work","customSustainRateApPerHour":6.5}`
- create a suggested task timebox after reviewing recommendations:
  `{"taskId":"task_123","projectId":"project_456","title":"Draft the methods section","startsAt":"2026-04-03T08:00:00.000Z","endsAt":"2026-04-03T09:30:00.000Z","source":"suggested"}`

Use these interaction rules.

Keep the main discussion natural. Do not turn every conversation into a form. Do not offer Forge for every passing mention. Offer it once, near the end, only when the signal is strong and storing would help.

Good examples:
“This is a `project` in Forge. Do you want to save it?”
“This sounds like a `behavior_pattern`. Do you want to map it and save it?”
“This is a `trigger_report`. Do you want to capture it in Forge?”

Bad behavior:
interrupting too early
asking for every optional field
using vague labels instead of the real entity name
repeating the Forge prompt after the user has declined

Treat Psyche as structured reflective work, not as casual metadata. When the user is distressed, prioritize support and clarity over structure. Only suggest storage when the user seems ready.

When the user asks which Forge tools are available, list exactly these tools:
`forge_call_agent_messages_route`
`forge_get_operator_overview`
`forge_get_operator_context`
`forge_get_agent_onboarding`
`forge_get_doctor`
`forge_apply_doctor_fix`
`forge_call_attention_route`
`forge_call_entity_navigation_route`
`forge_call_calendar_connection_route`
`forge_call_wiki_route`
`forge_call_movement_route`
`forge_call_life_force_route`
`forge_call_workbench_route`
`forge_call_course_route`
`forge_call_artifact_route`
`forge_call_life_event_route`
`forge_call_people_route`
`forge_call_peer_route`
`forge_get_user_directory`
`forge_get_ui_entrypoint`
`forge_get_psyche_overview`
`forge_get_psyche_schema_catalog`
`forge_get_xp_metrics`
`forge_get_weekly_review`
`forge_get_wiki_settings`
`forge_list_wiki_pages`
`forge_get_wiki_page`
`forge_get_wiki_health`
`forge_search_wiki`
`forge_upsert_wiki_page`
`forge_sync_wiki_vault`
`forge_reindex_wiki_embeddings`
`forge_ingest_wiki_source`
`forge_get_current_work`
`forge_get_today_priority`
`forge_get_sleep_overview`
`forge_get_sports_overview`
`forge_get_training_load_overview`
`forge_get_weight_loss_overview`
`forge_search_nutrition_foods`
`forge_search_foods`
`forge_lookup_nutrition_barcode`
`forge_log_food`
`forge_update_food_log`
`forge_parse_food_log_with_chatgpt`
`forge_log_body_checkin`
`forge_log_appearance_checkin`
`forge_log_subjective_food_effect`
`forge_log_gut_checkin`
`forge_get_nutrition_patterns`
`forge_start_nutrition_experiment`
`forge_update_nutrition_experiment`
`forge_update_sleep_session`
`forge_update_workout_session`
`forge_get_preferences_workspace`
`forge_start_preferences_game`
`forge_merge_preferences_contexts`
`forge_enqueue_preferences_item_from_entity`
`forge_submit_preferences_judgment`
`forge_submit_preferences_signal`
`forge_update_preferences_score`
`forge_list_questionnaires`
`forge_get_questionnaire`
`forge_clone_questionnaire`
`forge_ensure_questionnaire_draft`
`forge_publish_questionnaire_draft`
`forge_start_questionnaire_run`
`forge_get_questionnaire_run`
`forge_update_questionnaire_run`
`forge_complete_questionnaire_run`
`forge_get_self_observation_calendar`
`forge_search_entities`
`forge_create_entities`
`forge_update_entities`
`forge_delete_entities`
`forge_restore_entities`
`forge_grant_reward_bonus`
`forge_adjust_work_minutes`
`forge_post_insight`
`forge_log_work`
`forge_start_task_run`
`forge_heartbeat_task_run`
`forge_focus_task_run`
`forge_complete_task_run`
`forge_release_task_run`
`forge_get_calendar_overview`
`forge_connect_calendar_provider`
`forge_sync_calendar_connection`
`forge_create_work_block_template`
`forge_recommend_task_timeboxes`
`forge_create_task_timebox`

Additional first-class surfaces:

- Use the high-level batch routes for basic Preferences CRUD. `preference_catalog`, `preference_catalog_item`, `preference_context`, and `preference_item` all use `forge_search_entities`, `forge_create_entities`, `forge_update_entities`, and `forge_delete_entities`. Preference catalogs and catalog items move to the reversible Settings Bin and can be restored through `forge_restore_entities`; contexts and standalone preference items delete immediately and cannot be restored.
- Treat context consolidation as a separate Preferences action. Read both exact contexts first, then call `forge_merge_preferences_contexts` with one `sourceContextId` and one `targetContextId` after explaining that judgments and signals move, the source is deactivated, and the target is recomputed. Never emulate this with batch deletion.
- Treat entity-backed Preference Item enqueue and evidence changes as separate actions. Use `forge_enqueue_preferences_item_from_entity` for an exact existing Forge source instead of hand-building source links. Read the Preferences Workspace before judgment, signal, or score correction; judgment and signal require `userId`, `domain`, and `contextId`, while `forge_update_preferences_score` also requires `itemId`. Use a signal for favorite, veto, must-have, bookmark, neutral, or compare-later language, and reserve score override for an explicit correction or protection of inferred state. `neutral` removes the current direct effect while preserving prior signals in history; it adds no direct weight, evidence, or confidence. After writing, explain the returned effective signal, score, status, and confidence instead of predicting the result.
- Use the high-level batch routes for basic questionnaire CRUD too. `questionnaire_instrument` goes through `forge_create_entities`, `forge_update_entities`, and `forge_delete_entities`.
- Use the high-level batch routes for ordinary health-session CRUD too. `sleep_session` and `workout_session` go through `forge_search_entities`, `forge_create_entities`, `forge_update_entities`, and `forge_delete_entities` by default. Keep the dedicated health tools for review surfaces and reflective enrichment on one record.
- Keep the dedicated Preferences tools only for real preference actions and read models: `forge_get_preferences_workspace`, `forge_start_preferences_game`, `forge_merge_preferences_contexts`, `forge_enqueue_preferences_item_from_entity`, `forge_submit_preferences_judgment`, `forge_submit_preferences_signal`, and `forge_update_preferences_score`.
- Keep the dedicated questionnaire tools only for real flow actions and read models: `forge_list_questionnaires`, `forge_get_questionnaire`, `forge_clone_questionnaire`, `forge_ensure_questionnaire_draft`, `forge_publish_questionnaire_draft`, `forge_start_questionnaire_run`, `forge_get_questionnaire_run`, `forge_update_questionnaire_run`, and `forge_complete_questionnaire_run`.
- Self-observation is note-backed. Read the calendar through `forge_get_self_observation_calendar`, but create or update the stored observation as a `note` tagged `Self-observation` with `frontmatter.observedAt` and links to the relevant `behavior_pattern`, `trigger_report`, or other Forge records.
- `forge_get_psyche_schema_catalog` is a read-only reference path for schema themes. Use it before setting `belief_entry.schemaId`; do not invent schema ids, and do not treat schema catalog entries as user-owned beliefs.
- `sleep_session` and `workout_session` are first-class health records. Treat them like ordinary stored entities for CRUD, and use the dedicated health tools for read models or post-review enrichment rather than pretending they live on a special mutation island.
- Movement is a specialized domain surface, not batch CRUD. Use the dedicated movement route family for day, month, all-time, timeline, places, trip detail, selection aggregates, user-defined overlays, and repair actions. The runtime paths live under `/api/v1/movement/*`, and the OpenClaw HTTP mirror exposes the same family under `/forge/v1/movement/*`.
- Life Events use both paths deliberately. Use shared batch CRUD for normal `life_event` create, update, search, soft delete, restore, and generic `entity_links`. Use `/api/v1/life-events/*` only for chronology reads, one-event reads, calendar sync, calendar-to-Life-Event conversion, ticket artifact import, and travel-status reads. The OpenClaw HTTP mirror exposes the same family under `/forge/v1/life-events/*`.
- Life Force is a specialized domain surface, not batch CRUD. Use `GET /api/v1/life-force` for the overview, `PATCH /api/v1/life-force/profile` for durable profile changes, `PUT /api/v1/life-force/templates/:weekday` for weekday curves, and `POST /api/v1/life-force/fatigue-signals` for right-now fatigue or recovery signals. The OpenClaw HTTP mirror uses `/forge/v1/life-force/*`.
- Workbench is a specialized domain surface, not batch CRUD. Use `/api/v1/workbench/*` for flow catalog reads, flow CRUD, execution, explicit cancellation, run history, published outputs, node results, and latest-node-output reads. The OpenClaw HTTP mirror uses `/forge/v1/workbench/*`. Execution and chat accept a whole-flow `timeoutMs` from 1,000 to 900,000 milliseconds, defaulting to 300,000. Use `cancelRun` only for one exact active run. Treat `cancelled` and `timed_out` as immutable terminal receipts, preserve completed-node evidence, and retry only from the stored input contract.
