# Forge Codex

Use this plugin when you want Codex to work directly with Forge through the curated MCP tool surface.

## Preferred workflow

1. Start with `forge_get_operator_overview`.
2. Search before creating duplicates with `forge_search_entities`.
3. Use batch tools for normal work:
   - `forge_create_entities`
   - `forge_update_entities`
   - `forge_delete_entities`
   - `forge_restore_entities`
   - this includes `note` as a first-class entity, and goal/project/task creates can include nested `notes`
4. Use the task-run tools for truthful live work:
   - `forge_start_task_run`
   - `forge_heartbeat_task_run`
   - `forge_focus_task_run`
   - `forge_complete_task_run`
   - `forge_release_task_run`
   - include `closeoutNote` when the work summary should become a durable linked note
5. Store structured recommendations with `forge_post_insight`.
6. Use `forge_get_ui_entrypoint` when the Forge UI is the better surface for Kanban, detailed review, or Psyche exploration.

## Behavioral rules

- Prefer the operator overview before mutating Forge.
- Prefer batch entity tools for multi-entity work.
- Search before create.
- Use `note` as the only collaboration record terminology. Notes are the durable Markdown entity for progress evidence, handoff context, and multi-entity linkage.
- Delete defaults to soft-delete unless hard delete is explicit.
- Use the UI handoff when the user should inspect or edit visually.
- When Forge is local on `127.0.0.1` or `localhost`, the plugin can auto-start the Forge runtime.
