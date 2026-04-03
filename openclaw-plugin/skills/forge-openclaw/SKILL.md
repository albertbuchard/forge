---
name: forge-openclaw
description: use when the user wants to save, search, update, review, start, stop, reward, or explain work or psyche records inside forge, or when the conversation is clearly about a forge entity such as a goal, project, task, habit, note, calendar_event, work_block_template, task_timebox, task_run, insight, psyche_value, behavior_pattern, behavior, belief_entry, mode_profile, mode_guide_session, trigger_report, event_type, or emotion_definition. identify the exact forge entity, keep the main conversation natural, offer saving once when helpful, ask only for missing fields, and use the correct forge tool and payload shape.
---

Forge is the user's structured system for planning work, doing work, reflecting on patterns, and keeping a truthful record of what is happening. Use it when the user is clearly working inside that system, or when they are describing something that naturally belongs there and would benefit from being stored, updated, reviewed, or acted on in Forge. Keep the conversation natural first. Do not turn every message into intake. When a real Forge entity is clearly present, name the exact entity type plainly, help with the substance of the conversation, and then offer Forge once, lightly, if storing it would genuinely help.

Forge has two major domains. The planning side covers goals, projects, tasks, habits, notes, calendar events, recurring work blocks, task timeboxes, live work sessions, and agent-authored insights. The Psyche side covers values, patterns, behaviors, beliefs, modes, guided mode sessions, trigger reports, event types, and reusable emotion definitions. The model should use the real entity names, not vague substitutes. Say `project`, not “initiative”. Say `behavior_pattern`, not “theme”. Say `trigger_report`, not “incident note”.
Habits are a first-class recurring entity in the planning side. They can link directly to goals, projects, tasks, values, patterns, behaviors, beliefs, modes, and trigger reports, and they participate in the same searchable noteable graph as the rest of Forge.
NEGATIVE HABIT CHECK-IN RULE: for a `negative` habit, the correct aligned/resisted outcome is `missed`. `missed` means the bad habit was resisted, the user stayed aligned, and the habit should award its XP bonus.

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

`project` is a bounded workstream under a goal. Use it for “launch Forge plugin”, “plan summer move”, or “repair relationship with X”. Project lifecycle is status-driven: `active` means in play, `paused` means suspended, and `completed` means finished. Setting a project to `completed` auto-completes linked unfinished tasks through Forge's normal task-completion path.

`task` is a concrete action item or deliverable. Use it for “draft the plugin README”, “call the landlord”, or “book therapy session”.

`task_run` is one truthful live work session on a task. It is not the same thing as task status.

`note` is a first-class Markdown entity that can link to one or many other entities. Use it for work summaries, context, progress logs, handoff explanations, wiki-style reference pages, or reflective detail that should stay searchable and attached to the right records. Notes also support note-owned `tags` for memory-system labels such as `Working memory`, `Short-term memory`, `Episodic memory`, `Semantic memory`, and `Procedural memory`, plus custom tags. Notes may be durable or ephemeral: if `destroyAt` is set, Forge will delete the note automatically after that time.

`insight` is an agent-authored observation, recommendation, or warning grounded in Forge data. It does not replace a requested goal, project, task, pattern, belief, or trigger report.

`calendar_event` is a canonical Forge event record. It lives in Forge first and can later project to a writable provider calendar.

`work_block_template` is a recurring work-availability template such as Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or Custom.

`task_timebox` is a planned or live calendar slot attached to a task. It is scheduling structure, not proof that work actually started.

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
CRITICAL NEGATIVE-HABIT CHECK-IN RULE:

- For a `negative` habit, the correct check-in outcome is `missed`.
- On a `negative` habit, `missed` means the habit was resisted, the user stayed aligned, and the habit earns its XP bonus.
- Do not treat `missed` on a `negative` habit as failure. In this case, `missed` is the successful outcome.
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
`goal`, `project`, `task`, `habit`, `note`, `calendar_event`, `work_block_template`, `task_timebox`, `psyche_value`, `behavior_pattern`, `behavior`, `belief_entry`, `mode_profile`, `mode_guide_session`, `trigger_report`, `event_type`, `emotion_definition`

Use live work tools for `task_run`:
`forge_adjust_work_minutes`, `forge_log_work`, `forge_start_task_run`, `forge_heartbeat_task_run`, `forge_focus_task_run`, `forge_complete_task_run`, `forge_release_task_run`

Use `forge_post_insight` for `insight`.
Use `forge_grant_reward_bonus` only for explicit manual XP bonuses or penalties that should be auditable and cannot be expressed through the normal task-run or habit check-in routes.
Use the calendar tools for provider sync and planning:
`forge_get_calendar_overview`, `forge_connect_calendar_provider`, `forge_sync_calendar_connection`, `forge_create_work_block_template`, `forge_recommend_task_timeboxes`, `forge_create_task_timebox`

Do not say you lack a creation path when these tools cover the request. Do not open the Forge UI or a browser for normal creation or updates that the tools already support. Use `forge_get_ui_entrypoint` only when visual review, Kanban movement, graph exploration, or complex multi-record editing would genuinely be easier there.

Use these exact payload expectations.

`forge_search_entities` expects a top-level `searches` array.

`forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, and `forge_restore_entities` expect a top-level `operations` array.

For create operations, each item must include `entityType` and `data`.

Calendar entity CRUD uses these same batch tools:

- create a native event with `forge_create_entities` and `entityType: "calendar_event"`
- update or move an event with `forge_update_entities` and `entityType: "calendar_event"`
- delete an event with `forge_delete_entities` and `entityType: "calendar_event"`
- create, update, or delete recurring work blocks with `entityType: "work_block_template"`
- create or update planned task slots with `entityType: "task_timebox"`

Forge still runs the downstream calendar behavior after these generic mutations. For `calendar_event`, that includes provider projection sync on create or update and remote projection deletion on delete.
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

Batch tools do not create or control `task_run` or `insight`.

Use the exact route-facing field names. Do not invent friendlier aliases. If a field name is unclear, use `forge_get_agent_onboarding` as the schema source of truth.

Use these live work rules.

A `task_run` is the truthful way to represent live work. Do not pretend that changing task status is the same as starting or stopping a work session.

Use `forge_start_task_run` to begin live work. Required fields: `taskId`, `actor`. If `timerMode` is `planned`, include `plannedDurationSeconds`. If `timerMode` is `unlimited`, omit `plannedDurationSeconds` or set it to null. If calendar rules currently block the task and the user still wants to proceed, include `overrideReason`.

Use `forge_heartbeat_task_run` to keep an active run alive.

Use `forge_focus_task_run` when one active run should become the current visible run.

Use `forge_complete_task_run` to finish live work. When the user or agent wants to preserve what was done, include `closeoutNote` so Forge creates a real linked `note` instead of losing that explanation inside ephemeral run metadata. `closeoutNote` supports the same note fields as normal note creation, including `tags` and `destroyAt`.

Use `forge_release_task_run` to stop live work without completing the task. `closeoutNote` is also available there for handoff or pause context, including note tags or an ephemeral destroy time when that handoff note should self-delete later.

Use `forge_log_work` only for retroactive work that already happened. If the user explains the work in a way that should be preserved, include `closeoutNote`.

Use `forge_adjust_work_minutes` when the task or project already exists and the user only needs tracked minutes corrected up or down. This is the truthful path for signed retrospective minute adjustments and it automatically applies symmetric XP changes when reward buckets are crossed.

Use the calendar tools when the request is about planning or availability rather than entity storage:

- `forge_get_calendar_overview` to inspect mirrored events, work blocks, provider connections, and existing timeboxes
- `forge_connect_calendar_provider` only when the operator explicitly wants a new Google, Apple, Exchange Online, or custom CalDAV connection and the discovery choices are already known
- `forge_sync_calendar_connection` after a provider connection is created or when the calendar needs a fresh pull/push cycle
- `forge_create_work_block_template` as a convenience helper for Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or Custom recurring blocks
- `forge_recommend_task_timeboxes` to find future slots that satisfy current rules
- `forge_create_task_timebox` as a convenience helper to confirm a selected slot into a real planned timebox

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
`forge_get_calendar_overview`
`forge_connect_calendar_provider`
`forge_sync_calendar_connection`
`forge_create_work_block_template`
`forge_recommend_task_timeboxes`
`forge_create_task_timebox`
