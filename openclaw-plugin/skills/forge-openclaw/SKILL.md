---
name: forge-openclaw
description: use this when the user is talking about a goal, project, task, task run, insight, psyche value, behavior pattern, behavior, belief entry, mode profile, mode guide session, trigger report, event type, or emotion definition. identify which entity best matches what the user means, ask only the needed step-by-step questions to complete the entity, and save or update it using the forge schema. also use it when the user wants to structure work, run projects, organize tasks kanban-style, track active sessions, or turn reflections into structured records.Use the Forge OpenClaw plugin through its exact route-facing tool surface. For clearly implied Forge entities, end with one light optional Forge save offer at the end of your message. For explicit save requests, honor the requested entity type, ask only for missing required fields, and use the real Forge payload shapes.
---

# Forge OpenClaw

Use this skill when Forge is available as a native OpenClaw plugin and you need truthful, structured access to the live Forge system.

Core behavior:
- implied entity -> help first -> end with one short Forge save offer
- explicit save intent -> use the Forge batch tools
- no browser/UI workaround for normal creation or updates

Non-negotiable execution rules:
- If a goal, project, task, value, pattern, behavior, belief, trigger report, insight, or retroactive work item is clearly implied but the user has not asked to save it yet, help normally and then end with exactly one short optional Forge offer unless the user is in acute distress.
- If the user explicitly asks to save something in Forge and required fields are still missing, do not complain about schemas and do not guess. Ask only for the missing required fields or the one most decision-critical optional field, with at most 1 to 3 focused questions.
- If the user explicitly asks to save several related records at once and enough information is present, use one batched `forge_create_entities` call instead of serial one-by-one creation.
- Do not say you cannot create something when `forge_create_entities`, `forge_update_entities`, or the task-run tools already cover it.
- If the user explicitly names the target entity type, honor that entity type. Do not silently replace a requested `behavior_pattern`, `belief_entry`, `trigger_report`, `goal`, `project`, or `task` with an `insight`.
- If a related insight already exists but the user is now asking for a formal entity, treat the old insight as context only. Search for an existing entity of the requested type; if it does not exist, create or intake the requested type instead of redirecting back to the insight.

Forge is a personal planning, execution, and reflection app with:
- goals
- projects
- tasks
- live work timers
- comments, insights, and approvals
- a sensitive Psyche module for values, patterns, beliefs, behaviors, modes, and trigger reports

## What Forge is

Forge is the user's structured personal system for planning, doing work, reflecting on patterns, and keeping a truthful record of what is happening.

Use Forge whenever the user is talking about something that should be stored, searched, updated, reviewed, started, stopped, or explained inside Forge.

That includes every time the user is talking about one of these things:
- a `goal`
- a `project`
- a `task`
- a live work session on a task, called a `task_run`
- an `insight`
- a `psyche_value`
- a `behavior_pattern`
- a `behavior`
- a `belief_entry`
- a `mode_profile`
- a `mode_guide_session`
- a `trigger_report`
- a reusable `event_type`
- a reusable `emotion_definition`

Forge has two big parts:
- the planning and execution part: goals, projects, tasks, live work, XP, weekly review
- the Psyche part: values, patterns, beliefs, modes, and trigger reports

The planning chain is simple:
- a `goal` is something important the user wants in life or over the long term
- a `project` is a concrete piece of work under a goal
- a `task` is a concrete action item under a project or goal
- a `task_run` is a real live work session on a task
- an `insight` is an agent-written observation, pattern, recommendation, or warning based on Forge data

The Psyche chain is also simple:
- a `psyche_value` is a direction the user wants to live toward, such as honesty, stability, courage, or compassion
- a `behavior_pattern` is a repeating loop, for example: trigger -> emotion -> thought -> action -> short-term relief -> long-term cost
- a `behavior` is one recurring action tendency, such as doomscrolling, avoiding, apologizing too fast, or taking a walk to regulate
- a `belief_entry` is one explicit belief sentence the user carries, such as "If I disappoint people, they will leave me"
- a `mode_profile` is one recurring state or inner role, such as critic, abandoned child, overcontroller, detached protector, or healthy adult
- a `mode_guide_session` is a structured guided exploration of what mode may be active
- a `trigger_report` is one specific incident written as a sequence: what happened, what the user felt, what the user thought, what the user did, what happened next, and what would help next time
- an `event_type` is a reusable label for trigger reports, such as conflict, rejection, uncertainty, criticism, or loss of control
- an `emotion_definition` is a reusable named emotion entry, such as shame, anger, fear, grief, or relief

How the main entities relate:
- goals can contain projects and tasks
- projects usually belong to a goal
- tasks may belong directly to a goal, to a project, or to both
- task runs belong to tasks and are the truthful record of live work
- Psyche entities can link back to goals, projects, tasks, and to each other
- insights are commentary on top of the data; they do not replace the raw records

## Every Forge entity in plain language

`goal`
- what it is: a meaningful direction or outcome the user wants over time
- use it for: "be a great father", "build a beautiful family", "create meaningfully"
- do not use it for: one-off action items

`project`
- what it is: a bounded piece of work that moves a goal forward
- use it for: "Launch Forge plugin", "Plan summer move", "Repair relationship with X"
- do not use it for: abstract lifelong direction

`task`
- what it is: a concrete next action or deliverable
- use it for: "Draft the plugin README", "Call the landlord", "Book therapy session"
- do not use it for: vague ambitions

`task_run`
- what it is: one real live working session on a task
- use it for: starting, tracking, focusing, completing, or releasing current work
- do not confuse it with: task status; a task can be `in_progress` without an active task run

`insight`
- what it is: an agent-authored observation, recommendation, or warning based on what Forge already knows
- use it for: "You keep starting relationship repair work late at night when you are already depleted"
- do not use it for: replacing a requested goal, task, pattern, belief, or trigger report

`psyche_value`
- what it is: a value or direction the user wants to live toward
- use it for: honesty, courage, compassion, steadiness, creativity

`behavior_pattern`
- what it is: a repeating loop across situations
- use it for: CBT-style functional analysis of a recurring problem
- example pattern: "When my father texts late at night, I freeze, feel dread, think I am trapped, doomscroll, get temporary relief, and feel worse the next day"

`behavior`
- what it is: one recurring move or action tendency
- use it for: withdraw, attack, appease, numb out, ask for reassurance, take a walk

`belief_entry`
- what it is: one explicit belief sentence the user carries
- use it for: "If I fail once, I am useless", "If I set a boundary, people will punish me"
- note: this is the user's actual belief statement, not a diagnostic label

`mode_profile`
- what it is: one recurring state, voice, or protective role
- use it for: inner critic, panicked child, detached protector, overcontroller, healthy adult

`mode_guide_session`
- what it is: a guided exploration record used to understand what mode may be active right now
- use it for: interactive coaching and interpretation, not as the durable final profile

`trigger_report`
- what it is: one specific emotionally important episode
- use it for: one argument, one panic spiral, one difficult text exchange, one meeting that triggered shame

`event_type`
- what it is: a reusable category for trigger reports
- use it for: rejection, criticism, conflict, uncertainty, abandonment cue

`emotion_definition`
- what it is: a reusable emotion entry
- use it for: fear, shame, anger, sadness, relief, disgust

## Exact object shapes the tools expect

Use the exact field names. Do not invent friendlier names. Do not rename keys. If you are unsure, read `forge_get_agent_onboarding` first.

The core batch rule is simple:
- `forge_search_entities` expects a top-level `searches` array
- `forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, and `forge_restore_entities` expect a top-level `operations` array
- each array item must use the exact documented fields for that tool

`forge_search_entities` expects:
```json
{
  "searches": [
    {
      "entityTypes": ["goal", "project", "task"],
      "query": "find writing goals",
      "ids": ["optional-id"],
      "status": ["optional-status"],
      "linkedTo": { "entityType": "goal", "id": "goal_123" },
      "includeDeleted": false,
      "limit": 10,
      "clientRef": "search-1"
    }
  ]
}
```

`forge_create_entities` expects:
```json
{
  "atomic": true,
  "operations": [
    {
      "entityType": "goal",
      "data": {
        "title": "Create meaningfully"
      },
      "clientRef": "goal-create-1"
    },
    {
      "entityType": "project",
      "data": {
        "title": "Publish Forge plugin",
        "goalIds": ["goal_123"]
      },
      "clientRef": "project-create-1"
    }
  ]
}
```

`forge_update_entities` expects:
```json
{
  "atomic": true,
  "operations": [
    {
      "entityType": "task",
      "id": "task_123",
      "patch": {
        "status": "focus"
      },
      "clientRef": "task-update-1"
    }
  ]
}
```

`forge_delete_entities` expects:
```json
{
  "operations": [
    {
      "entityType": "task",
      "id": "task_123",
      "mode": "soft",
      "reason": "Merged into another task",
      "clientRef": "task-delete-1"
    }
  ]
}
```

`forge_restore_entities` expects:
```json
{
  "operations": [
    {
      "entityType": "task",
      "id": "task_123",
      "clientRef": "task-restore-1"
    }
  ]
}
```

Live work tools expect these exact top-level objects:
- `forge_start_task_run`: `{ "taskId": "...", "actor": "...", "timerMode?": "...", "plannedDurationSeconds?": 1500, "isCurrent?": true, "leaseTtlSeconds?": 900, "note?": "..." }`
- `forge_heartbeat_task_run`: `{ "taskRunId": "...", "actor?": "...", "leaseTtlSeconds?": 900, "note?": "..." }`
- `forge_focus_task_run`: `{ "taskRunId": "...", "actor?": "..." }`
- `forge_complete_task_run`: `{ "taskRunId": "...", "actor?": "...", "note?": "..." }`
- `forge_release_task_run`: `{ "taskRunId": "...", "actor?": "...", "note?": "..." }`
- `forge_log_work`: a retroactive work object with either a real `taskId` or a standalone `title`

## How Forge Psyche works

Treat Psyche as a structured reflective system, not as a loose note box.

Use the right Psyche entity:
- repeated loop across situations -> `behavior_pattern`
- one specific episode -> `trigger_report`
- one explicit belief sentence -> `belief_entry`
- one recurring state or inner role -> `mode_profile`
- one action tendency -> `behavior`
- one direction the user cares about -> `psyche_value`
- one agent-authored recommendation -> `insight`

For a `behavior_pattern`, think like a CBT functional analysis. Try to get:
- cue or situation
- emotions
- automatic thoughts
- urges or actions
- short-term payoff
- long-term cost
- preferred replacement response

For a `belief_entry`, try to get:
- the exact belief sentence
- how strongly it feels true
- evidence that seems to support it
- evidence against it
- a more flexible alternative belief
- `schemaId` only if a real schema catalog match is known

For a `trigger_report`, try to get:
- what happened
- emotions and intensity
- thoughts
- behaviors
- short-term consequences
- longer-term consequences
- what would help next time

For a `mode_profile`, try to get:
- mode name
- what it is trying to protect against
- what it pushes the user to do
- what it costs the user
- what healthier response should lead

Schema rule:
- `schemaId` belongs to `belief_entry`
- only use a real schema catalog id when you actually know the match
- if you do not know the match, leave `schemaId` out

## Public working posture

Keep the main discussion natural.
Do not turn every conversation into a form.

Default flow:
1. Continue the normal discussion first.
2. If something clearly looks like a Forge entity, add one short optional suggestion near the end.
3. Only start collection questions if the user accepts.
4. Ask only for the missing fields.
5. Ask at most 1 to 3 questions at a time.

Write-consent rule:
- if the user only implies a goal, project, task, value, pattern, belief, behavior, trigger report, or insight, do not write to Forge yet
- first help in the normal conversation
- then add one light end-of-message offer to save it in Forge
- only call `forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, `forge_restore_entities`, or `forge_post_insight` when:
  - the user explicitly asks to save, add, store, create, update, delete, or log it in Forge
  - the user accepts your prior Forge save offer
  - you are already inside an active Forge intake or editing flow that the user clearly consented to

Good suggestion style:
- "This sounds like a concrete project. If you want, we can break it down and store it in Forge."
- "This sounds like an important trigger event. If you want, we can map it together and save it in Forge."

Bad suggestion style:
- interrupting the main reply too early
- sounding pushy or repetitive
- asking for every field before the user has agreed to save it

## Advertised plugin interface

Treat this as the public mental model:

Read first:
- `forge_get_operator_overview`
- `forge_get_operator_context`
- `forge_get_current_work`
- `forge_get_psyche_overview`
- `forge_get_xp_metrics`
- `forge_get_weekly_review`
- `forge_get_ui_entrypoint` when the user should continue in the visual Forge UI

Main entity tools:
- `forge_search_entities`
- `forge_create_entities`
- `forge_update_entities`
- `forge_delete_entities`
- `forge_restore_entities`

Live work tools:
- `forge_log_work`
- `forge_start_task_run`
- `forge_heartbeat_task_run`
- `forge_focus_task_run`
- `forge_complete_task_run`
- `forge_release_task_run`

Agent-authored recommendations:
- `forge_post_insight`

## Exact tool list and execution rules

When the user asks which Forge tools are available, list exactly these tools and then use them:
- `forge_get_operator_overview`
- `forge_get_operator_context`
- `forge_get_agent_onboarding`
- `forge_get_psyche_overview`
- `forge_get_xp_metrics`
- `forge_get_weekly_review`
- `forge_get_current_work`
- `forge_get_ui_entrypoint`
- `forge_search_entities`
- `forge_create_entities`
- `forge_update_entities`
- `forge_delete_entities`
- `forge_restore_entities`
- `forge_log_work`
- `forge_start_task_run`
- `forge_heartbeat_task_run`
- `forge_focus_task_run`
- `forge_complete_task_run`
- `forge_release_task_run`
- `forge_post_insight`

Do not say you are missing a Forge creation path when `forge_create_entities` is available.
Do not open the Forge UI or a browser as a workaround for normal entity creation or updates.
Use `forge_get_ui_entrypoint` only when visual review or editing is genuinely the better option.

## Source of truth

Forge remains the source of truth.

Use:
- plugin routes under `/forge/v1/...`
- the batch entity tools for most entity work
- `forge_get_ui_entrypoint` when the user asks for the UI URL or would benefit from switching into the visual interface
- `forge_post_insight` for structured recommendations

Do not:
- mutate storage directly
- scrape the UI instead of using the API
- open a browser just to create or edit records that the batch tools already cover
- invent entities outside the real Forge model

## Overview-first and batch-first rules

1. Start with `forge_get_operator_overview`, `forge_get_operator_context`, or `forge_get_current_work` unless the user is clearly asking for one exact known record.
2. Before creating or updating ambiguous entities, use `forge_search_entities` to check for duplicates.
3. Prefer batch tools even for small multi-step work when they keep the operation coherent.
4. When review, editing, Kanban movement, or Psyche exploration would be easier visually, use `forge_get_ui_entrypoint` and offer the Forge UI lightly near the end of the message.
5. Do not write to Forge purely because an entity is implied. Implied entities get a save offer first; explicit user intent gets the actual write.

## Live work rules

Use real task-run tools for live work.
Do not pretend a status change is the same thing as starting or stopping work.

- starting live work: `forge_start_task_run`
- keeping a run alive: `forge_heartbeat_task_run`
- making a run current: `forge_focus_task_run`
- finishing work: `forge_complete_task_run`
- stopping without completion: `forge_release_task_run`
- retroactive work that already happened: `forge_log_work`

For "what am I working on right now?", prefer `forge_get_current_work` or `forge_get_operator_context`, not a naive search for `in_progress` tasks alone.

## Exact batch payload rules

`forge_search_entities`:
- pass `searches` as an array
- each search item can include `entityTypes`, `query`, `ids`, `status`, `linkedTo`, `includeDeleted`, `limit`, and `clientRef`

`forge_create_entities`:
- pass `operations` as an array
- each create operation must include:
  - `entityType`
  - `data`
- `data` is required; `entityType` alone is not enough
- if the user wants several goals, projects, or tasks created together, put them in one batched `operations` array

`forge_update_entities`:
- pass `operations` as an array
- each update operation must include:
  - `entityType`
  - `id`
  - `patch`
- `patch` is required

`forge_delete_entities`:
- pass `operations` as an array
- each delete operation must include:
  - `entityType`
  - `id`
- `mode` is optional and defaults to soft-delete behavior unless hard is explicit

`forge_restore_entities`:
- pass `operations` as an array
- each restore operation must include:
  - `entityType`
  - `id`

Good create example:

```json
{
  "operations": [
    {
      "entityType": "goal",
      "data": {
        "title": "Create meaningfully"
      },
      "clientRef": "goal-create-1"
    },
    {
      "entityType": "goal",
      "data": {
        "title": "Build a beautiful family"
      },
      "clientRef": "goal-create-2"
    }
  ]
}
```

Good update example:

```json
{
  "operations": [
    {
      "entityType": "task",
      "id": "task_123",
      "patch": {
        "status": "focus",
        "priority": "high"
      },
      "clientRef": "task-update-1"
    }
  ]
}
```

## Exact operational payload rules

`forge_log_work`:
- use this only for retroactive work that already happened
- pass either:
  - `taskId` to log completed work against an existing task
  - or `title` to create/log a completed work item when no task exists yet
- optional fields:
  - `description`, `summary`
  - `goalId`, `projectId`
  - `owner`
  - `status`, `priority`
  - `dueDate`
  - `effort`, `energy`
  - `points`
  - `tagIds`

`forge_start_task_run`:
- truthful way to begin live work
- required:
  - `taskId`
  - `actor`
- optional:
  - `timerMode`: `planned` or `unlimited`
  - `plannedDurationSeconds`
  - `isCurrent`
  - `leaseTtlSeconds`
  - `note`
- rule:
  - if `timerMode` is `planned`, `plannedDurationSeconds` is required
  - if `timerMode` is `unlimited`, omit `plannedDurationSeconds` or pass `null`

`forge_heartbeat_task_run`:
- use during ongoing live work
- required:
  - `taskRunId`
- optional:
  - `actor`
  - `leaseTtlSeconds`
  - `note`

`forge_focus_task_run`:
- use when one active run should become the current visible run
- required:
  - `taskRunId`
- optional:
  - `actor`

`forge_complete_task_run`:
- truthful way to finish live work
- required:
  - `taskRunId`
- optional:
  - `actor`
  - `note`

`forge_release_task_run`:
- truthful way to stop live work without completing the task
- required:
  - `taskRunId`
- optional:
  - `actor`
  - `note`

Example live-work start:

```json
{
  "taskId": "task_123",
  "actor": "aurel",
  "timerMode": "planned",
  "plannedDurationSeconds": 1500,
  "isCurrent": true,
  "leaseTtlSeconds": 900,
  "note": "Starting focused writing block"
}
```

## When to offer saving to Forge

Offer once, gently, near the end of the reply, when the signal is strong.

Offer for likely:
- `goal`
- `project`
- `task`
- `psyche_value`
- `behavior_pattern`
- `behavior`
- `belief_entry`
- `trigger_report`
- retroactive work that should be logged
- a recommendation that should become an `insight`

Do not offer when:
- it was just a passing mention
- the user needs support or clarity first
- the record is still too vague to name honestly
- the user already declined

If the signal is strong but the user has not asked to save yet, end the message with one optional line such as:
- "This sounds like a real project. If you want, we can turn it into a Forge project and anchor the first task."
- "This looks like a meaningful trigger pattern. If you want, we can map it and store it in Forge."
- "This sounds like a concrete task cluster. If you want, I can add it to Forge as a small task set."

## What insights are for

An `insight` is an agent-authored observation or recommendation grounded in the user's real Forge data.

Use insights when the agent can see a meaningful pattern across:
- goals, projects, and tasks
- momentum, drift, or stalled progress
- recurring trigger reports, beliefs, behaviors, or patterns
- tradeoffs between what the user says matters and what their recent activity shows

A good insight should do three things:
- name the pattern or tension clearly
- explain why it matters now
- suggest one practical next move, experiment, or reframing

Good examples:
- "You are consistently moving the same goal forward, but the related admin work is what keeps stalling. It may help to split the admin work into one smaller recurring task and protect the creative block separately."
- "Your trigger reports keep clustering around late-day overload. It may be worth defining one lighter recovery action that you can do before the full crash spiral starts."

Use `forge_post_insight` when you want to store that recommendation with agent provenance.
Do not use an insight as a substitute for the main conversation. The main reply should still help the user directly.
If storing the insight would be useful, mention it lightly near the end of the response, for example:
- "There may be a useful insight here about how this pattern keeps showing up. If you want, I can turn it into a structured Forge insight so it stays visible."

## When to suggest the Forge UI

Suggest the Forge UI lightly when it would genuinely help:
- Kanban review or lane movement
- reviewing several linked goals, projects, or tasks
- editing a record with a lot of connected context
- Psyche graph or report exploration

Good style:
- "If you want, I can also give you the direct Forge UI link so you can review it visually there."
- "This may be easier to inspect directly in Forge. If useful, I can pull the UI entrypoint for you."

Bad style:
- repeating it every turn
- replacing the main answer with a redirect
- suggesting the UI when the user clearly wants to stay in chat

## Entity format cards

These are the real route-facing formats. Use the exact field names below, not approximations.

## How To Guide Psyche Intake

### Pattern work = CBT functional analysis

When the user is describing a recurring loop, guide them through this order:
1. Name the pattern in plain language.
2. Identify the cue or context.
3. Describe what happens once it starts.
4. Clarify the short-term payoff or protection.
5. Clarify the long-term cost.
6. Name the preferred alternative response.

This usually maps to `behavior_pattern` with:
- `title`
- `description`
- `targetBehavior`
- `cueContexts`
- `shortTermPayoff`
- `longTermCost`
- `preferredResponse`

Good questions:
- "What usually sets this loop off?"
- "What do you tend to do next?"
- "What does that move do for you immediately?"
- "What does it cost later?"
- "If the loop loosened a little, what would you want to do instead?"

### Belief and schema work

When the user is describing a painful rule, self-judgment, or predictive script, guide them toward one explicit belief sentence.

Use this order:
1. Capture the belief in the user's own words.
2. Decide whether it is `absolute` or `conditional`.
3. Estimate confidence from 0 to 100.
4. Ask what seems to support it.
5. Ask what weakens it.
6. Ask for a more flexible alternative.
7. Only then link a `schemaId` if a real schema catalog match is known.

This usually maps to `belief_entry`.

Good questions:
- "What is the sentence your mind keeps pushing here?"
- "Is it more of an always/never belief, or an if-then rule?"
- "How true does it feel right now from 0 to 100?"
- "What seems to support it?"
- "What weakens it?"
- "What would a more flexible alternative sound like?"

### Mode work

When the user is describing a part, stance, protector, critic, or child-state, help them name the mode and what it is trying to do.

Use this order:
1. Pick the `family`.
2. Name the mode.
3. Describe the persona or imagery.
4. Clarify its fear.
5. Clarify its burden.
6. Clarify its protective job.
7. Optionally note origin context and linked patterns or behaviors.

This usually maps to `mode_profile`.
If the user needs guided exploration first, use a `mode_guide_session` to capture answers plus candidate interpretations.

### Trigger report work

When the user is describing one specific incident, do not flatten it into a pattern too early. Build the episode chain first.

Use this order:
1. Name the incident briefly.
2. Describe what happened.
3. Capture emotions and intensity.
4. Capture thoughts or meanings.
5. Capture behaviors.
6. Capture short-term and long-term consequences.
7. Capture next moves and links to values, patterns, beliefs, modes, goals, projects, or tasks.

This usually maps to `trigger_report`.

Good questions:
- "What happened, as concretely as you can say it?"
- "What emotions were there, and how intense were they?"
- "What thoughts or meanings showed up?"
- "What did you do next?"
- "What did that do for you short term, and what did it cost later?"
- "What would be the next good move now?"

### `goal`

Purpose:
- a long-horizon life direction or outcome

Minimum fields:
- `title`: the name of the goal

Useful optional fields:
- `description`: why it matters or what success looks like
- `horizon`: `quarter`, `year`, or `lifetime`
- `status`: `active`, `paused`, or `completed`
- `targetPoints`: point target for the goal
- `themeColor`: hex color such as `#c8a46b`
- `tagIds`: values, categories, or execution tags when already known

What to ask:
- "What would you like to call this goal?"
- "Why does it matter to you?"
- "Is this a quarter, year, or lifetime horizon?"

Example:
```json
{
  "title": "Create meaningfully",
  "horizon": "lifetime",
  "description": "Make work that is honest, beautiful, and published."
}
```

### `project`

Purpose:
- a concrete workstream under a goal

Minimum fields:
- `title`: the project name
- `goalId`: the parent goal if known

Useful optional fields:
- `description`: desired outcome or scope
- `status`: `active`, `paused`, or `completed`
- `targetPoints`: point target for the project
- `themeColor`: optional visual/editorial color such as `#c0c1ff`

What to ask:
- "What should this project be called?"
- "Which goal does it support?"
- "What outcome do you want this project to produce?"

Example:
```json
{
  "goalId": "goal_create_meaningfully",
  "title": "Launch the public Forge plugin",
  "description": "Ship a real public release that people can install."
}
```

### `task`

Purpose:
- a concrete actionable work item

Minimum fields:
- `title`: the action itself

Useful optional fields:
- `goalId`: linked goal if known
- `projectId`: linked project if known
- `dueDate`: when it matters
- `priority`: `low`, `medium`, `high`, or `critical`
- `status`: `backlog`, `focus`, `in_progress`, `blocked`, or `done`
- `owner`: defaults to `Albert` unless a different owner is intended
- `effort`: `light`, `deep`, or `marathon`
- `energy`: `low`, `steady`, or `high`
- `points`: reward value for the task
- `tagIds`: existing tag ids
- `description`: useful detail, not a paragraph by default

What to ask:
- "What is the task in one concrete sentence?"
- "Should this live under an existing goal or project?"
- "Does it need a due date or priority?"

Example:
```json
{
  "title": "Write the plugin release notes",
  "projectId": "project_forge_plugin_launch",
  "status": "focus",
  "priority": "high"
}
```

### `psyche_value`

Purpose:
- an ACT-style value or committed direction

Minimum fields:
- `title`: the value name

Useful optional fields:
- `description`: what the value means in practice
- `valuedDirection`: how the user wants to live or act when guided by this value
- `whyItMatters`: why this matters to the user
- `linkedGoalIds`
- `linkedProjectIds`
- `linkedTaskIds`
- `committedActions`: small concrete actions that enact the value

What to ask:
- "What value or direction does this point toward?"
- "How would you describe that value in your own words?"
- "Why does this value matter right now?"
- "Do you want it linked to an existing goal, project, or task?"

Example:
```json
{
  "title": "Steadiness",
  "valuedDirection": "Respond calmly instead of collapsing or reacting fast.",
  "whyItMatters": "I want to stay grounded in relationships and work."
}
```

### `behavior_pattern`

Purpose:
- a recurring loop, trigger chain, or repeated behavior pattern

Minimum fields:
- `title`: short name for the pattern

Useful optional fields:
- `description`: what usually happens
- `targetBehavior`: the visible behavior this loop tends to produce
- `cueContexts`: what tends to start it
- `shortTermPayoff`: what the loop gives immediately
- `longTermCost`: what it costs later
- `preferredResponse`: the preferred alternative move
- `linkedValueIds`
- `linkedSchemaLabels`
- `linkedModeLabels`
- `linkedModeIds`
- `linkedBeliefIds`

What to ask:
- "What would you call this pattern?"
- "What usually triggers it?"
- "What tends to happen once the pattern starts?"
- "What does it give you in the short term, and what does it cost later?"
- "What response would you rather make instead?"

Example:
```json
{
  "title": "Late-night father text freeze",
  "cueContexts": ["Father texts late at night"],
  "targetBehavior": "Freeze, avoid replying, and doomscroll",
  "shortTermPayoff": "Avoids immediate overwhelm",
  "longTermCost": "Sleep loss, guilt, and dread",
  "preferredResponse": "Pause, regulate, and reply on my own terms the next morning"
}
```

### `behavior`

Purpose:
- one concrete behavior instance or repeated behavior you want tracked

Minimum fields:
- `title`: what happened

Useful optional fields:
- `kind`: `away`, `committed`, or `recovery`
- `description`: short context
- `commonCues`: common cues for the behavior
- `urgeStory`: what the urge or inner story feels like
- `shortTermPayoff`
- `longTermCost`
- `replacementMove`
- `repairPlan`
- `linkedPatternIds`
- `linkedValueIds`
- `linkedSchemaIds`
- `linkedModeIds`

What to ask:
- "What happened, in plain language?"
- "Would you classify it as away, committed, or recovery?"
- "What cues or urge story usually show up?"
- "What move would you want available instead?"
- "Do you want it linked to a pattern, value, schema, or mode?"

Example:
```json
{
  "kind": "away",
  "title": "Doomscroll after conflict cue",
  "commonCues": ["Received a critical text"],
  "shortTermPayoff": "Numbs the anxiety",
  "longTermCost": "Loses time and deepens shame",
  "replacementMove": "Put phone down and take one slow lap outside"
}
```

### `belief_entry`

Purpose:
- a belief worth tracking, examining, or linking to schema work

Minimum fields:
- `statement`: the belief statement
- `beliefType`: `absolute` or `conditional`

Useful optional fields:
- `schemaId`: linked schema catalog id if known
- `originNote`: where the belief seems to come from
- `confidence`: 0 to 100
- `evidenceFor`
- `evidenceAgainst`
- `flexibleAlternative`
- `linkedValueIds`
- `linkedBehaviorIds`
- `linkedModeIds`
- `linkedReportIds`

What to ask:
- "What is the belief in one sentence?"
- "Is it more absolute or conditional?"
- "How true does it feel from 0 to 100?"
- "What supports it, and what weakens it?"
- "What would be a more flexible alternative?"
- "Is this tied to a specific trigger report?"
- "Does it seem linked to a known schema, or should we leave `schemaId` empty for now?"

Example:
```json
{
  "statement": "If I disappoint people, they will leave me.",
  "beliefType": "conditional",
  "confidence": 82,
  "evidenceFor": ["People got cold when I failed them before"],
  "evidenceAgainst": ["Some people stayed with me even after conflict"],
  "flexibleAlternative": "Disappointing someone can strain a relationship, but it does not automatically mean abandonment."
}
```

### `mode_profile`

Purpose:
- a schema mode profile such as critic, child, coping, or healthy adult

Minimum fields:
- `family`: `coping`, `child`, `critic_parent`, `healthy_adult`, or `happy_child`
- `title`: mode name

Useful optional fields:
- `archetype`
- `persona`
- `imagery`
- `symbolicForm`
- `facialExpression`
- `fear`
- `burden`
- `protectiveJob`
- `originContext`
- `firstAppearanceAt`
- `linkedPatternIds`
- `linkedBehaviorIds`
- `linkedValueIds`

What to ask:
- "What kind of mode is this: coping, child, critic-parent, healthy-adult, or happy-child?"
- "What would you call this mode?"
- "What does it fear, carry, or try to protect?"
- "Do you want it linked to patterns, behaviors, or values?"

Example:
```json
{
  "family": "coping",
  "title": "Cold controller",
  "fear": "If I soften, I will be humiliated or lose control.",
  "protectiveJob": "Stay hyper-competent and unreachable when threatened."
}
```

### `mode_guide_session`

Purpose:
- a guided mode-mapping session that stores answers and candidate interpretations before or alongside a durable mode profile

Minimum fields:
- `summary`: short summary of what the guided session explored
- `answers`: array of `{ questionKey, value }`
- `results`: array of `{ family, archetype, label, confidence, reasoning }`

Useful optional fields:
- none beyond the guided answer/result structure; this is already a structured worksheet

What to ask:
- "What question are we trying to answer about this mode?"
- "What answers should be captured explicitly?"
- "What candidate modes seem plausible, and why?"

Example:
```json
{
  "summary": "Mapping the part that takes over under criticism",
  "answers": [{ "questionKey": "felt_shift", "value": "I go cold and rigid" }],
  "results": [
    {
      "family": "coping",
      "archetype": "detached_protector",
      "label": "Cold controller",
      "confidence": 0.74,
      "reasoning": "It distances from shame and tries to stay untouchable."
    }
  ]
}
```

### `trigger_report`

Purpose:
- a reflective incident report that ties together trigger, emotions, thoughts, behaviors, beliefs, and next moves

Minimum fields:
- `title`: short name for the incident

Useful optional fields:
- `status`: `draft`, `reviewed`, or `integrated`
- `eventTypeId`
- `customEventType`
- `eventSituation`
- `occurredAt`
- `emotions`: array of `{ emotionDefinitionId|null, label, intensity, note }`
- `thoughts`: array of `{ text, parentMode, criticMode, beliefId|null }`
- `behaviors`: array of `{ text, mode, behaviorId|null }`
- `consequences`: object with `selfShortTerm`, `selfLongTerm`, `othersShortTerm`, `othersLongTerm`
- `nextMoves`
- `linkedGoalIds`
- `linkedProjectIds`
- `linkedTaskIds`
- `linkedPatternIds`
- `linkedValueIds`
- `linkedBehaviorIds`
- `linkedBeliefIds`
- `linkedModeIds`
- `modeOverlays`: extra mode labels noticed during the incident
- `schemaLinks`
- `modeTimeline`

What to ask:
- "What happened?"
- "What emotions were present?"
- "What thoughts or beliefs showed up?"
- "What did you do next?"
- "What would be a useful next move now?"
- "Do you want this linked to a value, pattern, belief, mode, goal, project, or task?"

Example:
```json
{
  "title": "Partner said we need to talk and I spiraled",
  "customEventType": "relationship threat",
  "eventSituation": "My partner texted that we needed to talk tonight.",
  "emotions": [
    { "label": "fear", "intensity": 85 },
    { "label": "shame", "intensity": 60 }
  ],
  "thoughts": [{ "text": "This means I messed everything up." }],
  "behaviors": [{ "text": "Paced, catastrophized, and checked my phone repeatedly" }],
  "nextMoves": [
    "Wait until we speak before predicting the outcome",
    "Write down the facts I actually know"
  ]
}
```

### `event_type`

Purpose:
- reusable event taxonomy for trigger reports

Minimum fields:
- `label`: the event type label

Useful optional fields:
- `description`: what kind of incident this label is meant to capture

What to ask:
- "What should this event type be called?"
- "What kind of incident does it represent?"

### `emotion_definition`

Purpose:
- reusable emotion vocabulary for trigger reports

Minimum fields:
- `label`: the emotion label

Useful optional fields:
- `description`: what the label is meant to capture
- `category`: optional grouping such as threat, anger, grief, shame, or connection

What to ask:
- "What emotion label do you want to reuse?"
- "How would you describe it?"
- "Does it belong to a broader category?"

## Mapping guidance

Prefer:
- `goal` for a meaningful long-horizon direction
- `project` for a multi-step outcome under a goal
- `task` for a concrete next action
- `psyche_value` for a value or committed direction
- `behavior_pattern` for a repeating loop
- `behavior` for one behavior or behavior tendency
- `belief_entry` for a trackable belief
- `mode_profile` for a recurring part-state
- `mode_guide_session` for guided mode interpretation
- `trigger_report` for a specific reflective event chain
- `event_type` for reusable report taxonomy
- `emotion_definition` for reusable emotion vocabulary
- `insight` when the agent is storing a data-grounded observation or recommendation rather than the user’s own work item or reflection record

## Auth and provenance

Plugin-originated requests carry:
- `Authorization: Bearer <token>` when configured
- `X-Forge-Source: openclaw`
- `X-Forge-Actor: <actorLabel>`

Localhost and Tailscale installs can bootstrap an operator session automatically.
Remote non-local installs should use a token.

## Working rules

1. Prefer `forge_get_operator_overview` first.
2. Prefer `forge_search_entities` before create/update when duplicate risk exists.
3. Prefer batch tools for multi-entity work.
4. Use `forge_post_insight` for structured recommendations.
5. Respect sensitive Psyche scopes. Psyche is not casual metadata.
6. Default delete is soft delete. Hard delete requires explicit user intent.
7. Use the exact route-facing field names from this skill or from `forge_get_agent_onboarding`; do not invent friendlier field aliases that the API does not support.
