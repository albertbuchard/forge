# Entity Conversation Playbooks

Use this file whenever the user is creating or updating a Forge entity outside the
deeper Psyche exploration flow. The point is to keep the conversation natural and
intentional while still gathering enough structure to store the right record.

## Interaction stance

- Ask only for what is missing or still unclear.
- Lead the user somewhere. Know whether you are trying to clarify the name, the role,
  the outcome, the placement, the timing, the success condition, or the links.
- Let each question have one job. If you cannot say what the question is trying to
  clarify, ask a different question.
- Ask one to three focused questions at a time. One is usually best when the user is
  unsure or emotionally loaded.
- Reflect briefly before the next question when the user gives nuance that matters.
- For emotionally meaningful planning records such as goals, habits, and notes, reflect
  the meaning first and then ask for the structure.
- Do not read schema fields out loud unless the user explicitly wants a mechanical
  checklist.
- Prefer a progression of:
  recent intent or concrete example -> working name -> purpose or outcome -> placement
  in Forge -> operational details -> linked context.
- If the user already gave a usable title, timing, or parent context, do not ask for it
  again just because the schema has that field.
- When the user says "save something about..." and the record is still fuzzy, help them
  sharpen what they are trying to preserve before you ask for the final Forge shape.
- When the meaning is clearer than the wording, offer a tentative title or summary
  yourself and ask whether it fits. Do not make the user do all the naming work alone.
- Before saving, offer a short working summary in the user's own language when that
  would reduce ambiguity.
- When updating, start with:
  what is changing,
  what should stay true,
  and what prompted the update now.

## Question design rules

- Prefer one clean question over a stacked sentence with multiple asks.
- For straightforward logistical entities such as tasks, calendar events, work blocks,
  timeboxes, and task runs, use the fast path: confirm what is already clear and ask
  for only the one missing operational detail.
- When you need two details, ask for the more meaning-bearing one first.
- If the user sounds uncertain, ask for an example before an abstraction.
- If the user sounds clear and decisive, confirm the working formulation and move to the
  one missing structural detail.
- A good next question usually clarifies one of these:
  what this is,
  why it matters,
  where it belongs,
  what success looks like,
  when it should happen,
  or what should stay linked.
- Before the final save question, it is often better to offer a tentative formulation
  than to ask for a raw title. Example shape:
  "This sounds like a project about repairing trust with Lea, not just a loose note.
  Does that fit, and if so what outcome would tell you it is moving?"
- Avoid dead-form prompts like "What should this be called?" when the user is still
  figuring out what the thing is. Name first, then ask for correction.

## Update loop

Use this when the user is updating an existing record rather than creating a new one.

1. Ask what feels newly true, newly urgent, or newly clear.
2. Ask what should stay intact so the record does not lose its core meaning.
3. Ask for the concrete trigger for the update if it matters.
4. Then ask only for the missing structural detail required by the change.

## Goal

Aim: clarify the direction and why it matters, not just produce a title.

Arc:

1. Ask what direction or outcome the user wants to keep in view.
2. Ask why it matters now.
3. Distinguish the goal from a project or task.
4. Clarify horizon and status only after the meaning is clear.

Ready to save when:

- the goal has a stable name
- the direction is understandable in plain language
- the horizon is clear enough if it matters

Preferred opening question:

- "What direction are you trying to hold onto here, in a way you would want future-you to keep seeing?"

## Project

Aim: turn an intention into a bounded workstream with a clear outcome.

Arc:

1. Ask what this piece of work should be called.
2. Ask what outcome would make the project feel real or complete for now.
3. Ask which goal it belongs under.
4. Clarify status, owner, and notes only after the scope is clear.

Ready to save when:

- the project has a clear name
- the outcome is concrete enough to recognize later
- its parent goal is known or intentionally absent pending follow-up

Preferred opening question:

- "If this becomes a real project in Forge, what outcome would make it feel genuinely underway or complete?"

## Strategy

Aim: turn a vague plan into a deliberate sequence toward a real end state.

Arc:

1. Ask what end state the strategy is trying to land.
2. Ask which goals or projects are the true targets.
3. Ask what the major steps or nodes are.
4. Ask about order, dependencies, and anything that must not be skipped.
5. Clarify linked entities or ownership once the sequence itself makes sense.

Ready to save when:

- the strategy has a stable name
- the end state is concrete enough to test
- the directed sequence is sketched clearly enough to build the graph

Preferred opening question:

- "What future state is this strategy supposed to make real?"

## Task

Aim: identify the next concrete move, not just capture a vague obligation.

Arc:

1. Ask what the next concrete action is.
2. Ask where it belongs: project, goal, both, or standalone.
3. Ask what would make it easier to do: due date, priority, owner, or brief context.

Ready to save when:

- the task is phrased as an actionable move
- placement is clear enough
- any crucial timing or priority is captured

Preferred opening question:

- "What is the next concrete move you want to remember or do?"

## Habit

Aim: define the recurring behavior and the cadence in a way that makes later check-ins unambiguous.

Arc:

1. Ask what the recurring behavior is in plain language.
2. Ask whether doing it is aligned or a slip.
3. Ask about cadence and what counts as success in practice.
4. Ask about links to goals, tasks, or Psyche entities only if that would help later review.

Ready to save when:

- the recurring behavior is specific
- polarity is clear
- the cadence and success condition are clear enough to check in honestly

Preferred opening question:

- "What is the recurring behavior you want Forge to keep track of?"

## Note

Aim: preserve the useful context and link it to the right places without turning the note into a dumping ground.

Arc:

1. Ask what the note needs to preserve.
2. Ask what entities it should stay attached to.
3. Ask whether it should be durable or temporary.
4. Ask about tags or author only if they help retrieval or handoff.

Ready to save when:

- the note body captures the important point
- the links are clear
- durability versus ephemeral memory is clear when relevant

Preferred opening question:

- "What feels important to preserve from this?"

## Insight

Aim: capture one grounded observation or recommendation clearly enough that it remains useful later.

Arc:

1. Ask what pattern, tension, or observation should be remembered.
2. Ask what entity or timeframe it belongs to, if any.
3. Ask what recommendation, caution, or invitation should remain explicit.

Ready to save when:

- the observation has a stable title or phrase
- the summary is clear
- the recommendation is explicit

Preferred opening question:

- "What is the clearest thing you want future-you or the agent to remember from this?"

## Calendar Event

Aim: make the event legible as a real commitment in time, with the right timezone and links.

Arc:

1. Ask what the event is.
2. Ask when it starts and ends in local time.
3. Ask where it belongs or what it supports.
4. Ask whether it should stay Forge-only only if that choice matters.

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
3. Ask whether this is a manual reservation, a suggestion, or a live-run alignment only if relevant.
4. Ask about override reason only if calendar rules are being bypassed.

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

## Event Type

Aim: create a reusable incident category that will actually help future reports stay consistent.

Arc:

1. Ask what category the label should capture.
2. Ask how narrow or broad it should be.
3. Ask for a short description only if the label could be ambiguous later.

Ready to save when:

- the label is stable
- the category boundary is clear enough to reuse

Preferred opening question:

- "What kind of incident should this category stand for?"

## Emotion Definition

Aim: create a reusable emotion label with enough clarity to use consistently later.

Arc:

1. Ask what emotion label the user wants to preserve.
2. Ask what distinguishes it from nearby emotions.
3. Ask for a broader category only if it will help later browsing or reporting.

Ready to save when:

- the label is stable
- the meaning is clear enough to reuse

Preferred opening question:

- "What emotion label do you want to keep reusable in Forge?"
