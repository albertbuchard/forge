---
name: forge-openclaw
description: Use the Forge OpenClaw plugin to collaborate with Forge through explicit plugin-owned routes and tools backed by the live /api/v1 contract.
---

# Forge OpenClaw

Use this skill when Forge is available as a native OpenClaw plugin and you need truthful, structured access to the live Forge system.

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

High-level entity workflow:
- `forge_search_entities`
- `forge_create_entities`
- `forge_update_entities`
- `forge_delete_entities`
- `forge_restore_entities`

Agent-authored recommendations:
- `forge_post_insight`

Narrow CRUD tools still exist for exact operations, timers, settings, approvals, comments, rewards, and specialized Psyche flows, but they are fallback tools and should not be the main advertised workflow.

## Source of truth

Forge remains the source of truth.

Use:
- plugin routes under `/forge/v1/...`
- the batch entity tools for most entity work
- `forge_post_insight` for structured recommendations

Do not:
- mutate storage directly
- scrape the UI instead of using the API
- invent entities outside the real Forge model

## Overview-first and batch-first rules

1. Start with `forge_get_operator_overview` unless the user is clearly asking for one exact known record.
2. Before creating or updating ambiguous entities, use `forge_search_entities` to check for duplicates.
3. Prefer batch tools even for small multi-step work when they keep the operation coherent.
4. Use narrow tools only when the job is genuinely specialized:
   - live timers and work logging
   - settings
   - approvals
   - comments
   - rewards
   - exact single-record fallback flows

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
4. Use `forge_log_work` if the work already happened.
5. Use `forge_post_insight` for structured recommendations.
6. Respect sensitive Psyche scopes. Psyche is not casual metadata.
7. Default delete is soft delete. Hard delete requires explicit user intent.
