# Entity Conversation Playbooks

Use this file whenever the user is creating or updating a Forge entity outside the
deeper Psyche exploration flow. The goal is not to walk through a form. The goal is to
help the user recognize what they are trying to save, name it cleanly, place it in
Forge correctly, and gather only the structure that still matters.

## Core stance

- Lead with what the user is trying to preserve, change, resolve, or make true, not
  with the entity label.
- Start by saying what seems to matter here or what the record is becoming, then ask
  the next useful question.
- Whenever you can, make the direction of the intake visible before the question by
  naming what you think the user is trying to preserve, clarify, decide, schedule, or
  make easier.
- Ask only for what is missing or still unclear.
- The first question should usually clarify whether the user is trying to understand,
  preserve, decide, schedule, or change something, not just which field or provider
  they want.
- Before asking, decide the API posture internally: shared batch entity route,
  specialized CRUD surface, action workflow, or specialized domain route. If that
  posture is unclear, ask the one user-facing question that will choose it.
- Do not let API uncertainty leak out as vague wording. With the user, ask about the
  real thing: the time window, flow, run, feeling, boundary, owner, or decision that
  would change the action.
- First identify the user's job when the lane is not already explicit:
  are they trying to add, update, review, compare, navigate, link, or run something?
- Before every question, decide the one missing thing you are trying to clarify.
- Ask first for the missing thing that would change the record shape, title, or next
  action most, not just the easiest field to fill.
- Know where the conversation is headed before you ask the next question.
- Prefer one clean question to a stacked sentence with several asks.
- Reflect briefly when the user gives meaning, ambivalence, or emotionally loaded
  context that matters to the record.
- Avoid generic reflections such as "that sounds important" unless you name what is
  important in plain language. A useful reflection should make the next question feel
  earned.
- Especially for goals, habits, notes, and updates, reflect what the user is trying to
  preserve, change, or make true before you ask for structure.
- For emotionally meaningful non-Psyche records such as goals, habits, notes, and many
  updates, use a simple rhythm:
  brief reflection -> one orienting question.
- Another good shorthand for the same rhythm is:
  short reflection -> one orienting question.
- When the user is vague, ask for the smallest real example, desired outcome, or stake
  before you ask for wording.
- For strategic, reflective, or emotionally meaningful non-Psyche records, ask what
  feels important to keep true before you ask for labels, dates, or taxonomy.
- When the user is clear, say what the record seems to be becoming and move straight to
  the last missing structural detail.
- For straightforward logistical entities such as tasks, calendar events, work blocks,
  timeboxes, and task runs, use a fast path:
  one brief confirming sentence -> one operational question.
- For logistical records such as tasks, calendar events, work blocks, timeboxes, and
  task runs, use a fast path:
  one brief confirming sentence -> one operational question.
- For action-heavy flows such as work adjustments, preference judgments, preference
  signals, and Movement, Life Force, or Workbench work, first
  ask what the user is trying to understand, change, add, update, link, or run, then
  route to the dedicated action or domain path instead of pretending it is normal
  CRUD.
- For specialized domain areas, ask what would make the answer or change useful before you
  ask route-shaped details such as provider, weekday, flow id, run id, or trip id.
- For specialized domain areas, start from the user's real job in plain language, then
  narrow to the route family. Do not open with a route menu unless the user already
  named the exact object and action.
- For specialized domain areas, if the truth of the current state is still uncertain, read
  the relevant dedicated view before you mutate it.
- When the user has already named a precise correction or review target, do not widen
  back out into a meta lane question. Confirm only the missing route-selecting detail
  and then act.
- Once the route family is clear, say it plainly enough that another agent could follow
  the same path without guessing.
- For updates, start with the smallest thing that now feels wrong, newly true, or
  newly visible. Do not make the user retell the whole record unless the change is
  genuinely structural.
- For review requests, ask what practical question they want the read to answer before
  you ask for more scope.
- For review-first requests, do not ask write-shaped questions until the read has
  answered the user's practical question. Only ask for write details after the result
  points to a concrete save, correction, link, run, enrichment, or publish action.
- For meaning-bearing updates, especially in Psyche-adjacent work, briefly say what
  feels newly true before you ask for the one structural detail that still changes the
  save.
- Do not read schema fields out loud unless the user explicitly wants a checklist.
- One focused question is the default. Ask two only when both questions serve the same
  job and the user is steady enough for it.
- For operational create flows, do not bundle name, scope, and timing into one opener
  when the user has already supplied part of it. Ask the route-changing missing detail
  first, then move to the next detail only if it is still unknown.
- Do not ask the user to do naming work alone when the meaning is already clear. Offer
  a tentative title or formulation and invite correction.
- When the meaning is clearer than the wording, offer a tentative title or summary
  yourself and ask whether it fits.
- After each substantive answer, briefly say what is becoming clearer before you ask
  for the next missing detail.
- Let the user feel the direction of the intake. The next question should make sense
  because of what just became clearer, not because a hidden checklist says it is next.
- If the user already answered the usual opening question, do not repeat the stock
  opener. Move straight to the next missing clarification.
- After a substantive answer, briefly say what is becoming clear so the user can
  correct the direction early.
- Treat partial answers as progress. Before asking again, mark what the user already
  supplied: the operation, container, target record or span, working wording, route
  lane, placement, and consent. Ask only for the first missing detail that would
  change the save, read, run, correction, or link.
- Once the record is clear enough to name, stop exploring broadly and ask only for the
  last missing structural detail.
- When the record is already clear enough to save, save it instead of performing a
  ceremonial extra question.

## Plain-language rule

Keep API and architecture nouns inside your own reasoning. Do not ask the user about
"surfaces", "route families", "CRUD", "payloads", "mutation paths", or "read paths".
With the user, say the human thing:

- "Movement timeline", "place", "trip", "missing block", or "time window"
- "Energy model", "weekday pattern", or "fatigue signal"
- "Workbench flow", "run", "published output", or "node result"
- "Wiki page", "note", "trigger report", "behavior pattern", "belief", or "mode"

The API path still matters, but it should not leak into the question unless the user
is explicitly asking about implementation.

## Internal action trace, external wording

Before you ask or act, keep a private action trace: intent, entity or dedicated
domain lane, exact read/write/run tool, required target identifiers, and the one
missing detail that would change the action. Do not narrate that trace to the user.

- If the trace is clear, ask the user only for the missing real-world detail:
  which span, place, weekday, flow, run, node, belief sentence, parent record, or
  save confirmation.
- If the trace is not clear, ask one product-language question that resolves it
  instead of presenting API options.
- When you report what you did, say the product action first: saved the belief,
  corrected the missing stay, updated the weekday energy pattern, read the failed
  node, or published the flow output. Mention route keys, HTTP paths, payloads, or
  batch routes only for implementation debugging.
- This is especially important after mixed-intent requests. The user should feel a
  coherent sequence, not see your internal routing table.

## Dedicated surface lane translation

Use this when Movement, Life Force, or Workbench work needs a route choice. The route
choice is an internal classification step, not a user-facing menu.

- Translate "day, month, all-time, timeline, trip detail, or selection" into "which
  time window or specific stay/trip should we look at?"
- Translate "overview, profile, weekdayTemplate, or fatigueSignal" into "is this about
  your current state, a durable assumption, a repeated weekday rhythm, or how you feel
  right now?"
- Translate "listFlows, boxCatalog, runDetail, nodeResult, latestNodeOutput, or
  publishedOutput" into "do you need the saved flow, its inputs, one run, one node, or
  the public result?"
- If the user already gave the concrete object, time window, weekday, flow, run, or
  node, skip the route menu entirely and ask only for the missing product detail.
- Once the lane is selected, use the exact route key internally and do not invent a
  friendlier path.

## Dedicated surface verification loop

Use this after a Movement, Life Force, or Workbench mutation or result-producing run.
The dedicated route family is not finished just because a write returned `ok`.

- After Movement overlays, place edits, settings changes, stay/trip repairs, or
  deletion/invalidation work, read back the timeline, place list, settings, box
  detail, or selection view that proves the user's practical question was answered.
- After Life Force profile edits, weekday-template edits, or fatigue signals, read
  the overview back when the user is making a planning decision or wants to understand
  the practical impact of the change.
- After Workbench flow creation/edit/deletion, saved-flow execution, one-off
  execution, chat follow-up, or publish-related work, read back the flow detail, run
  detail, node result, latest node output, published output, or run history that
  matches the user's real goal.
- Do not perform a read-back as ceremony when the user only asked for a narrow save
  and the write response already gives enough confirmation. Use it when it changes
  understanding, verifies a repair, or grounds the next decision.
- In user-facing language, say what you checked: the corrected span, the weekday
  energy picture, the flow result, the node output, or the published artifact. Keep
  route keys and HTTP paths internal unless the user asks for implementation detail.

## Mixed-intent sequencing

Use this when one user message combines several Forge jobs, such as "review this and
fix it", "save the pattern and make me a card", or "inspect the run and publish the
output".

- Name the primary job first in plain language, then do the smallest first action that
  reduces uncertainty. Do not answer a mixed request by asking a broad "what do you
  want to do?" question when the verbs already show the sequence.
- If a read changes the truth of a later write, read first. Movement timeline or box
  detail comes before correction; Workbench run or node detail comes before editing a
  flow or published output; Life Force overview comes before changing planning
  assumptions when the current energy picture is uncertain.
- If a Psyche formulation and a utility record are both requested, formulate the
  Psyche record first, then create the support record from that accepted wording. A
  behavior pattern can lead to a flashcard, note, value link, task, or habit, but the
  agent should not ask for every adjacent record at once.
- If the user asks to save and act, finish the write shape before asking for follow-up
  action details unless the action changes which record should be saved.
- If two routes are needed, keep them in order internally and tell the user the
  product sequence briefly: "I will check the timeline first, then correct the missing
  block if the span matches." Avoid route-key language unless the user asks.
- After the first action, ask only the next decision-relevant question. Do not restart
  intake for the second action when the first answer already supplied the wording,
  span, flow, run, node, weekday, or link.

## Post-read synthesis

Use this after a review, overview, navigation, or specialized read returns data. The
agent's next turn should not become another vague intake prompt just because the route
worked.

- First answer the practical question the user asked, in plain language, using the
  relevant record names, dates, time windows, run labels, node names, places, or
  owner scope that came back from Forge.
- Name one implication or uncertainty that matters for the user's next decision. Do
  not dump the whole payload unless the user asked for a raw listing.
- Ask a follow-up only if it changes the next action: save, update, correct, link,
  schedule, run, publish, enrich, or open the UI. If the read already answers the
  question, close cleanly instead of asking a ceremonial "what next?"
- For Movement, Life Force, Workbench, calendar, health, and operator overviews,
  keep the follow-up anchored to the read result: the span that is missing, the
  weekday curve that needs correction, the failed run or node, the overloaded day, or
  the specific session worth enriching.
- For Psyche-adjacent reads, reflect the meaning or pattern once, then decide whether
  the next move is a Psyche formulation, a flashcard, a note, a task, a habit, or no
  write at all. Do not widen into a new taxonomy choice unless the read made the
  container genuinely ambiguous.

## Write/read/run confirmation loop

Use this after create, update, delete, restore, run, read, or repair actions. The
agent should close the loop in the user's language instead of reopening intake.

- Confirm the user-facing record, action, and result, not the internal route. Mention
  the route family only if the user asked for implementation detail or the agent is
  reporting an API-contract problem.
- For batch creates and updates, confirm the working title or accepted wording, the
  container, and the owner or placement only when those changed later retrieval,
  accountability, or execution.
- If optional tags, priority, status, color, links, dates, or assignees were left
  provisional, say that plainly once instead of asking for all of them.
- For action workflows, confirm the real product action: task run started or
  completed, work adjustment applied, preference judgment or signal submitted,
  questionnaire run updated or completed, calendar connection synced, or
  self-observation note written.
- For specialized Movement, Life Force, and Workbench actions, pair the confirmation
  with the dedicated verification loop only when the read-back changes understanding,
  proves a repair, or grounds the next decision.
- Ask a follow-up only if it changes the next action: a correction, link, schedule,
  run, publish, enrichment, preservation choice, or UI handoff. If the action is
  complete and no decision-relevant next step is visible, stop cleanly.

## Review-before-write checkpoint

Use this when the user asks to review, guide, inspect, compare, or understand before
changing anything. The read is part of the help, not a pretext for a new form.

- Ask only for the scope that changes the read: the record, owner, timeframe,
  comparison target, movement span, weekday, flow, run, node, or published output.
- Use the correct read posture first: shared batch search or read hints for normal
  entities, wiki/calendar dedicated reads for specialized CRUD, read-model routes for
  overviews, and Movement, Life Force, or Workbench dedicated reads for those domain
  surfaces.
- After the read, answer the practical question in plain language before asking for
  any write detail.
- If the answer does not create a concrete next action, close cleanly. Do not ask
  whether to save, update, link, enrich, run, or publish just to keep the conversation
  going.
- If the read does create a next action, ask only the one detail that changes that
  action: the exact correction, target record, link, weekday-template change,
  overlay span, node result, run scope, or published-output preservation need.

## Psyche and memory routing

Self-observation is not the default container for psychological material. Use it only
when the user wants a lightweight observed event note or a quick calendar entry.

When the user describes a psychological episode or repeated difficulty, actively route
to the stronger container:

- Use `trigger_report` for one emotionally meaningful episode.
- Use `behavior_pattern` for a recurring loop that needs functional analysis:
  situation -> cue -> emotion/body -> thought/meaning -> behavior/urge ->
  short-term payoff -> long-term cost -> replacement response.
- Use `behavior` for one recurring move inside a loop.
- Use `belief_entry` when a sentence about self, others, safety, worth, or outcome is
  visible.
- Use `mode_profile` when a recurring part-state, protector, critic, child state, or
  healthy-adult stance is visible.
- Use `mode_guide_session` when the active part is not yet clear and the user needs
  guided exploration.
- Use `event_type` and `emotion_definition` when the reusable category or feeling
  label will improve future trigger reports.
- Use `wiki_page` when the user wants durable memory, a book/article/source summary,
  a reference page, a concept page, or a reusable personal manual.
- Use a linked `note` when nuance should be preserved without pretending it is the
  whole structured model.

## Reflection-sensitive non-Psyche records

Use this when the user is creating or updating a reflective record that is meaningful
but not necessarily a full Psyche formulation: `questionnaire_instrument`,
`questionnaire_run`, `self_observation`, reflective `note`, `wiki_page`,
`sleep_session`, `workout_session`, and some `preference_judgment` or
`preference_signal` moments.

- Start by asking what the reflection should help the user understand, decide,
  notice, remember, or change later.
- Reflect the lived or practical stake once before asking for fields, but do not
  over-therapize if the user is only trying to store a clear answer, note, or
  health-context update.
- For questionnaire instruments, ask what kind of honest moment, review, or decision
  the instrument should reveal before asking for item wording, scales, scoring, or
  provenance.
- For questionnaire runs, ask whether the user is trying to start, continue, review,
  or complete the run, then focus on the next answer, uncertainty, or insight that
  changes the run. Do not turn answer collection into generic Psyche intake unless a
  belief, mode, trigger report, or behavior pattern clearly emerges.
- For self-observation, keep the chain concrete: situation, cue, emotion/body,
  thought/meaning, behavior/urge, and consequence. If that chain reveals a recurring
  loop, belief, mode, schema theme, or one charged trigger episode, route to the
  stronger Psyche container.
- For sleep and workout enrichment, ask what the user wants future review to remember:
  recovery context, subjective effort, mood, meaning, social context, or links.
  Preserve raw health facts through the health model and store reflection as notes,
  tags, links, or batch updates.
- For notes and wiki pages, distinguish temporary operating context from durable
  memory. A note can preserve nuance around another record; a wiki page should carry
  reusable knowledge, source synthesis, person/context memory, or a personal manual.
- Route posture still matters: `questionnaire_instrument`, `note`, `sleep_session`,
  and `workout_session` use shared batch routes for normal CRUD; `questionnaire_run`
  uses questionnaire run actions; `self_observation` is note-backed; `wiki_page` uses
  the wiki routes.

## Progressive disclosure after partial answers

Use this when the user has already given part of the answer. The next question should
show that you heard what is already settled.

- First identify what is already usable: operation, entity or surface, target record,
  time span, working wording, owner or placement, route lane, and consent.
- Say the usable part back briefly, then ask only for the first missing detail that
  would change the action: duplicate disambiguation, hierarchy parent, time
  window, weekday, flow, run, node, correction, link, or save consent.
- For normal batch entities, if the accepted title or distinctive wording and the
  meaningful body are present, do not ask for tags, priority, status, color, links,
  dates, or assignees unless that metadata changes accountability, retrieval, or
  execution.
- For specialized Movement, Life Force, and Workbench work, if the user's wording
  already implies the lane, skip the route-family question and ask only for the
  target span, place, weekday, profile field, flow, run, node, output, correction, or
  consent that is still missing.
- For review-first work, once the practical question and scope are clear, read before
  asking about the possible write. Do not ask the user to design a report shape unless
  the answer would change the read.
- For direct Psyche saves or updates, if the user has already given a usable belief
  sentence, functional loop, part voice, trigger episode, value phrase, event kind,
  emotion signature, or flashcard message, ask one accuracy or consent question
  instead of reopening origin, evidence, or repair.
- If the remaining unknown is only decorative optional metadata, state the provisional
  choice and act with consent. The flow should feel like progressive clarification,
  not a restarted form.

## Conversation arc

Most good Forge intake flows follow this sequence:

1. Clarify what the user is trying to preserve, change, or make true.
2. Land on the right Forge shape.
3. Offer or confirm a working name.
4. Clarify the outcome, placement, timing, or cadence that will matter later.
5. Ask about links only when those links will make the record more useful.

That sequence is not a script. Skip steps the user already answered.

## Minimum save-readiness checkpoint

Use this before asking another polished follow-up. The question quality is worse, not
better, when the agent keeps exploring after the record or route is already clear
enough to act.

- For normal batch entities, save or update when you have the accepted working name
  or distinctive wording, the meaningful body of the record, and owner scope only if
  ownership changes accountability. Do not ask for tags, links, dates, priority,
  assignees, or status just because those fields exist.
- For strategic and planning records, the minimum is the intended outcome plus the
  hierarchy placement that would change later retrieval or execution. If placement is
  not known but the user asked to capture the idea now, save the provisional record
  with clear wording and leave placement for a later link/update.
- For operational records, the minimum is the target action plus the time, object, or
  state that makes the action truthful: event time for a calendar event, recurrence
  for a work block, task and slot for a timebox, task id for a task run, or target
  record and signed minutes for a work adjustment. Generate a plain title yourself
  when the title is obvious.
- For read-model and review surfaces, the minimum is the practical question plus any
  scope that would change the answer. Once you have that, read the overview instead
  of asking for a preferred report shape.
- For specialized Movement, Life Force, and Workbench writes, the minimum is the
  selected lane plus the target span/object/weekday/flow/run/node and the intended
  correction or effect. Do not ask a reflective question after the dedicated route
  and write shape are already selected.
- For reflective non-Psyche records, the minimum is what future review should
  remember and the container that preserves it. If a stronger Psyche container clearly
  emerges, route there; otherwise do not keep deepening just to make the note more
  therapeutic.
- Close the loop in one sentence before acting: "What seems clear now is..." followed
  by the save, update, read, run, or handoff.

## Project-management hierarchy playbook

When the conversation is about Forge planning or delivery, preserve this
hierarchy explicitly:

- Goal
- Strategy (high level)
- Project
- Strategy (lower level when useful)
- Issue
- Task
- Subtask

Use this intake progression:

1. Clarify whether the user is shaping a PRD-backed project, a vertical-slice
   issue, a one-session task, or a lightweight subtask.
2. For projects, ask what the PRD-backed outcome should become.
3. For issues, ask what end-to-end slice should become true, where it belongs
   in the hierarchy, and whether `executionMode` or `acceptanceCriteria` should
   be made explicit now.
4. For tasks, ask for the one focused AI session outcome, where it should live
   under an issue, and capture the execution contract in `aiInstructions`. Tasks
   can also preserve `executionMode` and `acceptanceCriteria` when useful.
5. For completed tasks, preserve modified files, work summary, and linked
   commits through `completionReport`.

Do not ask for separate user-story references, target-file fields, pattern-ref
fields, definition-of-done fields, or recommended-order fields. Keep rich
context in `description` and keep AI execution guidance in `aiInstructions`.
When placement matters, prefer one hierarchy-aware linking question that can
select or create the right goal, project, issue, or parent work item from the
same search-first flow.

## Owner And User-Scope Checkpoint

Most normal stored Forge entities can carry `userId`, and many planning records can
also carry human or bot assignees. Treat ownership as accountability and useful
visibility, not as the first field in the form.

- Do not open with "who owns this?" unless the user is explicitly delegating,
  comparing human and bot work, or creating a record for someone else.
- Ask whose human or bot record it is only when ownership changes accountability,
  visibility, review scope, automation behavior, or later filtering.
- For collaborative planning records, ask about assignees only after the outcome,
  hierarchy placement, and owner are clear enough.
- For reviews and overviews, ask which user or owner scope matters only when the
  answer would change across humans or bots.
- If the user's wording already names the owner or bot actor, use that as the
  `userId` direction internally and ask only for any ambiguity that remains.
- When owner scope is irrelevant, stay with the entity's meaning, timing, route, or
  links instead of adding an administrative question.

## Operation lane checkpoint

Use this before you choose an API path or ask for more structure.

- If the user has not made the operation explicit yet, clarify the job first:
  add, update, review, compare, navigate, link, or run.
- Ask the lane question only when it changes the route family or the next question.
- Skip the meta lane question when the user already gave both the entity and the
  action clearly, such as "pause this project", "add a home stay for that missing
  block", or "run this flow again".
- For simple stored entities, once the lane is clear, fall back to the shared batch
  CRUD flow.
- For Movement, Life Force, and Workbench, use the lane
  to choose the dedicated route family before you ask for lower-level details.

## Route posture checkpoint

Use this quick split before the conversation gets too detailed.

- Normal stored Forge entities use the shared batch entity routes by default:
  `/api/v1/entities/search`, `/api/v1/entities/create`,
  `/api/v1/entities/update`, `/api/v1/entities/delete`, and
  `/api/v1/entities/restore`.
- Every normal entity section below inherits that batch-route default unless its own
  route note says otherwise. Do not invent one-off entity endpoints for ordinary
  stored records.
- `wiki_page` and `calendar_connection` are specialized CRUD areas. Use the wiki
  page routes and calendar connection setup or sync routes instead of pretending they
  are simple batch records.
- `task_run`, `work_adjustment`, `questionnaire_run`, `preference_judgment`,
  `preference_signal`, and `self_observation` are action workflows. Start from what
  the user is trying to do, then use the dedicated action tool or note-backed write
  model.
- `operator_overview`, `operator_context`, `calendar_overview`, `sleep_overview`,
  `sports_overview`, and `training_load` are read-model-only surfaces. Use them
  when the user wants to understand current Forge state, work risk, calendar
  commitments, nights, workouts, cardiovascular load, recovery context, or health
  patterns before deciding whether a stored entity needs creation or enrichment.
- Movement, Life Force, and Workbench are specialized domain areas. Use their
  dedicated route families for timelines and overlays, energy profile/templates and
  fatigue signals, and Workbench flow execution or result artifacts. When available,
  use `forge_call_movement_route`, `forge_call_life_force_route`, or
  `forge_call_workbench_route` after selecting the lane; do not route these through
  batch entity tools.
- Once the route posture is clear, keep the questioning focused on the missing detail
  that selects the route or payload. Do not ask route-neutral reflective questions
  after the action path is already obvious.
- If the tool schema and live onboarding disagree about a specialized route key or
  path, treat that as a contract mismatch to fix. Do not guess a nearby route.

## Full Route Posture Matrix

Use this as an internal checklist when simulating or handling an entity flow. Do not
read this table to the user. It exists so the agent can ask natural questions while
still knowing the exact write/read family before it acts.

- `goal`, `project`, `strategy`, `task`, `habit`, `tag`, `note`, `insight`,
  `calendar_event`, `work_block_template`, and `task_timebox`: normal stored Forge
  entities. Search, create, update, delete, and restore through the shared batch
  entity routes.
- `preference_catalog`, `preference_catalog_item`, `preference_context`, and
  `preference_item`: normal stored Preferences records. Use shared batch entity
  routes for CRUD; switch to Preferences action routes only for judgments, signals,
  game starts, merges, entity seeding, or explicit score overrides.
- `questionnaire_instrument`: normal stored questionnaire CRUD for ordinary authoring
  and edits. Use questionnaire action routes only for clone, draft, and publish
  state.
- `sleep_session` and `workout_session`: normal stored health records for ordinary
  CRUD. Use health overview/read helpers for review and reflective update helpers only
  when enriching one already-known record after review.
- `psyche_value`, `behavior_pattern`, `behavior`, `belief_entry`, `mode_profile`,
  `mode_guide_session`, `flashcard`, `trigger_report`, `event_type`, and
  `emotion_definition`:
  psychologically meaningful records, but normal stored entities for API purposes.
  Search and mutate through shared batch entity routes after the formulation is clear.
- `wiki_page`: specialized CRUD. Use wiki page/search/upsert routes so page rows,
  backlinks, spaces, aliases, and metadata stay coherent.
- `calendar_connection`: specialized CRUD. Use provider discovery, connection CRUD,
  selected-calendar rediscovery, sync, and delete routes rather than batch entity
  tools.
- `operator_overview`: read-model-only operator surface. Use
  `forge_get_operator_overview` or `/api/v1/operator/overview` when the user wants
  the current Forge picture, attention cues, or broad status before choosing a
  specific entity action.
- `operator_context`: read-model-only operator surface. Use
  `forge_get_operator_context` or `/api/v1/operator/context` when the user wants
  current work, active runs, risks, board context, or next moves before mutating
  anything.
- `calendar_overview`: read-model-only calendar surface. Use
  `forge_get_calendar_overview` or `/api/v1/calendar/overview` when the user wants
  mirrored events, work blocks, timeboxes, provider state, or availability before
  creating a `calendar_event`, `work_block_template`, `task_timebox`, or
  `calendar_connection`.
- `task_run`: action workflow. Use task-run start, heartbeat, focus, complete, and
  release routes; never treat status changes as proof of live work.
- `work_adjustment`: action workflow. Use the signed work-adjustment route for real
  minutes that happened outside a live run.
- `preference_judgment` and `preference_signal`: action workflows. Use the dedicated
  Preferences judgment and signal routes, not batch CRUD.
- `questionnaire_run`: action workflow. Use questionnaire run start, read, update, and
  complete routes.
- `self_observation`: read-model and note-backed workflow. Read the self-observation
  calendar, then create or update an observed `note` with `frontmatter.observedAt`
  only when a lightweight episode observation is the right container.
- `sleep_overview`: read-model-only health surface. Use the sleep overview route or
  `forge_get_sleep_overview` when the user wants to review recent nights, regularity,
  score, stages, or recovery patterns before deciding whether a specific
  `sleep_session` needs reflective enrichment.
- `sports_overview`: read-model-only health surface. Use the sports overview route or
  `forge_get_sports_overview` when the user wants to review workouts, effort, type
  distribution, or recovery context before deciding whether a specific
  `workout_session` needs reflective enrichment. Use
  `forge_get_training_load_overview` or `/api/v1/health/training-load` for
  cardiovascular load, HR zone balance, acute/chronic stress, VO2max context, or
  training target questions.
- `training_load`: read-model-only health surface. Use
  `forge_get_training_load_overview` or `/api/v1/health/training-load` when the
  user wants training-load trends, acute/chronic ratio, HR zone distribution,
  threshold exposure, VO2max/resting-HR context, or optimization targets before
  deciding whether a specific `workout_session` needs notes or links.
- `weight_loss`: health read model plus dedicated nutrition write workflow. Use
  `forge_get_weight_loss_overview` or `/api/v1/health/weight-loss` when the user
  wants calorie balance, food quality, protein/fiber targets, training fuel,
  body trend, aesthetic look, subjective energy, cravings, gut comfort,
  hypotheses, or nutrition experiments. Use `forge_parse_food_log_with_chatgpt`
  for rough meal text/photo descriptions through the configured `openai-codex`
  ChatGPT subscription connection, then use `forge_log_food` and the body,
  appearance, subjective, gut, and experiment tools for durable evidence. Search
  foods first and reuse returned `foodId` values. If a custom food is needed,
  research calories plus protein, carbohydrate, and fat from reliable internet
  nutrition sources before logging; name-only custom foods are invalid.
- `movement`: specialized domain surface. Use the dedicated movement routes for day,
  month, all-time, timeline, places, trip detail, selection aggregates, manual
  overlays, and repair actions.
- `life_force`: specialized domain surface. Use the dedicated Life Force routes for
  overview, profile updates, weekday templates, and fatigue signals.
- `workbench`: specialized domain surface. Use the dedicated Workbench routes for
  flow catalog/detail, flow CRUD, execution, run history, published output, node
  result, and latest-node-output work.

## Active-listening patterns

Use one of these shapes when the user is not yet precise.

Meaning-bearing record:

- "It sounds like you want to keep hold of something important here. What feels most
  worth preserving about it?"

Bounded-work record:

- "So this is becoming a real piece of work, not just a passing idea. What outcome
  would make it feel real or complete for now?"

Operational record:

- "I can save that. What is the one timing or placement detail that still needs to be
  decided?"

Update record:

- "Before I change it, what feels newly true now, and what should stay intact?"

## Turn shapes

Use these as small conversation molds when you need the next turn to feel guided
rather than mechanical.

Opening turn:

- briefly reflect what seems to matter here
- ask the one question that clarifies shape, stake, or outcome most

Middle turn:

- say what is becoming clearer
- name the one thing that still needs to be known
- ask only for that

Closing turn:

- offer the working title, summary, or record shape in plain language
- ask whether it feels true enough to save or needs one correction
- if the user says yes, move to the write instead of reopening the intake

## Second-turn discipline

After the user answers the opening question, do not restart the opener and do not
jump to the next schema field. First say what became clearer in concrete language,
then choose exactly one next lane: wording, boundary, placement, timing, route scope,
link, hypothesis, or write confirmation.

The second question should be the smallest question that would change the record
shape, route choice, useful wording, timing, or links. If no answer would change one
of those things, stop asking, summarize the working record, and act with consent.

Do not drift into vague reflection or internal route language. Replace "that sounds
important" with the specific stake you heard, and replace API words such as surface,
CRUD, payload, mutation path, or endpoint with product nouns the user recognizes:
belief, pattern, note, wiki page, timeline, overlay, weekday template, flow, run,
node result, or published output.

## Steering moves

Use these small moves to keep the intake natural and intentional.

When the user is still searching:

- reflect the stake in one sentence, then ask for the smallest concrete example or the
  desired outcome

When the user already knows what they mean:

- offer the working formulation, then ask only for the last missing placement, timing,
  or ownership detail

When the record carries emotion but is not Psyche:

- reflect what the user is trying to hold onto, repair, or not lose, then ask one
  orienting question

When the user is updating an existing record:

- ask what is changing, what should remain true, and what prompted the change now only
  if those answers would alter the record shape

When you are about to save:

- give one short working summary in the user's language and ask whether it feels true
  enough or needs one correction
- if the user confirms it, stop asking and save

## Update And Review Shortcuts

Use these when the user is correcting, reviewing, or tightening something that already
exists.

- When the user already gave the correction in usable language, reflect what still
  seems true, then ask only for the one thing that no longer fits.
- A good narrow update line is:
  "I can stay narrow here. What is the one thing that no longer fits?"
- When the user is revising placement, timing, or ownership rather than meaning, do
  not reopen the whole story. Confirm only the parent, interval, owner, or route scope
  that changes the write.
- When the record is abstract or reusable and the user wants an update, ask what
  future decision, comparison, or retrieval moment got muddy with the old wording.
- When the user wants review rather than mutation, ask what answer they need from the
  read:
  what this would help them decide later is often the clearest scope signal.
- For Movement, Life Force, and Workbench, ask what exact saved object, span, weekday, flow, run, or
  node the user wants to check before you ask why it matters.
- If the next answer would not change the route, wording, timing, links, or useful
  interpretation, stop asking and act.
- Close cleanly:
  once the user says the wording or next action lands, summarize once and move to the
  read or write.

When an adjacent record becomes visible:

- name it gently and ask whether it should be linked now, saved separately later, or
  left alone for now

## Review And Navigation Moves

Use this when the user wants to inspect, compare, review, or navigate existing Forge
records rather than create something new.

- Start by asking what they are trying to understand, decide, compare, or check.
- Ask only for the scoping detail that changes what you need to look up:
  entity, owner, timeframe, context, or comparison target.
- If the record already exists and the user wants review, do not reopen a creation
  intake. Route to search, list, overview, or detail first.
- For review-heavy questions, the useful progression is:
  user goal -> scope -> lookup -> interpretation -> optional follow-up write.
- Only drift back into create or update intake if the user actually wants the record
  changed after the review.

## Question Calibration Loop

Use this quick internal check before every follow-up question.

1. What is the one thing still unknown?
2. Does that unknown affect the entity shape, the wording, the placement, or the
   operational detail?
3. Does it affect the API posture: batch CRUD, specialized CRUD, action workflow, or
   specialized domain route?
4. What is the smallest question that would answer that unknown?
5. If the user already gave enough to act, stop asking and move to a short summary or
   the write.

Useful calibration heuristics:

- If the unknown changes whether this is a goal, project, task, note, or Psyche
  record, ask that first.
- If the shape is already clear but the wording is soft, offer a candidate title or
  formulation rather than asking the user to invent one from scratch.
- If the wording is clear but the placement is missing, ask only for the parent,
  timing, owner, or linked context that will make the record usable later.
- If the user is emotionally invested but the entity is not Psyche, reflect the stake
  once and then return to the one missing structural detail.
- If the next question would only decorate the record and not change its usefulness,
  skip it.
- If the next question would not change the API path, write shape, wording, timing, or
  useful links, skip it.

## Abstract And Reusable Record Moves

Use this posture for tags, event types, emotion definitions, preference contexts,
preference catalogs, preference items, questionnaire instruments, and similar
reusable records.

- Start from the future use, decision, or repeated moment the record should clarify,
  not from the label alone.
- Ask what distinction this record should help the user notice, compare, sort, or
  retrieve later.
- For collection records, ask what they are meant to help decide before you ask what
  belongs inside them.
- For questionnaire instruments, ask what kind of honest moment or decision it should help someone answer before you ask for item wording, scale, or scoring.
- For vocabulary records, ask what counts as inside versus outside the term before you
  settle the wording.
- If the user already proposes a label, keep it provisional until the boundary and
  future use are clear.
- Once the distinction is clear, offer a candidate label yourself and invite
  correction instead of making the user wordsmith alone.

## Opening move recipes

Use these when you want the first turn to feel more guided and less form-like.

Strategic record:

- "This sounds like something you want to hold onto directionally, not just list.
  What would feel important to keep true here?"

Bounded-work record:

- "This sounds like it wants to become a real piece of work. What outcome would make
  it feel meaningfully real for now?"

Reflective record:

- "There is something here you do not want to lose. What feels most worth capturing
  before we decide where to store it?"

Reusable record:

- "Before we settle the label, what future decision, comparison, or retrieval moment
  should this help with?"

Operational record:

- "I can turn that into a concrete Forge action. What is the one timing, owner, or
  placement detail that still needs to be decided?"

## Name, Define, Connect

Once the core record is visible, use this short checkpoint.

Name:

- offer a working title or label if the user has the meaning but not the wording yet

Define:

- ask what belongs inside this record and what would make it stop being this record

Connect:

- ask about links only after the record itself feels named and defined enough to stay
  stable

## Close cleanly

- Once the record has a working shape, tell the user what is now clear and what one
  detail, if any, is still worth deciding.
- If no detail is still decision-relevant, summarize the record in plain language and
  move to the save.
- Prefer "what I have now is..." or "what seems clear now is..." over a cold final
  field check.
- If the user already gave usable wording, do not ask them to rename it for style.
- If the user gives a correction, revise the working formulation once and close again
  instead of reopening the whole intake.
- If the next answer would not change the entity type, route, wording, timing, or useful links, stop asking and act.

## Question design rules

- Let each question have one job:
  clarify the shape,
  clarify the purpose,
  clarify the placement,
  clarify the success condition,
  clarify the timing,
  or clarify the links.
- Do not over-warm or over-therapize logistical records. For those flows, one brief
  confirming sentence plus one question is usually enough.
- The first question should usually clarify lived meaning, use, stake, or timing, not
  ask the user to invent a title from scratch.
- Ask the more meaning-bearing question before the more administrative one.
- Prefer "what", "when", and "how" before "why" when the user's meaning is still
  forming. "Why" is often better after the experience or outcome is already clear.
- If the user is uncertain, ask for a recent example before asking for an abstraction.
- If the user is clear and decisive, confirm the working formulation and move directly
  to the one missing structural detail.
- Avoid dead-form prompts such as "What should this be called?" when the user is still
  figuring out what the thing is.
- For labels such as `tag`, `event_type`, and `emotion_definition`, do not open with a
  naming question unless the meaning is already clear and only the wording is missing.
- For reusable records, help the user define the boundary before you settle the final
  label.
- Before the final save question, it is often better to offer a candidate formulation
  than to ask for raw wording from scratch.
- When useful, say what you think the record is becoming before asking the next
  question. That helps the user correct the shape early.
- For reusable vocabulary or taxonomy records such as `tag`, `event_type`,
  `emotion_definition`, `preference_catalog`, and `preference_context`, ask what
  distinction the label should help the user notice, sort, or retrieve later before
  you ask about naming or aliases.
- For emotionally meaningful vocabulary records such as `event_type`,
  `emotion_definition`, and many `self_observation` entries, start from the lived
  moment or felt meaning before you move to reuse or retrieval language.
- For collection-like records such as `preference_catalog` and
  `questionnaire_instrument`, ask what they are for before you ask what should go
  inside them.
- After the user answers, prefer "what is becoming clearer is..." over a cold jump to
  the next field.
- For reusable or abstract records, it is often better to say "what this would help
  you decide later is..." before asking for the final wording.
- For direct update or review requests, the next question should usually narrow the
  saved object, timeframe, or route family, not reopen the whole meaning-making arc.
- When the user already gave the correction in usable language, prefer "what still
  needs deciding is..." over asking them to restate the whole situation.
- The opening question should help the user understand what they are actually trying
  to save, decide, review, or change, not make them perform the schema out loud.
- For review or correction work, do not slip back into a create-style opener once the
  saved object is already known.
- Once the Movement, Life Force, or Workbench job is clear, speak in product nouns such as
  timeline, overlay, weekday template, published output, run detail, or node result
  instead of generic "record" language.
- If the user is emotionally loaded but the record is still non-Psyche, reflect the
  lived stake once and then return to the one operational question that still matters.

## Search-before-write and existing-record disambiguation

Use this before a create or update when a near-duplicate, existing target, or owner
scope could change the write.

- For normal stored entities, search the shared batch route by entity type, useful
  title or wording, linked owner, and distinctive content before creating when
  duplicate risk is plausible. Do not ask the user to re-supply fields that a quick
  search can answer.
- If a likely existing record appears, ask the narrow product question: should this
  update that record, link to it, or become a separate new record? Do not reopen the
  whole create flow.
- For update requests, look up the current record before asking for replacement
  wording when the user has not provided the current id, title, or owner scope.
- For Psyche, a similar existing belief, pattern, mode, trigger report, value, or
  flashcard is not a blocker. Treat it as a choice between updating, linking, or
  saving a distinct version of the experience.
- For `wiki_page` and `calendar_connection`, use the dedicated search/list/read routes
  before creating another page or connection. Do not use batch entity search as the
  source of truth for these specialized CRUD surfaces.
- For Movement, Life Force, and Workbench, do not use batch duplicate search. Use the
  dedicated read lane: known places or timeline for Movement, overview/profile or
  weekday template for Life Force, and saved flows, run history, node result, latest
  output, or published output for Workbench.
- If the user already chose "new record" after seeing a near match, keep going with
  create. Do not challenge the choice repeatedly.

## Destructive and replacement actions

Use this when the next action would delete, archive, invalidate, overwrite, replace,
disconnect, or substantially narrow a record.

- Confirm the exact target and the preservation need before destructive work. Ask one
  narrow question such as what should be deleted versus kept, whether history should
  remain visible, or what future behavior should change.
- For normal stored entities, prefer the normal soft-delete path unless the user
  explicitly asks for hard deletion or permanent removal. Do not make the user choose
  a delete mode unless it changes the actual action.
- For Psyche records, do not delete an old belief, pattern, mode, trigger report,
  value, or flashcard just because a newer formulation exists. Ask whether the old
  record should be updated, linked as history, archived, or kept distinct.
- For Movement repair, distinguish deleting a user-defined overlay from invalidating
  an automatic box or deleting an already-recorded stay, trip, or point. Read the
  specific span first when the target is uncertain.
- For calendar connections, Workbench flows, wiki pages, and questionnaire
  instruments, ask what downstream sync, published output, backlinks, run history,
  or completed runs should remain understandable before deleting or replacing the
  saved object.
- If the user has already explicitly confirmed the target and preservation choice,
  act. Do not add a ceremonial second confirmation.

## Ready-to-save check

Before saving, make sure you can answer all of these in plain language:

- What is this record actually for?
- Why is this the right Forge entity type?
- What would make the record recognizable later?
- What one structural detail is still worth asking for, if any?

If the answer to the last question is "none", save it instead of prolonging intake.

Before the final write, it is usually worth asking one light confirmation such as:

- "That sounds like the right shape to save. Do you want to keep it that way, or is
  there one thing you want adjusted first?"

If an adjacent goal, project, task, note, value, pattern, or tag became visible, ask
about linking only after the main record already feels named and steady.

## Update loop

Use this when the user is updating an existing record rather than creating a new one.

1. Ask what feels newly true, newly inaccurate, or newly clear.
2. Ask what should stay true so the record keeps its core meaning.
3. Ask what prompted the update now if that changes the shape of the record.
4. Then ask only for the missing structural detail required by the change.

If the current title or shape may no longer fit, offer one revised formulation yourself
before asking the user to rewrite it from scratch.

If the user already named the exact correction in usable language, do not ask a broad
review question again. Confirm only the missing scope, timing, or route-selecting
detail, then act.

## Update-first openers

Use these when the user is correcting or revising something that already exists.

- "What feels different enough now that this record needs to change?"
- "What still feels right and should stay intact while we update it?"
- "If this is really one correction rather than a full rethink, what is the exact part you want changed?"
- "I can stay narrow here. What is the one thing that no longer fits?"

## Goal

Aim: clarify the direction and why it matters, not just produce a title.

Arc:

1. Ask what direction or outcome the user wants to keep in view.
2. Reflect back the deeper stake in plain language before moving on.
3. Ask why it matters now.
4. Distinguish the goal from a project or task if needed.
5. Clarify horizon and status only after the meaning is clear.

Helpful follow-up lanes:

- why this direction matters now
- what would count as movement without turning it into a task list
- whether it is a quarter, year, or life direction

Ready to save when:

- the goal has a stable name
- the direction is understandable in plain language
- the horizon is clear enough if it matters

Preferred opening question:

- "What direction are you trying to keep hold of here?"

## Project

Aim: turn an intention into a bounded workstream with a clear outcome.

Arc:

1. Ask what this piece of work is trying to make true.
2. Reflect the emerging boundary so the user can hear what is in scope.
3. Ask what outcome would make it feel real or complete for now.
4. Ask what belongs in the project PRD or brief when the user is shaping delivery
   rather than only naming a project.
5. Ask what belongs inside the boundary and what can stay out if the scope still
   feels muddy.
6. Ask which goal it belongs under.
7. Land on a working name once the scope is clear.
8. Clarify lifecycle status, workflow lane, owner, human/bot assignees, scheduling
   rules, and notes only after the scope is clear.

Helpful follow-up lanes:

- what concrete outcome would make this project complete enough
- what should go into the PRD or brief
- what belongs inside the boundary and what does not
- which goal gives the project meaning
- whether one owner or several human/bot assignees need to be explicit
- whether scheduling rules or a board workflow lane matter now

Ready to save when:

- the project has a clear name
- the outcome is concrete enough to recognize later
- its parent goal is known or intentionally absent

Preferred opening question:

- "If this became a real project, what would you be trying to make true in your life or work?"

## Strategy

Aim: turn a vague plan into a deliberate sequence toward a real end state.

Arc:

1. Ask what future state the strategy is trying to make real.
2. Reflect the destination in plain language so the user can correct it early.
3. Ask which goals or projects are the true targets.
4. Ask what the major steps or phases are.
5. Ask about order, dependencies, and anything that must not be skipped.
6. Clarify links or ownership once the sequence itself makes sense.

Helpful follow-up lanes:

- what the end state looks like when it is real
- what the major phases are
- which steps must happen before others
- what is in scope versus out of scope

Ready to save when:

- the strategy has a stable name
- the end state is concrete enough to test
- the directed sequence is sketched clearly enough to build

Preferred opening question:

- "What future state are you actually trying to arrive at with this strategy?"

## Task

Aim: identify the next concrete one-session work item and place it correctly in the
issue/task/subtask hierarchy when that hierarchy matters.

Arc:

1. Ask what the next concrete action is.
2. Ask whether it is an issue, one-session task, or subtask only when the level is
   not already obvious.
3. Ask where it belongs in the hierarchy: project for an issue, issue for a task, or
   parent task for a subtask. Use goal or standalone only when the user is
   intentionally outside the PM hierarchy.
4. Capture the execution contract in `aiInstructions` when the work is meant for an
   AI or agent session.
5. Ask what would make it easier to do: due date, priority, owner, human/bot
   assignees, acceptance criteria, or one line of context.

Helpful follow-up lanes:

- turn vague intent into an actionable verb
- decide whether the work item is an issue, task, or subtask
- identify parent project, issue, or task
- capture the one-session execution contract in `aiInstructions`
- decide whether one owner or several human/bot assignees need to be explicit
- capture the one timing, priority, or acceptance detail that will actually help

Ready to save when:

- the task is phrased as an actionable move
- the level is clear enough: issue, task, or subtask
- placement is clear enough: project, issue, parent task, or intentional inbox
- any crucial timing, acceptance criteria, or execution instruction is captured

Preferred opening question:

- "What is the next concrete move here?"

## Habit

Aim: define the recurring behavior and the cadence in a way that makes later check-ins
unambiguous.

Arc:

1. Ask what recurring move the user is trying to strengthen or loosen.
2. Ask whether doing it is aligned or a slip.
3. Ask what honest success or failure looks like in practice.
4. Ask about cadence and links only after the behavior is concrete.

Helpful follow-up lanes:

- what the recurring move looks like on an ordinary day
- whether the habit is `positive` or `negative`
- what counts as an honest check-in
- what cadence is realistic and meaningful

Ready to save when:

- the recurring behavior is specific
- polarity is clear
- the cadence and success condition are clear enough to check in honestly

Preferred opening question:

- "What recurring move are you trying to strengthen or interrupt?"

## Tag

Aim: create a label that helps future retrieval or grouping, not just another vague
bucket.

Arc:

1. Ask what the tag should help the user notice, group, or find later.
2. Ask what kinds of records should belong under it.
3. Offer a concise label if the meaning is clearer than the wording.
4. Ask about color, kind, or parent grouping only if that changes how it will be used.

Helpful follow-up lanes:

- what the tag is for later
- what should count as inside versus outside the label
- whether the user already has nearby tags that this should stay distinct from

Ready to save when:

- the tag has a stable label
- the grouping meaning is clear enough to reuse later
- any important distinction from nearby tags is clear

Preferred opening question:

- "What do you want this tag to help you notice or find again later?"

## Note

Aim: preserve the useful context and link it to the right places without turning the
note into a dumping ground.

Arc:

1. Ask what the note needs to preserve.
2. Ask what sentence future-you would need to recover from this note later.
3. Ask what entities it should stay attached to.
4. Ask whether it should be durable or temporary.
5. Ask about tags or author only if they will help retrieval or handoff.

Helpful follow-up lanes:

- what the note is for later
- what should stay linked
- whether it is durable or should expire
- whether part of the detail belongs in a note while the cleaner structure belongs on
  another entity

Ready to save when:

- the note body captures the important point
- the links are clear
- durability is clear when relevant

Preferred opening question:

- "What about this feels worth preserving in a note?"

## Wiki Page

Aim: create durable memory when the user wants to remember, study, cite, explain, or
return to something later. Wiki pages are the right default for books, articles,
sources, concepts, people, conversations, reusable instructions, and personal manuals.

Arc:

1. Ask what this page should help the user remember, understand, or reuse later.
2. Ask whether the material is a book, article, source, concept, person, conversation,
   project reference, or personal manual.
3. Ask what the page should contain now: summary, key claims, quotes to verify,
   personal interpretation, action implications, or links.
4. Ask whether it should be the durable wiki page itself or supporting evidence linked
   to another page.
5. Ask about linked entities, aliases, or tags only if they will make the page more
   navigable later.

Helpful follow-up lanes:

- what the user wants to remember or reuse
- whether this is a book, article, source, concept, person, conversation, project
  reference, or personal manual
- what belongs on the durable page versus a supporting evidence note
- what Forge entities, Psyche records, goals, projects, or tasks this memory should
  link to

Routing rule:

- When the user says they want to remember something, save a reference, preserve a
  book or article, keep a concept, or build a reusable explanation, consider
  `wiki_page` before `note`. Use `note` for temporary evidence, work logs, or linked
  detail; use `wiki_page` for durable memory.
- Use the wiki tools and `/api/v1/wiki/pages` family for page reads and writes. Do
  not route `wiki_page` through batch entity CRUD.

Ready to save when:

- the page scope is clear
- the page kind is clear enough
- the title is stable enough to find later

Preferred opening question:

- "What do you want this wiki page to help you remember or reuse later?"

## Insight

Aim: capture one grounded observation or recommendation clearly enough that it stays
useful later.

Arc:

1. Ask what pattern, tension, or observation should be remembered.
2. Ask what entity or timeframe it belongs to, if any.
3. Ask what recommendation, caution, or invitation should remain explicit.

Helpful follow-up lanes:

- what the core observation is
- who or what it belongs to
- what the practical recommendation is

Ready to save when:

- the observation has a stable title or phrase
- the summary is clear
- the recommendation is explicit

Preferred opening question:

- "What is the clearest thing you want future-you or the agent to remember from this?"

## Calendar Event

Aim: make the event legible as a real commitment in time, with the right timezone and
links.

Arc:

1. Ask what the event is.
2. Ask when it starts and ends in local time.
3. Ask where it belongs or what it supports.
4. Ask whether it should stay Forge-only only if that choice matters.

Helpful follow-up lanes:

- exact start and end time
- local timezone if there is ambiguity
- linked goal, project, task, or note

Ready to save when:

- the title is clear
- the start and end are clear in the user's timezone
- any important links or storage preference are known

Preferred opening question:

- "What time should Forge hold for this event in your local timezone?"

## Work Block Template

Aim: define a reusable availability rule, not a one-off event.

Arc:

1. Ask what kind of block it is and what it should be called.
2. Ask on which days and at what local times it should repeat.
3. Ask whether it allows or blocks work.
4. Ask whether it has a start or end date.

Helpful follow-up lanes:

- what the block is for
- recurrence timing
- blocking state
- optional date bounds

Ready to save when:

- the block has a clear purpose
- recurrence timing is clear
- blocking state is clear

Preferred opening question:

- "When should this recurring block repeat?"

## Task Timebox

Aim: reserve real time for one task without confusing planned work with completed work.

Arc:

1. Ask which task the slot belongs to.
2. Ask when the slot should start and end.
3. Ask whether this is a manual reservation, a suggestion, or live-run alignment only
   if relevant.
4. Ask about override reason only if calendar rules are being bypassed.

Helpful follow-up lanes:

- attached task
- exact time window
- scheduling context only if it changes the action

Ready to save when:

- the task is known
- the time window is clear
- any special scheduling context is explicit

Preferred opening question:

- "When should Forge reserve focused time for this task?"

## Task Run

Aim: start truthful live work with as little friction as possible while still knowing
what is being worked on and by whom.

Arc:

1. Confirm the task.
2. Confirm the actor only if it is not already obvious.
3. Ask whether the run should be planned or unlimited only if that changes the action.
4. Start the run instead of turning it into intake.
5. Use the dedicated task-run tool for start, heartbeat, focus, complete, and release work. Do not bounce to the Forge UI, a browser session, or a generic web route for those actions unless the user explicitly wants the visual surface.

Ready to start when:

- the task is identified clearly enough
- the actor is clear enough
- any timer mode choice that matters is explicit

Preferred opening question:

- "Which task should I start?"

Route note:

- `task_run` is an action workflow. Start live work with `/api/v1/tasks/:id/runs`.
  Use `/api/v1/task-runs/:id/heartbeat`, `/focus`, `/complete`, and `/release` for
  the rest of the run lifecycle. Do not represent live work by only changing task
  status.

## Work Adjustment

Aim: correct tracked minutes truthfully without pretending a live run happened.

Arc:

1. Ask what existing task or project the minutes belong to.
2. Ask whether time should be added or removed.
3. Ask what real work or correction the adjustment is meant to capture.
4. Ask for a short audit note only if the reason would otherwise be unclear later.

Helpful follow-up lanes:

- what record the correction belongs to
- whether the adjustment is positive or negative
- what truthful reason should stay attached to the correction

Route note:

- `work_adjustment` is an action workflow. Use the dedicated work-adjustment tool or
  `/api/v1/work-adjustments` path after the target and signed minute correction are
  clear. Do not create a fake task run or invent a standalone batch CRUD entity.

Ready to act when:

- the target task or project is clear
- the minute delta is clear
- the note is clear enough when an audit trail matters

Preferred opening question:

- "Which task or project should this time correction belong to?"

## Operator Overview

Aim: read the broad Forge state before choosing a specific action, without turning a
status check into generic intake.

Arc:

1. Ask what the user is trying to understand about Forge overall.
2. Read the operator overview before asking the user to reconstruct active work,
   attention cues, or broad status from memory.
3. Reflect the practical decision the overview should support.
4. Move into a specific entity flow only when the overview points to a concrete goal,
   project, task, habit, note, Psyche record, or follow-up action.

Helpful follow-up lanes:

- whether the user wants a broad status read, a priority decision, or a handoff
- which owner or user scope matters if several humans or bots are involved
- what decision the overview should help them make next

Route note:

- `operator_overview` is a read-model-only operator surface. Use
  `forge_get_operator_overview` or `/api/v1/operator/overview`; do not create,
  update, or delete `operator_overview` through batch CRUD.
- If the read reveals a specific record that needs work, switch to that record's
  normal route posture after the user chooses the follow-up.

Ready to review when:

- the broad question is clear enough
- any owner or user scope that changes the read is clear enough

Preferred opening question:

- "What are you trying to understand about Forge overall right now?"

## Operator Context

Aim: inspect current work, active runs, risk, and next moves before changing records.

Arc:

1. Ask whether the user is checking current work, risk, blockers, active sessions, or
   the next move.
2. Read operator context before reopening a create or update intake.
3. Reflect what the read is meant to decide: continue, stop, reprioritize, update, or
   create.
4. Move to task-run, work-adjustment, task, project, or note flow only when one
   concrete follow-up is visible.

Helpful follow-up lanes:

- current task or active run
- blocked or stale work
- next move versus broad review
- owner or user scope when bot and human work are both present

Route note:

- `operator_context` is a read-model-only operator surface. Use
  `forge_get_operator_context` or `/api/v1/operator/context`; do not mutate it
  through batch CRUD.
- If the user decides to start, complete, release, or adjust work after the read,
  switch to the dedicated action workflow for that operation.

Ready to review when:

- the current-work question is clear
- any user or owner scope is clear enough

Preferred opening question:

- "What current work, risk, or next move are you trying to check?"

## Self Observation

Aim: capture one observed episode in a structured chain without letting a loose note
replace the stronger Psyche model. A self-observation should usually name the
situation, cue, emotion/body, thought/meaning, behavior/urge, and consequence. If the
material reveals a recurring loop, belief, mode, schema theme, or
trigger chain, route toward the structured Psyche record instead of parking it as an
unstructured observation.

Arc:

1. Ask what happened in the situation.
2. Ask what cue, trigger, or shift made the episode noticeable.
3. Ask what emotion, body signal, thought, or meaning showed up.
4. Ask what behavior showed up: what the user did, wanted to do, avoided, or
   repeated next.
5. Ask what happened immediately after, including short-term relief or cost if it is
   visible.
6. Decide whether this should stay a lightweight self-observation or become a
   `trigger_report`, `behavior_pattern`, `behavior`, `belief_entry`, `mode_profile`,
   `mode_guide_session`, `flashcard`, `event_type`, `emotion_definition`, or wiki
   page.
7. Link the observation to the structured record when the structured record is the
   real container.

Helpful follow-up lanes:

- situation or event
- cue, trigger, or body shift
- emotion and intensity
- thought, meaning, belief sentence, or schema theme
- behavior, urge, avoidance, or coping move
- short-term payoff and later cost
- whether this is one episode, a recurring pattern, an active mode, or durable memory

Route note:

- `self_observation` is note-backed. Read the calendar first, then create or update an
  observed `note` with `frontmatter.observedAt` instead of inventing a standalone CRUD
  write. The read path is `/api/v1/psyche/self-observation/calendar`; the stored
  write is a linked `note` through the shared batch entity route.
- Do not promote self-observation over functional analysis. If the user is describing
  a loop, use `behavior_pattern`; if they are describing one emotionally meaningful
  episode, use `trigger_report`; if a part-state is central, use `mode_guide_session`
  or `mode_profile`; if a belief sentence is central, use `belief_entry`; if the
  user needs a rehearsable reminder during the trigger or urge, use `flashcard`.
- If the user wants to remember a source, concept, book, article, or durable personal
  explanation, use `wiki_page` rather than self-observation.

If the user already gave the event or timing, move straight to the missing part of the
chain: cue, emotion, thought, behavior, consequence, or structured Psyche link.

Ready to save when:

- the situation/event is clear
- at least one emotion/body signal, thought/meaning, or behavior/urge is clear
- timing is clear enough
- any better structured container has been chosen or linked

Preferred opening question:

- "What happened in the situation, and what did you feel, think, or do next?"

## Sleep Session

Aim: enrich one night's record with reflective context instead of treating it like a
generic note.

Arc:

1. Ask what about this night feels worth capturing.
2. Ask whether the main point is quality, pattern, context, meaning, or links.
3. Ask what goal, project, task, habit, or Psyche record it should stay connected to.
4. Ask about tags only if they will help later review.

Route note:

- For ordinary create, update, delete, or search work on `sleep_session`, stay on the
  shared batch CRUD routes. Use the reflective review helper only when enriching one
  already-known night after review.

Ready to update when:

- the reflective takeaway is clear
- the relevant links or tags are clear when needed

Preferred opening question:

- "What about this night feels important enough to remember or connect?"

## Workout Session

Aim: enrich one workout with subjective effort, mood, meaning, or linked context.

Arc:

1. Ask what about the session the user wants to preserve.
2. Ask whether the key layer is effort, mood, meaning, social context, or links.
3. Ask what it connects to in Forge if links matter.
4. Ask about tags only if they help later retrieval.

Route note:

- For ordinary create, update, delete, or search work on `workout_session`, stay on
  the shared batch CRUD routes. Use the reflective review helper only when enriching
  one already-known workout after review.

Ready to update when:

- the reflective point is clear
- the key mood, effort, meaning, or links are clear when needed

Preferred opening question:

- "What about this workout feels most worth remembering or connecting?"

## Sleep Overview

Aim: review sleep patterns before deciding whether one night needs a reflective update
or a planning follow-up.

Arc:

1. Ask what the user wants to understand from the sleep picture: one night, a recent
   trend, regularity, recovery, stages, or links to work and Psyche context.
2. Read the sleep overview before asking the user to reconstruct metrics from memory.
3. Reflect the practical question the user is trying to answer from the overview.
4. Move to `sleep_session` enrichment only when one specific night needs context,
   tags, notes, or links.

Helpful follow-up lanes:

- which night or date range matters
- whether the question is recovery, regularity, stages, schedule drift, or links
- what decision the sleep review should help with

Route note:

- `sleep_overview` is a read-model-only surface. Use `forge_get_sleep_overview` or
  `/api/v1/health/sleep` for review. Do not create, update, or delete
  `sleep_overview` through batch CRUD.
- If the review reveals that one night needs reflective context, switch to the stored
  `sleep_session` batch route or reflective update helper for that known session.

Ready to review when:

- the user's practical sleep question is clear
- the relevant night or date range is clear enough

Preferred opening question:

- "What are you trying to understand from your sleep picture right now?"

## Sports Overview

Aim: review workout context before deciding whether one workout needs a
reflective update, and route deeper cardiovascular load questions to the
training-load read model.

Arc:

1. Ask what the user wants to understand from the sports picture: one workout, a
   recent training trend, effort, volume, type mix, recovery, zone balance, or
   links to mood and goals.
2. Read the sports overview before asking the user to reconstruct metrics from memory.
3. Reflect the practical decision the review should support.
4. Move to `workout_session` enrichment only when one specific workout needs context,
   tags, notes, or links.

Helpful follow-up lanes:

- which workout or date range matters
- whether the question is load, effort, activity type, recovery, mood, or links
- what decision the sports review should help with

Route note:

- `sports_overview` is a read-model-only surface. Use `forge_get_sports_overview` or
  `/api/v1/health/fitness` for session review. Do not create, update, or delete
  `sports_overview` through batch CRUD.
- For cardiovascular load, HR zone distribution, zone-time by week/month/day,
  acute/chronic load, VO2max context, smart training modes, 4x4 suitability,
  next-workout guidance, or training target questions, use
  `forge_get_training_load_overview` or `/api/v1/health/training-load`. Treat
  `training_load` as read-model-only, not a batch CRUD entity.
- If the review reveals that one workout needs reflective context, switch to the
  stored `workout_session` batch route or reflective update helper for that known
  session.

Ready to review when:

- the user's practical training or recovery question is clear
- the relevant workout or date range is clear enough

Preferred opening question:

- "What are you trying to understand from your workout picture right now?"

## Training Load

Aim: review cardiovascular load and training targets before deciding whether one
workout needs reflective enrichment or a recovery/target adjustment.

Arc:

1. Ask what practical decision the user wants to support: build aerobic base,
   control overload risk, preserve hard-day quality, understand combat-sport
   intensity, or compare recent load against chronic base.
2. Read the training-load overview before asking the user to reconstruct zones,
   VO2max, or recent hard sessions from memory.
3. Reflect the load signal with explicit confidence: HR coverage, sensor limits,
   recent sample count, and whether kickboxing/wrist HR may be noisy.
4. Move to `workout_session` enrichment only when one specific workout needs
   notes, tags, context, or links.

Helpful follow-up lanes:

- whether the question is adaptation, overload risk, zone target, VO2max trend,
  sport contribution, or one recent session
- which date range matters if the default 7-day and 28-day windows are not enough
- whether the user is optimizing health, performance, recovery, or a specific
  upcoming training block

Route note:

- `training_load` is a read-model-only surface. Use
  `forge_get_training_load_overview` or `/api/v1/health/training-load` for
  cardiovascular load, HR zone distribution, acute/chronic load, VO2max context,
  and training target analysis. Do not create, update, or delete `training_load`
  through batch CRUD.
- If one workout needs subjective effort, meaning, social context, or links,
  switch to the stored `workout_session` batch route or reflective update helper.

Ready to review when:

- the user's practical adaptation or recovery question is clear
- the relevant time window or default 7-day/28-day comparison is acceptable

Preferred opening question:

- "What training-load decision are you trying to support right now?"

## Weight Loss

Aim: review and capture nutrition, body-composition, sport-fueling, aesthetic,
subjective-energy, craving, and gut-comfort evidence before turning observations
into a testable food or training hypothesis.

Arc:

1. Ask what link the user is trying to understand: fat loss pace, food intake,
   training fuel, look/puffiness, energy, cravings, gut comfort, or a specific
   meal reaction.
2. Read `forge_get_weight_loss_overview` before asking the user to reconstruct
   recent food, weight, workouts, or subjective state from memory.
3. Use `forge_parse_food_log_with_chatgpt` for rough meal text or photo
   descriptions. This must go through Forge's configured `openai-codex` ChatGPT
   subscription connection, not a metered OpenAI API path.
4. Use `forge_log_food`, `forge_log_body_checkin`,
   `forge_log_appearance_checkin`, `forge_log_subjective_food_effect`, and
   `forge_log_gut_checkin` to preserve the user's actual evidence.
5. For `forge_log_food`, call `forge_search_foods` or barcode lookup first. Reuse
   a matching result through `item.foodId`. If there is no match, create a custom
   food only after researching calories, protein, carbohydrate, and fat; include
   `caloriesKcal`, `proteinG`, `carbsG`, and `fatG` in the item.
6. Use `forge_get_nutrition_patterns`, `forge_start_nutrition_experiment`, and
   `forge_update_nutrition_experiment` when repeated observations should become
   an N-of-1 test instead of vague advice.

Helpful follow-up lanes:

- whether the decision is weight trend, protein/fiber sufficiency, sport fuel,
  visual look, water retention, gut comfort, cravings, or energy
- whether a meal should be confirmed precisely or logged as a candidate estimate
- whether a searched/catalog food can be reused by `foodId` or whether a researched
  custom food with calories and macros is needed
- which outcome metric should define a nutrition experiment before interpreting it

Route note:

- `weight_loss` is a health read model plus dedicated nutrition write workflow.
  Use `/api/v1/health/weight-loss` or `forge_get_weight_loss_overview` for the
  overview. Do not invent generic batch entities for food logs or body check-ins
  when the dedicated tools exist. Food search reads Forge's local custom/cache
  database plus public nutrition catalogs. `forge_log_food` rejects custom items
  without calories, protein, carbohydrate, and fat.

Ready to review when:

- the food, body, training-fuel, gut, craving, appearance, energy, or experiment
  question is clear enough to choose the overview, log, check-in, or experiment
  path

Preferred opening question:

- "What food-body link are you trying to test or understand right now?"

## Calendar Overview

Aim: review commitments, work blocks, provider state, and existing timeboxes before
creating or changing calendar records.

Arc:

1. Ask what the user is trying to understand or decide from the calendar picture.
2. Ask for the date range or owner scope only if it changes the read.
3. Read the calendar overview before asking the user to recreate availability from
   memory.
4. Reflect the practical decision the overview should support.
5. Move to `calendar_event`, `work_block_template`, `task_timebox`, or
   `calendar_connection` only when a specific follow-up action is visible.

Helpful follow-up lanes:

- which day, week, or date range matters
- whether the question is availability, conflicts, provider health, work blocks, or
  existing timeboxes
- what scheduling or planning decision the review should support

Route note:

- `calendar_overview` is a read-model-only calendar surface. Use
  `forge_get_calendar_overview` or `/api/v1/calendar/overview`; do not create,
  update, or delete `calendar_overview` through batch CRUD.
- If the review reveals a concrete scheduling action, switch to the stored
  `calendar_event`, `work_block_template`, or `task_timebox` batch route, or to the
  specialized `calendar_connection` lifecycle route.

Ready to review when:

- the user's practical calendar question is clear
- the relevant date range or owner scope is clear enough

Preferred opening question:

- "What are you trying to understand or decide from your calendar picture?"

## Calendar Connection

Aim: connect the right provider deliberately without turning setup into a credential
dump.

Arc:

1. Ask which provider the user wants to connect and what they want Forge to do with
   it.
2. Ask whether the goal is read-only visibility, writable planning, or both.
3. Ask what workflow they are trying to unlock so the connection stays grounded in a
   real use case.
4. Ask only for the next provider-specific step that still matters, such as auth flow,
   label, or calendar selection.
5. If the user is updating or removing an existing connection, ask which connection
   and what exact lifecycle action they want before touching credentials or sync.
6. Move into the actual connection flow once the setup goal is clear.

Helpful follow-up lanes:

- what calendar workflow the user wants to unlock
- whether writable projection matters
- whether the provider requires a local sign-in step instead of manual fields
- whether this is new setup, rediscovery, selected-calendar update, sync, or removal

Route note:

- `calendar_connection` is a specialized CRUD surface, not a batch CRUD entity.
- Use `GET /api/v1/calendar/connections` to read existing connections.
- Use `POST /api/v1/calendar/discovery` for Apple or custom CalDAV discovery and
  `GET /api/v1/calendar/macos-local/discovery` for calendars already configured on
  this Mac.
- Use `GET /api/v1/calendar/connections/:id/discovery` before changing selected
  calendars on an existing connection.
- Use `POST /api/v1/calendar/connections`, `PATCH /api/v1/calendar/connections/:id`,
  `POST /api/v1/calendar/connections/:id/sync`, or
  `DELETE /api/v1/calendar/connections/:id` for the connection lifecycle.

Ready to act when:

- the provider is clear
- the intended sync behavior is clear enough
- the user-facing workflow that depends on the connection is clear enough
- the next setup step is obvious

Preferred opening question:

- "What workflow do you want this calendar connection to unlock?"

## Preference Judgment

Aim: capture one pairwise preference decision with the right context, not just log a
left-versus-right click.

Arc:

1. Ask what comparison the user is actually trying to settle.
2. Ask which context or domain this judgment belongs to.
3. Ask whether the result is left, right, tie, or skip.
4. Ask for reason tags or strength only if they will improve later interpretation.

Helpful follow-up lanes:

- what the comparison is really about
- which preference context should own the signal
- whether the choice feels decisive, weak, tied, or not ready

Route note:

- `preference_judgment` is an action workflow. Submit it through
  `POST /api/v1/preferences/judgments` with the preferences judgment tool, not batch
  CRUD.

Ready to act when:

- the left and right items are clear
- the outcome is clear
- the relevant context or profile is clear enough

Preferred opening question:

- "What comparison are you actually trying to settle here?"

## Preference Signal

Aim: store a direct preference signal such as favorite, veto, bookmark, or
compare-later with the context that makes it interpretable later.

Arc:

1. Ask what item the user wants to mark.
2. Ask what signal they want to give it.
3. Ask what domain or context this belongs to if that is still unclear.
4. Ask about strength only if the user is expressing a gradient rather than a simple mark.

Helpful follow-up lanes:

- what item is being marked
- whether this is a favorite, veto, bookmark, neutral, or compare-later signal
- what context makes the signal meaningful

Route note:

- `preference_signal` is an action workflow. Submit it through
  `POST /api/v1/preferences/signals` with the preferences signal tool, not batch CRUD.

Ready to act when:

- the item is clear
- the signal type is clear
- the context is clear enough if it changes interpretation

Preferred opening question:

- "What do you want Forge to remember about this item right now?"

## Movement

Aim: clarify whether the user wants to understand time in place, review travel
behavior, add or update a stay or trip, create or clean up a known place, change
movement operating settings, or link movement context to another Forge record before
choosing the dedicated route family.

Arc:

1. Ask what they are trying to make clearer, repair, or preserve about where they
   were before you narrow to the exact movement lane.
2. Ask whether the user is trying to query behavior, add something manually, update
   an existing movement item, or link movement to another Forge entity.
3. Ask whether the focus is a stay, a trip, a place, a timeline window, or a selected span.
4. If this is place creation or cleanup, ask what label, boundary, and future use
   should make the place recognizable later.
5. Ask for the time window, place, or movement item that makes the question concrete.
6. Ask what they are trying to notice, preserve, or answer through that movement context.
7. If the user is changing movement operating behavior, ask whether the change is
   about passive tracking, publish mode, retention, or companion readiness.
8. Choose the dedicated day, month, all-time, timeline, places, trip-detail,
   selection, or settings route once the question shape is clear.
9. If the truth of one uncertain span is still unclear, read the timeline or saved-box
   detail before you mutate it.
10. Skip the meta lane question when the user already named the exact correction or
   review target and only one ambiguity remains.
11. Use the dedicated movement route once you know whether the user needs timeline
   review, overlay, place or trip detail, selection summary, settings, or repair.

Direct action rules:

- If the user is clearly talking about a missing-data gap that should become a stay or
  trip, use a user-defined movement box.
- Treat day, month, all-time, timeline, trip detail, and selection as internal read
  lanes. With the user, ask for the useful time window, place, selected span, stay, or
  trip instead of listing route choices.
- Treat settings as a separate movement lane for passive capture, publish mode, and
  retention behavior. Ask what operating behavior should change instead of routing it
  through a place, stay, or trip edit.
- Use settings reads before settings writes when the current capture or publish state
  is uncertain.
- Preflight with `/api/v1/movement/user-boxes/preflight` when overlap or exact timing
  is unclear, then create the overlay with `/api/v1/movement/user-boxes`.
- Use `kind: "stay"` when the user stayed in one place and `kind: "trip"` when they
  traveled.
- Use raw `PATCH /api/v1/movement/stays/:id` or `/api/v1/movement/trips/:id` only for
  editing an already-recorded stay or trip, not for filling a missing span.
- If the user wants to undo or remove one manual overlay, delete the saved
  user-defined box instead of patching a recorded stay or trip.
- If the user wants to inspect one already-saved movement correction before editing
  it, read the box detail first so the follow-up write stays grounded in the saved
  object.
- If the user is asking where they were during one uncertain window, prefer a timeline
  read before you create a correction. Mutate only after the lived truth is clear.
- When the user has already given the real answer, for example "I stayed home during
  that missing block", do not ask a broad review question again. Confirm only the
  interval or place if that is still ambiguous, then act.
- When you do act on a concrete missing-gap correction, create the overlay and read
  the relevant timeline back instead of leaving the correction ungrounded.
- For known-place creation or cleanup, ask what the place should be called, what
  counts inside its boundary, and how future movement reads should use it. Use the
  dedicated place routes, not a tag or batch entity write.
- After a Movement repair, known-place edit, settings change, overlay deletion, or
  automatic-box invalidation, verify through the relevant dedicated read when the
  user is trying to understand whether the movement picture is now truthful.

Helpful follow-up lanes:

- whether the user wants time-in-place, travel history, one specific stay or trip, a
  place summary, or a link
- what time window, place, stay, trip, or selection is in scope
- what label, boundary, or future-use distinction makes a known place worth saving or
  renaming
- whether the question is behavioral, such as time at home, travel frequency, or place
  distribution, versus an edit
- whether the edit is a missing-gap overlay versus a true recorded stay/trip patch
- whether the user is trying to repair one recorded movement item versus fill a
  missing span
- whether they are changing passive capture, publish mode, retention, or companion
  readiness rather than movement history

Lane-to-route map:

- review one day or month:
  `/api/v1/movement/day` or `/api/v1/movement/month`
- review long-range behavior or dominant places:
  `/api/v1/movement/all-time`, `/api/v1/movement/places`, or `/api/v1/movement/selection`
- inspect the full life timeline:
  `/api/v1/movement/timeline`
- inspect or change passive capture and publishing settings:
  `GET /api/v1/movement/settings` or `PATCH /api/v1/movement/settings`
- create or revise one saved place:
  `/api/v1/movement/places` or `/api/v1/movement/places/:id`
- inspect one trip:
  `/api/v1/movement/trips/:id`
- inspect one saved movement box before repairing it:
  `/api/v1/movement/boxes/:id`
- fill a missing span:
  `/api/v1/movement/user-boxes/preflight` then `/api/v1/movement/user-boxes`
- repair or revise one saved overlay:
  `/api/v1/movement/user-boxes/:id`
- delete one saved overlay:
  `DELETE /api/v1/movement/user-boxes/:id`
- repair one recorded automatic box:
  `/api/v1/movement/automatic-boxes/:id/invalidate`
- edit an already-recorded stay, trip, or trip point:
  `/api/v1/movement/stays/:id`, `/api/v1/movement/trips/:id`, or `/api/v1/movement/trips/:id/points/:pointId`
- delete an already-recorded stay, trip, or trip point:
  `DELETE /api/v1/movement/stays/:id`, `DELETE /api/v1/movement/trips/:id`, or `DELETE /api/v1/movement/trips/:id/points/:pointId`

Ready to act when:

- the movement question or correction is clear
- the time range, place, stay, trip, or selection is clear enough
- the user goal is clear enough to tell review, overlay, and repair apart
- the user goal is clear enough to choose the route
- for settings changes, the intended tracking, publish, or retention behavior is clear

Preferred opening question:

- "What are you trying to understand, correct, or preserve about where you stayed and traveled?"

## Life Force

Aim: clarify whether the user wants to review current energy state, change durable
profile assumptions, edit weekday curves, log a real-time fatigue signal, or make a
planning decision based on the energy model.

Arc:

1. Ask what feels off, important, or worth tracking in their energy picture before
   you reduce it to one life-force lane.
2. Ask whether the job is overview, profile change, weekday-template change, or fatigue signaling.
3. Ask what part of the current energy picture feels most important or inaccurate.
4. Ask what planning decision should change if the model is corrected: workload,
   recovery, timeboxing, meeting load, or task choice.
5. Ask what should stay true if they are changing profile or template assumptions.
6. Ask whether the user is describing a stable weekly shape or just how today feels
   when the lane is still blurred.
7. If the user describes a repeatable day-shape such as "Mondays crash after lunch",
   treat that as a weekday-template question before you reach for profile or
   fatigue-signal routes.
8. If the user already named the life-force lane clearly, skip the meta lane question
   and ask only for the specific weekday, profile field, or signal that still matters.
9. If the user wants to see what changed after a write, read the overview back instead
   of leaving the result implicit.
10. Route to the dedicated life-force path once the lane is clear.

Helpful follow-up lanes:

- whether the user wants explanation, editing, or signaling
- what part of the energy model feels off or useful
- what planning decision the overview or correction should change
- what durable assumption versus real-time state is being changed
- whether the user is describing a stable weekly shape or just how today feels

Lane-to-route map:

- understand the current energy picture:
  `GET /api/v1/life-force`
- change durable profile assumptions:
  `PATCH /api/v1/life-force/profile`
- change one weekday curve or template:
  `PUT /api/v1/life-force/templates/:weekday`
- log a real-time tired or recovered signal:
  `POST /api/v1/life-force/fatigue-signals`

Direct action rules:

- In onboarding, this surface may be keyed as `lifeForce` and also as the entity-style
  alias `life_force`. Treat both names as the same dedicated Life Force route family,
  not as batch CRUD.
- Treat overview, profile, weekday-template, and fatigue-signal lanes as internal
  route choices. With the user, ask whether this is a current read, a durable
  assumption, a repeated weekday rhythm, or a right-now state instead of reciting route
  names.
- The overview route key is `overview` and the concrete runtime path is
  `GET /api/v1/life-force`. Do not invent `/api/v1/life-force/overview`.
- If the user is describing a durable baseline such as work capacity, recovery style,
  or action-point assumptions, patch the profile instead of logging a fatigue signal.
- If the user is describing a repeatable weekday rhythm, update that weekday template
  instead of treating it as a one-off right-now feeling.
- If the user is describing how one weekday should usually feel, update that weekday
  template instead of editing the profile.
- If the user only needs an explanation or planning read, use the overview first and
  do not turn the conversation into a profile or template mutation.
- For profile or weekday-template edits, ask what future planning behavior should
  change, such as workload, recovery time, timeboxes, meeting load, or task choice,
  so the write is not just a more polished description.
- If the user says something like "I always dip on Tuesdays after lunch", treat that
  as a weekday-template edit, not as a one-off fatigue signal.
- If the user is describing right-now depletion or recovery, post a fatigue signal and
  then read the overview back if they want to see the updated picture.
- After a profile or weekday-template change, read the overview back when the user is
  trying to understand the practical impact of the change, not just store it silently.
- After a fatigue signal, profile patch, or weekday-template edit, verify through the
  Life Force overview when the next planning decision depends on the updated energy
  picture.

Ready to act when:

- the life-force lane is clear
- the relevant weekday, profile field, or signal is clear enough
- the user intent is clear enough to choose overview versus mutation

Preferred opening question:

- "What feels most off, important, or worth understanding in your energy picture right now?"

## Workbench

Aim: clarify whether the user wants to inspect a flow, edit it, run it, or inspect
results so the agent uses the dedicated workbench contract instead of vague CRUD.

Arc:

1. Ask what they are trying to learn, repair, publish, or run through Workbench
   before you narrow to flow discovery, editing, execution, or results.
2. Ask whether the job is flow discovery, one flow edit, execution, run history, published output, node-level inspection, latest-node-output lookup, or a follow-up message in a saved flow chat.
3. Ask which flow, slug, run, or node the request is about.
4. Ask whether they need the stable flow contract, one run result, one published
   output, one node result, or the latest node output.
5. If the user is creating or editing a flow, clarify the flow's job, stable inputs,
   expected public output, and the smallest structural change before asking for node
   details.
6. If the user wants one-off execution, clarify whether this should stay a one-time
   input run or become a reusable saved flow before creating anything durable.
7. If the user wants to delete or archive a flow, ask which saved flow is affected
   and what future run, published output, or public contract should no longer exist.
8. If the user wants to continue a saved flow chat, ask which flow should receive the
   follow-up and what the message should accomplish.
9. If the user already named the flow and action clearly, skip the meta lane
   question and ask only for the missing run, node, or output scope.
10. If the user wants a stable public input contract or published output, prefer those
   dedicated reads instead of detouring through run history first.
11. If the user is debugging one failed run, ask whether the useful artifact is the run
   summary, one node result, the latest node output, or the published output before
   you start asking for edits.
12. Route to the dedicated workbench route family once the execution lane is clear.

Helpful follow-up lanes:

- whether the user wants structure, execution, or results
- what exact flow or run is in scope
- whether they need whole-flow output or node-level detail
- whether they need a public input contract or a published output instead of a debug trace
- whether a requested execution should remain one-off or become a reusable saved flow

Lane-to-route map:

- discover or inspect flows:
  `/api/v1/workbench/flows`, `/api/v1/workbench/flows/:id`, or `/api/v1/workbench/flows/by-slug/:slug`
- create, update, or delete a flow:
  `POST /api/v1/workbench/flows`, then `PATCH /api/v1/workbench/flows/:id` or
  `DELETE /api/v1/workbench/flows/:id` for an existing saved flow
- run a known flow:
  `/api/v1/workbench/flows/:id/run`
- run from a one-off input contract:
  `/api/v1/workbench/run`
- send one follow-up message into a saved flow chat:
  `POST /api/v1/workbench/flows/:id/chat`
- inspect published output or run history:
  `/api/v1/workbench/flows/:id/output` or `/api/v1/workbench/flows/:id/runs`
- inspect one run or node result:
  `/api/v1/workbench/flows/:id/runs/:runId`,
  `/api/v1/workbench/flows/:id/runs/:runId/nodes`,
  `/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId`
- inspect the latest successful node output:
  `/api/v1/workbench/flows/:id/nodes/:nodeId/output`
- inspect available box inputs:
  `/api/v1/workbench/catalog/boxes`

Direct action rules:

- If the user needs the stable public contract of a flow, prefer the flow detail or
  published-output routes before a run-history read.
- Treat saved-flow catalog, box catalog, run history, run detail, node result, latest
  node output, and published output as internal read lanes. With the user, ask whether
  they need the saved flow, its input contract, one run, one node, or the public
  result instead of listing route keys.
- For flow catalog questions, use `GET /api/v1/workbench/flows`; for available box
  inputs, use `GET /api/v1/workbench/catalog/boxes`. Do not blur those into one vague
  "catalog" read when the user needs a runnable flow versus an input-box contract.
- If the user wants to execute a known saved flow, use `/api/v1/workbench/flows/:id/run`.
- If the user wants one-off input execution without depending on a saved flow id, use
  `POST /api/v1/workbench/run` through the dedicated one-off execution lane and keep
  the user-facing question about the one-off input contract.
- For one-off execution, do not create a saved flow unless the user wants reuse. Ask
  whether the input contract should be temporary or durable, then route to
  `POST /api/v1/workbench/run` for the temporary case.
- If the user wants to debug one failed execution, narrow whether they need the run
  detail, one node result, the latest node output, or the published output before you
  ask for flow changes.
- If the user only wants a published output, latest node output, or run detail, do not
  reopen a flow-edit intake before reading that artifact.
- If the user wants one node's latest successful output, do not browse old runs first
  unless they explicitly want historical debugging.
- If the user wants to understand what inputs a flow can accept before editing or
  running it, read the box catalog or flow detail before asking for structured
  input details.
- For new flows, ask what the flow should reliably produce, what input contract it
  should accept, and what first node or box should anchor it. Do not start by asking
  for raw JSON.
- For flow edits, ask what behavior should change and how the public contract stays
  stable, unless the user explicitly wants to change the contract.
- For flow deletion, confirm the saved flow and whether published outputs or run
  history still need to be preserved elsewhere before calling delete.
- For flow chat follow-ups, use the saved flow chat route only when the user wants to
  continue a flow-specific conversation. Do not turn a chat follow-up into a new flow
  run, note, or generic entity update unless that is what the user asks for.
- After Workbench execution, flow edits, chat follow-ups, or publish-related work,
  verify through the matching dedicated read: run detail, node result, latest node
  output, flow detail, run history, or published output. Do not leave a run or edit
  as an abstract success message when the user asked to inspect or use the result.

Ready to act when:

- the workbench lane is clear
- the flow, run, or node is clear enough
- the requested read or mutation is clear enough to choose the route
- for flow CRUD, the intended stable input, output, or lifecycle effect is clear
- for flow chat, the saved flow and follow-up message aim are clear

Preferred opening question:

- "What are you trying to inspect, change, run, or publish through Workbench?"

## Preference Catalog

Aim: define a useful comparison pool, not just a list with no decision purpose.

Arc:

1. Ask what preference question this catalog is meant to support.
2. Ask what domain or concept area it belongs to.
3. Ask what kinds of items should be included or excluded.
4. Offer a working catalog name once the purpose is clear.

Helpful follow-up lanes:

- what decision or taste question this catalog should help answer
- what belongs in scope
- what would make the catalog immediately useful instead of bloated

Route note:

- `preference_catalog` is normal stored Preferences CRUD. Use the shared batch entity
  routes unless the user is playing the comparison game or submitting a judgment or
  signal.

Ready to save when:

- the catalog has a stable purpose
- the domain is clear
- the boundary of what belongs inside is clear enough

Preferred opening question:

- "What decision or taste question should this catalog help with?"

## Preference Catalog Item

Aim: add one candidate in a way that will make later comparisons feel clear and fair.

Arc:

1. Ask what makes this item worth including in the catalog.
2. Ask what catalog or domain it belongs to if that is still unclear.
3. Ask what would make the comparison confusing or unfair if the label stayed as-is.
4. Ask for a short clarifying description only if the label would be ambiguous later.
5. Ask about aliases or tags only if they help retrieval.

Helpful follow-up lanes:

- why this item belongs in the comparison pool
- what would distinguish it from nearby items
- whether the label alone will be clear later

Route note:

- `preference_catalog_item` is normal stored Preferences CRUD. Use batch entity
  create/update/search for catalog membership and wording changes.

Ready to save when:

- the item label is clear
- the parent catalog is clear
- there is enough context to recognize it later if the label is ambiguous

Preferred opening question:

- "What makes this option meaningfully worth comparing?"

## Preference Context

Aim: define a real operating mode for preferences, not a decorative label.

Arc:

1. Ask what situation or mode this context is meant to represent.
2. Ask what decisions or comparisons should feel different inside that context.
3. Ask what should count inside that context and what should stay outside it.
4. Ask whether it should be active, default, or kept separate from other evidence.
5. Offer a concise name if the mode is clearer than the wording.

Helpful follow-up lanes:

- what decisions this context should shape
- what belongs inside versus outside the mode
- whether it should be default or explicitly separate

Route note:

- `preference_context` is normal stored Preferences CRUD. Use batch entity
  create/update/search for context definition changes.

Ready to save when:

- the context has a stable purpose
- its boundary is clear enough to use consistently
- any default or sharing choice that matters is clear

Preferred opening question:

- "In what situation should Forge treat your preferences differently here?"

## Preference Item

Aim: save one concrete preference candidate or signal without losing the context that
makes it meaningful.

Arc:

1. Ask what preference or taste question this item belongs to.
2. Ask what domain or context it should live in.
3. Ask whether the user is saving a comparison candidate or a direct signal such as
   favorite, veto, or compare-later.
4. Ask what makes the item distinct enough to compare usefully only if it is still a
   comparison candidate.

Helpful follow-up lanes:

- what domain this belongs to
- what context makes the preference meaningful
- whether this is a signal or a comparison candidate
- what distinguishes the item from nearby options

Route note:

- `preference_item` is normal stored Preferences CRUD when saving or editing a
  candidate. Use `preference_judgment` or `preference_signal` routes only when the
  user is recording a comparison outcome or direct mark.

Ready to act when:

- the item is clear
- the domain or profile context is clear enough
- any needed distinguishing detail is captured

Preferred opening question:

- "What preference are you trying to make clearer by saving this item?"

## Questionnaire Instrument

Aim: clarify whether the user is authoring a reusable questionnaire and what honest
moment, pattern, or decision the instrument should help someone notice.

Arc:

1. Ask what honest moment, pattern, or decision the questionnaire should help someone
   notice.
2. Ask who it is for and when it should be used.
3. Ask what the respondent should understand after answering that they might otherwise
   miss.
4. Reflect the practical use case back in plain language before asking for item
   wording.
5. Ask what would make the instrument distinct instead of redundant if a
   near-duplicate risk is visible.
6. Ask about item shape, response scale, scoring, or provenance only after the purpose
   and use context are steady.
7. Move to draft creation once the purpose is clear.

Helpful follow-up lanes:

- what honest moment, decision, or review this instrument should support
- who will answer it and under what circumstances
- what the answers should help the respondent understand or choose
- what would make the instrument distinct instead of redundant

Route note:

- `questionnaire_instrument` is normal stored CRUD for ordinary create, update,
  delete, and search work. Use clone, draft, and publish action routes only when the
  user is working with instrument version state. Questionnaire action paths live under
  `/api/v1/psyche/questionnaires`, including `/:id/clone`, `/:id/draft`, and
  `/:id/publish`.

Ready to act when:

- the purpose is clear
- the audience or use context is clear
- the respondent-facing insight or decision is clear
- the instrument is distinct enough to draft

Preferred opening question:

- "What honest moment or decision should this questionnaire help someone notice or track?"

## Questionnaire Run

Aim: clarify whether the user wants to start, continue, review, or complete one answer
session without turning the run into a mechanical form fill.

Arc:

1. Ask what the user wants from the run right now: start, continue, review, or finish.
2. Ask which questionnaire or existing run this is about.
3. If the user wants to continue or finish, ask what feels most stuck, unfinished, or
   important before asking for more content.
4. If the user is reviewing answers, ask what the run should help them understand
   before proposing edits or completion.
5. If answering is still in progress, ask only for the next answer or note that matters.

Helpful follow-up lanes:

- whether the job is to begin, resume, review, or complete
- what questionnaire or run is in scope
- what next answer, uncertainty, or note is actually blocking progress
- what the completed run should help the user understand or decide

Route note:

- `questionnaire_run` is an action workflow. Use the questionnaire run start, read,
  update, and complete routes instead of treating answers as generic batch CRUD:
  `/api/v1/psyche/questionnaires/:id/runs`,
  `/api/v1/psyche/questionnaire-runs/:id`, and
  `/api/v1/psyche/questionnaire-runs/:id/complete`.

Ready to act when:

- the questionnaire is identified
- the user intent for the run is clear

Preferred opening question:

- "Are you trying to start, continue, review, or finish this run right now?"

## Event Type

Aim: bridge into the Psyche playbook for a reusable incident category without
flattening the lived episode into cold taxonomy. `event_type` is a Psyche taxonomy
record: use the deeper Event Type guidance in `psyche_entity_playbooks.md` when the
user is exploring meaning, and keep this section as the route and handoff reminder.

Arc:

1. Ask what kind of emotionally meaningful moment keeps recurring and why naming it
   consistently would help future trigger reports.
2. Reflect the repeated moment back in plain language by naming the emotional or
   relational stake before narrowing the wording.
3. Ask for one recent example if the boundary is still abstract.
4. Clarify what belongs inside this event type and what should stay outside it.
5. Offer one concise candidate label once the repeated moment is clear.
6. Link it to trigger reports, beliefs, patterns, modes, or emotion definitions only
   after the category itself feels accurate.

If the user already offered a candidate label, keep the wording provisional and ask
what kinds of moments belong inside it before you ask whether the label is right.

Route note:

- `event_type` is psychologically meaningful but still uses shared batch CRUD for
  storage. Search and mutate it through the shared entity routes after the lived
  category, boundary, and wording are clear enough. Do not treat it as a generic tag
  or route it through `self_observation`.

Ready to save when:

- the repeated moment is understandable in plain language
- the boundary is clear enough for future reports to use consistently
- the label feels accurate enough or has one candidate wording to confirm

Preferred opening question:

- "What kind of moment keeps happening that you want future reports to name the same way each time?"

## Emotion Definition

Aim: `emotion_definition` is a Psyche taxonomy record, so bridge into the Psyche
playbook for a reusable emotion entry by its lived signature, not by a dictionary
definition. Use the deeper Emotion Definition guidance in
`psyche_entity_playbooks.md` when the user is exploring the feeling.

Arc:

1. Ask when this feeling was present recently and what made it recognizable.
2. Reflect the felt signature back in plain language before asking for category or
   label polish.
3. Ask what distinguishes it from nearby emotions if that matters.
4. Ask what the feeling tends to signal, protect, warn about, long for, or demand.
5. Offer one concise definition in the user's language and invite correction.
6. Link it to trigger reports, modes, beliefs, or patterns only after the definition
   feels steady.

Helpful follow-up lanes:

- what tells the user this is that feeling and not a nearby one
- body signal, urge, image, thought, or relational meaning that identifies it
- what kind of moments this emotion name should be used for later
- what the feeling usually warns about, longs for, protects, or demands

Route note:

- `emotion_definition` is psychologically meaningful but still uses shared batch CRUD
  for storage. Search and mutate it through the shared entity routes after the felt
  signature, boundary, and wording are clear enough. Do not treat it as a generic
  dictionary item.

Ready to save when:

- the label is clear
- the felt signature is clear enough to recognize later
- the boundary from nearby feelings is clear enough when it matters
- the definition can be written in language the user recognizes

Preferred opening question:

- "When this feeling is present, what tells you it is this feeling and not a nearby one?"
