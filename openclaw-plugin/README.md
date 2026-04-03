# Forge OpenClaw Plugin

`forge-openclaw-plugin` is the publishable OpenClaw package for Forge.
When the plugin targets `localhost` or `127.0.0.1`, it auto-starts the bundled Forge runtime so the local install path stays one-step.

## Open the UI

If you want the actual Forge app, not just the plugin tools, ask your OpenClaw agent:

- `Open the Forge UI`
- `Give me the Forge UI address`
- `Take me to Forge`

For a normal local install, the Forge UI address is usually:

```text
http://127.0.0.1:4317/forge/
```

You can also ask the agent to call the UI entry tool and return the exact current address.

If you want Forge to use a specific local data folder, set `dataRoot` in the plugin config. The local runtime will then store its database under `data/forge.sqlite` inside that folder instead of using the runtime working directory.

Default data path:

- normal npm/OpenClaw install: usually `~/.openclaw/extensions/forge-openclaw-plugin/data/forge.sqlite`
- linked repo-local install: usually `<your-repo>/openclaw-plugin/data/forge.sqlite`

If you want the data to live somewhere else for persistence or backup reasons, set `dataRoot` explicitly in the plugin config and restart the gateway.

## What Forge looks like

Overview dashboard:

![Forge overview dashboard](https://raw.githubusercontent.com/albertbuchard/forge/main/openclaw-plugin/docs/assets/forge-overview-dashboard.png)

Psyche graph:

![Forge Psyche graph](https://raw.githubusercontent.com/albertbuchard/forge/main/openclaw-plugin/docs/assets/forge-psyche-graph.png)

## What this plugin is

Forge is a personal system for:

- long-term goals
- active projects
- concrete tasks
- recurring habits
- truthful live work sessions
- weekly review and XP feedback
- structured Psyche records such as values, patterns, beliefs, modes, and trigger reports

This plugin gives OpenClaw the tools it needs to work with that system. It can read current state, search records, create and update records, control live work sessions, post insights, and hand the user off to the Forge UI when the visual workflow is easier.
It can also grant an explicit audited XP bonus or penalty through the dedicated reward-bonus route when the normal automatic task or habit reward flows are not the right fit.
It can also add or remove tracked minutes on existing tasks or projects through a dedicated signed work-adjustment route without pretending that a live task run happened.
It also understands Forge `note` records, which are Markdown-based, searchable, and linkable across one or many entities.
Notes support includes:

- `note` as the durable collaboration entity
- notes surfaced directly in the Forge UI, including the global `/forge/notes` page
- nested `notes` on goal, project, and task creation
- `closeoutNote` on live-work endpoints when the summary should become a durable linked note

Examples:

- “Save this as a project in Forge.”
- “Show me my current work in Forge.”
- “Start a real work session on this task.”
- “Map this as a behavior pattern.”
- “Open the Forge UI.”

## Install

Current OpenClaw builds should use package discovery:

```bash
openclaw plugins install forge-openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
```

`openclaw plugins enable forge-openclaw-plugin` marks the plugin enabled, but it does not guarantee that `plugins.allow` was repaired. The `node -e ...` command above preserves the current allow list and appends `"forge-openclaw-plugin"` if it is missing.

For release-parity local development from this repo:

```bash
openclaw plugins install ./projects/forge/openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
```

Equivalent config:

```json5
{
  plugins: {
    allow: ["forge-openclaw-plugin"],
    entries: {
      "forge-openclaw-plugin": {
        enabled: true,
        config: {
          dataRoot: "/absolute/path/to/forge-data"
        }
      }
    }
  }
}
```

If you want to move the data folder, edit the same config entry and set:

```json5
{
  plugins: {
    entries: {
      "forge-openclaw-plugin": {
        config: {
          dataRoot: "/absolute/path/to/forge-data"
        }
      }
    }
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

Older OpenClaw builds can keep using the repo-root fallback entry during the transition:

```bash
openclaw plugins install ./projects/forge
openclaw gateway restart
```

That repo-local path is the fallback only. The published package stays on the SDK `definePluginEntry` entrypoint. The OpenClaw plugin id is `forge-openclaw-plugin`, while the product name stays `Forge` and the CLI namespace stays `forge`.

## Recommended usage

The main mental model is intentionally small:

1. `forge_get_operator_overview`
2. `forge_get_operator_context` or `forge_get_current_work` for live work and board state
3. `forge_get_psyche_overview`, `forge_get_xp_metrics`, and `forge_get_weekly_review` for read-heavy guidance
4. `forge_get_ui_entrypoint` when the user should continue in the visual Forge UI
5. `forge_search_entities`
6. `forge_create_entities` or `forge_update_entities`
7. `forge_delete_entities` or `forge_restore_entities` when needed
8. `forge_grant_reward_bonus` for explicit audited manual XP changes
9. `forge_adjust_work_minutes` for signed minute corrections on existing tasks or projects
10. `forge_log_work` for completion-style retroactive work
11. `forge_start_task_run`, `forge_heartbeat_task_run`, `forge_focus_task_run`, `forge_complete_task_run`, and `forge_release_task_run` for real live work
12. `forge_get_calendar_overview`, `forge_connect_calendar_provider`, `forge_sync_calendar_connection`, `forge_create_work_block_template`, `forge_recommend_task_timeboxes`, and `forge_create_task_timebox` for calendar-aware execution
13. `forge_post_insight` for recommendations

Use the UI entrypoint sparingly.
Do not open the Forge UI or a browser just to create or update normal records that the tools already cover.
If an entity is only implied in the discussion, help first and offer Forge lightly near the end; only write after explicit save intent.

The batch tools are array-first:

- `forge_search_entities` takes `searches: []`
- `forge_create_entities` takes `operations: []`, and each create operation must include `entityType` and full `data`
- goal, project, and task creates can include nested `notes`, which Forge turns into linked note entities automatically
- `forge_update_entities` takes `operations: []`, and each update operation must include `entityType`, `id`, and `patch`
- `forge_delete_entities` and `forge_restore_entities` also take `operations: []`

Project lifecycle uses those same generic tools:

- suspend a project by patching `status: "paused"` with `forge_update_entities`
- finish a project by patching `status: "completed"` with `forge_update_entities`
- restart a project by patching `status: "active"` with `forge_update_entities`
- finishing a project auto-completes linked unfinished tasks
- delete stays soft by default unless `mode: "hard"` is explicit on `forge_delete_entities`

Scheduling rules use those same generic updates:

- patch `project.schedulingRules` through `forge_update_entities` to define project-wide calendar defaults
- patch `task.schedulingRules` and `task.plannedDurationSeconds` through `forge_update_entities` for task-specific overrides
- use the calendar-specific tools only for provider connections, work blocks, overview reads, slot recommendations, and explicit timeboxes

Batch several related creates together in one request when the user is asking for multiple goals, projects, or tasks at once.

The live onboarding payload is the deep contract for agents. It now includes:

- `conceptModel`: what the main Forge concepts mean
- `psycheSubmoduleModel`: what the Psyche records and reference taxonomies are for
- `psycheCoachingPlaybooks`: how to guide users through pattern, belief/schema, mode, and trigger-report intake
- `relationshipModel`: how goals, projects, tasks, task runs, Psyche entities, and insights connect
- `entityCatalog`: exact field-level definitions for real Forge entity payloads
- `toolInputCatalog`: exact mutation and live-work input shapes with examples

That means the agent should use the real route-facing fields, for example:

- `belief_entry` uses `statement` and `beliefType`
- `behavior_pattern` uses `cueContexts`, `shortTermPayoff`, `longTermCost`, and `preferredResponse`
- `mode_guide_session` uses `summary`, `answers`, and `results`
- `event_type` and `emotion_definition` are reusable report vocabularies
- `trigger_report` uses nested `emotions`, `thoughts`, `behaviors`, and `consequences`

Live work is not just task status:

- use `forge_start_task_run` to begin actual work
- use `forge_release_task_run` to stop without completing
- use `forge_complete_task_run` to finish and collect the real work reward path
- if Forge reports a calendar block and the user still wants to start, retry `forge_start_task_run` with an explicit `overrideReason`
- include `closeoutNote` on `forge_complete_task_run`, `forge_release_task_run`, or `forge_log_work` when the summary should become a durable linked note
- use `forge_log_work` only for completion-style retroactive work that already happened
- use `forge_adjust_work_minutes` when the task or project already exists and only tracked minutes need to move up or down
- do not use `forge_adjust_work_minutes` to fake a live session; it is for truthful retrospective minute corrections only

Calendar-aware execution tools:

- `forge_get_calendar_overview` reads provider state, mirrored events, work blocks, and timeboxes together
- `forge_create_entities`, `forge_update_entities`, and `forge_delete_entities` are the normal path for `calendar_event`, `work_block_template`, and `task_timebox`
- `forge_connect_calendar_provider` creates a Google, Apple, Exchange Online, or custom CalDAV connection once the mirrored calendars are chosen. Exchange Online normally relies on the interactive Settings sign-in flow first.
- `forge_sync_calendar_connection` runs provider pull/push sync for one connection
- `forge_create_work_block_template` creates recurring half-day, holiday, or custom work blocks
- work-block templates accept optional `startsOn` / `endsOn` date bounds and stay compact in Forge instead of expanding into one stored event per day
- omit `endsOn` to keep a block repeating indefinitely; use `kind: "holiday"` with all weekdays plus `0-1440` minutes for vacations or full-day leave
- `forge_recommend_task_timeboxes` suggests future slots that fit current rules
- `forge_create_task_timebox` confirms a selected slot into a real Forge timebox

The skill is entity-format-driven. It teaches the agent how to:

- keep the conversation natural
- make only gentle end-of-message save suggestions
- lightly suggest the Forge UI when visual review or editing would be easier
- ask only for missing fields
- capture goals, projects, tasks, values, patterns, behaviors, beliefs, and trigger reports

For local use, set the plugin origin to `http://127.0.0.1` or `http://localhost` and the plugin will bring Forge up automatically. If you leave the default localhost setup alone and `4317` is already taken, Forge now moves to the next free local port and remembers that choice for future runs.

If you want to manage that plugin-managed local runtime cleanly, use:

```bash
openclaw forge start
openclaw forge stop
openclaw forge restart
openclaw forge status
```

These commands only manage the runtime when it was auto-started by the OpenClaw plugin. If Forge was started manually some other way, they tell you that instead of killing unrelated processes.

If the local runtime fails to come up, check the plugin-managed runtime log at:

```bash
~/.openclaw/logs/forge-openclaw-plugin/<host>-<port>.log
```

On clean installs, the plugin now also repairs missing bundled runtime dependencies on first local start before it launches Forge.

The startup error now points at that log file when the child process exits before Forge becomes healthy.

## Publishing and listing

The reliable publication path for the Forge plugin is:

1. publish `forge-openclaw-plugin` to npm
2. verify `openclaw plugins install forge-openclaw-plugin`
3. add Forge to the OpenClaw community plugin listing with the npm package and GitHub repo

ClawHub note:

- OpenClaw's public docs clearly position ClawHub as the skills registry.
- The community plugin listing requirements still ask for npm publication and a public GitHub repository.
- So the safe publish path for the Forge plugin itself is npm + GitHub + community listing.
- If you want Forge discoverability inside ClawHub as well, publish a companion Forge skill there separately. That is additive. It does not replace the npm plugin package.
