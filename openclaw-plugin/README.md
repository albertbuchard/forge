# Forge OpenClaw Plugin

`forge-openclaw-plugin` is the publishable OpenClaw package for Forge.
When the plugin targets `localhost` or `127.0.0.1`, it auto-starts the bundled Forge runtime so the local install path stays one-step.

OpenClaw install note:

- `openclaw plugins enable forge-openclaw-plugin` is not always enough by itself.
- If `forge-openclaw-plugin` is missing from `plugins.allow`, OpenClaw can still refuse to load it.
- The install section below includes the `node -e ...` step that repairs `plugins.allow` safely.
- I re-verified on April 21, 2026 that OpenClaw `2026.4.15` still blocks both the published package install and the repo-local install because Forge launches a local runtime and gets flagged by the installer scanner. The bypass sections below are still current.

## Open the UI

If you want the actual Forge app, not just the plugin tools, ask your OpenClaw agent:

- `Open the Forge UI`
- `Give me the Forge UI address`
- `Take me to Forge`

For a normal local install, the Forge UI address is usually:

```text
http://127.0.0.1:4317/forge/
```

That `4317` backend URL is the stable entrypoint. If Forge is running in a local
development checkout, the backend can proxy and supervise the hot-reloading Vite
frontend behind that same `/forge/` URL. Shared routes such as Tailscale should
still target `http://127.0.0.1:4317/forge/`, not `3027` directly.

You can also ask the agent to call the UI entry tool and return the exact current address.

If you want Forge to use a specific local data folder, set `dataRoot` in the plugin config. The local runtime will then store its database as `forge.sqlite` directly inside that folder instead of using the runtime working directory.

Default data path:

- local installs now default to the shared Forge home at `~/.forge/forge.sqlite`
- set `dataRoot` only when you intentionally want a different shared database

If you want the data to live somewhere else for persistence or backup reasons, set `dataRoot` explicitly in the plugin config and restart the gateway.

## What Forge looks like

Overview dashboard:

![Forge overview dashboard](https://raw.githubusercontent.com/albertbuchard/forge/main/openclaw-plugin/docs/assets/forge-overview-dashboard.png)

Psyche graph:

![Forge Psyche graph](https://raw.githubusercontent.com/albertbuchard/forge/main/openclaw-plugin/docs/assets/forge-psyche-graph.png)

## What this plugin is

Forge is a personal system for:

- human and bot users with explicit ownership
- long-term goals
- active projects
- directed strategies across projects and tasks
- first-class preferences with a comparison game and editable concept libraries
- concrete tasks
- recurring habits
- truthful live work sessions
- weekly review and XP feedback
- file-first wiki memory with spaces, backlinks, ingest, and explicit Forge links
- first-class sleep and sports records imported from the iPhone companion or generated from habits
- structured Psyche records such as values, patterns, beliefs, modes, and trigger reports

Forge project management is explicit and repeated:

- `Goal -> Strategy -> Project -> Strategy -> Issue -> Task -> Subtask`
- one mixed board for `project | issue | task | subtask`
- one compact hierarchy view with shared search and filters
- hierarchy-aware linking flows that can select or create goals, projects, issues, and parent work items
- shared `executionMode` + `acceptanceCriteria` support on issues and tasks
- direct commits to `main` by default

This plugin gives OpenClaw the tools it needs to work with that system. It can read current state, search records, create and update records, control live work sessions, post insights, and hand the user off to the Forge UI when the visual workflow is easier.
It can also grant an explicit audited XP bonus or penalty through the dedicated reward-bonus route when the normal automatic task or habit reward flows are not the right fit.
It can also add or remove tracked minutes on existing tasks or projects through a dedicated signed work-adjustment route without pretending that a live task run happened.
It also understands Forge `note` records, which are Markdown-based, searchable, and linkable across one or many entities.
It also exposes Forge's file-first wiki memory surface plus the first-class sleep and sports read models, so an agent can review recent nights, inspect workout context, update reflective metadata on health sessions, and work with wiki pages without dropping to raw files.
The curated plugin route surface now includes the dedicated wiki and health APIs directly, including wiki settings, page reads and writes, search, health, sync, reindex, background ingest, sleep review, sports review, and reflective updates on individual sleep or workout sessions.
Notes support includes:

- `note` as the durable collaboration entity
- notes surfaced directly in the Forge UI, including the global `/forge/notes` page
- nested `notes` on goal, project, and task creation
- `closeoutNote` on live-work endpoints when the summary should become a durable linked note

Examples:

- “Save this as a project in Forge.”
- “Show me the bot-owned strategies.”
- “Open Preferences and let me start the game.”
- “What does Forge already know about my food preferences?”
- “Show me my current work in Forge.”
- “Start a real work session on this task.”
- “Map this as a behavior pattern.”
- “Open the Forge UI.”

## Multi-user And Multi-agent Setup

Forge is built to support several humans and bots in one shared planning
system. The key distinction is:

- ownership answers "whose record is this"
- linking answers "what does this record connect to"

That means this plugin should not flatten all work into the default operator.
When a task belongs to a bot, the write should set that bot `userId`. When a
read should compare several owners, it should pass repeated `userIds`.

Recommended shared setup:

1. Run one shared Forge runtime.
2. Point OpenClaw, Hermes, and the browser UI at that same runtime.
3. Let the default shared Forge home `~/.forge` stand unless you intentionally
   want a different shared database.
4. Create the human and bot users in `Settings -> Users`.
5. Use `userId` on writes and `userIds` on reads.

Current sharing behavior is intentionally clear:

- users are typed as `human` or `bot`
- the runtime can list users directly
- reads are permissive when a route explicitly scopes to another user
- cross-user links are valid, so a human-owned project can reference bot-owned
  tasks, notes, or strategy nodes

If OpenClaw and Hermes are supposed to collaborate inside one Forge system, the
important thing is not only matching `origin` and `port`. Local installs now
converge on the same `~/.forge` data root automatically. Only override
`dataRoot` when you deliberately want a different shared database.

## Strategies And Alignment Metrics

Forge strategies are first-class planning records for work that unfolds through
an ordered graph instead of a flat checklist.

A strategy includes:

- target goals and projects
- free-text overview and end-state description
- optional linked entities
- a directed acyclic graph of task and project nodes

The graph can branch, but it should not loop.

Current metrics are explicit:

- project nodes use project progress directly
- task nodes map status to progress:
  `done`/`completed`/`reviewed`/`integrated` = `100%`
  `in_progress`/`active` = `66%`
  `focus` = `50%`
  `blocked`/`paused` = `25%`
  everything else = `0%`
- active or next nodes are the incomplete nodes whose dependencies are already
  complete
- target progress comes from the linked goals or projects
- `alignmentScore` is
  `round((average node progress * 0.7 + average target progress * 0.3) * 100)`

This lets the user and the agent answer two concrete questions:

- What work is truly next in the plan?
- How aligned is current execution with the intended end state?

## Preferences And Concept Libraries

Forge now has a dedicated Preferences workspace at `/forge/preferences`.

The main UX is intentionally simple:

- the landing view starts with what Forge already knows
- if the model is thin, the UI says that plainly and offers one visible `Start the game` action
- comparison happens in a modal with two simple cards instead of a crowded page
- Forge-native domains can pull from real Forge entities automatically
- broader taste domains can start from seeded concept libraries that the user can edit

The current seeded concept-library domains include:

- `food`
- `activities`
- `places`
- `countries`
- `fashion`
- `people`
- `media`
- `tools`

The runtime API for this surface lives under `/api/v1/preferences/*`.
OpenClaw should still use `forge_get_agent_onboarding` as the live contract
source when route-facing field names are uncertain, and it should prefer the UI
handoff when the user wants to play the comparison game visually.

## Wiki, Sleep, And Sports

Forge now exposes three more agent-relevant surfaces directly:

- the Wiki: file-first markdown memory with explicit spaces, backlinks, search, ingest, and maintenance health checks
- Sleep: recent nights, sleep score and regularity metrics, stage averages, and linked reflective context
- Sports: workout volume, effort, types, habit-generated sessions, and linked Forge context

OpenClaw tool coverage for those areas is explicit:

- wiki reads and writes use the `forge_get_wiki_*`, `forge_search_wiki`, `forge_upsert_wiki_page`, `forge_sync_wiki_vault`, `forge_reindex_wiki_embeddings`, and `forge_ingest_wiki_source` tools
- sleep review uses `forge_get_sleep_overview` and record enrichment uses `forge_update_sleep_session`
- sports review uses `forge_get_sports_overview` and record enrichment uses `forge_update_workout_session`

The sports UI route is `/forge/sports`, while the backend overview route remains
`/api/v1/health/fitness`. Sleep lives at `/forge/sleep` and `/api/v1/health/sleep`.

## Install

Current OpenClaw builds should use package discovery:

```bash
openclaw plugins install forge-openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
```

If the install path is blocked on your OpenClaw build, use this temporary npm bypass instead. This is still required on OpenClaw `2026.4.15` as of April 21, 2026:

```bash
npm install -g forge-openclaw-plugin
node -e 'const cp=require("child_process"); const fs=require("fs"); const path=require("path"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); const pluginPath=path.join(cp.execSync("npm root -g",{encoding:"utf8"}).trim(),"forge-openclaw-plugin"); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); j.plugins.load ??= {}; j.plugins.load.paths = Array.from(new Set([...(j.plugins.load.paths || []), pluginPath])); j.plugins.entries ??= {}; j.plugins.entries["forge-openclaw-plugin"] = { enabled: true, config: { origin: "http://127.0.0.1", port: 4317, actorLabel: "", timeoutMs: 15000 } }; fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n"); console.log("Configured", pluginPath);'
openclaw gateway restart
openclaw plugins info forge-openclaw-plugin
openclaw forge health
```

That bypass still uses the published npm package. It just tells OpenClaw to load the npm-installed folder directly from `plugins.load.paths`, which avoids the installer block that still happens on OpenClaw `2026.4.15`.

`openclaw plugins enable forge-openclaw-plugin` marks the plugin enabled, but it does not guarantee that `plugins.allow` was repaired. The `node -e ...` command above preserves the current allow list and appends `"forge-openclaw-plugin"` if it is missing.

For release-parity local development from this repo:

```bash
openclaw plugins install ./projects/forge/openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
```

OpenClaw `2026.4.15` still blocks that repo-local install on this machine, so keep
the repo folder on `plugins.load.paths`, make sure
`openclaw plugins info forge-openclaw-plugin` still points at the local Forge source
path, then restart the gateway and verify health. That fallback still keeps OpenClaw
on the local code folder instead of switching to the published package.

Equivalent config:

```json5
{
  plugins: {
    allow: ["forge-openclaw-plugin"],
    entries: {
      "forge-openclaw-plugin": {
        enabled: true,
        config: {
          dataRoot: "~/.forge",
          actorLabel: "",
          apiToken: ""
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

Recommended local behavior:

- leave `actorLabel` blank so Forge can inherit the trusted local operator label automatically
- leave `apiToken` blank for localhost and trusted Tailscale setups
- leave `dataRoot` alone unless you intentionally want a different shared local Forge home

## Doctor And Runtime Config

Forge now maintains a runtime settings mirror at `<dataRoot>/forge.json`.
This is separate from the OpenClaw plugin config in `~/.openclaw/openclaw.json`.

The distinction is:

- OpenClaw plugin config decides how OpenClaw reaches Forge
- `forge.json` inside the Forge data root decides what Forge's effective settings are

Operational behavior:

- if `forge.json` does not exist, Forge exports it on startup
- UI and API settings changes update both the SQLite store and `forge.json`
- valid values in `forge.json` take precedence over persisted DB values
- the file is then rewritten as a full mirrored snapshot so the runtime converges again

Diagnostic entrypoints:

```bash
openclaw forge doctor
npm run doctor --prefix ./projects/forge
```

The doctor output now includes `settingsFile` details such as the resolved path, validity, sync state, parse errors, and which override keys were applied from `forge.json`.

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
- goal, project, task, strategy, habit, tag, and note writes can include `userId` to assign ownership to a human or bot user
- scoped reads can use `userId` or repeated `userIds` query parameters when the agent needs to focus on specific humans or bots
- `forge_update_entities` takes `operations: []`, and each update operation must include `entityType`, `id`, and `patch`
- official habit outcomes can stay on that same shared path: patch `entityType: "habit"` with `checkIn: { status, dateKey?, note?, description? }` to record the real habit outcome without leaving batch CRUD
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
- `psycheCoachingPlaybooks`: how to guide users through values work, functional analysis, behavior mapping, belief/schema intake, mode work, mode-guide sessions, and trigger reports with active listening instead of raw form prompts
- `relationshipModel`: how goals, projects, tasks, task runs, Psyche entities, and insights connect
- `entityCatalog`: exact field-level definitions for real Forge entity payloads
- `entityRouteModel.specializedDomainSurfaces`: the dedicated route families for Movement, Life Force, and Workbench, including when not to use generic batch CRUD
- `toolInputCatalog`: exact mutation and live-work input shapes with examples

That means the agent should use the real route-facing fields, for example:

- `strategy` uses `targetGoalIds`, `targetProjectIds`, `linkedEntities`, and a directed acyclic `graph`
- `belief_entry` uses `statement` and `beliefType`
- `behavior_pattern` uses `cueContexts`, `shortTermPayoff`, `longTermCost`, and `preferredResponse`
- `mode_guide_session` creates require `summary` and `answers`; `results` is optional candidate interpretation output
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
- `forge_connect_calendar_provider` creates a Google, Apple, Exchange Online, Calendars On This Mac, or custom CalDAV connection once the mirrored calendars are chosen. Exchange Online normally relies on the interactive Settings sign-in flow first, after the local Microsoft client ID, tenant, and redirect URI are configured in Forge. The macOS-local path relies on EventKit and replaces overlapping remote account connections instead of keeping duplicate copies.
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

The repo now supports a tag-driven GitHub Actions release path for step 1. The normal
prep flow from a clean checkout on `main` is:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release-forge-openclaw-plugin.sh patch
```

That command bumps the aligned plugin versions, runs the verification suite, commits
the release, and pushes `main` plus a matching tag like `v0.2.27`. The
`.github/workflows/release-openclaw-plugin.yml` workflow then publishes the package
from that tag.

One-time npm setup for CI:

- configure npm Trusted Publishing for this GitHub repository and the
  `release-openclaw-plugin.yml` workflow
- keep using GitHub-hosted runners for the publish job, because npm Trusted Publishing
  does not support self-hosted runners yet

If you explicitly want the old laptop-driven publish path, run the same script without
`FORGE_RELEASE_MODE=prepare` and it will still publish directly after pushing.

For the exact prerequisites, tags, and GitHub secret names, use
`docs/release-cheat-sheet.md`.

ClawHub note:

- OpenClaw's public docs clearly position ClawHub as the skills registry.
- The community plugin listing requirements still ask for npm publication and a public GitHub repository.
- So the safe publish path for the Forge plugin itself is npm + GitHub + community listing.
- If you want Forge discoverability inside ClawHub as well, publish a companion Forge skill there separately. That is additive. It does not replace the npm plugin package.
