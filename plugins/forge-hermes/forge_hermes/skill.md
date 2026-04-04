# Forge Hermes

Use this plugin when Hermes should work directly with Forge through the curated Forge
tool surface.

## Core model

Forge has two major domains. The planning side covers goals, projects, tasks, habits,
notes, calendar events, recurring work blocks, task timeboxes, live task runs, and
agent-authored insights. The Psyche side covers values, patterns, behaviors, beliefs,
modes, guided mode sessions, trigger reports, event types, and reusable emotion
definitions.

Treat `note` as a first-class Markdown entity. Notes can link to one or many Forge
entities, carry note-owned `tags`, and optionally self-delete when `destroyAt` is set.
Use note tags both for custom labels and for memory-system labels such as `Working
memory`, `Short-term memory`, `Episodic memory`, `Semantic memory`, and `Procedural
memory`.

## Preferred workflow

1. Start with `forge_get_operator_overview`.
2. Use `forge_get_operator_context`, `forge_get_current_work`, `forge_get_psyche_overview`, or `forge_get_calendar_overview` when the request needs a more specific read model.
3. Search before creating duplicates with `forge_search_entities`.
4. Prefer the batch entity tools for normal stored-entity work:
   `forge_create_entities`, `forge_update_entities`, `forge_delete_entities`, `forge_restore_entities`.
5. Treat narrow calendar helpers as convenience helpers, not the default architecture:
   `forge_create_work_block_template` and `forge_create_task_timebox` are fine, but Hermes should still prefer the generic batch entity routes when practical.
6. Use the task-run tools for truthful live work:
   `forge_start_task_run`, `forge_heartbeat_task_run`, `forge_focus_task_run`, `forge_complete_task_run`, `forge_release_task_run`.
7. Use `forge_adjust_work_minutes` for signed minute corrections on existing tasks or projects, not to fake a live session.
8. Use `forge_post_insight` only for agent-authored interpretation or recommendation, not as a substitute for creating a real goal, project, task, note, or Psyche record.
9. Use `forge_get_ui_entrypoint` only when the Forge UI is genuinely the better surface for Kanban, review, graph exploration, or complex multi-record editing.

## Entity guidance

- `goal`, `project`, `task`, `habit`, `note`, `calendar_event`, `work_block_template`, `task_timebox`, `psyche_value`, `behavior_pattern`, `behavior`, `belief_entry`, `mode_profile`, `mode_guide_session`, `trigger_report`, `event_type`, and `emotion_definition` should normally flow through the batch entity routes.
- `task_run` is not a batch entity. Use the live task-run tools instead.
- `insight` is not a batch entity. Use `forge_post_insight`.
- For `goal`, `project`, or `task`, nested `notes` on create can include `contentMarkdown`, `author`, `tags`, `destroyAt`, and extra `links`.
- Standalone `note` creates can include `contentMarkdown`, `author`, `tags`, `destroyAt`, and `links`.
- When preserving a work summary from `forge_log_work`, `forge_complete_task_run`, or `forge_release_task_run`, prefer `closeoutNote` so the summary becomes a real linked note rather than transient run metadata.

## Behavioral rules

- Prefer overview and search before mutation unless the user is asking for one exact known write.
- Prefer the high-level batch entity routes over proliferating one-off CRUD routes.
- Delete defaults to soft delete unless hard delete is explicit.
- Project lifecycle changes are status patches on `project.status`, not separate suspend or finish routes.
- Notes are searchable and editable records, not comment strings. If the user cares about durable context, preserve it as a note.
- Ephemeral notes are appropriate for scratch memory, temporary handoffs, or “what just happened” captures that should disappear automatically later.
- Use the Forge UI handoff sparingly and intentionally.
- When Forge is local on `127.0.0.1` or `localhost`, the Hermes plugin can reuse Forge's tested local-runtime bootstrap path to start the runtime before the request.
- The Hermes install keeps its durable plugin config at `~/.hermes/forge/config.json`; the default local data root is `~/.hermes/forge`, and that file is the right place to move the data folder or pin a different local port.
