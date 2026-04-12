# Forge OpenClaw Plugin

Forge ships a native OpenClaw plugin add-on with a deliberately small public surface.

## Session Bootstrap

Forge now injects a live session-start bootstrap block into each newly created
OpenClaw agent session through the plugin's `agent:bootstrap` hook. This is a
session bootstrap, not a per-reply prompt mutation.

The injected block includes:

- the current Forge operator snapshot
- current goals, projects, strategies, tasks, and habits
- all wiki pages under the `People` branch, with each page title plus the first
  100 characters of its page text
- a short instruction telling the agent to use the Forge skill/tools when it
  needs more detail about any listed Forge entity or person page

Implementation note:

- Forge uses the internal hook route `registerHook("agent:bootstrap", ...)`
  because that event can append a synthetic bootstrap file before the first
  model turn of a new session
- this is more precise for session-start context than relying on legacy
  `before_agent_start`, which OpenClaw still supports but documents as legacy

## Open the UI

If the user wants the actual Forge app, tell them they can either:

- ask the agent to open the Forge UI
- ask the agent to give them the Forge UI address

Useful example replies:

- “I can open the Forge UI for you.”
- “The local Forge UI address is usually `http://127.0.0.1:4317/forge/`, but localhost installs can move to the next free port if `4317` is already taken.”

Use the UI route or tool when the user wants visual review, Kanban movement, graph exploration, or broader editing in the Forge app itself.

## Data folder

By default, Forge stores its SQLite data under the active runtime root:

- normal npm/OpenClaw install: usually `~/.openclaw/extensions/forge-openclaw-plugin/forge.sqlite`
- linked repo-local plugin install: usually `<repo>/openclaw-plugin/forge.sqlite`

If the user wants the data somewhere else for persistence, backup, or manual control, set `dataRoot` in the Forge plugin config and restart the gateway.

## Screenshots

Overview dashboard:

![Forge overview dashboard](../openclaw-plugin/docs/assets/forge-overview-dashboard.png)

Psyche graph:

![Forge Psyche graph](../openclaw-plugin/docs/assets/forge-psyche-graph.png)

The intended workflow is:

- start with `forge_get_operator_overview`, `forge_get_operator_context`, or `forge_get_current_work`
- use `forge_get_psyche_overview`, `forge_get_xp_metrics`, and `forge_get_weekly_review` for read-heavy guidance
- use `forge_search_entities` before mutating when duplicates are possible
- create, update, delete, and restore through the batch entity tools
- use `forge_adjust_work_minutes` for signed minute corrections on existing tasks or projects
- use `forge_log_work` for completion-style retroactive work
- use the task-run tools for real live work: `forge_start_task_run`, `forge_heartbeat_task_run`, `forge_focus_task_run`, `forge_complete_task_run`, `forge_release_task_run`
- use `forge_grant_reward_bonus` only when a manual XP bonus or penalty should be explicit and auditable
- use first-class `note` entities for Markdown progress evidence, handoff context, and multi-entity work summaries
- use the dedicated wiki tools for file-first knowledge work, not the batch entity routes
- use `forge_get_sleep_overview`, `forge_get_sports_overview`, `forge_update_sleep_session`, and `forge_update_workout_session` for the first-class sleep and sports surfaces
- store agent-authored recommendations with `forge_post_insight`
- use `forge_get_ui_entrypoint` when the user should continue in the visual Forge UI

## Preferences Workspace

Forge now treats Preferences as a first-class product area.

The UI behavior is:

- arrive on what Forge already knows about the selected user's preferences
- if the model is weak, say that clearly and show one prominent `Start the game` action
- run the comparison flow inside a modal with two simple cards instead of an inline form
- seed Forge-native domains from real Forge entities automatically
- seed broader taste domains from editable concept libraries

The current concept-library domains are:

- `food`
- `activities`
- `places`
- `countries`
- `fashion`
- `people`
- `media`
- `tools`

The runtime surface lives under `/api/v1/preferences/*`.
Hermes exposes dedicated Preferences tools directly, while OpenClaw should use
the live onboarding contract for exact route-facing fields and prefer a UI
handoff when the user wants to play the comparison game visually.

## Wiki, Sleep, And Sports

Forge now exposes three newer agent-facing surfaces that matter for OpenClaw:

- Wiki is the file-first memory layer. Use the dedicated wiki tools so page files, backlinks, search, and ingest metadata stay aligned.
- Sleep is a first-class reflective surface. Use `forge_get_sleep_overview` for review and `forge_update_sleep_session` to attach tags, notes, or Forge links to one night.
- Sports is the workout review surface. Use `forge_get_sports_overview` for read access and `forge_update_workout_session` to add subjective effort, narrative meaning, tags, or links to one workout.

The curated plugin route surface now mirrors those capabilities directly:

- Wiki: `/api/v1/wiki/settings`, `/api/v1/wiki/pages`, `/api/v1/wiki/pages/:id`, `/api/v1/wiki/search`, `/api/v1/wiki/health`, `/api/v1/wiki/sync`, `/api/v1/wiki/reindex`, `/api/v1/wiki/ingest-jobs`
- Health: `/api/v1/health/sleep`, `/api/v1/health/sleep/:id`, `/api/v1/health/fitness`, `/api/v1/health/workouts/:id`

The Forge UI routes are `/forge/wiki`, `/forge/sleep`, and `/forge/sports`.
The backend overview routes are `/api/v1/health/sleep` and
`/api/v1/health/fitness` for sleep and sports respectively.

## Notes contract

Forge notes are the durable collaboration record across the app, API, and plugin surface.

- use `note` as the only collaboration entity name
- use `/api/v1/notes` and the batch entity routes, not legacy comment routes
- notes can link to one or many goals, projects, tasks, and Psyche records
- goal, project, and task creation can include nested `notes`
- task completion, task release, and retroactive work logging can include `closeoutNote`
- the main detail views and the global `/forge/notes` page now surface these records directly in the UI

Some notes can also be pinned to a sub-part of an entity with an anchor key. The main user-facing case today is stage-specific trigger report notes such as Spark, Story, State, Lens, and Pivot.

The execution rule is:

- do not open the Forge UI or a browser just to create or update normal records that the batch entity tools already cover
- only use the UI entrypoint when visual review, multi-record editing, Kanban movement, or Psyche exploration is genuinely the better workflow
- if an entity is only implied in the discussion, do not write immediately; help first, then offer Forge lightly near the end, and only write after explicit save intent

## Multi-user And Multi-agent Setup

Forge now assumes that one runtime can serve several humans and bots.

The important model is:

- `userId` controls ownership
- `userId` or repeated `userIds` control read scope
- cross-user links are valid and expected

Recommended setup when OpenClaw and another adapter such as Hermes are meant to
share one Forge system:

1. choose one shared Forge runtime
2. choose one explicit `dataRoot`
3. point every adapter at that same `origin`, `port`, and storage root
4. create the human and bot users in Forge itself
5. write with explicit `userId`
6. read with `userIds` when comparing owners

Current access posture is intentionally permissive while the policy layer stays
modular:

- users can be listed directly
- explicit scoped reads can include another user
- ownership still stays visible in cards, detail views, searches, and strategy
  graphs

This is what lets a human-owned project point at bot-owned tasks or a bot-owned
strategy point at human-owned goals without losing clarity.

## Strategies And Metrics

Strategies are the planning surface for work that has sequence and branching.

A strategy contains:

- `targetGoalIds`
- `targetProjectIds`
- `linkedEntities`
- `graph`
- `overview`
- `endStateDescription`

The graph is a directed acyclic graph of `project` and `task` nodes. That means
it can branch, but it cannot loop back on itself.

Current strategy metrics are deliberately concrete:

- project nodes use project progress percentage
- task nodes map status to progress:
  `done`/`completed`/`reviewed`/`integrated` = `1.0`
  `in_progress`/`active` = `0.66`
  `focus` = `0.5`
  `blocked`/`paused` = `0.25`
  anything else = `0`
- completed nodes are nodes at `1.0`
- active and next nodes are incomplete nodes whose dependencies are already
  complete
- target progress comes from linked goals and projects
- `planCoverageScore` measures how much of the graph and end targets are
  genuinely moving or complete
- `sequencingScore` penalizes out-of-order execution
- `scopeDisciplineScore` penalizes off-plan work happening inside the strategy
  scope
- `qualityScore` reflects blocked nodes and weak end-target completion
- `alignmentScore` is the weighted blend of those four scores

That is enough for a user or agent to inspect the current plan honestly instead
of treating strategy as only a narrative note.

Forge also now exposes per-user XP summaries through the user directory so
humans and bot agents can each accumulate their own visible reward trail while
still collaborating inside one shared runtime.

The plugin no longer mirrors every Forge route. Forge itself still has the full `/api/v1` surface for the web app and internal runtime.
Instead, the plugin exposes the parts the agent actually needs: overview, current context, Psyche and XP reads, batch entity mutations, signed minute corrections, completion-style retroactive work logging, real task-run control, insight posting, and UI entry.
When the configured origin is `localhost` or `127.0.0.1`, the plugin auto-starts the bundled Forge runtime. Default localhost installs prefer `4317`, but if that port is already occupied the plugin now moves to the next free local port and remembers it for future runs unless the user explicitly pinned a different port.

## Agent understanding contract

The agent should not have to guess Forge shapes.

The live onboarding route now returns:

- `conceptModel`: what goals, projects, tasks, task runs, insights, and Psyche records actually mean
- habits are part of that concept model and are first-class in batch entity workflows, note links, search, and delete/restore
- `psycheSubmoduleModel`: what values, patterns, behaviors, beliefs, schema catalog entries, modes, mode guides, event types, emotion definitions, and trigger reports are for
- `psycheCoachingPlaybooks`: how the agent should guide values work, functional analysis, behavior mapping, belief/schema intake, mode work, mode-guide sessions, and trigger reports with active listening instead of raw form prompts
- `relationshipModel`: how those records relate to each other
- `entityCatalog`: exact per-entity field guides with real route-facing field names, required fields, enums, defaults, and relationship rules
- `toolInputCatalog`: exact input contracts and examples for the mutation and live-work tools

The intended usage is:

1. call `forge_get_agent_onboarding` when tool semantics are uncertain
2. use the exact field names from onboarding
3. do not invent friendlier aliases that the API does not accept

Important examples:

- `belief_entry` uses `statement` and `beliefType`, not ad-hoc fields like `title` or `belief`
- `behavior_pattern` uses `cueContexts`, `shortTermPayoff`, `longTermCost`, and `preferredResponse`
- `mode_guide_session` creates require `summary` and `answers`; `results` stays optional candidate interpretation output rather than a free-form note
- `event_type` and `emotion_definition` are reusable Psyche taxonomies that support reports
- `trigger_report` uses nested arrays for `emotions`, `thoughts`, and `behaviors`, plus a structured `consequences` object
- live work is handled through task runs, not just task status
- minute corrections on existing tasks or projects go through `/api/v1/work-adjustments`, not `/api/v1/operator/log-work`
- bundled OpenClaw skill docs now include a dedicated Psyche interview playbook so the agent can explore values, patterns, beliefs, behaviors, modes, and reports naturally before saving them

## Which manifest does what

There are three files involved on purpose:

- [`openclaw.plugin.json`](../openclaw.plugin.json): source-of-truth plugin manifest in the main Forge repo
- [`openclaw-plugin/openclaw.plugin.json`](../openclaw-plugin/openclaw.plugin.json): packaged copy that ships in the npm artifact
- [`openclaw-plugin/package.json`](../openclaw-plugin/package.json): npm package metadata and `openclaw.extensions` entry wiring

## Install

Current OpenClaw builds should use package discovery:

```bash
openclaw plugins install forge-openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
```

For release-parity local development:

```bash
openclaw plugins install ./projects/forge/openclaw-plugin
openclaw plugins enable forge-openclaw-plugin
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n");'
openclaw gateway restart
openclaw forge health
```

Temporary bypass for some OpenClaw `2026.4.x` builds:

Some recent OpenClaw versions can still block Forge during `plugins install`, even though Forge is a legitimate local-runtime plugin. The installer currently flags the package as dangerous because it launches the local Forge runtime and proxies to the localhost API. I am trying to get a better long-term install story upstream. Until then, the most reliable fallback is:

```bash
npm install -g forge-openclaw-plugin
node -e 'const cp=require("child_process"); const fs=require("fs"); const path=require("path"); const p=process.env.HOME+"/.openclaw/openclaw.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); const pluginPath=path.join(cp.execSync("npm root -g",{encoding:"utf8"}).trim(),"forge-openclaw-plugin"); j.plugins ??= {}; j.plugins.allow = Array.from(new Set([...(j.plugins.allow || []), "forge-openclaw-plugin"])); j.plugins.load ??= {}; j.plugins.load.paths = Array.from(new Set([...(j.plugins.load.paths || []), pluginPath])); j.plugins.entries ??= {}; j.plugins.entries["forge-openclaw-plugin"] = { enabled: true, config: { origin: "http://127.0.0.1", port: 4317, actorLabel: "aurel", timeoutMs: 15000 } }; fs.writeFileSync(p, JSON.stringify(j, null, 2)+"\n"); console.log("Configured", pluginPath);'
openclaw gateway restart
openclaw plugins info forge-openclaw-plugin
openclaw forge health
```

That bypass still uses the published npm package. It avoids the current installer regression by loading the npm-installed folder from `plugins.load.paths` instead of relying on the blocked `plugins install` flow.

`openclaw plugins enable forge-openclaw-plugin` sets the enabled flag, but it does not by itself guarantee that `plugins.allow` contains the plugin id. The `node -e ...` command above preserves the current allow list and appends `"forge-openclaw-plugin"` if it is missing.

For older OpenClaw builds that still need the repo-local fallback entry:

```bash
openclaw plugins install ./projects/forge
openclaw gateway restart
```

## Publishing path

For the Forge plugin itself, the safe public distribution path is:

1. publish the npm package `forge-openclaw-plugin`
2. verify install with `openclaw plugins install forge-openclaw-plugin`
3. submit Forge to the OpenClaw community plugin listing with:
   - the npm package name
   - the public GitHub repository
   - install and setup docs

ClawHub clarification:

- the official OpenClaw docs clearly document ClawHub as the public skill registry
- the community plugin listing requirements still point plugin authors to npm and GitHub
- so Forge should be treated as an npm-published OpenClaw plugin first
- if desired, Forge can also ship a separate companion skill to ClawHub for discovery, but that is not the main plugin publish path

## Enable it

Example config:

```json5
{
  plugins: {
    enabled: true,
    allow: ["forge-openclaw-plugin"],
    entries: {
      "forge-openclaw-plugin": {
        enabled: true,
        config: {
          origin: "http://127.0.0.1",
          port: 4317,
          dataRoot: "/absolute/path/to/forge-data",
          apiToken: "",
          actorLabel: "aurel",
          timeoutMs: 15000
        }
      }
    }
  }
}
```

`origin` is the protocol + host without the port.
`port` is split out explicitly so local collisions are easy to fix without rebuilding the whole URL.
`dataRoot` is optional. Use it when you want the local Forge runtime to use a specific data folder instead of the runtime working directory.

Changing the data folder means changing this exact config entry:

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

Then restart OpenClaw:

```bash
openclaw gateway restart
```

## Local and remote connection modes

For localhost or Tailscale Forge instances, the plugin can bootstrap an operator session automatically.
For pure localhost targets, it also auto-starts Forge if the local runtime is not already running.

That means the fast path is:

1. install the plugin
2. set `origin` and `port`
3. restart OpenClaw

Examples:

- `origin: "http://127.0.0.1"`, `port: 4317`
- `origin: "http://100.96.75.87"`, `port: 4317`
- `origin: "http://<your-device>.ts.net"`, `port: 4317`

If the target is remote and non-local, use `apiToken`.

## UI entrypoint

The plugin exposes two ways to move the user into the real Forge UI:

- tool: `forge_get_ui_entrypoint`
- redirect route: `GET /forge/v1/ui`

Use this lightly when a visual workflow would be easier, for example:

- reviewing Kanban state
- editing several linked entities
- inspecting Psyche graphs or reports
- continuing work directly inside Forge after the conversation

The hint should stay optional and end-weighted, not pushy.

## Public plugin contract

The curated tool contract is:

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
- `forge_adjust_work_minutes`
- `forge_log_work`
- `forge_start_task_run`
- `forge_heartbeat_task_run`
- `forge_focus_task_run`
- `forge_complete_task_run`
- `forge_release_task_run`
- `forge_get_calendar_overview`
- `forge_connect_calendar_provider`
- `forge_sync_calendar_connection`
- `forge_create_work_block_template`
- `forge_recommend_task_timeboxes`
- `forge_create_task_timebox`
- `forge_post_insight`

Live work rule:

- do not fake start or stop work by only moving task status
- use the real task-run tools for active work
- use `forge_adjust_work_minutes` when a task or project already exists and only the tracked minutes need correction
- use `forge_log_work` only when the work already happened and you are logging it as a finished work item after the fact

## Exact batch payload rules

The high-level Forge mutation tools are array-first.

`forge_search_entities`:

- pass `searches` as an array

`forge_create_entities`:

- pass `operations` as an array
- each operation must include `entityType` and full `data`
- `entityType` alone is not enough
- batch multiple creates together in one request when they belong to the same user ask

`forge_update_entities`:

- pass `operations` as an array
- each operation must include `entityType`, `id`, and `patch`
- project lifecycle is status-driven, so suspend with `status: "paused"`, finish with `status: "completed"`, and restart with `status: "active"`
- finishing a project auto-completes linked unfinished tasks
- task and project scheduling rules also stay on these generic patches: use `project.schedulingRules`, `task.schedulingRules`, and `task.plannedDurationSeconds`

`forge_delete_entities`:

- pass `operations` as an array with `entityType` and `id`
- delete defaults to soft unless hard is explicit

`forge_restore_entities`:

- pass `operations` as an array with `entityType` and `id`

## Exact operational payload rules

`forge_log_work`:

- use for work that already happened
- pass either `taskId` or `title`

`forge_adjust_work_minutes`:

- use for signed minute changes on an existing `task` or `project`
- required: `entityType`, `entityId`, `deltaMinutes`
- optional: `note`
- `deltaMinutes` must be non-zero and Forge clamps negative removals so credited time never goes below zero

`forge_start_task_run`:

- required: `taskId`, `actor`
- optional: `timerMode`, `plannedDurationSeconds`, `overrideReason`, `isCurrent`, `leaseTtlSeconds`, `note`
- if `timerMode` is `planned`, `plannedDurationSeconds` is required
- if current calendar rules block the task and the user still wants to continue, retry with an explicit `overrideReason`

Calendar tools:

- `forge_get_calendar_overview` for current provider state, native Forge events, mirrored events, work blocks, and timeboxes
- `forge_create_entities`, `forge_update_entities`, and `forge_delete_entities` for canonical Forge event management plus work blocks and task timeboxes
- `forge_connect_calendar_provider` and `forge_sync_calendar_connection` for provider setup and sync, including Exchange Online through Microsoft Graph in read-only mode. Exchange Online setup is normally completed through the interactive Settings flow after the local Microsoft client ID, tenant, and redirect URI have been saved in Forge, rather than through fully non-interactive agent input.
- `forge_create_work_block_template` for recurring half-day, holiday, or custom work blocks
- work-block templates accept optional `startsOn` / `endsOn` `YYYY-MM-DD` bounds; omitting `endsOn` keeps the block repeating indefinitely
- holiday blocks should normally use `kind: "holiday"` with `weekDays: [0,1,2,3,4,5,6]` and `startMinute: 0`, `endMinute: 1440`
- `forge_recommend_task_timeboxes` and `forge_create_task_timebox` for future planning and confirmation

`forge_heartbeat_task_run`:

- required: `taskRunId`
- optional: `actor`, `leaseTtlSeconds`, `note`

`forge_focus_task_run`:

- required: `taskRunId`

`forge_complete_task_run`:

- required: `taskRunId`
- optional: `actor`, `note`

`forge_release_task_run`:

- required: `taskRunId`
- optional: `actor`, `note`

Example create payload:

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

Example update payload:

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

Example live-work start payload:

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

The curated route contract is:

- `GET /forge/v1/health`
- `GET /forge/v1/operator/overview`
- `GET /forge/v1/agents/onboarding`
- `POST /forge/v1/entities/search`
- `POST /forge/v1/entities/create`
- `POST /forge/v1/entities/update`
- `POST /forge/v1/entities/delete`
- `POST /forge/v1/entities/restore`
- `POST /forge/v1/insights`
- `GET /forge/v1/ui`

## Token creation

Best path:

1. open Forge in the browser locally or over Tailscale
2. go to `Settings` -> `Agents`
3. issue or rotate a token there
4. copy the raw `fg_live_...` token when it is revealed once
5. paste it into `plugins.entries["forge-openclaw-plugin"].config.apiToken`

CLI path:

```bash
curl -i -c /tmp/forge.cookie http://127.0.0.1:4317/api/v1/auth/operator-session

curl -X POST http://127.0.0.1:4317/api/v1/settings/tokens \
  -b /tmp/forge.cookie \
  -H 'content-type: application/json' \
  -d '{
    "label": "Aurel full operator",
    "agentLabel": "aurel",
    "agentType": "assistant",
    "trustLevel": "trusted",
    "autonomyMode": "scoped_write",
    "approvalMode": "high_impact_only",
    "scopes": [
      "read",
      "write",
      "insights",
      "rewards.manage",
      "psyche.read",
      "psyche.write",
      "psyche.note",
      "psyche.insight",
      "psyche.mode"
    ]
  }'
```

## Diagnose

```bash
openclaw plugins info forge-openclaw-plugin
openclaw forge health
openclaw forge overview
openclaw forge onboarding
openclaw forge ui
openclaw forge start
openclaw forge stop
openclaw forge restart
openclaw forge status
openclaw forge doctor
openclaw forge route-check
```

`openclaw forge doctor` checks connectivity, onboarding, and curated route coverage.
`openclaw forge start`, `openclaw forge stop`, `openclaw forge restart`, and `openclaw forge status` manage the local Forge runtime when it is being handled by the OpenClaw plugin. If Forge was started some other way, they report that instead of killing random local processes.
If the local runtime fails before it becomes healthy, check `~/.openclaw/logs/forge-openclaw-plugin/127.0.0.1-4317.log` for the captured Forge stdout/stderr from the plugin-managed child process. On clean installs, the plugin also attempts to repair missing bundled runtime dependencies on first local start before it launches Forge.
