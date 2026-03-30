---
name: forge-openclaw
description: use when the user wants to save, search, update, review, start, stop, reward, or explain work or psyche records inside forge, or when the conversation is clearly about a forge entity such as a goal, project, task, habit, task_run, insight, psyche_value, behavior_pattern, behavior, belief_entry, mode_profile, mode_guide_session, trigger_report, event_type, or emotion_definition. identify the exact forge entity, keep the main conversation natural, offer saving once when helpful, ask only for missing fields, and use the correct forge tool and payload shape.
---

Forge is the user's structured system for planning work, doing work, reflecting on patterns, and keeping a truthful record of what is happening. Use it when the user is clearly working inside that system, or when they are describing something that naturally belongs there and would benefit from being stored, updated, reviewed, or acted on in Forge. Keep the conversation natural first. Do not turn every message into intake. When a real Forge entity is clearly present, name the exact entity type plainly, help with the substance of the conversation, and then offer Forge once, lightly, if storing it would genuinely help.

Forge has two major domains. The planning side covers goals, projects, tasks, notes, live work sessions, and agent-authored insights. The Psyche side covers values, patterns, behaviors, beliefs, modes, guided mode sessions, trigger reports, event types, and reusable emotion definitions. The model should use the real entity names, not vague substitutes. Say `project`, not “initiative”. Say `behavior_pattern`, not “theme”. Say `trigger_report`, not “incident note”.
Habits are a first-class recurring entity in the planning side. They can link directly to goals, projects, tasks, values, patterns, behaviors, beliefs, modes, and trigger reports, and they participate in the same searchable noteable graph as the rest of Forge.

Write to Forge only with clear user consent. If the user is just thinking aloud, helping first is usually better than writing immediately. After helping, you may offer one short Forge prompt if the match is strong. If the user agrees, ask only for the missing fields and only one to three focused questions at a time. Do not offer Forge again after a decline unless the user reopens it.

Optional recurring automation templates live in `cron_jobs.md` next to this skill. Use that file only when the user explicitly asks for recurring Forge automations, cron jobs, scheduled check-ins, or a recurring synthesis workflow. Those entries are rich examples, not defaults: adapt personal details such as names, recipients, phone numbers, or project titles to the current user, but preserve the intended tone, operational logic, and any example naming conventions when the user chooses to adopt that pattern.

Forge data location rule:

- by default, Forge stores data under the active runtime root at `data/forge.sqlite`
- on a normal OpenClaw install, this usually means `~/.openclaw/extensions/forge-openclaw-plugin/data/forge.sqlite`
- on a linked repo-local install, this usually means `<repo>/openclaw-plugin/data/forge.sqlite`
- if the user wants the data somewhere else for persistence, backup, or manual control, tell them to set `plugins.entries["forge-openclaw-plugin"].config.dataRoot` and restart the OpenClaw gateway
- if the user asks where the data is stored or how to move it, explain the current default plainly and show the exact config field
- if the user wants to manage a plugin-managed local Forge runtime cleanly, tell them to run `openclaw forge start`, `openclaw forge stop`, `openclaw forge restart`, or `openclaw forge status`
- these commands only manage a runtime that the OpenClaw plugin auto-started itself; if Forge was started manually elsewhere, they will say so instead of killing random local processes

Use these exact entity meanings when deciding what the user is describing.

`goal` is a meaningful long-horizon direction or outcome. Use it for “be a great father”, “create meaningfully”, or “build a beautiful family”, not for one-off action items.

`project` is a bounded workstream under a goal. Use it for “launch Forge plugin”, “plan summer move”, or “repair relationship with X”.

`task` is a concrete action item or deliverable. Use it for “draft the plugin README”, “call the landlord”, or “book therapy session”.

`task_run` is one truthful live work session on a task. It is not the same thing as task status.

`note` is a Markdown evidence record that can link to one or many entities. Use it for work summaries, context, progress logs, handoff explanations, or reflective detail that should stay searchable and attached to the right records.

`insight` is an agent-authored observation, recommendation, or warning grounded in Forge data. It does not replace a requested goal, project, task, pattern, belief, or trigger report.

`psyche_value` is a direction the user wants to live toward, such as honesty, courage, steadiness, compassion, or creativity.

`behavior_pattern` is a recurring loop across situations. Think in terms of cue, emotion, thought, action, short-term payoff, long-term cost, and preferred replacement response.

`behavior` is one recurring action tendency or move, such as withdrawing, appeasing, attacking, numbing out, or taking a regulating walk.

`belief_entry` is one explicit belief sentence the user carries, such as “If I disappoint people, they will leave me.”

`mode_profile` is one recurring state, voice, or inner role, such as inner critic, abandoned child, detached protector, overcontroller, or healthy adult.

`mode_guide_session` is a guided exploration record used to understand what mode may be active right now. It is a structured worksheet, not the final durable profile unless the user wants it that way.

`trigger_report` is one specific emotionally meaningful episode described as what happened, what was felt, what was thought, what was done, what happened next, and what would help next time.

`event_type` is a reusable category for trigger reports, such as rejection, criticism, conflict, uncertainty, or abandonment cue.

`emotion_definition` is a reusable emotion entry, such as fear, shame, anger, grief, relief, or disgust.

Use this intake map when the user agrees to save or update something.

`goal`
Use for a meaningful direction over time.
Minimum field: `title`
Usually useful: `description`, `horizon`, `status`
Ask:
1. What should this goal be called?
2. Why does it matter to you?
3. Is this a quarter, year, or lifetime horizon?

`project`
Use for a bounded workstream under a goal.
Minimum field: `title`
Usually useful: `goalId`, `description`, `status`
Ask:
1. What should this project be called?
2. Which goal does it support?
3. What outcome should it produce?

`task`
Use for one concrete action or deliverable.
Minimum field: `title`
Usually useful: `projectId`, `goalId`, `priority`, `dueDate`, `status`, `owner`
Ask:
1. What is the task in one concrete sentence?
2. Should it live under an existing goal or project?
3. Does it need a due date, priority, or owner?

`habit`
Use for a recurring commitment or recurring slip with explicit cadence and XP consequences.
Minimum field: `title`
Usually useful: `polarity`, `frequency`, `linkedGoalIds`, `linkedProjectIds`, `linkedTaskIds`, `linkedValueIds`, `linkedPatternIds`, `linkedBehaviorIds`, `linkedBeliefIds`, `linkedModeIds`, `linkedReportIds`
Ask:
1. What is the recurring behavior in one concrete sentence?
2. Is doing it good (`positive`) or a slip (`negative`)?
3. What should it link back to in Forge or Psyche?

`task_run`
Use for live work happening now.
Required fields to start: `taskId`, `actor`
Ask only what is needed to start the run, such as the task, the actor, and whether the run is planned or unlimited.

`psyche_value`
Use for a value or committed direction.
Minimum field: `title`
Usually useful: `description`, `valuedDirection`, `whyItMatters`, links to goals, projects, or tasks
Ask:
1. What value or direction is this?
2. How would you describe it in your own words?
3. Why does it matter now?

`behavior_pattern`
Use for a recurring loop across situations.
Minimum field: `title`
Usually useful: `description`, `targetBehavior`, `cueContexts`, `shortTermPayoff`, `longTermCost`, `preferredResponse`
Ask:
1. What would you call this pattern?
2. What usually sets it off, and what tends to happen next?
3. What does it give you in the short term, what does it cost later, and what response would you rather make?

`behavior`
Use for one recurring move or action tendency.
Minimum fields: `kind`, `title`
Usually useful: `commonCues`, `urgeStory`, `shortTermPayoff`, `longTermCost`, `replacementMove`, `repairPlan`
Ask:
1. What happened, in plain language?
2. Is it an `away`, `committed`, or `recovery` behavior?
3. What cues show up, and what move would you want available instead?

`belief_entry`
Use for one explicit belief sentence.
Minimum fields: `statement`, `beliefType`
Usually useful: `confidence`, `evidenceFor`, `evidenceAgainst`, `flexibleAlternative`, `originNote`
Ask:
1. What is the belief in one sentence?
2. Is it `absolute` or `conditional`, and how true does it feel from 0 to 100?
3. What supports it, what weakens it, and what would be a more flexible alternative?

`mode_profile`
Use for a recurring part-state or inner role.
Minimum fields: `family`, `title`
Usually useful: `fear`, `burden`, `protectiveJob`, `originContext`, links to patterns, behaviors, and values
Ask:
1. What kind of mode is this: `coping`, `child`, `critic_parent`, `healthy_adult`, or `happy_child`?
2. What should this mode be called?
3. What does it fear, carry, or try to protect?

`mode_guide_session`
Use for guided exploration before or alongside a durable mode profile.
Minimum fields: `summary`, `answers`, `results`
Ask only what is needed to capture the guided exploration and the candidate interpretations.

`trigger_report`
Use for one specific emotionally important episode.
Minimum field: `title`
Usually useful: `eventSituation`, `occurredAt`, `emotions`, `thoughts`, `behaviors`, `consequences`, `nextMoves`, links to values, beliefs, patterns, modes, goals, projects, or tasks
Ask:
1. What happened?
2. What emotions were present, and how intense were they?
3. What thoughts showed up, what did you do next, and what would be the useful next move now?

`event_type`
Use for a reusable trigger category.
Minimum field: `label`
Usually useful: `description`
Ask:
1. What should this event type be called?
2. What kind of incident does it represent?

`emotion_definition`
Use for a reusable emotion vocabulary entry.
Minimum field: `label`
Usually useful: `description`, `category`
Ask:
1. What emotion label do you want to reuse?
2. How would you describe it?
3. Does it belong to a broader category?

Use these rules when choosing tools.

Read first with `forge_get_operator_overview`, `forge_get_operator_context`, or `forge_get_current_work` unless the user is clearly asking for one exact known record or one exact write.

Before creating or updating an ambiguous stored entity, use `forge_search_entities` to check for duplicates.

Use the batch entity tools for stored records:
`forge_search_entities`, `forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, `forge_restore_entities`

These tools operate on:
`goal`, `project`, `task`, `habit`, `note`, `psyche_value`, `behavior_pattern`, `behavior`, `belief_entry`, `mode_profile`, `mode_guide_session`, `trigger_report`, `event_type`, `emotion_definition`

Use live work tools for `task_run`:
`forge_adjust_work_minutes`, `forge_log_work`, `forge_start_task_run`, `forge_heartbeat_task_run`, `forge_focus_task_run`, `forge_complete_task_run`, `forge_release_task_run`

Use `forge_post_insight` for `insight`.
Use `forge_grant_reward_bonus` only for explicit manual XP bonuses or penalties that should be auditable and cannot be expressed through the normal task-run or habit check-in routes.

Do not say you lack a creation path when these tools cover the request. Do not open the Forge UI or a browser for normal creation or updates that the tools already support. Use `forge_get_ui_entrypoint` only when visual review, Kanban movement, graph exploration, or complex multi-record editing would genuinely be easier there.

Use these exact payload expectations.

`forge_search_entities` expects a top-level `searches` array.

`forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, and `forge_restore_entities` expect a top-level `operations` array.

For create operations, each item must include `entityType` and `data`.

When creating `goal`, `project`, or `task`, the create payload may also include `notes: [{ contentMarkdown, author?, links? }]`. Forge will create real linked `note` entities automatically and attach them to the new parent record.

For update operations, each item must include `entityType`, `id`, and `patch`.

For delete operations, each item must include `entityType` and `id`. Delete is soft by default unless the user explicitly wants hard delete.

For restore operations, each item must include `entityType` and `id`.

Batch tools do not create or control `task_run` or `insight`.

Use the exact route-facing field names. Do not invent friendlier aliases. If a field name is unclear, use `forge_get_agent_onboarding` as the schema source of truth.

Use these live work rules.

A `task_run` is the truthful way to represent live work. Do not pretend that changing task status is the same as starting or stopping a work session.

Use `forge_start_task_run` to begin live work. Required fields: `taskId`, `actor`. If `timerMode` is `planned`, include `plannedDurationSeconds`. If `timerMode` is `unlimited`, omit `plannedDurationSeconds` or set it to null.

Use `forge_heartbeat_task_run` to keep an active run alive.

Use `forge_focus_task_run` when one active run should become the current visible run.

Use `forge_complete_task_run` to finish live work. When the user or agent wants to preserve what was done, include `closeoutNote` so Forge creates a real linked `note` instead of losing that explanation inside ephemeral run metadata.

Use `forge_release_task_run` to stop live work without completing the task. `closeoutNote` is also available there for handoff or pause context.

Use `forge_log_work` only for retroactive work that already happened. If the user explains the work in a way that should be preserved, include `closeoutNote`.

Use `forge_adjust_work_minutes` when the task or project already exists and the user only needs tracked minutes corrected up or down. This is the truthful path for signed retrospective minute adjustments and it automatically applies symmetric XP changes when reward buckets are crossed.

Do not use `forge_adjust_work_minutes` to simulate a live session. Live work still belongs in `forge_start_task_run` and the rest of the task-run workflow.

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
`forge_get_operator_overview`
`forge_get_operator_context`
`forge_get_agent_onboarding`
`forge_get_psyche_overview`
`forge_get_xp_metrics`
`forge_get_weekly_review`
`forge_get_current_work`
`forge_get_ui_entrypoint`
`forge_search_entities`
`forge_create_entities`
`forge_update_entities`
`forge_delete_entities`
`forge_restore_entities`
`forge_grant_reward_bonus`
`forge_adjust_work_minutes`
`forge_log_work`
`forge_start_task_run`
`forge_heartbeat_task_run`
`forge_focus_task_run`
`forge_complete_task_run`
`forge_release_task_run`
`forge_post_insight`
