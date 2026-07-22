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
- Do not use vague reflective filler such as "tell me more about that", "can you say
  more", or "what feels important here" after the user has already given a concrete
  target, span, object, wording, or correction. Replace it with a named observation
  and the one question that would change the save, read, run, link, or update.
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
- For straightforward logistical entities such as tasks, calendar events, work
  blocks, timeboxes, and task runs, use a fast path:
  one brief confirming sentence -> one operational question.
- For action-heavy flows such as work adjustments, preference judgments, preference
  signals, and Movement, Life Events, Life Force, or Workbench work, first
  ask what the user is trying to understand, change, add, update, link, or run, then
  route to the dedicated action or domain path instead of pretending it is normal
  CRUD.
- For specialized domain areas, ask what would make the answer or change useful before you
  ask route-shaped details such as provider, Life Event id, artifact id, weekday,
  flow id, run id, or trip id.
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

## Depth calibration

Use this before choosing how much to ask. The goal is to match the user's actual job,
not to make every entity feel equally deep.

- Quick capture: the user already gave usable wording and says "save this", "remember
  this", "log this", or otherwise makes storage the job. Reflect the working shape
  once, ask only the one structural, accuracy, or consent detail that changes the
  write, and do not force a full exploration.
- Guided formulation: the user wants to understand, name, map, decide, or work
  through unclear or charged material. Use active listening, one lane at a time, and
  Psyche hypotheses when appropriate before saving.
- Review-first: the user wants to inspect, compare, navigate, or understand something
  already in Forge. Read the relevant stored entity, overview, or specialized surface
  before asking write-shaped questions.
- Action-first: the target task run, work adjustment, preference judgment or signal,
  questionnaire run, Movement correction, Life Event calendar sync, ticket import, or
  status read, Life Force signal/template, or Workbench run/output is already clear.
  Act, or ask only for the missing target, span, event, artifact, weekday, flow, run,
  node, correction, or consent.
- Do not downgrade psychologically meaningful material into quick capture when the
  user is asking to understand it. Do not expand a simple storage request into therapy
  or project planning when a concise save is enough.

## Plain-language rule

Keep API and architecture nouns inside your own reasoning. Do not ask the user about
"surfaces", "route families", "CRUD", "payloads", "mutation paths", or "read paths".
With the user, say the human thing:

- "Movement timeline", "place", "trip", "missing block", or "time window"
- "Life Event", "calendar match", "ticket import", "travel status", or
  "life timeline"
- "Energy model", "weekday pattern", or "fatigue signal"
- "Workbench flow", "run", "published output", or "node result"
- "Wiki page", "artifact file", "provenance", "note", "trigger report",
  "behavior pattern", "belief", or "mode"

The API path still matters, but it should not leak into the question unless the user
is explicitly asking about implementation.

## User-facing wording guard

Use this guard after the opening question too. Later turns, read summaries, and
confirmations should stay as concrete as the first question.

- Do not say "that sounds important" unless you name the stake: what the user is
  trying to protect, recover, decide, remember, repair, schedule, or publish.
- Do not ask "what would you like to do with this?" after the user's verb, the read
  result, or the selected route lane already makes one next action visible. Name the
  next action and ask only for the missing product detail, or close cleanly.
- Replace implementation words with product nouns before the sentence reaches the
  user. Say missing stay, place boundary, weekday energy curve, saved flow, failed
  run, node output, Life Event, calendar match, ticket import, travel status,
  belief sentence, pattern, flashcard, wiki page, calendar connection, artifact file,
  provenance, generic entity link, or task run instead of
  endpoint, payload, mutation, batch route, or route key.
- If the only honest next sentence would be a generic reflection or a route-shaped
  question, pause and identify the product noun internally. If you still cannot name
  it, ask one grounding question about the real moment, span, object, or decision.
- After a read or write, never add a conversational tail just to sound warm. If no
  answer-changing uncertainty remains, summarize the result in product language and
  stop.

## Internal action trace, external wording

Before you ask or act, keep a private action trace: intent, entity or dedicated
domain lane, exact read/write/run tool, required target identifiers, and the one
missing detail that would change the action. Do not narrate that trace to the user.

- If the trace is clear, ask the user only for the missing real-world detail:
  which span, place, event, artifact, weekday, flow, run, node, belief sentence, parent record, or
  save confirmation.
- If the trace is not clear, ask one product-language question that resolves it
  instead of presenting API options.
- When you report what you did, say the product action first: saved the belief,
  corrected the missing stay, updated the weekday energy pattern, read the failed
  node, or published the flow output. Mention route keys, HTTP paths, payloads, or
  batch routes only for implementation debugging.
- This is especially important after mixed-intent requests. The user should feel a
  coherent sequence, not see your internal routing table.

## Known-target fast path

Use this when the user's words already name the object, action, and likely route lane.
The agent should not make the user pass through the general opener again.

- For normal stored entities, if the user gave the accepted wording and the intended
  operation, ask only for the parent, owner, or duplicate-disambiguation detail that
  would change the write. If none would change it, summarize and save.
- For task hierarchy work, if the user already says issue, task, or subtask, keep that
  level and ask only for the missing project, issue, or parent task that would change
  placement.
- For Movement, if the user already names the missing span, saved overlay, place,
  stay, trip, or trip point, ask only for the missing interval, boundary, saved
  object, or confirmation that is still missing; do not ask whether this is day,
  timeline, or repair work.
- For Life Force, if the user already names a weekday pattern, profile assumption, or
  right-now fatigue state, ask only for the weekday/time shape, profile field, signal
  intensity, or planning effect that would change the dedicated write.
- For Workbench, if the user already names a flow, run, node, latest output, or
  published result, ask only for the missing flow, run, node, input, output, or
  preservation choice. Do not reopen flow-creation or flow-edit intake before reading
  the requested artifact.
- For direct Psyche saves, if the belief sentence, functional loop, part voice,
  trigger episode, value phrase, event kind, emotion signature, or flashcard message
  is already usable, move to one accuracy or consent question instead of restarting
  exploration.

## Dedicated surface lane translation

Use this when Movement, Life Events, Life Force, or Workbench work needs a route choice. The route
choice is an internal classification step, not a user-facing menu.

- Translate "day, month, all-time, timeline, trip detail, or selection" into "which
  time window or specific stay/trip should we look at?"
- Translate "timeline, read, calendarSync, fromCalendarEvent, importTicket, or travelStatus" into "is this about the chronology, one event, the calendar match, a ticket artifact, or travel status?"
- Translate "overview, profile, weekdayTemplate, or fatigueSignal" into "is this about
  your current state, a durable assumption, a repeated weekday rhythm, or how you feel
  right now?"
- Translate "listFlows, boxCatalog, runDetail, nodeResult, latestNodeOutput, or
  publishedOutput" into "do you need the saved flow, its inputs, one run, one node, or
  the public result?"
- If the user already gave the concrete object, time window, weekday, flow, run, or
  node, skip the route menu entirely and ask only for the missing product detail.
- When the current truth is uncertain, choose the dedicated read lane before asking
  write-shaped questions. Movement timeline, saved-box, trip, place, or settings
  reads come before corrections; Life Force overview comes before profile/template
  changes when the energy picture is unclear; Workbench flow, run, node, latest
  output, or published-output reads come before edit or publish decisions.
- After that read, ask only for the missing detail that changes the correction,
  planning effect, rerun, edit, publish, or preservation choice. Do not restart a
  broad lane question after the read has narrowed the work.
- Once the lane is selected, use the exact route key internally and do not invent a
  friendlier path.

## Dedicated surface route fallback

Use this when the adapter tool surface is missing, stale, or narrower than live Forge
onboarding.

- First prefer the route-key tools when they exist:
  `forge_call_movement_route`, `forge_call_life_event_route`,
  `forge_call_life_force_route`, or `forge_call_workbench_route`.
- If a route-key tool is unavailable, stale, or lacks the needed route key, read live
  onboarding and use the exact `methodRoutes` entry for the selected lane. Cross-check
  OpenAPI only to confirm the same method and path.
- Do not fall back to generic batch CRUD for Movement, Life Events, Life Force, or Workbench just
  because a route-key tool is missing. They remain specialized domain surfaces.
- Do not invent a nearby raw path, put IDs into the route key, or ask the user to pick
  an endpoint. Ask only for the missing product identifier or span that fills the
  published path.
- Before calling a specialized route, check the selected `methodRoutes` entry for
  placeholders such as `:id`, `:weekday`, `:slug`, `:runId`, `:nodeId`, or
  `:pointId`. Every placeholder must be filled through `pathParams` with the same
  name before the call; never hide one inside `query`, `body`, or `routeKey`.
- If a required placeholder is missing, ask for the product noun that fills it: the
  saved place, movement box, Life Event, trip, weekday, flow, slug, run, node, or
  trip point.
- If tool schema, live onboarding, and OpenAPI disagree, trust live onboarding for the
  immediate call when it names the exact route, then treat the disagreement as a Forge
  contract bug to fix.

## Specialized route-contract handshake

Use this before every Movement, Life Events, Life Force, or Workbench call so the route path is
truthful without turning the user's turn into implementation talk.

- Select the product lane first in plain language: movement span or repair, Life Event chronology/calendar/ticket/status, energy
  assumption or signal, saved flow/run/node/output, or published artifact.
- Then verify the matching `routeKey` against live onboarding `routeKeys` and
  `methodRoutes`. The route key and method/path must come from that contract, not from
  memory or a guessed URL.
- If `methodRoutes` contains placeholders, fill every placeholder through
  `pathParams` with the exact placeholder name before the call. Ask the user only for
  the missing product noun that fills the placeholder.
- Cross-check OpenAPI when you are debugging or when a route-key tool looks stale; do
  not make the user choose between endpoint names.
- If the contract is missing a lane the product clearly supports, stop and report a
  contract bug instead of silently using generic batch CRUD or a nearby route.

## Dedicated surface verification loop

Use this after a Movement, Life Events, Life Force, or Workbench mutation or result-producing run.
The dedicated route family is not finished just because a write returned `ok`.

- After Movement overlays, place edits, settings changes, stay/trip repairs, or
  deletion/invalidation work, read back the timeline, place list, settings, box
  detail, or selection view that proves the user's practical question was answered.
- After Life Event calendar sync, calendar-to-Life-Event marking, ticket import, or
  travel-status work, read back the event detail or timeline when that proves the
  chronology, calendar match, ticket-derived fields, or status question was answered.
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
  detail comes before correction; Life Events timeline or event detail comes before calendar sync, ticket import, or status interpretation when the target is unclear; Workbench run or node detail comes before editing a
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
- If the read produces several possible actions, choose the one that most directly
  answers the user's practical question and ask only for the missing detail that would
  permit that action. Do not hand the user a broad menu after you just learned enough
  to narrow the next move.
- Make the read's decision value explicit before any follow-up: what the read rules
  in, what it rules out, and what one uncertainty remains. If there is no
  answer-changing uncertainty, do not ask another question.
- For Movement, Life Events, Life Force, Workbench, calendar, health, and operator overviews,
  keep the follow-up anchored to the read result: the span that is missing, the
  Life Event calendar match, ticket import, or travel status, the weekday curve that
  needs correction, the failed run or node, the overloaded day, or the specific
  session worth enriching.
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
- For specialized Movement, Life Events, Life Force, and Workbench actions, pair the confirmation
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
  overviews, and Movement, Life Events, Life Force, or Workbench dedicated reads for those domain
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
- Use `artifact` when the user wants Forge to store a trusted file for human
  retrieval, audit, provenance, or evidence. Link it to other Forge records through
  the general entity-link model; do not create an artifact-specific relationship
  system.
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
  window, Life Event, ticket artifact, weekday, flow, run, node, correction, link, or save consent.
- For normal batch entities, if the accepted title or distinctive wording and the
  meaningful body are present, do not ask for tags, priority, status, color, links,
  dates, or assignees unless that metadata changes accountability, retrieval, or
  execution.
- For specialized Movement, Life Events, Life Force, and Workbench work, if the user's wording
  already implies the lane, skip the route-family question and ask only for the
  target span, place, event, artifact, weekday, profile field, flow, run, node, output, correction, or
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

## Missing-information diff

Before every create or update question, compare the user's words and the current
record against the matching live onboarding entry.

1. Start with `minimumCreateFields` for a create, or the user's requested correction
   for an update.
2. Remove values already stated, values safely derived from context, and optional
   fields with published defaults.
3. Keep only unknowns that change meaning, ownership, hierarchy, timing, retrieval,
   safety, or route selection.
4. Ask for the first blocking decision. A non-Psyche question may group only
   inseparable values, such as start/end/timezone or origin/destination/time.
5. When the diff is empty, act. Do not ask for tags, colors, status, links, notes, or
   other polish merely because the schema permits them.

For updates, read the current record first. Patch only the accepted correction and
preserve omitted fields. Do not turn a narrow correction into a new intake.

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
- For Attention, list as soon as the user asks what needs a next move. Snooze,
  dismiss, or restore only after a current read confirms the stable item id and
  allowed action; snooze also needs a future return time. For Entity Navigation,
  list once the retrieval question is clear and touch only an exact in-scope record
  the agent actually viewed. Pin and unpin stay human-only.
- For specialized Movement, Life Events, Life Force, and Workbench writes, the minimum is the
  selected lane plus the surface-specific target and intended effect:
  Movement span/place/stay/trip/settings/correction, Life Event event/calendar
  match/ticket artifact/travel-status target, Life Force weekday/profile/signal/planning
  effect, or Workbench flow/run/node/input/output/preservation choice. Do not ask
  a reflective question after the dedicated route and write shape are already
  selected.
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
5. For completed tasks, preserve modified files, work summary, and linked Git
   reference IDs through `completionReport`, and send the referenced canonical
   commit, branch, or pull-request records in `gitRefs`.
6. After completion, read the task back and verify `closeoutState`,
   `completionReport`, and `gitRefs` before claiming that evidence was stored.

Closeout rules:

- `completionReport.modifiedFiles` supports at most 256 safe repository-relative
  paths of at most 512 characters each. `workSummary` supports 8,000 characters.
  `linkedGitRefIds` supports at most 64 IDs of at most 128 characters each.
- `gitRefs` supports at most 64 records. Each requires `refType` and `refValue`;
  any `url` must use HTTP or HTTPS. Every linked ID must resolve to a resulting
  task Git ref.
- `forge_complete_task_run` stores the report, Git refs, optional
  `closeoutNote`, task state, time, rewards, and activity atomically. Repeating
  the exact terminal closeout is idempotent; changing closeout evidence on replay
  conflicts.
- Quick or native completion may truthfully leave `closeoutState: deferred` when
  no closeout evidence was captured. Report that state directly instead of
  inventing evidence.
- `forge_release_task_run` accepts only `actor`, `note`, and `closeoutNote`. It
  does not accept `completionReport` or `gitRefs` and does not complete the task.

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
- For Attention, choose list, snooze, dismiss, or restore through the dedicated tool
  after a current queue read. For Entity Navigation, choose bounded list or exact
  touch through its dedicated tool; never turn pin or unpin into an agent lane.
- For Movement, Life Events, Life Force, and Workbench, use the lane
  to choose the dedicated route family before you ask for lower-level details.

## Operation coverage checkpoint

Use this as a live handling and simulation check so every entity family is exercised
as real work, not only as a create form.

- Normal stored entities need four possible lanes in the agent's head: add a new
  record, update an existing record, review or navigate existing records, and link or
  place the record in Forge. Ask the lane only when the user's verb does not already
  choose it.
- Action workflows need action verbs instead of CRUD verbs: start, continue, complete,
  adjust, judge, signal, publish, sync, or observe. Once the action verb is clear,
  ask only for the missing target, answer, comparison, minutes, or consent.
- Specialized CRUD surfaces need lifecycle verbs: create, read, update, sync,
  reconnect, delete, or browse. For wiki pages, ask about the durable page or evidence
  source; for calendar connections, ask about the provider workflow and lifecycle
  action.
- Read-model surfaces need a practical read question plus scope. Do not ask
  write-shaped questions until the read creates a concrete follow-up.
- Attention and Entity Navigation need bounded dedicated reads before action.
  Attention actions require a current returned item and allowed action; Entity
  Navigation touch requires the exact record the agent actually viewed. Neither
  surface is batch CRUD, and agent tools never pin or unpin.
- Movement, Life Events, Life Force, and Workbench need their dedicated operation lanes: review,
  correct, repair, run, inspect, publish, preserve, calendar-sync, ticket-import, or
  status. If the lane depends on current state, read first through the dedicated
  surface and then ask only for the span, place, event, artifact, weekday, flow, run,
  node, output, correction, planning effect, or preservation choice that is still
  missing. After the lane is clear, use the exact dedicated route key internally.
- Psyche entities need a formulation lane before the storage lane when the user wants
  understanding. Direct saves can move to one accuracy or consent question; guided
  formulation should stay with one lived example, one hypothesis when useful, and one
  corrected saveable shape.

## Route posture checkpoint

Use this quick split before the conversation gets too detailed.

- Normal stored Forge entities use the shared batch entity routes by default:
  `/api/v1/entities/search`, `/api/v1/entities/create`,
  `/api/v1/entities/update`, `/api/v1/entities/delete`, and
  `/api/v1/entities/restore`.
- The shared route model is batch-shaped because each request is array-first; the
  actual paths are the five `/api/v1/entities/*` routes above. Do not invent
  `/api/v1/entities/batch`, `/api/v1/batch`, or one-off per-entity CRUD paths.
- Every normal entity section below inherits that batch-route default unless its own
  route note says otherwise. Do not invent one-off entity endpoints for ordinary
  stored records.
- `wiki_page`, `calendar_connection`, and `artifact` are specialized CRUD areas. Use
  the wiki page routes, calendar connection setup or sync routes, and artifact routes
  instead of pretending they are simple batch records. Batch CRUD may search, update,
  delete, and restore artifact metadata, but file upload, scan, enrichment, trust,
  versions, audit, and generic entity-link replacement stay on the Artifact Store
  route family.
- `wiki_page`, `calendar_connection`, and `artifact` all publish route keys and
  method/path maps under live onboarding `specializedCrudEntities`. Use those maps
  for route verification before acting, just as you use `methodRoutes` for the
  specialized domain surfaces. Do not guess wiki, calendar connection, or artifact
  paths from memory when the route key is published.
- `task_run`, `work_adjustment`, `questionnaire_run`, `preference_judgment`,
  `preference_signal`, and `self_observation` are action workflows. Start from what
  the user is trying to do, then use the dedicated action tool or note-backed write
  model.
- `attention_inbox` and `entity_navigation` are specialized domain surfaces. Use
  `forge_call_attention_route` for a bounded queue read and eligible snooze,
  dismiss, or restore actions. Use `forge_call_entity_navigation_route` for bounded
  pin/recent listing or an exact post-view touch. Do not route either surface through
  batch CRUD, and do not attempt human-only pin or unpin actions.
- `operator_overview`, `operator_context`, `calendar_overview`, `sleep_overview`,
  `sports_overview`, and `training_load` are read-model-only surfaces. Use them
  when the user wants to understand current Forge state, work risk, calendar
  commitments, nights, workouts, cardiovascular load, recovery context, or health
  patterns before deciding whether a stored entity needs creation or enrichment.
- Movement, Life Events, Life Force, and Workbench are specialized domain areas. Use their
  dedicated route families for timelines and overlays, Life Events chronology and
  calendar/ticket/status actions, energy profile/templates and fatigue signals, and
  Workbench flow execution or result artifacts. When available, use
  `forge_call_movement_route`, `forge_call_life_event_route`,
  `forge_call_life_force_route`, or `forge_call_workbench_route` after selecting the
  lane; do not route these through batch entity tools.
- Once the route posture is clear, keep the questioning focused on the missing detail
  that selects the route or payload. Do not ask route-neutral reflective questions
  after the action path is already obvious.
- If the tool schema and live onboarding disagree about a specialized route key or
  path, treat that as a contract mismatch to fix. Do not guess a nearby route.

## Route execution handoff

Use this after the conversation has enough information and before any read, write,
run, repair, or publish call. This is an internal checklist; do not turn it into a
user-facing API explanation.

1. Freeze the accepted user-facing formulation or target object: title, belief
   sentence, movement span, Life Event target, weekday, flow, run, node, or published result.
2. Choose exactly one execution lane: shared batch CRUD, specialized CRUD, action
   workflow, read-model route, or specialized domain route.
3. For shared batch CRUD, use the catalog `entityType` exactly and the shared
   `/api/v1/entities/search`, `/api/v1/entities/create`,
   `/api/v1/entities/update`, `/api/v1/entities/delete`, and
   `/api/v1/entities/restore` routes. Search or read first for update, delete,
   restore, link, duplicate-disambiguation, or review work.
4. For specialized CRUD or action workflows, use the named tool or documented route
   for wiki pages, calendar connections, artifacts, task runs, work adjustments,
   questionnaire runs, preference judgments/signals, and self-observation notes.
   For `wiki_page`, `calendar_connection`, and `artifact`, verify route keys and
   method/path entries from live onboarding `specializedCrudEntities` before calling
   lower-level routes.
5. For Attention and Entity Navigation, verify the selected `routeKey` against live
   onboarding. Attention actions need a current stable item id and allowed action;
   Entity Navigation touch needs the exact entity type and id actually viewed. Keep
   pin and unpin outside agent execution.
6. For Movement, Life Events, Life Force, and Workbench, verify the `routeKey`, method, path, and
   every placeholder in `methodRoutes`; fill `pathParams` by placeholder name before
   the call. Do not put IDs into `routeKey`, hide placeholders in `query` or `body`,
   or use nearby guessed paths.
7. After the call, confirm the product result in the user's language and run the
   verification read only when it proves a repair, explains impact, or grounds the
   next decision.

## Read-Model Alias Handling

Live onboarding publishes several read-model surfaces with both camelCase and
entity-style aliases. Treat each pair as the same user-facing flow and normalize it
internally before asking questions:

- `attentionInbox` and `attention_inbox`
- `entityNavigation` and `entity_navigation`
- `todayPriority` and `today_priority`
- `operatorOverview` and `operator_overview`
- `operatorContext` and `operator_context`
- `calendarOverview` and `calendar_overview`
- `sleepOverview` and `sleep_overview`
- `sportsOverview` and `sports_overview`
- `trainingLoad` and `training_load`
- `weightLoss` and `weight_loss`
- `preferencesWorkspace` and `preferences_workspace`
- `selfObservation` and `self_observation`

Do not ask the user which alias they mean. Ask the practical question the read should
answer, then use the published read route for that alias pair.

## Full Route Posture Matrix

Use this as an internal checklist when simulating or handling an entity flow. Do not
read this table to the user. It exists so the agent can ask natural questions while
still knowing the exact write/read family before it acts.

- `goal`, `project`, `strategy`, `task`, `habit`, `tag`, `person`,
  `note`, `insight`,
  `calendar_event`, `work_block_template`, and `task_timebox`: normal stored Forge
  entities. Search, create, update, delete, and restore through the shared batch
  entity routes.
- `life_event`: normal stored chronological record for important events. Search,
  create, update, delete, restore, and write generic links through the shared batch
  entity routes. Use the dedicated Life Events routes only for timeline reads,
  one-event reads, calendar sync, calendar-to-Life-Event marking, ticket artifact
  import, and travel-status reads.
- `preference_catalog`, `preference_catalog_item`, `preference_context`, and
  `preference_item`: normal stored Preferences records. Use shared batch entity
  routes for CRUD; switch to Preferences action routes only for judgments, signals,
  game starts, merges, entity seeding, or explicit score overrides.
- `preferences_workspace`: read-model-only Preferences explanation surface. Use
  `forge_get_preferences_workspace` or `GET /api/v1/preferences/workspace` to
  explain inferred scores from supporting judgments, signals, overrides, and evidence
  counts before proposing a dedicated Preferences action. Never mutate the workspace
  through batch CRUD.
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
- `artifact`: specialized CRUD. Use `/api/v1/artifacts` for paged metadata listing
  with `limit`/`offset` and trusted file upload, plus artifact detail routes for
  metadata reads and updates, static rescan, optional LLM metadata enrichment,
  trust-state decisions, version and audit reads, and replacement of general
  `entity_links`. Use batch CRUD for artifact metadata delete/restore. Do not
  download, decrypt, open, execute, preview, transform file bytes, or submit artifact
  passwords as an agent. Password and byte routes are human-operator-only actions.
- `attention_inbox`: actor-scoped derived surface. Use
  `forge_call_attention_route` to list the bounded queue or snooze, dismiss, and
  restore eligible returned items. Never invent queue records, use batch CRUD, or
  dismiss blocked and overdue work.
- `entity_navigation`: canonical pins plus actor-scoped recent history. Use
  `forge_call_entity_navigation_route` with `list` or `touch`. Touch only an exact
  record the agent actually viewed. Pin and unpin remain human-operator-only in the
  Forge Action Bar and are intentionally absent from agent tools.
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
- `course` and `concept`: specialized learning surfaces. Use
  `forge_call_course_route` for installed-course catalog/detail, learner-safe
  sessions, attempts, validated package import/export, concept discovery, and
  concept evidence. Never use shared batch CRUD for either surface.

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

## Active-listening turn contract

Use this before deepening any create, update, review, or guide flow. The turn should
prove that the agent heard the user and knows what the next answer would change.

1. Reflect the specific stake, working shape, or product object in one sentence.
   Avoid generic warmth such as "that sounds important".
2. Classify the next useful move internally: wording, boundary, placement, timing,
   route scope, support action, verification read, preservation choice, or consent.
3. Ask one question whose answer would change that move.
4. If the answer would only add polish, optional metadata, or therapist-like color,
   do not ask it.

For Psyche-adjacent material, the reflection should name a felt stake, protection,
prediction, payoff, cost, or value conflict. If a functional loop or belief sentence
is already visible, move toward one tentative formulation instead of mirroring again.

For logistical entities, keep the reflection short and route to the operational
detail: parent, owner, time, recurrence, run target, comparison item, or save
confirmation.

For Movement, Life Events, Life Force, and Workbench, reflect the product object first:
movement span, place boundary, Life Event, calendar match, ticket artifact, travel status, weekday curve, fatigue signal, flow, run, node output,
or published result. Then ask only for the missing route-selecting detail.

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
CRUD, payload, mutation path, route key, batch route, or endpoint with product nouns
the user recognizes: belief, pattern, note, wiki page, timeline, overlay, missing
stay, weekday template, flow, run, node result, or published output. If you cannot
name the product noun yet, ask one grounding question about the real span, place,
weekday, flow, run, node, belief sentence, parent record, or save confirmation
instead of adding reflective filler.

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
- For Movement, Life Events, Life Force, and Workbench, ask what exact saved object, span, event, artifact, weekday, flow, run, or
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
4. What concrete action would a possible answer enable: save, update, review, link,
   schedule, correct, run, publish, preserve, or stop?
5. What is the smallest question that would answer that unknown?
6. If the user already gave enough to act, stop asking and move to a short summary or
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
- If you cannot say what the user's answer would change, do not ask the question.
  Summarize what is already clear, take the read/write/run action, or close cleanly.
- For review-first work, the follow-up must point to one action enabled by the read:
  no change, save, update, correct, link, schedule, run, publish, preserve, enrich, or
  open the UI. Do not ask a generic "what do you want to do with this?" after the read
  already narrowed the practical next move.
- For Movement, Life Events, Life Force, and Workbench, the same rule applies through the product
  object: missing span, place boundary, Life Event time, calendar match, ticket artifact, travel status, weekday curve, profile assumption, flow, run,
  node, output, or preservation choice.

## No-question gate

Use this before every follow-up, especially after partial answers, reads, writes,
repairs, and Psyche-adjacent material. A polished extra question is still a bad
question when it cannot change the next action.

- Ask only if the answer can change one of these: record type, accepted wording,
  hierarchy placement, owner/accountability, timing, route lane, target object,
  correction, link, verification read, run/publish/preserve action, or consent.
- Do not ask for optional tags, colors, priority, assignees, dates, aliases, visual
  style, or related links when the user already gave enough to save, read, run,
  correct, or close.
- If the next question would only make the conversation feel warmer, more complete, or
  more like a form, skip it. Summarize what is clear and act, or close cleanly.
- For review-first work, answer the practical question first. Ask another question
  only when the read exposes an answer-changing uncertainty or a concrete action the
  user has not yet authorized.
- For specialized domains, do not ask a reflective "why" after the route lane and
  target are already known; ask only for the span, place, event, artifact, weekday, flow, run, node,
  output, correction, or preservation choice that permits the action.
- For Psyche-adjacent work, do not keep exploring once the user has accepted a
  formulation. Ask one accuracy or consent question, then save or stop.

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
- Once the Movement, Life Events, Life Force, or Workbench job is clear, speak in product nouns such as
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
- For Movement, Life Events, Life Force, and Workbench, do not use batch duplicate search. Use the
  dedicated read lane: known places or timeline for Movement, Life Events timeline or event detail for Life Events, overview/profile or
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

Aim: help the user preserve a chosen direction without turning an explicit save
or narrow correction into a values interview.

Choose the lane first:

- direct capture
- guided clarification
- exact-record review or narrow update

Arc:

1. For direct capture, reflect the supplied title and chosen direction, search
   normalized titles for a duplicate, and ask one accuracy or consent question.
   Do not demand a description, why-now explanation, success measure, horizon,
   status, links, owner, tags, notes, or target points when the title already
   names the direction clearly.
2. For review or narrow update, search for and read the exact existing goal
   first. Summarize its accepted title, direction or body, horizon, status, and
   meaningful links. Ask only what is newly true or inaccurate, preserve sparse
   accepted records, and patch only that accepted change.
3. For guided clarification, ask what direction or outcome the user wants to
   keep in view. Reflect the deeper stake in plain language and ask why it
   matters now only when the answer would change the direction or wording.
4. Distinguish a durable goal direction from a project with a bounded
   deliverable or a task with one concrete next action. Offer one concise
   working title and ask whether it fits rather than making the user formulate
   it alone.
5. Clarify horizon, status, owner, placement, or links only when the detail
   changes later review, responsibility, or navigation.

Helpful follow-up lanes:

- why this direction matters now
- what would count as movement without turning it into a task list
- whether it is a quarter, year, or life direction

Ready to save when:

- direct capture has an accepted title that names the chosen direction and one
  accuracy or consent check; Forge's API requires only the title
- review or narrow update has read the exact existing goal and isolated the
  smallest accepted change without backfilling a sparse record
- guided clarification has a durable direction and accepted wording that are
  distinct from a project or task
- why it matters and horizon are present only when they change the goal's
  meaning or later use
- every write uses shared batch CRUD

Preferred opening question:

- "Are you naming a direction, making sense of why it matters, or updating a goal that already exists?"

## Project

Aim: preserve or shape a bounded workstream under an exact parent Goal without
turning a direct save or narrow correction into a project workshop.

Arc:

1. Distinguish direct capture, guided project shaping, exact-record review or
   narrow update, and read-only review before asking about outcome, scope, or
   delivery details.
2. For direct capture, reflect the supplied title, resolve the exact existing
   parent Goal, search for the normalized title inside that Goal, and ask one
   accuracy or consent question. Forge requires only `goalId` and `title`. Do not
   demand an outcome statement, description, PRD, scope boundary, lifecycle
   status, workflow lane, owner, assignees, scheduling rules, tags, links, notes,
   points, or color.
3. For review or narrow update, search for and read the exact existing Project
   first. Answer read-only questions before proposing a write. Preserve its
   accepted title, parent Goal, description, PRD, lifecycle status, workflow lane,
   ownership, assignees, scheduling, and links, then patch only what is newly true
   or inaccurate. Never force a sparse existing Project through full create
   intake.
4. For guided shaping, ask, "What would you be trying to make true through this
   work?" and reflect the emerging boundary. Ask what outcome would make it complete
   enough, what belongs inside the boundary and what can stay out if the scope still
   feels muddy, and what belongs in the project PRD or brief only when the user wants
   help shaping delivery.
5. Every Project requires an existing parent Goal. If no suitable Goal exists,
   help the user choose or create one as a separate accepted step before creating
   the Project. Do not imply that an intentionally absent parent is valid.
6. Distinguish a Project as a bounded multi-step deliverable or workstream from a
   Goal that names a direction and a Task or Issue that names executable work.
   Offer a concise working title when the user wants help naming it.
7. Keep lifecycle `status` separate from the board `workflowStatus` lane. Ask about
   either, plus owner, human/bot assignees, scheduling rules, tags, links, or notes,
   only when the detail changes delivery, responsibility, or later navigation.
8. Use shared batch CRUD for every Project search, create, update, soft delete, and
   restore. Do not invent a dedicated Project route.

Helpful follow-up lanes:

- what concrete outcome would make this project complete enough
- what should go into the PRD or brief
- what belongs inside the boundary and what does not
- which goal gives the project meaning
- whether one owner or several human/bot assignees need to be explicit
- whether scheduling rules or a board workflow lane matter now

Ready to save when:

- direct capture has an accepted title, the exact existing parent Goal, a duplicate
  check inside that Goal, and one accuracy or consent check
- review or narrow update has read the exact existing Project and isolated the
  smallest accepted change without backfilling a sparse record
- guided shaping has a bounded multi-step deliverable, accepted title, and exact
  parent Goal; outcome, boundary, and PRD detail are present only when they change
  delivery
- every write uses shared batch CRUD

Preferred opening question:

- "Are you naming a project you already understand, shaping its boundary, or updating one that exists?"

## Strategy

Aim: turn a vague plan into a deliberate sequence, then help the user review or
renegotiate that execution contract without confusing progress updates with plan
changes.

Arc:

1. Identify the lane first: create or shape a draft, review execution, make an
   ordinary status change, lock the agreed plan, or explicitly unlock it to
   renegotiate.
2. For any existing strategy, read the exact current record before questioning.
   Reflect its end state, targets, lock state, and relevant active, blocked,
   out-of-order, or off-plan evidence so the user can correct the frame.
3. For review, answer what is progressing, blocked, out of order, or outside the
   agreed scope before asking at most one question about the decision the evidence
   does not settle.
4. For a draft, ask what future state it should make real, which goals or projects
   are true targets, and which existing project or task nodes form the smallest
   sufficient plan.
5. Clarify only the order, branch condition, dependency, or must-not-skip step that
   remains ambiguous. Keep the graph directed and acyclic, with no missing or
   duplicate nodes, self-loops, or duplicate edges.
6. Before locking, summarize the target, end-state or overview, graph sequence, and
   meaningful linked context as the proposed contract, then ask for explicit lock
   acceptance.
7. When a locked strategy needs a core plan change, distinguish execution progress
   from real renegotiation. Do not unlock it unless the user explicitly chooses to
   reopen the contract; ordinary status changes do not require an unlock.
8. Use shared batch CRUD for strategy create, update, delete, restore, and search.
   Do not invent a specialized Strategy lifecycle route.

Helpful follow-up lanes:

- what the end state looks like when it is real
- what the major phases are
- which steps must happen before others
- what is in scope versus out of scope
- what the metrics say is active, blocked, out of order, or off plan
- whether the user wants to execute the contract or renegotiate it

Ready to save when:

- review has read the exact current strategy and answered the practical question
- a draft has a stable name, meaningful target or end state, and valid directed
  sequence of existing project or task nodes
- lock has at least one target, an overview or end-state description, a valid graph,
  and explicit acceptance of the summarized contract
- unlock has explicit intent to renegotiate, rather than merely record progress

Preferred opening question:

- "Are you shaping this strategy, reviewing how execution is going, or deciding
  whether the plan should be locked or renegotiated?"

## Task

Aim: preserve a direct work item without hierarchy friction, while helping guided
work fit the right issue, task, or subtask level and close out truthfully.

Choose the lane first:

- direct capture
- guided breakdown or hierarchy placement
- exact-record review or narrow update
- read-only review
- closeout

Arc:

1. For direct capture, reflect the supplied title, search normalized titles for a
   duplicate, and ask one accuracy or consent question. Forge requires only `title`.
   When `level` is omitted it defaults to `task`, and an ordinary task may remain in
   the inbox without a parent. Do not demand a rewritten action, hierarchy choice,
   goal, project, parent, description, status, priority, owner, assignees, due date,
   `aiInstructions`, execution mode, acceptance criteria, blockers, scheduling,
   tags, points, notes, or completion evidence.
2. For review or narrow update, search for and read the exact existing work item
   first. Answer read-only questions before proposing a write. Preserve accepted
   level, hierarchy, wording, status, ownership, execution contract, blockers,
   scheduling, tags, git refs, and completion state, then patch only what is newly
   true or inaccurate. Never force a sparse existing task through full create
   intake.
3. For guided breakdown, ask what one concrete outcome should become true. Ask
   whether it is an issue, one-session task, or lightweight subtask only when level
   changes the work. In hierarchy-aware work, an issue requires a project, a task
   parent must be an issue, and a subtask parent must be a task. Keep intentional
   inbox or legacy placement available for an ordinary task.
4. Capture the execution contract in `aiInstructions` only when the work is meant
   for an AI or agent session. Ask for AFK or HITL execution mode, acceptance
   criteria, blockers, due date, priority, owner, human/bot assignees, or context
   only when that detail changes execution, accountability, or verification.
5. For closeout, read the exact work item and current status first. Record only
   factual `workSummary`, `modifiedFiles`, and `linkedGitRefIds` supported by the
   user or execution evidence. Leave arrays empty when none apply and never invent
   evidence. If the user asks only for a status change, honor that narrow update and
   allow closeout to remain deferred instead of reopening intake.
6. Use shared batch CRUD for Task search, create, update, soft delete, and restore.
   Starting, focusing, heartbeating, completing, or releasing a `task_run` uses the
   dedicated Task Run action tools and must not be guessed as Task CRUD.

Level-specific handling:

- For `issue`, ask what vertical slice of the project should become true and whether
  it is AFK or HITL before asking for one-session execution instructions.
- For `task`, ask what one focused session should finish and which issue it belongs
  under when the hierarchy matters.
- For `subtask`, ask which parent task it breaks down and what small child step it
  names. Do not inflate a subtask into a full task or issue unless the described work
  no longer fits as a lightweight child step.
- When the user already says issue, task, or subtask, keep that word in the
  user-facing reflection and confirmation. Do not collapse all three into "task" just
  because the API entity type is `task`.
- All three levels still use the shared batch entity route with `entityType: "task"`
  and the appropriate `level`. The level distinction is product meaning, not a
  separate route family.

Helpful follow-up lanes:

- turn vague intent into an actionable verb
- decide whether the work item is an issue, task, or subtask
- identify parent project, issue, or task
- capture the one-session execution contract in `aiInstructions`
- decide whether one owner or several human/bot assignees need to be explicit
- capture the one timing, priority, or acceptance detail that will actually help

Ready to save when:

- direct capture has an accepted title, normalized-title duplicate search, and one
  accuracy or consent check; omitted level may default to an inbox task
- review or narrow update has read the exact work item and isolated the smallest
  accepted change without backfilling sparse fields
- guided hierarchy work has the concrete outcome plus required placement: project
  for an issue, issue parent for a hierarchical task, or task parent for a subtask
- closeout has read the exact item and records only factual evidence; a status-only
  request may leave the completion report deferred
- Task records use shared batch CRUD and Task Run lifecycle actions use their
  published dedicated tools

Preferred opening question:

- "Are you saving a work item you already understand, breaking work down, reviewing
  one, or closing it out?"

## Habit

Aim: make the recurring action and honest check-in meaning clear without turning a
direct save, narrow correction, or today's outcome into a full habit-design interview.

Choose the lane first:

- direct capture
- guided habit design
- exact-record review or narrow update
- check-in or outcome correction

Arc:

1. For direct capture, reflect the observable recurring action, search normalized
   titles for a duplicate, and ask one accuracy or consent question. Ask whether
   it is positive or negative only when doing the named action does not already
   make aligned versus misaligned meaning clear. Do not demand a description,
   cadence discussion, links, XP settings, or an underlying psychological
   formulation.
2. For review or narrow update, search for and read the exact existing habit
   first. Summarize its accepted action, polarity, cadence, status, check-in
   meaning, and meaningful links. Ask only what is newly true or inaccurate,
   preserve sparse accepted records, and patch only that accepted change.
3. For guided design, ask what one observable action counts, whether doing it is
   aligned or a slip, and what an honest check-in means. Ask about frequency,
   target count, or weekdays only when the daily default is not accepted or the
   recurrence would otherwise be ambiguous.
4. If the user is describing a recurring protective or avoidance loop rather
   than only a behavior to track, reflect that distinction and offer a linked
   `behavior_pattern`. Do not make Psyche formulation a prerequisite for saving
   the habit.
5. For a check-in, read the exact habit first and ask only for the user-facing
   outcome and a date when it is not today. Map positive `Done` to stored `done`
   and positive `Missed` to stored `missed`; map negative `Resisted` to stored
   `missed` and negative `Performed` to stored `done`. Do not ask the user to
   choose raw `done` or `missed` when polarity changes what they mean.
6. Write or correct the official outcome with `forge_update_entities`,
   `entityType: "habit"`, and `patch.checkIn`, then read the habit back. Do not
   invent a dedicated agent check-in tool.

Helpful follow-up lanes:

- what the recurring move looks like on an ordinary day
- whether the habit is `positive` or `negative`
- what counts as an honest check-in
- what cadence is realistic and meaningful

Ready to save when:

- direct capture has an accepted title naming one observable action, polarity
  only when its meaning is ambiguous, and one accuracy or consent check
- review or narrow update has read the exact habit and isolated the smallest
  accepted definition change without backfilling a sparse record
- guided design has an observable action, honest success or slip meaning, and
  only the non-default cadence needed for unambiguous check-ins
- a check-in has read the exact habit and resolved the user-facing outcome plus
  a non-today date when needed before using `habit.patch.checkIn`
- definition changes and official check-ins both use shared batch CRUD

Preferred opening question:

- "Are you defining a recurring move to strengthen or interrupt, adjusting it, or recording what happened today?"

## Tag

Aim: preserve a clear reusable label quickly when the user already knows it, and
help shape a taxonomy only when that would improve retrieval.

Choose the lane first:

- direct capture
- guided taxonomy
- exact-record review or narrow update
- read-only review

Arc:

1. For direct capture, search existing Tags by the supplied name. Reflect the
   accepted name once and ask only one accuracy or consent question. Forge requires
   only `name`; `kind` defaults to `category`, `color` to `#71717a`, and
   `description` to an empty string.
2. Do not require a purpose, inside-versus-outside boundary, kind, color,
   description, owner, parent grouping, or attachment target for direct capture.
3. For review or narrow update, search for and read the exact existing Tag first.
   Answer read-only questions before proposing a write. Preserve accepted sparse
   name, kind, color, description, and ownership; ask only what is newly true or
   inaccurate and patch only that accepted change.
4. For guided taxonomy, ask what the label should help the user notice or retrieve
   and what nearby label it must remain distinct from only when the wording is
   ambiguous, a near-duplicate exists, or the user wants help designing a reusable
   system. Offer one concise name and check whether it fits.
5. Ask about kind, color, or description only when the user says it changes grouping
   or recognition. Forge has no parent-tag field; do not invent one.
6. Keep Tag creation separate from attachment. Creating a Tag does not apply it to
   another record. Read the exact target before updating a supported `tagIds`
   field; Note and Wiki records use their own free-text tag labels rather than a
   stored Tag id.
7. Use shared batch CRUD for Tag search, create, update, soft delete, and restore.
   Do not guess a dedicated Tag route.

Helpful follow-up lanes:

- the supplied name and any case-insensitive exact duplicate
- the retrieval purpose only when the wording is ambiguous
- the nearest existing Tag only when a distinction matters
- kind, color, or description only when it changes later recognition

Ready to save when:

- direct capture has an accepted `name`, a duplicate search, and one accuracy or
  consent check
- review or narrow update has read the exact Tag and isolated the smallest accepted
  change without backfilling optional metadata
- guided taxonomy has a clear retrieval purpose and accepted distinction only when
  that lane is actually needed
- attachment remains a separate exact-target update rather than a prerequisite for
  creating the Tag
- every Tag lifecycle write stays on shared batch CRUD

Preferred opening question:

- "Are you saving a label you already chose, shaping a reusable category, or reviewing an existing tag?"

## Person

Aim: keep a useful private record of someone in the user's life without turning the
conversation into a contact form or collecting personal details without a reason.

Arc:

1. Reflect who the user appears to mean and what they want Forge to help them
   remember, understand, or connect.
2. Search the intended owner's Person records by display name and aliases before
   creating a possible duplicate.
3. Ask for the name the user recognizes and one useful piece of relationship context
   only when either is still missing.
4. Ask about a link to a Wiki profile, event, goal, project, artifact, note, or Psyche
   record only when that connection should remain navigable.
5. For a Wiki association preview, show the exact proposed display name, preferred
   name, relationship category or label, short description, and aliases. Distinguish
   page evidence from model inference, then ask the user to accept, correct, or skip
   the proposal before apply.
6. Leave contacts, birthdays, private notes, and sensitive facts unasked unless the
   user says they are useful for this purpose.
7. If the user wants to connect two Forge installations, move to the separate
   human-controlled pairing and sharing flow. Do not encode pairing or consent as
   Person fields or entity links.
8. Use dedicated People reads for source-labelled local and shared context. Run a
   typed question only against an existing grant and only within its returned scope.

Helpful follow-up lanes:

- who the user means and which local Forge user owns the record
- what one piece of context will make the Person recognizable or useful later
- whether an existing Person with the same name or alias is the intended record
- which existing Forge records should stay linked
- whether the request is local memory or an existing-grant question

Route note:

- `person` is a normal batch-first entity. Use `forge_search_entities`,
  `forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, and
  `forge_restore_entities` for search, create, update, soft delete, and restore.
- Person links use the general `links: [{ entityType, entityId, relationship,
anchorKey? }]` contract in the batch create or update.
- A Person is a private local record about someone. It is not a local `User`, agent
  identity, peer credential, pairing, or grant.
- Use `forge_call_people_route` only for its published People reads, reviewed Wiki
  association steps, and typed-question steps. Use `forge_call_peer_route` only for
  published status, diagnostics, and existing-grant query support.
- Wiki extraction produces proposals, not facts. Apply only an accepted `associate`,
  `create_person`, or `skip` decision from the current version-bound preview after the
  user has reviewed every proposed Person field.
- Agents cannot accept pairing, change consent, widen or revoke a grant, approve or
  remove a device, request a resync, manage approval credentials, or perform a
  human-presence ceremony.

Ready to save when:

- the intended person and owning local user are clear
- the accepted display name is clear
- one useful context sentence is present when the name alone would be ambiguous
- any requested links are identified
- any Wiki-derived Person fields have been explicitly accepted, corrected, or skipped
- no optional personal detail is being collected without a stated use

Preferred opening question:

- "Who is this person to you, and what would be useful for Forge to help you remember or connect?"

## Note

Aim: preserve supplied wording without friction, while helping the user shape or
connect it only when that changes what the note is for.

Choose the lane first:

- direct capture
- guided shaping
- exact-record review or narrow update
- read-only review

Arc:

1. For direct capture, reflect the supplied Markdown, search a distinctive phrase for
   a duplicate when that risk is real, and ask one accuracy or consent question.
   Forge requires only `contentMarkdown`; do not demand a title, future-use
   sentence, links, tags, author, memory label, or expiry.
2. For review or narrow update, read the exact existing note first after resolving it
   by id.
   Preserve its accepted body, links, tags, author, expiry, and ownership. Answer a
   read-only question before proposing a write, and patch only what is newly true or
   inaccurate.
3. When changing note content, carry `expectedRevisionHash` from the exact read so a
   stale agent update cannot overwrite a newer revision. If the revision conflicts,
   reread and discuss the current note instead of retrying blindly.
4. For guided shaping, ask what the note needs to preserve and what sentence
   future-you would need to recover from this note later, then offer one concise draft
   in the user's language. Use that retrieval question only when it would change the
   body, title, tags, links, or durability.
5. Offer a Wiki page for durable reusable synthesis, `self_observation` for one
   observed moment, or a primary Psyche record when the material belongs there, but
   never make reclassification a prerequisite for preserving a standalone note.

Helpful follow-up lanes:

- what one point the note needs to preserve
- what future retrieval depends on, only when that changes the saved note
- whether a link, memory label, or expiry materially helps
- whether the user wants a standalone note or a linked primary container

Route note:

- `note` is a normal batch-first entity. Search, create, update, soft delete, and
  restore it through the shared entity tools unless the user needs the dedicated
  bounded Notes page API.
- `contentMarkdown` is the only create minimum. `links` is optional and defaults to
  an empty array, so an unlinked standalone note is valid.
- Search with an exact id before review or update. Include the returned
  `revisionHash` as `patch.expectedRevisionHash` when changing content.
- Notes use the general `links` model and can link to any compatible Forge entity.
- When Psyche authentication is enabled, reading Psyche-linked notes requires
  `psyche.read`; creating, updating, deleting, or restoring them requires
  `psyche.note`.

Ready to save when:

- direct capture has accepted `contentMarkdown` and one accuracy or consent check
- read-only review has read the exact note without manufacturing a write
- narrow update has isolated the smallest accepted change and carries the current
  revision hash for content changes
- guided shaping has an accepted faithful draft plus only the retrieval details that
  materially change later use
- every Note mutation uses shared batch CRUD with the required Psyche scope when
  applicable

Preferred opening question:

- "Are you saving wording you already have, working out what belongs in the note, or reviewing an existing note?"

## Wiki Page

Aim: help the user find, preserve, improve, ingest, or repair durable wiki knowledge
without turning every request into a new-page form. A wiki page is the right default for a book, article, source, concept, person, conversation, project reference, or personal manual.

Arc:

1. Identify whether the user wants to browse, search, read, create, update, delete,
   ingest, inspect wiki health, sync, or reindex. Skip this lane question when their
   verb already makes it clear.
2. For browse, review, update, or delete work, list, search, or resolve the existing
   page by id or slug, then read it before asking authoring questions.
3. For a new page, ask what it should help the user remember, understand, or reuse,
   then search for a near-duplicate topic before creating it.
4. For an update, ask for the smallest change that is newly true and what meaning,
   provenance, backlinks, or reusable instructions must stay intact.
5. For source ingest, ask what source is being added, how it should map into durable
   pages, and whether duplicate, partial-failure, or retry behavior changes the plan.
6. For health, sync, or reindex work, read current wiki health first and ask only what
   recovery result the user is trying to achieve.
7. Before deletion, confirm the exact page and what backlinks, citations, related
   pages, or history must remain understandable.
8. Ask about linked entities, aliases, tags, or supporting evidence only when they
   change retrieval, provenance, or navigation.
9. After create or update, read the page back when wording or links need verification.
   After delete, list or search when the user needs confirmation that the page is gone
   and remaining references are still understandable.

Helpful follow-up lanes:

- the practical knowledge or maintenance job
- the existing page, slug, source, or health state when one is involved
- the durable purpose and findable title for a genuinely new page
- the smallest intended change and what must remain true
- source mapping, duplicate handling, partial failures, retries, or recovery outcome
- links, aliases, tags, backlinks, or evidence only when they change later use

Routing rule:

- When the user says they want to remember something, save a reference, preserve a
  book or article, keep a concept, or build a reusable explanation, consider
  `wiki_page` before `note`. Use `note` for temporary evidence, work logs, or linked
  detail; use `wiki_page` for durable memory.
- Use `forge_call_wiki_route` for the complete `list`, `search`, `create`, `read`,
  `readBySlug`, `update`, `delete`, `health`, `sync`, `reindex`, and `ingest`
  lifecycle. The narrower Wiki tools remain convenient for their settled operations.
- Use the wiki tools and the `/api/v1/wiki/pages` route family for list, search,
  create, read, read-by-slug, update, delete, health, sync, reindex, and ingest. Do
  not route `wiki_page` through batch entity CRUD or guess a nearby route.
- Read before update, delete, health recovery, sync, or reindex when current state
  changes the safe next action.

Ready to act when:

- browse, search, or health has a practical question and answer-changing scope
- read, update, or delete has the exact page plus the intended lifecycle action and
  preservation need
- an existing-page change starts from a current page read resolved by id or slug
- create has passed a duplicate check and has a durable purpose, findable title, and
  meaningful Markdown body
- ingest, sync, or reindex has a source or maintenance target plus the expected result

Preferred opening question:

- "What are you trying to find, preserve, or improve in the wiki so it helps you remember or reuse later?"

## Artifact

Aim: guide the trusted-file lifecycle so a human can find, verify, preserve, or change
an artifact while agents stay inside authorized upload and metadata workflows and
download, password, and encryption actions remain human-only.

Arc:

1. Identify whether the user wants to list, read metadata, upload, update metadata,
   rescan, enrich, change trust state, inspect versions or audit history, replace
   links, delete metadata, restore metadata, or hand off a human-only action. Skip
   this lane question when the verb is already clear.
2. For an existing artifact, list or read current metadata first so the user does not
   have to reconstruct provenance, scan, trust, version, or link state from memory.
3. For list, metadata review, versions, or audit work, ask what practical retrieval,
   verification, or provenance question the read should answer, then answer it before
   proposing a write.
4. For trusted upload, ask what the file should help someone retrieve, prove, review,
   or preserve, then ask only for missing filename, purpose, provenance, or source
   path. Verify upload authority without requesting a password. Give each file one
   stable idempotency key and keep it unchanged only across an exact transport retry.
5. For a metadata update, ask for the smallest newly true change and what provenance,
   trust state, scan interpretation, or retrieval wording must remain intact.
6. For rescan, LLM enrichment, or trust-state work, read current metadata and scan
   state, clarify the intended result or authorization, and never let enrichment lower
   the deterministic danger score.
7. For link replacement, confirm the complete desired general `entity_links` set,
   including existing links that must remain, because replacement is not append.
8. For metadata delete or restore, confirm the exact artifact and lifecycle action;
   require explicit preservation intent before hard deletion.
9. Keep the boundary explicit: agents may perform authorized trusted uploads and
   metadata workflows, but download, password submission, and existing-artifact
   encryption are human/operator-only.
10. After an agent-authorized mutation, read the relevant state back and summarize
    what changed in product language.

Helpful follow-up lanes:

- the practical retrieval, verification, provenance, or lifecycle question
- the exact artifact and its current metadata, scan, trust, version, audit, or link state
- missing original filename, purpose, provenance, source path, or upload authority
- the smallest metadata change and what must remain intact
- the intended rescan, enrichment, or trust result and any required authorization
- whether the artifact belongs with a project, task, wiki page, note, Psyche record,
  or other Forge entity through a general `entity_links` relationship
- the complete desired link set when links are being replaced
- the exact metadata delete or restore action and explicit intent before hard deletion
- a human handoff for download, password, decryption, preview, execution,
  transformation, or existing-artifact encryption

Routing rule:

- `artifact` is a specialized CRUD surface. Use the Artifact Store route family for
  trusted file upload, metadata reads and updates, static scan, LLM enrichment,
  trust-state changes, versions, audit reads, and replacement of general
  `entity_links`.
- Read current artifact metadata before update, rescan, enrichment, trust, link,
  version, or audit work when current state changes the safe next action. Use batch
  metadata routes only for metadata search, update, delete, or restore; never use
  batch CRUD to create an artifact or transfer bytes.
- Do not create or use artifact-specific links. Artifact relationships are normal
  Forge entity-to-entity links with `sourceEntityType`, `sourceEntityId`,
  `targetEntityType`, `targetEntityId`, optional `relationship`, and optional
  `anchorKey`.
- Agents may list and update artifact metadata when authorized, but they must not
  download, decrypt, open, execute, preview, transform, submit passwords, or
  autonomously process stored file bytes. Agents may read `contentProtection` mode and
  password hints as metadata only.
- Forge derives agent identity and acting-user provenance from the authenticated
  token. Do not claim another agent or an out-of-scope user in the upload body. Reuse
  an upload idempotency key only for identical bytes and normalized metadata; use a
  new key for a deliberate new artifact.
- OpenAPI documents human-only download and encryption paths for the web/operator
  surface, but those paths are intentionally absent from `forge_call_artifact_route`
  and must not be called by agents.

Ready to act when:

- list, metadata read, versions, or audit has a practical question plus any required
  filter or exact artifact id
- trusted upload has upload authority, file bytes, original filename, purpose, and
  provenance or source path without a password, plus one stable per-file retry key
- metadata update, rescan, enrichment, or trust change has a current read, exact
  artifact, intended change, preservation need, and enrichment authorization when used
- link replacement has the complete desired general `entity_links` set
- metadata delete or restore has the exact artifact and lifecycle action, with
  explicit confirmation before hard deletion
- download, password, decryption, preview, execution, transformation, and
  existing-artifact encryption are handed to the human operator, never an agent call

Preferred opening question:

- "What are you trying to find, verify, preserve, or change about this file?"

## Insight

Aim: preserve a grounded interpretation and useful recommendation while keeping
evidence, the user's meaning, and the agent's hypothesis distinct.

Choose the lane first:

- direct capture
- evidence-guided synthesis
- exact-record review or narrow update
- read-only review

Arc:

1. For direct capture, reflect the supplied observation and recommendation,
   search recent insights for a semantic duplicate, offer a concise title only
   if one is missing, and ask one accuracy or consent question. Do not demand an
   entity link, timeframe, rationale, confidence score, evidence array,
   visibility, status, CTA label, or origin metadata when title, summary, and
   recommendation are already clear.
2. For read-only review or narrow update, search for and read the exact existing
   insight first. Separate its accepted title, summary, recommendation,
   rationale, confidence, evidence, timeframe, links, status, and visibility
   from what is newly true or inaccurate. Answer the review question before
   proposing a write, preserve sparse optional metadata, and patch only the
   accepted change.
3. For evidence-guided synthesis, read the relevant Forge records or overview
   before asking the user to reconstruct them. State the observed evidence
   first, reflect what the user says it means, then offer at most one tentative
   interpretation or recommendation and ask whether it fits or needs correction.
4. Keep source evidence, the user's interpretation, and the agent's hypothesis
   visibly separate. Do not present confidence as certainty or invent evidence
   to make the insight sound stronger.
5. Distinguish `insight` from a `note` that preserves raw detail,
   `self_observation` for one observed moment, `wiki_page` for durable reusable
   knowledge, `task` for an action, and `trigger_report`, `belief_entry`,
   `behavior_pattern`, `mode_profile`, or another Psyche record for the primary
   psychological material. Offer links only after the primary containers are
   clear; never use an insight to replace them.
6. Before saving, summarize the proposed title, grounded summary, and
   recommendation in the user's language, identify consequential uncertainty,
   and ask one accuracy or consent question.

Helpful follow-up lanes:

- what the core observation is
- who or what it belongs to
- what the practical recommendation is

Ready to save when:

- direct capture has the three required fields: accepted title, grounded
  summary, and recommendation, plus one accuracy or consent check
- read-only review has read the exact insight and its evidence without
  manufacturing a write
- narrow update has isolated the smallest accepted change without backfilling
  sparse optional metadata
- evidence-guided synthesis keeps observed evidence, the user's interpretation,
  and at most one tentative agent hypothesis distinct, names consequential
  uncertainty, and receives one fit-or-correction check
- a better primary note, self-observation, wiki, task, or Psyche container has
  been settled or linked first when needed
- every Insight write uses shared batch CRUD

Preferred opening question:

- "Are you saving an insight you already have, asking Forge to derive one from evidence, or reviewing an existing insight?"

## Calendar Event

Aim: make the event truthful in time and provider ownership without turning a direct
save, read-only review, or narrow correction into a scheduling form.

Choose the lane first:

- direct capture
- guided scheduling
- exact-record review or narrow update
- read-only review
- delete

Arc:

1. For direct capture, reflect the supplied title and time, search for a matching
   title in the overlapping interval, and ask only for the missing start, end or
   duration, or timezone interpretation. Once the accepted title, offset-bearing
   `startAt` and `endAt` with end after start, and one accuracy or consent check are
   present, save. Forge requires only `title`, `startAt`, and `endAt`. Do not demand
   description, location, place details, links, event type, categories,
   availability, all-day state, activity settings, owner, or calendar selection.
2. When the user gives local clock wording, resolve it to offset-bearing instants
   using the intended IANA timezone. Ask about timezone or daylight-saving ambiguity
   only when it could change the actual instant. Do not make the user format ISO
   timestamps.
3. For review, narrow update, or delete, search for and read the exact existing
   Calendar Event first. Answer read-only questions before proposing a write.
   Preserve accepted timing, timezone, place, links, provider mapping, ownership,
   recurrence, and optional metadata, then patch only what is newly true or
   inaccurate.
4. For updates, if the exact read shows external provider ownership, keep the event
   read-only. Explain that it must be changed in the provider or, with explicit
   consent, copied into a new Forge-owned event. Do not retry a batch update against
   the mirror.
5. If the exact read shows a recurring provider source and the user still wants an
   edit, ask whether it concerns one occurrence or the series. Use
   `recurrenceEditScope: "single"` only for an editable occurrence. Forge cannot edit
   the series from an expanded occurrence, so direct series work to the provider
   rather than claiming the update succeeded. Do not ask recurrence scope for a
   non-recurring event.
6. Omit `preferredCalendarId` to use the default writable connected calendar. Set it
   to `null` only when the user explicitly wants Forge-only storage. Ask for a
   particular calendar only when placement matters.
7. Ask where the event belongs or what it supports only when a place or link changes
   attendance, preparation, navigation, or later retrieval.
8. Before delete, summarize the exact event, its ownership, and its provider mapping,
   then obtain explicit confirmation. Forge marks the local event deleted
   immediately, has no restore, and attempts to delete every associated writable
   remote provider event or projected copy. Use shared batch CRUD for Calendar Event
   search, create, update, and delete. Provider projection happens downstream; do
   not invent a dedicated event route.

Helpful follow-up lanes:

- exact start and end time
- local timezone or daylight-saving interpretation only if there is ambiguity
- one occurrence versus provider-managed series only for a recurring source
- linked goal, project, task, or note only when the link changes later use
- explicit Forge-only storage when the default writable calendar is not wanted

Ready to save when:

- direct capture has an accepted title, offset-bearing start and end with end after
  start, an overlapping duplicate check, and one accuracy or consent check
- review or narrow update has read the exact event and isolated the smallest accepted
  change after checking provider ownership and recurrence
- external provider mirrors remain read-only for updates, and expanded-occurrence
  series edits are directed to the provider
- delete has an exact target, ownership and provider mapping plus explicit
  confirmation of immediate, non-restorable local removal and attempted deletion of
  every associated writable remote event or projected copy
- every event write uses shared batch CRUD

Preferred opening question:

- "Are you scheduling a new event, checking one already on the calendar, or changing one?"

## Work Block Template

Aim: define or maintain one reusable local-time availability rule without turning it
into a one-off event or a field-by-field form.

Choose the lane first:

- direct capture
- guided recurrence design
- exact-record review or narrow update
- read-only review
- delete

Arc:

1. For direct capture, reflect the accepted title and recurring weekdays, then resolve
   ordinary local clock wording into `startMinute` and `endMinute` yourself. Forge
   requires only `title`, `weekDays`, `startMinute`, and `endMinute`; `kind` defaults
   to `custom`, color to `#60a5fa`, timezone to `UTC`, and `blockingState` to
   `blocked`. Do not force the user to fill optional fields.
2. Use the user's known IANA timezone for local recurrence. Ask about timezone only
   when it is unknown or daylight-saving meaning could change the rule; do not make
   the user calculate minutes from midnight. If the end is earlier than the start,
   say that the block continues overnight. Equal start and end is invalid.
3. Search existing templates by title or kind and compare overlapping weekdays and
   local times. Summarize the effective title, days, times, timezone, and whether the
   rule allows or blocks work, then ask one accuracy or consent question.
4. In guided design, first clarify what availability decision the recurring rule
   should make. Ask about kind or blocking state only when the purpose does not imply
   them. Ask for `startsOn`, `endsOn`, or `exclusionDates` only when the rule is
   temporary or has known exceptions.
5. For review, narrow update, or delete, search for and read the exact template first.
   Answer the read-only question before proposing a write, preserve accepted sparse
   wording and defaults, and patch only what is newly true. Explain effects on future
   derived instances rather than pretending the template stores repeated events.
6. Before delete, identify the exact template and confirm that removal is immediate,
   non-restorable, bypasses the settings bin, and removes its future derived
   availability instances.

Helpful follow-up lanes:

- the availability decision this rule should make
- local days, times, timezone, and overnight meaning
- allowed or blocked only when not already implied
- temporary bounds or real exceptions only when relevant
- exact-record review, narrow update, or confirmed delete

Ready to act when:

- direct capture has an accepted title, at least one weekday, distinct local start and
  end minutes, a duplicate search, and one accuracy or consent check
- guided design has an accepted availability decision and effective recurrence
- review or update has read the exact template and isolated the smallest change
- delete has an exact target and explicit acknowledgement that it is immediate and
  non-restorable

Route note:

- ordinary search, create, update, and delete use shared batch CRUD
- `forge_create_work_block_template` is an optional create convenience, not a
  separate lifecycle or a reason to guess update or delete tools

Preferred opening question:

- "Are you setting up a recurring work rule, reviewing or changing one, or removing it?"

## Task Timebox

Aim: reserve or maintain real time for one exact task without confusing a plan, a live
task run, and evidence of completed work.

Choose the lane first:

- direct manual capture
- assisted recommendation
- exact-record review or narrow update
- read-only review
- status change
- delete

Arc:

1. For direct capture, resolve and read the exact existing task, derive or confirm a
   specific calendar title, and resolve local start plus end or duration into
   offset-bearing `startsAt` and `endsAt` with end after start. Search that task and
   overlapping interval for an existing timebox, then ask one accuracy or consent
   question. Forge requires only `taskId`, `title`, `startsAt`, and `endsAt`;
   `source` defaults to `manual` and `status` to `planned`.
2. Use `forge_get_calendar_overview` before placement when current commitments or
   availability matter. Ask about timezone only when it changes the instants; do not
   make the user format ISO timestamps. Ask for project, source, status, activity
   settings, owner, or `overrideReason` only when newly meaningful. An override reason
   records an intentional rule or calendar-pressure exception, not a generic note.
3. For assisted scheduling, read the exact task and call
   `forge_recommend_task_timeboxes` with `taskId` plus only the optional date window,
   limit, or timezone that changes the suggestions. Recommendations are read-only and
   timezone is optional. Present a small set of concrete choices and create only the
   slot the user accepts.
4. For review, update, status change, or delete, search for and read the exact timebox
   first. Answer read-only questions before proposing a write, preserve accepted task
   linkage, source, timing, status, provider mapping, and optional settings, and patch
   only what is newly true. `taskId` and `source` cannot be changed by update; moving
   the slot to another task requires an explicitly accepted replacement.
5. A timebox does not start a task run or prove work happened. Use task-run actions for
   live execution and factual closeout evidence. Use timebox status only for its own
   `planned`, `active`, `completed`, or `cancelled` state.
6. Before delete, identify the exact timebox and confirm that it becomes hidden
   immediately, is non-restorable, bypasses the settings bin, and, when
   provider-backed, leaves durable idempotent remote cleanup until acknowledged.

Helpful follow-up lanes:

- exact task and task-shaped calendar title
- manual slot versus bounded read-only suggestions
- exact offset-bearing time window
- scheduling exception only when it changes the action
- review, smallest patch, status change, or confirmed delete

Ready to act when:

- direct capture has read the exact task, accepted title and valid interval, checked
  the task and interval for overlap, and completed one accuracy or consent check
- recommendation has read the task and is ready with only useful optional bounds
- review or update has read the exact timebox and isolated the smallest change
- delete has an exact target and explicit acknowledgement of immediate local hiding,
  no restore, and durable remote cleanup when mapped

Route note:

- ordinary search, create, update, status change, and delete use shared batch CRUD
- `forge_create_task_timebox` is an optional create convenience
- `forge_recommend_task_timeboxes` is the bounded read-only assisted lane; a returned
  suggestion is not saved until the user accepts and creates it

Preferred opening question:

- "Do you already know the slot for this task, want Forge to suggest options, or need to review or change an existing timebox?"

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

## Today Priority

Aim: use Forge's current evidence to decide the next useful work without inventing a
fallback task.

Arc:

1. Clarify the user scope only when several owners are visible or the request is
   ambiguous.
2. Read the Today priority decision before recommending a task.
3. Reflect its state plainly: start, continue active work, resolve a conflict, recover
   capacity, choose smaller work, or stop because nothing is startable.
4. Read calendar overview separately when meetings or other events should constrain
   the user's choice.

Helpful follow-up lanes:

- whose work the decision should cover
- whether the user is choosing a new start or checking an active run
- whether meetings or non-task calendar events change the available window
- whether stale evidence should be refreshed before acting

Route note:

- `today_priority` is a read-model-only surface. Use
  `forge_get_today_priority` or `/api/v1/today/priority`; do not mutate it through
  batch CRUD.
- Schedule evidence in this decision comes from task timeboxes. Use
  `forge_get_calendar_overview` for meetings and other calendar events.
- Follow the returned `ready`, `continue-active`, `unresolved-active`, `overloaded`,
  `capacity-limited`, or `no-work` state. Do not replace a stop state with the first
  focus, backlog, or blocked task.

Ready to review when:

- the relevant user scope is clear enough
- the user has said whether calendar events beyond task timeboxes matter

Preferred opening question:

- "What decision are you trying to make about today's next work?"

## Self Observation

Aim: capture one observed episode with enough structure to be useful later without
turning a lightweight note into a forced functional analysis. A self-observation can
name whichever parts are actually present: situation, cue, emotion/body,
thought/meaning, behavior/urge, or consequence. If the material reveals a recurring
loop, belief, mode, schema theme, or trigger chain, offer the stronger Psyche record
and let the user confirm or correct that fit.

Arc:

1. Ask what happened in the situation.
2. Ask when it happened, or what observed date/time should anchor the note, if the
   timing is not already clear.
3. Reflect what seems most important in what the user already said.
4. Ask one next question about the most meaningful missing cue, emotion/body signal,
   thought/meaning, behavior/urge, or consequence. Do not require every link.
5. Ask about what happened next only when it changes the usefulness or likely
   container of the observation.
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

- `self_observation` is a Psyche-adjacent note-backed workflow, not generic quick
  capture. Read the calendar first, then create or update an observed `note` with
  `frontmatter.observedAt` instead of inventing a standalone CRUD write. The read
  path is `/api/v1/psyche/self-observation/calendar`; the stored write is a linked
  `note` through the shared batch entity route.
- Do not promote self-observation over functional analysis. If the user is describing
  a loop, use `behavior_pattern`; if they are describing one emotionally meaningful
  episode, use `trigger_report`; if a part-state is central, use `mode_guide_session`
  or `mode_profile`; if a belief sentence is central, use `belief_entry`; if the
  user needs a rehearsable reminder during the trigger or urge, use `flashcard`.
- If the user wants to remember a source, concept, book, article, or durable personal
  explanation, use `wiki_page` rather than self-observation.

If the user already gave the event or timing, reflect what stands out and ask only for
the one missing part that would make the note more useful or change its container.

Ready to save when:

- the situation/event and observed time are clear
- at least one meaningful cue, emotion/body signal, thought/meaning, behavior/urge,
  or consequence is clear enough to be useful later
- any stronger Psyche container supported by the material has been accepted or
  corrected by the user

Preferred opening question:

- "What happened in the situation, and what did you feel, think, or do next?"

## Sleep Session

Aim: capture or correct one night with minimal timing questions, preserve imported
evidence, and add reflective context only when the user wants it.

Choose the lane first:

- direct manual capture
- exact-record review or narrow correction
- read-only review
- reflective enrichment
- delete

Arc:

1. For direct manual capture, resolve the user's sleep start and wake time into
   offset-bearing `startedAt` and `endedAt`, ensure the end is after the start, and
   search the overlapping interval or local wake date for a duplicate. Reflect the
   interval once and ask one accuracy or consent question.
2. Forge requires only `startedAt` and `endedAt`. It defaults source fields for a
   manual record and derives time in bed, asleep time, awake time, score, and
   `localDateKey`. Do not require quality, stages, metrics, notes, tags, links,
   source details, or owner when already clear.
3. Ask for an IANA timezone only when local clock wording, daylight-saving
   ambiguity, or the local wake date would otherwise change the stored instants.
   When `localDateKey` is omitted, Forge derives it from `endedAt` in
   `sourceTimezone`, so the canonical night is the local wake date. Do not make the
   user format ISO timestamps or calculate that key.
4. For review or narrow correction, search for and read the exact existing Sleep
   Session first. Answer the read-only question before proposing a write. Preserve
   accepted sparse timing, source, provenance, stage, metric, annotation, tag, and
   link data; patch only what is newly true or inaccurate.
5. If the record is provider-backed, keep imported evidence separate from the
   user's correction. Do not rewrite raw timing, stages, source, or metrics merely
   to add context.
6. For reflective enrichment, read the exact night first. Briefly reflect the one
   quality, pattern, context, or meaning the user wants preserved, and ask only for
   a link or tag when it changes later review. Use `forge_update_sleep_session` for
   `qualitySummary`, notes, tags, or links so imported measurement fields remain
   untouched.
7. For delete, read and identify the exact night, explain that deletion is
   immediate, non-restorable, and bypasses the settings bin, then obtain explicit
   confirmation before `forge_delete_entities`.

Helpful follow-up lanes:

- the sleep start, wake time, and timezone only when needed to resolve the instants
- the canonical local wake date only when it disambiguates nearby records
- the smallest factual correction after an exact read
- one reflective quality, pattern, context, meaning, link, or tag when requested

Route note:

- Use shared batch CRUD for ordinary Sleep Session search, manual create, narrow
  correction, and delete. Use `forge_update_sleep_session` only for post-review
  reflective enrichment. Sleep Session deletion has no restore lane.

Ready to act when:

- direct capture has an accepted start and end with end after start, a duplicate
  search, and one accuracy or consent check
- read-only review has read the exact night and does not manufacture a write
- narrow correction has isolated the smallest accepted change without replacing
  provider-backed evidence with inference
- reflective enrichment has read the exact night and accepted only the reflection,
  tags, or links that should be preserved
- delete has an exact target and explicit acknowledgement that it is immediate and
  non-restorable

Preferred opening question:

- "Are you adding a night manually, reviewing or correcting one, adding context to it, or deleting it?"

## Workout Session

Aim: capture or correct one workout with minimal timing questions, preserve imported
or generated evidence, and make reflective context optional and specific.

Choose the lane first:

- direct manual capture
- exact-record review or narrow correction
- read-only review
- reflective enrichment
- delete

Arc:

1. For direct manual capture, identify the recognizable workout type and resolve the
   user's start and end into offset-bearing `startedAt` and `endedAt`. Ensure the end
   is after the start, search the nearby interval and workout type for a duplicate,
   and ask one accuracy or consent question.
2. Forge requires only `workoutType`, `startedAt`, and `endedAt` and defaults manual
   source fields. Do not require calories, distance, steps, heart rate, exercise
   minutes, effort, mood, meaning, social context, tags, links, provenance, or owner
   when those optional details were not requested.
3. Ask for a timezone only when local clock wording or daylight-saving ambiguity
   would otherwise change the stored instants. Resolve the time yourself; do not make
   the user format ISO timestamps or calculate duration.
4. For review or narrow correction, search for and read the exact existing Workout
   Session first. Answer the read-only question before proposing a write, preserve
   accepted sparse timing, workout type, source, provenance, biometric metrics,
   annotations, tags, and links, and patch only what is newly true or inaccurate.
5. For provider-backed or habit-generated records, keep imported or generated
   evidence separate from the user's correction. Do not rewrite measured timing,
   calories, distance, heart rate, source, or provenance merely to add context.
6. For reflective enrichment, read the exact workout first and reflect the one effort,
   mood, meaning, planned or social context, tag, or link the user wants preserved.
   Use `forge_update_workout_session` only for `subjectiveEffort`, `moodBefore`,
   `moodAfter`, `meaningText`, `plannedContext`, `socialContext`, tags, or links so
   imported measurement fields remain untouched.
7. For delete, read and identify the exact workout, explain that deletion is
   immediate, non-restorable, and bypasses the settings bin, and obtain explicit
   confirmation before `forge_delete_entities`.

Route note:

- For `workout_session`, use the shared batch CRUD routes for ordinary search, manual
  create, narrow correction, and delete. Use `forge_update_workout_session` only for
  post-review reflective enrichment. Workout Session deletion has no restore lane.

Ready to act when:

- direct capture has an accepted workout type, start, and end with end after start, a
  duplicate search, and one accuracy or consent check
- read-only review has read the exact workout and does not manufacture a write
- narrow correction has isolated the smallest accepted change without replacing
  provider-backed or habit-generated evidence with inference
- reflective enrichment has read the exact workout and accepted only the context,
  tags, or links that should be preserved
- delete has an exact target and explicit acknowledgement that it is immediate and
  non-restorable

Preferred opening question:

- "Are you adding a workout manually, reviewing or correcting one, adding context to it, or deleting it?"

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

Ready to review or act when:

- the food, body, training-fuel, gut, craving, appearance, energy, or experiment
  question is clear enough to choose the overview, food log, body check-in,
  appearance check-in, subjective food effect, gut check-in, pattern read, or
  N-of-1 experiment path
- if logging food, the item can reuse a searched `foodId`, barcode match, or has
  researched calories, protein, carbohydrate, and fat

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
5. If the user is updating, rediscovering, syncing, or removing an existing
   connection, list first and read the exact returned connection instead of making
   them reconstruct provider details from memory.
6. Reflect the current label, provider, selected calendars, and writable/read-only
   role, then ask only for the smallest lifecycle change or preservation choice that
   remains unclear.
7. Move into the actual connection flow once the setup goal is clear, and list again
   after a mutation when that verifies the intended result.

Helpful follow-up lanes:

- what calendar workflow the user wants to unlock
- whether writable projection matters
- whether the provider requires a local sign-in step instead of manual fields
- whether this is new setup, rediscovery, selected-calendar update, sync, or removal

Route note:

- `calendar_connection` is a specialized CRUD surface, not a batch CRUD entity.
- Use `forge_call_calendar_connection_route` with `list`, `discover`,
  `discoverMacOSLocal`, `rediscover`, `create`, `update`, `sync`, or `delete` so every
  published lifecycle action is callable without route guessing. The narrower
  `forge_connect_calendar_provider` and `forge_sync_calendar_connection` tools remain
  convenience helpers for those two already-settled actions.
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
- the existing connection is clear if this is rediscovery, selected-calendar update,
  sync, or removal
- its current provider, selected calendars, and writable/read-only role have been read
  rather than guessed for an existing-record change
- the intended sync behavior is clear enough
- the user-facing workflow that depends on the connection is clear enough
- the next setup, auth, calendar-selection, sync, or removal step is obvious

Preferred opening question:

- "What workflow do you want this calendar connection to unlock?"

## Preferences Workspace

Aim: explain an inferred preference ranking from its actual evidence so the user can
understand the model before deciding whether to change it.

Arc:

1. Ask what ranking, item, or decision the user is trying to understand. Ask for user,
   domain, or context scope only when it changes the answer.
2. Read the Preferences Workspace before asking the user to reconstruct scores,
   judgments, signals, or overrides from memory.
3. Answer the practical question first: name the leading result and the supporting
   judgment direction, direct signals, explicit overrides, and evidence count when
   available.
4. Treat sparse, conflicting, or context-mismatched evidence as uncertainty, not as
   proof. When useful, name the one comparison or signal that would most change the
   conclusion.
5. Only after explaining the read, ask whether the user wants to compare, merge
   contexts, add an existing Forge entity, record a judgment or signal, or override a
   score. Switch to that dedicated Preferences action only when the user chooses it.

Helpful follow-up lanes:

- the ranking, item, or practical decision to explain
- user, domain, or context scope only when it changes the evidence
- supporting judgments, direct signals, overrides, evidence count, and uncertainty
- the one missing comparison or signal that would materially change the conclusion
- one explicit follow-up action after the explanation, if the user wants a change

Route note:

- `preferences_workspace` is a read-model-only surface. Use
  `forge_get_preferences_workspace` or `GET /api/v1/preferences/workspace`; do not
  create, update, or delete it through batch CRUD.
- A missing workspace read returns `404` and must remain pure. Do not turn that GET
  into an implicit refresh; initialize only through an explicit user-chosen action.
- Follow-up writes use the dedicated comparison-game, context-merge,
  enqueue-from-entity, judgment, signal, or score-override tool. Do not mutate the
  read model or guess a generic Preferences route.

Ready to review when:

- the practical ranking or evidence question is clear
- any user, domain, context, or item scope that changes the answer is clear
- no write-shaped detail is requested before the read

Preferred opening question:

- "What preference ranking or decision are you trying to understand?"

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

1. Read the exact item and current Preferences workspace before proposing a write.
2. Reflect the current direct mark, context sharing and decay, and any conflict with existing comparisons.
3. Ask what signal the user wants only when their intent is not already clear.
4. Explain which current mark will be replaced; ask about strength only when the user expresses a gradient.
5. After saving, use the returned score and effective signal to explain the actual status, score, and confidence.

Helpful follow-up lanes:

- what item is being marked
- whether this is a favorite, veto, bookmark, neutral, or compare-later signal
- what context makes the signal meaningful

Route note:

- `preference_signal` is an action workflow. Submit it through
  `POST /api/v1/preferences/signals` with the preferences signal tool, not batch CRUD.
- `neutral` clears the current direct effect in that context. It preserves the
  audit history but adds no direct weight, evidence count, or confidence; the
  remaining evidence determines the returned score and status.

Ready to act when:

- the item is clear
- the signal type is clear
- the owner, domain, and context are clear
- the user understands which direct mark and model effect will be replaced

Preferred opening question:

- "What do you want Forge to remember about this item right now?"

## Attention

Aim: show the current actor the bounded set of decisions, blocked or overdue work,
reviews, and operational problems that need a next move without creating another
stored record type.

Arc:

1. When the user asks what needs attention, read the active queue immediately instead
   of asking them to classify the problem first.
2. If the user names a specific item or action, refresh the queue unless they already
   gave a stable item id from a current read.
3. Reflect why the most consequential item matters now using its severity, source, and
   current consequence. State uncertainty when the evidence does not establish urgency.
4. Ask which item they want to handle only when more than one returned item plausibly
   fits their request, then open the underlying record when the source itself needs action.
5. Snooze only when an item is valid but not actionable yet. Dismiss only when the
   returned `allowedActions` permits it. Never dismiss blocked or overdue work.
6. Restore a deferred item when the user wants it active again.

Lane-to-route map:

- Attention is a derived actor-scoped surface, not batch CRUD. Use the dedicated
  `forge_call_attention_route` with `list`, `snooze`, `dismiss`, or `restore`.
- Pass the stable returned id through `pathParams.id`. The canonical runtime path is
  `/api/v1/attention-inbox`; the OpenClaw mirror is `/forge/v1/attention`.

Ready to act when:

- the user has asked for a current queue read, or
- a current queue read identifies the stable item id and the requested action appears
  in `allowedActions`
- snooze has a future return time
- blocked or overdue work is being opened for source resolution, never dismissed

Preferred opening question:

- "Should I look across Forge for what most needs a next move, or is there something
  specific you already want to handle?"

## Entity Navigation

Aim: help the current actor reopen a canonical pinned record or resume something
they actually viewed recently, without turning navigation history into another form.

Arc:

1. List the bounded pinned and recent records before asking the user to reconstruct
   a title or entity type from memory.
2. Ask which returned record they mean only when more than one plausible match exists.
3. Open the exact canonical target and explain when a pinned target is deleted or
   unavailable instead of silently substituting another record.
4. Touch a record only after the agent actually viewed that exact in-scope record.
5. When the user wants to pin or unpin, direct them to the Forge Action Bar so the
   deliberate choice remains human-controlled.

Lane-to-route map:

- Use the dedicated `forge_call_entity_navigation_route` with `list` or `touch`. Pins
  are canonical shared or user-owned references; recent history is isolated to the
  current actor.
- Pin and unpin are not agent operations and must not be attempted through batch CRUD
  or an invented route.

Ready to act when:

- the dedicated published list route identifies the record to reopen, or
- the agent has actually viewed the exact in-scope entity type and id it will touch

Do not guess a nearby route or treat pin state as agent-owned when neither condition
is true.

Preferred opening question:

- "Are you trying to reopen something pinned, something you viewed recently, or the
  record we just looked at?"

## Life Events

Aim: preserve an important event or period in a person's life as a clear span on the
chronology, connected to the calendar, artifacts, wiki pages, goals, Psyche records,
and other Forge entities when those links help the event stay meaningful later.

Arc:

1. Ask what happened or what is coming up, and what makes it significant enough to
   belong on the Life Events timeline instead of only the calendar.
2. Ask for the missing start, end, place, and timezone details only when they are not
   clear from the user or from a ticket artifact. Life Events can last hours, days,
   weeks, or months.
3. Ask whether it is travel, stay, lodging, holiday, vacation, visit, move, festival,
   conference, retreat, concert, cinema, meal, party, ceremony, date,
   friends/family meeting, work phase, major work milestone, thesis milestone,
   class/course, exam, deadline, health episode, therapy, admin, legal/financial,
   celebration, memory, or a custom life event.
4. For travel, ask the practical route details: origin, destination, departure,
   arrival, transport mode, booking or ticket artifact, and when the user needs to
   leave or be ready.
5. Ask what the event should be linked to only when it will help later retrieval or
   interpretation: calendar event, artifact, wiki page, note, goal, project, task,
   Psyche record, preference, health record, or movement context.
6. Check for an existing calendar event before creating a new one. If one exists,
   link it; if not, project the Life Event into the calendar.
7. If the user provides a ticket or booking file, upload it through the Artifact Store
   first, then import the ticket from the artifact id. Do not download, execute, or
   inspect stored file bytes outside the Artifact Store contract.

Direct action rules:

- `life_event` is a normal stored entity for create, update, search, soft delete,
  restore, and generic links. Use the shared batch entity tools for those operations.
- The dedicated Life Events route family is for the chronology and domain actions:
  timeline reads, one-event reads, calendar sync, creating or linking from an existing
  calendar event, ticket artifact import, and travel-status reads.
- Relationships use the general `entity_links` model. Do not create a special
  life-event link table or a special artifact-link model.
- If the user clicks or names an existing calendar event and says it is a Life Event,
  use the calendar-to-Life-Event route and keep the calendar link explicit.
- If the user creates a Life Event first, use calendar sync to find or create the
  matching calendar event. Prefer `link_or_create` unless the user clearly wants
  no calendar projection.
- If a ticket import returns missing fields, ask only for the missing practical
  details that change the saved event: which traveler/event it is, origin or
  destination, departure or arrival time, title, or whether to create/link the
  calendar event.
- Travel-status reads are read-only status checks. They may report scheduled fallback
  status or provider-backed status when configured; they do not mutate the event.
- Custom Life Events are valid. Do not force a custom event into a travel or
  entertainment type just because the type catalog is available.

Helpful follow-up lanes:

- why this belongs on the Life Events timeline
- when it starts, when it ends, and which timezone applies
- whether this is a short event, overnight span, stay, festival, visit, work phase,
  health episode, or longer period
- where it starts, where it ends, and where the user needs to be
- whether this is travel, entertainment, family/friends, work milestone, health,
  ceremony, or custom
- which calendar event, ticket artifact, wiki page, goal, project, task, Psyche
  record, note, or movement context should be linked
- whether the user wants the event projected into the calendar
- whether ticket metadata should fill missing title, route, time, and description
- for travel, how the user is moving and when they need to leave or be ready

Lane-to-route map:

- create, update, search, soft delete, restore, or link normal Life Event records:
  shared batch entity routes with `entityType: "life_event"`
- read the chronology for the Life Events view:
  `GET /api/v1/life-events/timeline`
- read one Life Event with segments and links:
  `GET /api/v1/life-events/:id`
- link or create the calendar event for a Life Event:
  `POST /api/v1/life-events/:id/calendar-sync`
- turn an existing calendar event into a Life Event:
  `POST /api/v1/life-events/from-calendar-event`
- draft or create travel Life Events from trusted ticket artifacts:
  `POST /api/v1/life-events/import-ticket`
- read travel status for one event:
  `GET /api/v1/life-events/:id/travel-status`

Ready to act when:

- the event title or practical subject is clear
- the timing is known or intentionally approximate
- the type is known or custom is acceptable
- calendar projection or calendar linking is decided
- important generic entity links are known or intentionally absent
- for ticket import, the trusted Artifact Store artifact id is available

Preferred opening question:

- "What is the event you want Forge to place on your life timeline, and what makes it worth remembering there?"

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
- For route keys with placeholders, identify the product object before calling:
  `boxDetail`, `tripDetail`, `placeUpdate`, `userBoxUpdate`, `userBoxDelete`,
  `automaticBoxInvalidate`, `stayUpdate`, `stayDelete`, `tripUpdate`, `tripDelete`,
  `tripPointUpdate`, and `tripPointDelete` all need exact saved IDs in `pathParams`.
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
- After a Movement read, translate the returned data into one next action: no change,
  a manual overlay, a place boundary correction, a settings change, or a linked note.
  Ask only for the missing span, place, boundary, or confirmation that enables that
  action.
- If the next action is to preserve movement context with another Forge record, do
  not invent a movement-link route. Use the dedicated Movement read or selection
  route first, then create or update a normal linked `note` through
  `/api/v1/entities/create` or `/api/v1/entities/update`; put the movement span,
  place, trip, or stay summary in the note body and use normal Forge `links` to point
  at the goal, project, task, Psyche record, wiki page, health record, or artifact
  that should carry the context.
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
- whether a link should become a linked note/context summary after a Movement read or
  a correction to movement history itself
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
- For the weekday-template route, fill `pathParams.weekday` from the real weekday name
  or number before sending the update; do not bury the weekday only in the body.
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
- After a Life Force overview, translate the read into one planning implication before
  asking for a write: lighter workload, added recovery, protected timebox, meeting
  change, task-choice change, or no change. Ask for a profile, template, or signal
  detail only when that implication requires a mutation.

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
  Use route key `flowDetail` for saved-flow detail by id; `flowById` remains valid
  for older agents.
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
  Use route key `runHistory` for the run-history read; `runs` remains valid for
  older agents.
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
- For Workbench route keys with placeholders, identify the saved flow, slug, run, and
  node explicitly before calling. `flowDetail`, `flowById`, `flowBySlug`,
  `publishedOutput`, `runHistory`, `runs`, `runDetail`, `runNodes`, `nodeResult`,
  `latestNodeOutput`, `updateFlow`, `deleteFlow`, `runFlow`, and `chatFlow` all
  depend on exact `pathParams`.
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
- After a Workbench read, translate the returned artifact into one next action:
  rerun with clearer input, inspect a specific node, edit the saved flow, publish or
  preserve the output, or stop because the answer is already sufficient. Ask only for
  the missing input, node, run, preservation choice, or confirmation that would change
  that action.
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

## Course

Aim: help the user choose, continue, understand, submit, review, install, or export
learning work through the dedicated Course surface without turning every request into
an enrollment form or exposing hidden assessment material.

Arc:

1. Distinguish choosing a course, reviewing progress, continuing a lesson, getting
   learning support, submitting an activity, importing a package, and exporting a
   package.
2. If the course is not exact, list installed courses before asking for an internal id.
   If it is exact, read course detail or the learner-safe session before asking the user
   to repeat syllabus, progress, lesson, or activity context.
3. For learning support, stay with the current explanation, example, or activity. Ask
   what is unclear and help directly; support never depends on saving an attempt.
4. For an attempt, identify the exact course, lesson, and activity from the learner-safe
   session, preserve the learner's answer wording, and ask for confirmation only when
   they have not already asked to submit it.
5. After submission, explain the saved answer, assessment status, feedback, score,
   grade, points, and next lesson without inflating missing results. If structured
   assessment is unavailable, say that grading was withheld.
6. For import, identify the trusted Forge course package and whether the user intends a
   new install or an accepted replacement. Let Forge validate references and the
   canonical hash; report conflicts rather than bypassing them.
7. For export, identify the exact course and confirm that the user wants the canonical
   portable package. Never use export as a learner-facing lesson read.
8. Skip the broad lane question when the exact course and action are already clear.

Lane-to-route map:

- choose or browse -> `listCourses`
- review syllabus or progress -> `courseDetail`
- continue, learn, or get activity help -> `learningSession`
- submit an accepted answer -> `submitAttempt`
- install a trusted package -> `importCourse`
- explicitly transfer a portable package -> `exportCourse`
- find due or matching concepts -> `listConcepts`
- inspect one concept and its evidence -> `conceptDetail`

Learner-safety rules:

- Use `GET /api/v1/courses/:courseId/learn` for teaching, activity selection, and learner
  support. It removes instructor references, correct option ids, answer explanations,
  and extension assessment data.
- Do not reconstruct, reveal, or hint at hidden reference answers while helping with an
  activity. Work from the learner-safe prompt, the user's reasoning, and returned
  feedback.
- `GET /api/v1/courses/:courseId/export` returns the canonical package and may include
  instructor material. Call it only for explicit package transfer.
- `POST /api/v1/courses/:courseId/lessons/:lessonId/activities/:activityId/attempts`
  needs exact path identifiers and `answerMarkdown`. Preserve the user's wording.
- Written assessment can be withheld when the configured model cannot return a valid
  structured assessment. Never manufacture a score, grade, misconception, or mastery
  update.
- Course definitions are package-backed. Do not use shared batch CRUD for Course or
  Concept.

Ready to act when:

- catalog, detail, progress, or learner guidance has only the learner scope and exact
  course or lesson needed for the read
- an attempt has exact course, lesson, and activity identifiers plus accepted answer
  wording
- import has the trusted package plus new-install or accepted-replacement intent
- export has the exact course plus explicit portable-package intent

Preferred opening question:

- "Are you trying to choose a course, continue a lesson, submit work, review progress, or import or export a course?"

## Concept

Aim: explain one concept or due-review set through the dedicated learning surface
without treating a mastery estimate as a verdict or inventing direct concept CRUD.

Arc:

1. Distinguish one concept explanation, due-review prioritization, concepts inside one
   course, and interpretation of cross-course mastery evidence.
2. If the concept is not exact, list with only the learner, course, search, or due-only
   filter that changes the answer. Do not ask the user for an internal id they do not
   know.
3. Read exact concept detail before discussing prerequisites, related concepts, course
   coverage, source lessons, evidence, or mastery dimensions.
4. Keep the package-defined concept, observed learner evidence, and current mastery
   estimate separate. Offer at most one correctable learning hypothesis when it helps
   choose a prerequisite, review, or next lesson.
5. Ask only what changes the next learning action: explanation depth, prerequisite
   review, one due concept, one source lesson, or no action.
6. If the user wants the definition changed, explain that concept definitions come from
   validated course packages and clarify whether they mean to import a revised package.

Lane-to-route map:

- find a concept, a due set, or concepts within one course -> `listConcepts`
- explain one concept, its prerequisites, coverage, evidence, or mastery estimate ->
  `conceptDetail`
- continue from explanation into the containing lesson -> `learningSession`
- change a package-defined concept -> clarify revised-package intent, then use the
  Course `importCourse` lane only after the package is trusted and accepted

Ready to act when:

- list intent has only the learner, course, query, or due filter that changes the result
- exact detail has a concept selected from a current result or accepted id or slug
- any proposed next review remains grounded in observed evidence and is presented as a
  correctable learning interpretation

Preferred opening question:

- "Are you trying to understand one concept, see what is due for review, or make sense of your mastery evidence?"

## Preference Catalog

Aim: define a useful comparison pool, not just a list with no decision purpose.

Arc:

1. Ask what preference question this catalog is meant to support.
2. Ask what domain or concept area it belongs to.
3. Ask what kinds of items should be included or excluded.
4. Confirm the owner when several human or bot users are in scope.
5. Ask whether a goal, project, task, note, calendar record, Psyche record, artifact, or other Forge entity gives the catalog useful context.
6. Offer a working catalog name once the purpose is clear.

Helpful follow-up lanes:

- what decision or taste question this catalog should help answer
- what belongs in scope
- what would make the catalog immediately useful instead of bloated
- which existing Forge records explain why the catalog exists
- whether an apparent duplicate should update the current catalog or remain distinct

Route note:

- `preference_catalog` is normal stored Preferences CRUD. Use the shared batch entity
  routes unless the user is playing the comparison game or submitting a judgment or
  signal.
- Store relationships through the general `links` field backed by `entity_links`.
  Do not invent a catalog-specific link route.
- Creator source and actor are stamped by Forge. Do not ask the user to manufacture
  provenance that the authenticated request already supplies.
- Soft deletion moves a catalog to the Forge bin. Use `forge_restore_entities` when
  the user wants it back; require explicit confirmation before hard deletion.

Ready to save when:

- the catalog has a stable purpose
- the domain is clear
- the boundary of what belongs inside is clear enough
- the owner is unambiguous
- any useful general links are explicit, or the user has chosen to leave them empty

After saving, read the catalog back and verify its owner, purpose, boundaries,
links, and creator provenance. If Forge reports a normalized-title conflict, show
the existing catalog and ask whether the user meant to update it.

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

Aim: define or revise a real operating mode for preferences, or consolidate contexts
without losing the evidence that explains the resulting ranking.

Arc:

1. Identify the lane: review, create, update, or merge. If the user already made it
   clear, do not ask them to choose it again.
2. For review, update, or merge, read the current matching contexts before asking the
   user to reconstruct names, boundaries, or ids from memory.
3. For create, ask what situation or mode the context represents, which decisions
   should differ there, and what belongs inside versus outside. Search for a
   near-duplicate before saving.
4. For update, ask only what no longer fits and whether the context should remain
   active, default, or separate from other evidence.
5. For merge, reflect why the distinction is no longer useful, identify one exact
   source and one exact target on the same profile, and explain the effect before
   asking for explicit merge intent.
6. Offer a concise name only when the context meaning is clearer than its wording.

Helpful follow-up lanes:

- what decisions this context should shape
- what belongs inside versus outside the mode
- what one definition change would make the context more truthful
- why two existing contexts no longer need to stay separate
- which exact context should survive as the target

Route note:

- Ordinary `preference_context` create, update, immediate delete, and search use the
  shared batch entity tools. Context deletion is not restorable.
- Read the current contexts through `GET /api/v1/preferences/contexts` or one exact
  context through `GET /api/v1/preferences/contexts/:id`.
- An accepted merge uses `forge_merge_preferences_contexts` or
  `POST /api/v1/preferences/contexts/merge` with exactly one
  `sourceContextId` and one `targetContextId`. Never imitate a merge by deleting
  the source through batch CRUD.
- A merge moves judgments and signals to the target, clears derived source scores and
  summaries, deactivates the source, and recomputes the target.

Ready to act when:

- review has a practical question and matching context scope
- ordinary create or update has a clear purpose, decision boundary, accepted wording,
  and duplicate or preservation check
- merge has two read and verified contexts on the same profile, one exact source and
  target, an explained preservation effect, and explicit merge intent

Preferred opening question:

- "Are you defining a preference context, changing one, or bringing two contexts
  together?"

## Preference Item

Aim: preserve one clear preference candidate while distinguishing ordinary item
CRUD, source-entity enqueue, new evidence, and explicit model correction.

Arc:

1. Identify the lane first: review, ordinary standalone create or update, enqueue an
   existing Forge entity, record a pairwise judgment, record a direct signal, or
   explicitly override inferred score state. Skip the lane question when the user's
   verb already makes it clear.
2. For review or any action on an existing item, read the exact item and Preferences
   Workspace first. Answer what the current judgments, signals, override, evidence
   count, and uncertainty imply before asking for a write.
3. For an ordinary standalone candidate, ask which preference question and domain it
   belongs to, search for a duplicate, and use shared batch CRUD. Ask what
   distinguishes it only when nearby candidates would otherwise be ambiguous.
4. For an existing Forge record, confirm the exact source entity, user, and preference
   domain; search for the same `sourceEntityType` and `sourceEntityId`, then use
   `forge_enqueue_preferences_item_from_entity`. Let Forge derive the source label and
   description unless the user wants a meaningful override.
5. Treat left, right, tie, or skip as a pairwise judgment and favorite, veto,
   must-have, bookmark, neutral, or compare-later as a direct signal. Use their
   dedicated action tools instead of changing the item or score through batch CRUD.
6. Use `forge_update_preferences_score` only when the user explicitly wants to
   correct or protect inferred state. Confirm the exact item, user, domain, and
   context; distinguish a manual status, manual score, confidence lock, bookmark,
   compare-later flag, or frozen state from new evidence, and preserve unmentioned
   override fields.
7. After enqueue, judgment, signal, or score override, read or use the returned
   Preferences Workspace to verify the item, context, evidence, and resulting state
   rather than reporting only that the call succeeded.

Helpful follow-up lanes:

- what domain this belongs to
- what context makes the preference meaningful
- whether this is a standalone candidate, existing Forge record, new evidence, or
  explicit correction
- what distinguishes the item from nearby options
- which current evidence or inferred state the user wants to correct

Route note:

- `preference_item` uses normal stored Preferences CRUD for ordinary standalone
  candidate create, update, delete, restore, and search.
- Use `forge_enqueue_preferences_item_from_entity` and
  `POST /api/v1/preferences/items/from-entity` for an existing Forge source entity.
- Use `forge_submit_preferences_judgment` or
  `forge_submit_preferences_signal` for new evidence.
- Use `forge_update_preferences_score` and
  `PATCH /api/v1/preferences/items/:id/score` only for an explicit correction or
  protection of inferred score state after reading the workspace.

Ready to act when:

- ordinary CRUD has a clear candidate, domain, accepted wording, and duplicate check
- enqueue has an exact source entity, user, domain, and source-identity duplicate check
- judgment or signal has an exact context and truthful pair outcome or direct mark
- score override has explained evidence, explicit correction intent, exact item,
  user, domain, context, and at least one intentional override field

Preferred opening question:

- "Are you adding a preference candidate, bringing in an existing Forge record,
  reviewing its evidence, or correcting how it is scored?"

## Questionnaire Instrument

Aim: guide ordinary questionnaire authoring and version lifecycle without treating
review, clone, draft, or publish work as a new-instrument form.

Arc:

1. Identify whether the user wants to review, create, update, clone, ensure an
   editable draft, or publish. Skip this lane question when their verb is already
   clear.
2. For review, update, clone, draft, or publish work, read the existing questionnaire
   and current version state before asking the user to reconstruct it from memory.
3. For a new instrument, ask what honest moment, pattern, or decision it should help
   someone notice, who it is for, and what the respondent should understand afterward.
   Search for a near-duplicate before creating it through batch CRUD.
4. For an ordinary metadata or content update, ask for the smallest newly true change
   and what published meaning, scoring behavior, provenance, or historical-run
   interpretation must remain intact, then use batch CRUD.
5. For clone, confirm the exact source instrument, destination owner, and what purpose
   makes a separate copy useful instead of editing the source.
6. For draft, confirm the exact instrument and what the editable version is meant to
   change. Ensure the draft through the dedicated action rather than creating another
   instrument.
7. For publish, summarize the current draft's purpose, scoring, provenance, and
   answer-shape changes, then ask one explicit publish confirmation and optional
   version label without reopening item-by-item intake.
8. Use clone, draft, and publish tools only for version lifecycle, and answer review
   questions before proposing any mutation.

Helpful follow-up lanes:

- whether this is review, create, update, clone, draft, or publish work
- the honest moment, audience, and respondent-facing outcome for a new instrument
- the smallest update and what published or historical meaning must remain intact
- the source and destination owner for a clone
- the exact editable change for a draft
- purpose, scoring, provenance, answer-shape changes, and consent for publish

Route note:

- `questionnaire_instrument` is normal stored CRUD for ordinary create, update,
  delete, and search work. Use clone, draft, and publish action routes only when the
  user is working with instrument version state. Questionnaire action paths live under
  `/api/v1/psyche/questionnaires`, including `/:id/clone`, `/:id/draft`, and
  `/:id/publish`. Use `forge_list_questionnaires` and `forge_get_questionnaire` for
  read-first work, then `forge_clone_questionnaire`,
  `forge_ensure_questionnaire_draft`, or `forge_publish_questionnaire_draft` only
  for the matching lifecycle action.

Ready to act when:

- review has the practical question and exact instrument
- ordinary create or update has purpose, audience or use context, respondent-facing
  outcome, accepted wording, and any duplicate or preservation check
- clone has the exact source, destination owner, and reason for a separate copy
- draft has the exact instrument and intended editable change
- publish has a current draft read, a summary of purpose, scoring, provenance, and
  answer-shape changes, plus one explicit confirmation and optional version label

Preferred opening question:

- "What are you trying to understand, create, revise, or publish about this questionnaire?"

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

Aim: bridge into the Psyche playbook for direct capture, guided formulation, or narrow
review of a reusable emotionally meaningful incident category without flattening the
lived episode into cold taxonomy. `event_type` remains Psyche taxonomy stored through
shared batch CRUD.

Arc:

1. Distinguish direct capture, guided category formulation, and exact-record review or
   narrow update before asking for an example or emotional stake.
2. For direct capture, reflect the supplied label and recurring kind of moment, search
   normalized built-in and owner-scoped labels, and ask one accuracy or consent
   question. Do not require a fresh episode, hypothesis, boundary exercise, links, or
   optional description when the category is already clear.
3. For review or update, search for and read the exact existing event type first. State
   whether it is built-in or custom, preserve the accepted label and description, and
   ask only what is newly true or inaccurate. Built-in labels remain read-only.
4. For guided formulation, ask for one recent or recurring example only when the
   boundary is unclear. Reflect the repeated moment back in plain language, keep the
   observable kind of moment, the user's meaning, and at most one tentative emotional
   or relational hypothesis separate, then ask one fit-or-correction question.
5. Distinguish this reusable category from one `trigger_report` episode, a whole
   `behavior_pattern` loop, and one `emotion_definition` feeling. Clarify inclusion or
   exclusion only when it would change future report classification.
6. Offer one concise candidate label once the category is clear, preserve historical
   `customEventType` wording, and use shared batch CRUD for the accepted custom entry.

If the user offered a candidate label but its boundary remains unclear,
ask what kinds of moments belong inside it and which nearby moments should stay outside.

Route note:

- `event_type` is psychologically meaningful but still uses shared batch CRUD for
  storage. Search and mutate it through the shared entity routes after the lived
  category, boundary, and wording are clear enough. Do not treat it as a generic tag
  or route it through `self_observation`.
- Search before create. Built-in entries have `system: true` and are read-only; custom
  entries are owner-scoped. Create accepts only `label`, optional `description`, and
  optional `userId`. Do not invent `aliases`: wording equivalent after Unicode NFKC
  default case folding, punctuation, and whitespace normalization is a duplicate
  within one owner scope.
- Batch agent search should set `searches[].userIds` and requires base `read` or
  `write` plus `psyche.read`; batch mutations require base `write` plus
  `psyche.write`. Dedicated routes require only the corresponding Psyche scope. Put a
  stable `operations[].idempotencyKey` on each create and reuse it only for an exact
  retry.
- Preserve the report's own event wording in `customEventType`. A rename or deletion
  of the reusable entry must not rewrite that historical wording; hard deletion clears
  only the reusable reference. Soft-deleted references survive unrelated report
  updates and return on restore. Hard deletion leaves the create key terminal, so a
  delayed retry cannot recreate the entry.

Ready to save when:

- direct capture has an accepted label, an understandable recurring kind of moment,
  and one accuracy or consent check without requiring a fresh episode
- review or narrow update starts from the exact entry, preserves sparse accepted and
  historical wording, changes only the requested custom field, and does not mutate a
  built-in label
- guided formulation has a boundary clear enough for future reports, with any
  tentative emotional or relational hypothesis accepted or corrected

Preferred opening question:

- "What kind of moment keeps happening that you want future reports to name the same way each time?"

Intent-specific alternatives:

- Direct capture: "It sounds like this label already names the recurring moment. Is that wording accurate enough to save?"
- Existing entry: "I have the current event type in view. What feels newly true or inaccurate about its label or description?"

## Emotion Definition

Aim: bridge into the Psyche playbook for direct capture, guided differentiation, or
narrow review of a reusable feeling label by its lived signature, not by a dictionary
definition. `emotion_definition` remains Psyche taxonomy stored through shared batch
CRUD.

Arc:

1. Distinguish direct capture, guided differentiation, and exact-record review or
   narrow update before asking for a recent episode or deeper function.
2. For direct capture, reflect the supplied label and recognizable meaning, search
   normalized built-in and owner-scoped labels, and ask one accuracy or consent
   question. Do not require a fresh episode, body signature, nearby-feeling contrast,
   function hypothesis, category, links, or optional description when it is clear.
3. For review or update, search for and read the exact existing emotion definition
   first. State whether it is built-in or custom, preserve the accepted label,
   description, and category, and ask only what is newly true or inaccurate. Built-in
   definitions remain read-only.
4. For guided differentiation, ask for one recent feeling episode only when the lived
   signature is unclear. Reflect the felt signature back in plain language and identify
   only the body signal, urge, image, thought, or relational meaning needed for future
   recognition.
5. Keep observed cues, the user's emotion word and meaning, and at most one tentative
   function hypothesis separate, then ask one fit-or-correction question.
6. Contrast nearby feelings only when it would change future recognition. Distinguish
   this definition from one raw `trigger_report` emotion, a belief sentence, a mode
   state, or a `behavior_pattern` segment.
7. Offer one concise definition in the user's language, preserve historical raw
   emotion labels, and use shared batch CRUD for the accepted custom entry.

Helpful guided-differentiation lanes:

- what tells the user this is that feeling and not a nearby one
- body signal, urge, image, thought, or relational meaning that identifies it
- what kind of moments this emotion name should be used for later
- what the feeling usually warns about, longs for, protects, or demands

Route note:

- `emotion_definition` is psychologically meaningful but still uses shared batch CRUD
  for storage. Search and mutate it through the shared entity routes after the
  intent-specific readiness condition is met. Do not treat it as a generic dictionary
  item.
- Search before create. Built-in entries have `system: true` and are read-only; custom
  entries are owner-scoped. Create accepts only `label`, optional `description`,
  optional `category`, and optional `userId`. Do not invent `aliases` or `bodySignals`:
  wording equivalent after Unicode NFKC default case folding, punctuation, and
  whitespace normalization is a duplicate within one owner scope.
- Batch agent search should set `searches[].userIds` and requires base `read` or
  `write` plus `psyche.read`; batch mutations require base `write` plus
  `psyche.write`. Dedicated routes require only the corresponding Psyche scope. Put a
  stable `operations[].idempotencyKey` on each create and reuse it only for an exact
  retry.
- Preserve each report emotion's own `label` when linking a reusable definition. A
  rename or deletion must not rewrite that historical wording; hard deletion clears
  only the reusable reference. Soft-deleted references survive unrelated report
  updates and return on restore. Hard deletion leaves the create key terminal, so a
  delayed retry cannot recreate the entry.

Ready to save when:

- direct capture has an accepted label and recognizable meaning plus one accuracy or
  consent check, without requiring a fresh episode
- review or narrow update starts from the exact entry, preserves sparse accepted and
  historical wording, changes only the requested custom field, and does not mutate a
  built-in definition
- guided differentiation has a lived signature clear enough for future recognition,
  with any nearby-feeling distinction or tentative function hypothesis accepted or
  corrected only when it matters

Preferred opening question:

- "When this feeling is present, what tells you it is this feeling and not a nearby one?"

Intent-specific alternatives:

- Direct capture: "It sounds like this label already carries a recognizable meaning. Is that definition accurate enough to save?"
- Existing entry: "I have the current emotion definition in view. What feels newly true or inaccurate about its label, description, or category?"
