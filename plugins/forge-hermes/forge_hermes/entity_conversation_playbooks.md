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
- First identify the user's job when the lane is not already explicit:
  are they trying to add, update, review, compare, navigate, link, or run something?
- Before every question, decide the one missing thing you are trying to clarify.
- Ask first for the missing thing that would change the record shape, title, or next
  action most, not just the easiest field to fill.
- Know where the conversation is headed before you ask the next question.
- Prefer one clean question to a stacked sentence with several asks.
- Reflect briefly when the user gives meaning, ambivalence, or emotionally loaded
  context that matters to the record.
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
  signals, and specialized surface work in Movement, Life Force, or Workbench, first
  ask what the user is trying to understand, change, add, update, link, or run, then
  route to the dedicated action or surface path instead of pretending it is normal
  CRUD.
- For specialized surfaces, ask what would make the answer or change useful before you
  ask route-shaped details such as provider, weekday, flow id, run id, or trip id.
- When the user has already named a precise correction or review target, do not widen
  back out into a meta lane question. Confirm only the missing route-selecting detail
  and then act.
- Once the route family is clear, say it plainly enough that another agent could follow
  the same path without guessing.
- Do not read schema fields out loud unless the user explicitly wants a checklist.
- One focused question is the default. Ask two only when both questions serve the same
  job and the user is steady enough for it.
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
- Once the record is clear enough to name, stop exploring broadly and ask only for the
  last missing structural detail.
- When the record is already clear enough to save, save it instead of performing a
  ceremonial extra question.

## Conversation arc

Most good Forge intake flows follow this sequence:

1. Clarify what the user is trying to preserve, change, or make true.
2. Land on the right Forge shape.
3. Offer or confirm a working name.
4. Clarify the outcome, placement, timing, or cadence that will matter later.
5. Ask about links only when those links will make the record more useful.

That sequence is not a script. Skip steps the user already answered.

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
- For specialized surfaces such as Movement, Life Force, and Workbench, use the lane
  to choose the dedicated route family before you ask for lower-level details.

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

When an adjacent record becomes visible:

- name it gently and ask whether it should be linked now, saved separately later, or
  left alone for now

## Review And Navigation Moves

Use this when the user wants to inspect, compare, review, or navigate existing Forge
records rather than create something new.

- Start by asking what they are trying to understand, decide, compare, or check.
- Ask only for the scoping detail that changes the read path most:
  entity, owner, timeframe, context, or comparison target.
- If the record already exists and the user wants review, do not reopen a creation
  intake. Route to search, list, overview, or detail first.
- For review-heavy questions, the useful progression is:
  user goal -> scope -> read path -> interpretation -> optional follow-up write.
- Only drift back into create or update intake if the user actually wants the record
  changed after the review.

## Question Calibration Loop

Use this quick internal check before every follow-up question.

1. What is the one thing still unknown?
2. Does that unknown affect the entity shape, the wording, the placement, or the
   operational detail?
3. What is the smallest question that would answer that unknown?
4. If the user already gave enough to act, stop asking and move to a short summary or
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
- If the user gives a correction, revise the working formulation once and close again
  instead of reopening the whole intake.

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

1. Ask what feels newly true, newly urgent, or newly clear.
2. Ask what should stay true so the record keeps its core meaning.
3. Ask what prompted the update now if that changes the shape of the record.
4. Then ask only for the missing structural detail required by the change.

If the current title or shape may no longer fit, offer one revised formulation yourself
before asking the user to rewrite it from scratch.

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
4. Ask what belongs inside the boundary and what can stay out if the scope still
   feels muddy.
5. Ask which goal it belongs under.
6. Land on a working name once the scope is clear.
7. Clarify status, owner, and notes only after the scope is clear.

Helpful follow-up lanes:

- what concrete outcome would make this project complete enough
- what belongs inside the boundary and what does not
- which goal gives the project meaning

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

Aim: identify the next concrete move, not just capture a vague obligation.

Arc:

1. Ask what the next concrete action is.
2. Ask where it belongs: project, goal, both, or standalone.
3. Ask what would make it easier to do: due date, priority, owner, or one line of
   context.

Helpful follow-up lanes:

- turn vague intent into an actionable verb
- identify parent project or goal
- capture the one timing or priority detail that will actually help

Ready to save when:

- the task is phrased as an actionable move
- placement is clear enough
- any crucial timing or priority is captured

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

Aim: create a durable reference page with a clear scope instead of dumping raw notes
into the wiki.

Arc:

1. Ask what topic this page should become the canonical place for.
2. Ask whether it is a durable wiki page or supporting evidence.
3. Ask what future lookup, decision, or collaboration this page should support.
4. Ask about linked entities, aliases, or tags only if they will make the page more
   navigable later.

Helpful follow-up lanes:

- what this page should be the home for
- what should belong on the page versus remain linked evidence
- who would open this page later and what they should quickly understand

Ready to save when:

- the page scope is clear
- the page kind is clear enough
- the title is stable enough to find later

Preferred opening question:

- "What should this page become the main reference for?"

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

- "What is the event, and when should it happen in your local time?"

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

- "What recurring block do you want to set up, and when should it repeat?"

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

- "Which task are you trying to make time for, and when should the slot be?"

## Task Run

Aim: start truthful live work with as little friction as possible while still knowing
what is being worked on and by whom.

Arc:

1. Confirm the task.
2. Confirm the actor only if it is not already obvious.
3. Ask whether the run should be planned or unlimited only if that changes the action.
4. Start the run instead of turning it into intake.

Ready to start when:

- the task is identified clearly enough
- the actor is clear enough
- any timer mode choice that matters is explicit

Preferred opening question:

- "Which task should I start?"

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

Ready to act when:

- the target task or project is clear
- the minute delta is clear
- the note is clear enough when an audit trail matters

Preferred opening question:

- "Which task or project should this time correction belong to?"

## Self Observation

Aim: capture one observation clearly enough that it can support later reflection
without pretending it is already a full interpretation.

Arc:

1. Ask what was observed.
2. Reflect the moment without pretending it is already a finished interpretation.
3. Ask what felt most important to name before it gets smoothed over or forgotten.
4. Ask for the smallest concrete slice if the observation still feels vague or
   global.
5. Ask when it happened or became noticeable.
6. Ask what it may connect to: pattern, belief, value, mode, task, project, or note.
7. Ask for tags or extra context only if that will help later review.

Route note:

- `self_observation` is note-backed. Read the calendar first, then create or update an
  observed `note` with `frontmatter.observedAt` instead of inventing a standalone CRUD
  write.

If the user already gave the moment or timing, move straight to what they noticed most
clearly instead of re-asking when.

Ready to save when:

- the observation itself is clear
- the lived point of the observation is clear enough to revisit later
- timing is clear enough
- any useful links are captured

Preferred opening question:

- "What did you notice most clearly in that moment?"

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
5. Move into the actual connection flow once the setup goal is clear.

Helpful follow-up lanes:

- what calendar workflow the user wants to unlock
- whether writable projection matters
- whether the provider requires a local sign-in step instead of manual fields

Ready to act when:

- the provider is clear
- the intended sync behavior is clear enough
- the user-facing workflow that depends on the connection is clear enough
- the next setup step is obvious

Preferred opening question:

- "Which calendar provider are you trying to connect, and what do you want Forge to do with it?"

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

Ready to act when:

- the item is clear
- the signal type is clear
- the context is clear enough if it changes interpretation

Preferred opening question:

- "What do you want Forge to remember about this item right now?"

## Movement

Aim: clarify whether the user wants to understand time in place, review travel
behavior, add or update a stay or trip, inspect one place, or link movement context to
another Forge record before choosing the dedicated route family.

Arc:

1. Ask whether the user is trying to query behavior, add something manually, update an existing movement item, or link movement to another Forge entity.
2. Ask whether the focus is a stay, a trip, a place, a timeline window, or a selected span.
3. Ask for the time window, place, or movement item that makes the question concrete.
4. Ask what they are trying to notice, preserve, or answer through that movement context.
5. Skip the meta lane question when the user already named the exact correction or
   review target and only one ambiguity remains.
6. Route to the dedicated movement read or write path once the surface is clear.

Direct action rules:

- If the user is clearly talking about a missing-data gap that should become a stay or
  trip, use a user-defined movement box.
- Preflight with `/api/v1/movement/user-boxes/preflight` when overlap or exact timing
  is unclear, then create the overlay with `/api/v1/movement/user-boxes`.
- Use `kind: "stay"` when the user stayed in one place and `kind: "trip"` when they
  traveled.
- Use raw `PATCH /api/v1/movement/stays/:id` or `/api/v1/movement/trips/:id` only for
  editing an already-recorded stay or trip, not for filling a missing span.
- When the user has already given the real answer, for example "I stayed home during
  that missing block", do not ask a broad review question again. Confirm only the
  interval or place if that is still ambiguous, then act.
- When you do act on a concrete missing-gap correction, create the overlay and read
  the relevant timeline back instead of leaving the correction ungrounded.

Helpful follow-up lanes:

- whether the user wants time-in-place, travel history, one specific stay or trip, a
  place summary, or a link
- what time window, place, stay, trip, or selection is in scope
- whether the question is behavioral, such as time at home, travel frequency, or place
  distribution, versus an edit
- whether the edit is a missing-gap overlay versus a true recorded stay/trip patch
- whether the user is trying to repair one recorded movement item versus fill a
  missing span

Lane-to-route map:

- review one day or month:
  `/api/v1/movement/day` or `/api/v1/movement/month`
- review long-range behavior or dominant places:
  `/api/v1/movement/all-time`, `/api/v1/movement/places`, or `/api/v1/movement/selection`
- inspect the full life timeline:
  `/api/v1/movement/timeline`
- create or revise one saved place:
  `/api/v1/movement/places` or `/api/v1/movement/places/:id`
- inspect one trip:
  `/api/v1/movement/trips/:id`
- fill a missing span:
  `/api/v1/movement/user-boxes/preflight` then `/api/v1/movement/user-boxes`
- repair or revise one saved overlay:
  `/api/v1/movement/user-boxes/:id`
- repair one recorded automatic box:
  `/api/v1/movement/automatic-boxes/:id/invalidate`
- edit an already-recorded stay, trip, or trip point:
  `/api/v1/movement/stays/:id`, `/api/v1/movement/trips/:id`, or `/api/v1/movement/trips/:id/points/:pointId`

Ready to act when:

- the movement surface is clear
- the time range, place, stay, trip, or selection is clear enough
- the user goal is clear enough to tell review, overlay, and repair apart
- the user goal is clear enough to choose the route

Preferred opening question:

- "Are you trying to understand where you stayed and traveled, change one stay or trip, or answer a question about your movement behavior?"

## Life Force

Aim: clarify whether the user wants to review current energy state, change durable
profile assumptions, edit weekday curves, or log a real-time fatigue signal.

Arc:

1. Ask whether the job is overview, profile change, weekday-template change, or fatigue signaling.
2. Ask what part of the current energy picture feels most important or inaccurate.
3. Ask what should stay true if they are changing profile or template assumptions.
4. Ask whether the user is describing a stable weekly shape or just how today feels
   when the lane is still blurred.
5. If the user already named the life-force lane clearly, skip the meta lane question
   and ask only for the specific weekday, profile field, or signal that still matters.
6. Route to the dedicated life-force path once the lane is clear.

Helpful follow-up lanes:

- whether the user wants explanation, editing, or signaling
- what part of the energy model feels off or useful
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

- If the user is describing a durable baseline such as work capacity, recovery style,
  or action-point assumptions, patch the profile instead of logging a fatigue signal.
- If the user is describing how one weekday should usually feel, update that weekday
  template instead of editing the profile.
- If the user is describing right-now depletion or recovery, post a fatigue signal and
  then read the overview back if they want to see the updated picture.

Ready to act when:

- the life-force lane is clear
- the relevant weekday, profile field, or signal is clear enough
- the user intent is clear enough to choose overview versus mutation

Preferred opening question:

- "Do you want to understand the current energy picture, change how Forge models it, or log how you feel right now?"

## Workbench

Aim: clarify whether the user wants to inspect a flow, edit it, run it, or inspect
results so the agent uses the dedicated workbench contract instead of vague CRUD.

Arc:

1. Ask whether the job is flow discovery, one flow edit, execution, run history, published output, node-level inspection, or latest-node-output lookup.
2. Ask which flow, slug, run, or node the request is about.
3. Ask whether they need the flow contract, a run result, a published output, or a node result.
4. Ask what the user is trying to learn, repair, or publish through that flow.
5. If the user already named the flow and action clearly, skip the meta lane
   question and ask only for the missing run, node, or output scope.
6. Route to the dedicated workbench route family once the execution lane is clear.

Helpful follow-up lanes:

- whether the user wants structure, execution, or results
- what exact flow or run is in scope
- whether they need whole-flow output or node-level detail
- whether they need a public input contract or a published output instead of a debug trace

Lane-to-route map:

- discover or inspect flows:
  `/api/v1/workbench/flows`, `/api/v1/workbench/flows/:id`, or `/api/v1/workbench/flows/by-slug/:slug`
- create, update, or delete a flow:
  `POST/PATCH/DELETE /api/v1/workbench/flows`
- run a known flow:
  `/api/v1/workbench/flows/:id/run`
- run from a payload-first contract:
  `/api/v1/workbench/run`
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
- If the user wants to execute a known saved flow, use `/api/v1/workbench/flows/:id/run`.
- If the user wants payload-first execution without depending on a saved flow id, use
  `/api/v1/workbench/run`.
- If the user wants one node's latest successful output, do not browse old runs first
  unless they explicitly want historical debugging.

Ready to act when:

- the workbench lane is clear
- the flow, run, or node is clear enough
- the requested read or mutation is clear enough to choose the route

Preferred opening question:

- "Are you trying to inspect a flow, change it, run it, or inspect one run's outputs?"

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

Ready to act when:

- the item is clear
- the domain or profile context is clear enough
- any needed distinguishing detail is captured

Preferred opening question:

- "What preference are you trying to make clearer by saving this item?"

## Questionnaire Instrument

Aim: clarify whether the user is authoring a reusable questionnaire and what the
instrument is for.

Arc:

1. Ask what the questionnaire is meant to measure or surface.
2. Ask who it is for and when it should be used.
3. Ask what kind of honest moment or decision it should help someone answer before
   getting into item wording.
4. Reflect the practical use case back in plain language.
5. Ask what would make the instrument distinct instead of redundant if a near-duplicate
   risk is visible.
6. Move to draft creation once the purpose is clear.

Helpful follow-up lanes:

- what honest moment, decision, or review this instrument should support
- who will answer it and under what circumstances
- what would make the instrument distinct instead of redundant

Ready to act when:

- the purpose is clear
- the audience or use context is clear
- the instrument is distinct enough to draft

Preferred opening question:

- "What would this questionnaire help someone notice or track?"

## Questionnaire Run

Aim: clarify whether the user wants to start, continue, or complete one answer session.

Arc:

1. Ask what the user wants from the run right now: start, continue, review, or finish.
2. Ask which questionnaire or existing run this is about.
3. If the user wants to continue or finish, ask what feels most stuck, unfinished, or
   important before asking for more content.
4. If answering is still in progress, ask only for the next answer or note that matters.

Helpful follow-up lanes:

- whether the job is to begin, resume, review, or complete
- what questionnaire or run is in scope
- what next answer, uncertainty, or note is actually blocking progress

Ready to act when:

- the questionnaire is identified
- the user intent for the run is clear

Preferred opening question:

- "Do you want to start, continue, review, or finish a questionnaire run?"

## Event Type

Aim: create a reusable incident category that will actually help future reports stay
consistent.

Arc:

1. Ask what kind of moment or incident this label should capture in lived terms.
2. Reflect the repeated moment back in plain language before narrowing the wording.
3. Ask how narrow or broad it should be.
4. Ask what would count as inside versus outside the category if that boundary is
   still fuzzy.
5. Offer a concise label if the lived meaning is clearer than the wording.
6. Ask for a short description only if the label could be ambiguous later.

If the user already offered a candidate label, keep the wording provisional and ask
what kinds of moments belong inside it before you ask whether the label is right.

Ready to save when:

- the label is stable
- the intended category is clear enough that future reports will use it consistently

Preferred opening question:

- "What kind of moment keeps happening that you want future reports to name the same way each time?"

## Emotion Definition

Aim: define one reusable emotion entry clearly enough that future reports stay precise.

Arc:

1. Ask what this feeling is like in lived terms when the user says it.
2. Reflect the felt signature back in plain language before you settle the label.
3. Ask what distinguishes it from nearby emotions if that matters.
4. Offer a concise label if the felt meaning is clearer than the wording.
5. Ask for a short description only if later reports would benefit from it.

Helpful follow-up lanes:

- what tells the user this is that feeling and not a nearby one
- what kind of moments this emotion name should be used for later

Ready to save when:

- the label is clear
- the meaning is clear enough to reuse later

Preferred opening question:

- "When this feeling is present, what tells you it is this feeling and not a nearby one?"
