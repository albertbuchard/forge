---
name: forge-openclaw
description: Use the Forge OpenClaw plugin through its small batch-first tool surface. If a goal, task, project, trigger pattern, or insight is implied, help first, then end with one light offer to save it in Forge. Only write after explicit save intent.
---

# Forge OpenClaw

Use this skill when Forge is available as a native OpenClaw plugin and you need truthful, structured access to the live Forge system.

Core behavior:
- implied entity -> help first -> end with one short Forge save offer
- explicit save intent -> use the Forge batch tools
- no browser/UI workaround for normal creation or updates

Forge is a life operating system with:
- goals
- projects
- tasks
- live work timers
- comments, insights, and approvals
- a sensitive Psyche module for values, patterns, beliefs, behaviors, modes, and trigger reports

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

High-level entity workflow:
- `forge_search_entities`
- `forge_create_entities`
- `forge_update_entities`
- `forge_delete_entities`
- `forge_restore_entities`

Operational workflow:
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
Use `forge_get_ui_entrypoint` only when visual review or editing is genuinely the better workflow.

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

These are the main advertised formats. Use them to decide what to ask next.

### `goal`

Purpose:
- a long-horizon life direction or outcome

Minimum fields:
- `title`: the name of the goal

Useful optional fields:
- `description`: why it matters or what success looks like
- `horizon`: `quarter`, `year`, or `lifetime`
- `tagIds`: values, categories, or execution tags when already known

What to ask:
- "What would you like to call this goal?"
- "Why does it matter to you?"
- "Is this a quarter, year, or lifetime horizon?"

### `project`

Purpose:
- a concrete workstream under a goal

Minimum fields:
- `title`: the project name
- `goalId`: the parent goal if known

Useful optional fields:
- `description`: desired outcome or scope
- `status`: `active`, `paused`, or `completed`
- `themeColor`: optional visual/editorial color

What to ask:
- "What should this project be called?"
- "Which goal does it support?"
- "What outcome do you want this project to produce?"

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
- `description`: useful detail, not a paragraph by default

What to ask:
- "What is the task in one concrete sentence?"
- "Should this live under an existing goal or project?"
- "Does it need a due date or priority?"

### `psyche_value`

Purpose:
- an ACT-style value or committed direction

Minimum fields:
- `title`: the value name

Useful optional fields:
- `description`: what the value means in practice
- `linkedGoalIds`
- `linkedProjectIds`
- `linkedTaskIds`

What to ask:
- "What value or direction does this point toward?"
- "How would you describe that value in your own words?"
- "Do you want it linked to an existing goal, project, or task?"

### `behavior_pattern`

Purpose:
- a recurring loop, trigger chain, or repeated behavior pattern

Minimum fields:
- `title`: short name for the pattern

Useful optional fields:
- `description`: what usually happens
- `triggerCue`: what tends to start it
- `linkedValueIds`
- `linkedReportIds`

What to ask:
- "What would you call this pattern?"
- "What usually triggers it?"
- "What tends to happen once the pattern starts?"

### `behavior`

Purpose:
- one concrete behavior instance or repeated behavior you want tracked

Minimum fields:
- `title`: what happened

Useful optional fields:
- `kind`: `away`, `committed`, or `recovery`
- `description`: short context
- `linkedPatternIds`
- `linkedValueIds`
- `linkedReportIds`

What to ask:
- "What happened, in plain language?"
- "Would you classify it as away, committed, or recovery?"
- "Do you want it linked to a pattern, value, or report?"

### `belief_entry`

Purpose:
- a belief worth tracking, examining, or linking to schema work

Minimum fields:
- `title`: short label or belief title

Useful optional fields:
- `belief`: the actual belief statement
- `schemaFamily`: maladaptive or adaptive framing when known
- `linkedReportIds`

What to ask:
- "What is the belief in one sentence?"
- "Does it feel like an old pressure theme or a healthier stabilizing one?"
- "Is this tied to a specific trigger report?"

### `trigger_report`

Purpose:
- a reflective incident report that ties together trigger, emotions, thoughts, behaviors, beliefs, and next moves

Minimum fields:
- `title`: short name for the incident

Useful optional fields:
- `eventSummary`: what happened
- `eventTypeId`
- `emotionIds`
- `thoughtSummary`
- `behaviorSummary`
- `nextMove`
- `linkedGoalIds`
- `linkedProjectIds`
- `linkedTaskIds`
- `linkedPatternIds`
- `linkedValueIds`

What to ask:
- "What happened?"
- "What emotions were present?"
- "What thoughts or beliefs showed up?"
- "What did you do next?"
- "What would be a useful next move now?"

## Mapping guidance

Prefer:
- `goal` for a meaningful long-horizon direction
- `project` for a multi-step outcome under a goal
- `task` for a concrete next action
- `psyche_value` for a value or committed direction
- `behavior_pattern` for a repeating loop
- `behavior` for one behavior or behavior tendency
- `belief_entry` for a trackable belief
- `trigger_report` for a specific reflective event chain
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
