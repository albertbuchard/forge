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
- truthful live work sessions
- weekly review and XP feedback
- structured Psyche records such as values, patterns, beliefs, modes, and trigger reports

This plugin gives OpenClaw the tools it needs to work with that system. It can read current state, search records, create and update records, control live work sessions, post insights, and hand the user off to the Forge UI when the visual workflow is easier.

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
openclaw gateway restart
```

If your OpenClaw install does not enable it automatically, run:

```bash
openclaw plugins enable forge-openclaw-plugin
openclaw gateway restart
```

Equivalent config:

```json5
{
  plugins: {
    allow: ["forge-openclaw-plugin"],
    entries: {
      "forge-openclaw-plugin": {
        enabled: true
      }
    }
  }
}
```

Older OpenClaw builds can keep using the repo/manual install path during the transition:

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
8. `forge_log_work` for retroactive work
9. `forge_start_task_run`, `forge_heartbeat_task_run`, `forge_focus_task_run`, `forge_complete_task_run`, and `forge_release_task_run` for real live work
10. `forge_post_insight` for recommendations

Use the UI entrypoint sparingly.
Do not open the Forge UI or a browser just to create or update normal records that the tools already cover.
If an entity is only implied in the discussion, help first and offer Forge lightly near the end; only write after explicit save intent.

The batch tools are array-first:

- `forge_search_entities` takes `searches: []`
- `forge_create_entities` takes `operations: []`, and each create operation must include `entityType` and full `data`
- `forge_update_entities` takes `operations: []`, and each update operation must include `entityType`, `id`, and `patch`
- `forge_delete_entities` and `forge_restore_entities` also take `operations: []`

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
- use `forge_log_work` only for retroactive work that already happened

The skill is entity-format-driven. It teaches the agent how to:

- keep the conversation natural
- make only gentle end-of-message save suggestions
- lightly suggest the Forge UI when visual review or editing would be easier
- ask only for missing fields
- capture goals, projects, tasks, values, patterns, behaviors, beliefs, and trigger reports

For local use, set the plugin origin to `http://127.0.0.1` or `http://localhost` and the plugin will bring Forge up on the configured port automatically.

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
