# Forge Multi-user, Multi-agent, And Strategy Guide

This guide explains how to run Forge as one shared system for humans and bots,
how to point several agent adapters at the same runtime safely, and how
strategies and alignment metrics work in the current implementation.

## What Forge Adds

Forge is designed for cases where planning, execution, evidence, and reflection
need to stay in one system instead of being split across separate tools.

What that means in practice:

- a goal can stay linked to the projects that express it
- a project can stay linked to the tasks that move it
- a task can stay linked to timed work, notes, calendar plans, and strategy
  nodes
- a human-owned record and a bot-owned record can still link to each other
  without pretending they have the same owner
- the user and the agent can inspect the same structure later without
  reconstructing it from chat history

This is not about replacing every other tool. It is about keeping the parts
that matter for long-running collaborative execution in one clear operating
record.

## Core Ownership Model

Forge is explicitly multi-user.

Every Forge user is one of:

- `human`
- `bot`

Every important Forge entity can carry a `userId`, including goals, projects,
tasks, habits, notes, strategies, calendar records, and Psyche records.

Ownership means "whose record is this".
Linkage means "what does this record connect to".

Those are separate concepts on purpose.

Examples:

- a human-owned project can link to a bot-owned task
- a bot-owned strategy can target a human-owned goal
- a shared note can reference entities across several owners

## Current Access Posture

Forge is already structured for future access-policy work, but the current
runtime behavior is intentionally permissive so the product stays usable while
the sharing layer matures.

Today:

- Forge can list users directly
- scoped reads can ask for one user or many users
- users can read other users when the route explicitly asks for them
- ownership is visible in the UI and API

Relevant routes:

- `GET /api/v1/users`
- `GET /api/v1/users/directory`
- read routes that accept `userId` or repeated `userIds`

The important operating rule is simple:

- writes should set `userId` intentionally
- reads should scope with `userId` or `userIds` when ownership matters

## Recommended Multi-agent Setup

The safest collaborative setup is one shared Forge runtime and one shared Forge
database.

That keeps:

- one user directory
- one strategy graph set
- one task and project history
- one note graph
- one calendar planning layer

### Recommended shared-runtime pattern

1. Pick one Forge server URL and port.
2. Pick one Forge data root.
3. Point every adapter at that same runtime.
4. Create the human and bot users in Forge.
5. Use `userId` on writes and `userIds` on reads.

Examples of good shared setups:

- one local runtime at `http://127.0.0.1:4317`
- one shared `dataRoot`, such as `/absolute/path/to/forge-data`
- OpenClaw, Hermes, Codex, and the browser all talking to that same runtime

Examples of when to use separate data roots:

- you want isolated test environments
- you want a disposable bot sandbox
- you explicitly do not want the same users and records shared across adapters

If you want one shared Forge system, do not let each adapter silently drift onto
its own default data root.

## OpenClaw Setup For Shared Multi-user Forge

Recommended OpenClaw config shape:

```json5
{
  plugins: {
    allow: ["forge-openclaw-plugin"],
    entries: {
      "forge-openclaw-plugin": {
        enabled: true,
        config: {
          origin: "http://127.0.0.1",
          port: 4317,
          dataRoot: "/absolute/path/to/forge-data",
          actorLabel: "openclaw",
          apiToken: "",
          timeoutMs: 15000
        }
      }
    }
  }
}
```

Important points:

- `origin` is the protocol + host
- `port` is stored separately
- `dataRoot` should be explicit when several adapters are meant to share one
  Forge database
- `actorLabel` should identify the adapter or bot clearly in logs and activity

After install, also verify the OpenClaw allow-list repair step and the agent
tool-card permissions so the agent can actually see Forge.

## Hermes Setup For Shared Multi-user Forge

Recommended Hermes config at `~/.hermes/forge/config.json`:

```json
{
  "origin": "http://127.0.0.1",
  "port": 4317,
  "dataRoot": "/absolute/path/to/forge-data",
  "actorLabel": "hermes",
  "timeoutMs": 15000
}
```

Important points:

- use the same `origin`, `port`, and `dataRoot` as OpenClaw if they are meant
  to share one Forge runtime
- choose a distinct `actorLabel` so Hermes actions stay readable
- use `FORGE_API_TOKEN` when Hermes is writing to a remote protected runtime

## Browser And Standalone UI

Normal local addresses:

- app runtime: `http://127.0.0.1:4317/forge/`
- repo Vite dev server: `http://127.0.0.1:3027/forge/`

The browser UI is where the shared user scope becomes most visible:

- `Settings -> Users` manages human and bot users
- the shell-level scope selector can focus on one user, humans, bots, or all
- strategy pages, search bars, detail views, notes, and calendar linking all
  surface ownership directly
- the Users page includes a directed graph editor for relationship rights plus
  per-user XP summaries so the operator can see which human or bot is moving
  real work

## User Creation Checklist

For each new Forge user, define:

- kind: `human` or `bot`
- handle
- display name
- description
- accent color

Good examples:

- a human operator such as `Albert`
- a bot executor such as `Forge Bot`
- a specialized bot such as `Research Bot`

The goal is not cosmetic classification. It is to make ownership obvious when a
task, project, note, or strategy belongs to a different actor.

## Read And Write Rules For Agents

When an agent writes:

- set `userId` when creating a goal, project, task, habit, note, strategy, or
  Psyche record
- do not assume the default operator if the request clearly concerns a bot

When an agent reads:

- use `userId` for one owner
- use repeated `userIds` for several owners
- omit scoping only when the user really wants the full visible system

Example intent patterns:

- "Show me the bot-owned strategies" -> read with that bot's `userId`
- "Compare my projects with the execution bot's tasks" -> read with both
  `userIds`
- "Save this as a bot task supporting my project" -> create task with the bot
  `userId`, linked to the human-owned project

## Strategies

A strategy is Forge's planning layer above ordinary project execution.

Use a strategy when the user is describing:

- a sequence of work over time
- several branches that still converge toward one end state
- a plan that spans several projects or tasks
- a path where "what happens after what" matters

Do not reduce that to a plain note if the graph structure matters.

### Strategy fields

A strategy includes:

- `title`
- `overview`
- `endStateDescription`
- `status`
- `targetGoalIds`
- `targetProjectIds`
- `linkedEntities`
- `graph`
- optional `userId` ownership

### Graph rules

The strategy graph is a directed acyclic graph.

That means:

- nodes can branch
- nodes can converge
- cycles are not allowed

Current node types:

- `project`
- `task`

Each node can carry:

- `id`
- `entityType`
- `entityId`
- `title`
- `branchLabel`
- `notes`

Each edge can carry:

- `from`
- `to`
- `label`
- `condition`

## Strategy Metrics

Forge exposes strategy metrics so the user can tell whether execution is still
tracking the intended plan.

The current implementation is concrete:

### Node progress

Project nodes:

- use the project progress percentage directly

Task nodes:

- `done`, `completed`, `reviewed`, `integrated` -> `1.0`
- `in_progress`, `active` -> `0.66`
- `focus` -> `0.5`
- `blocked`, `paused` -> `0.25`
- anything else -> `0`

### Completed nodes

A node is counted as complete when its progress is `1.0`.

### Active and next nodes

A node is considered active or available next when:

- it is not complete
- every dependency feeding into it is already complete

This is why the DAG shape matters. The graph is not only visual. It controls
what Forge can truthfully say is available next.

### Target progress

Target progress is computed from:

- linked goal progress
- linked project progress

### Alignment score

The current implementation now breaks alignment into four concrete pieces:

- `planCoverageScore`: how much of the graph and end targets are genuinely
  moving or complete
- `sequencingScore`: whether work is being done in the agreed order
- `scopeDisciplineScore`: whether off-plan work is appearing inside the
  strategy scope
- `qualityScore`: whether blocked nodes and weak end-target completion are
  dragging the plan down

`alignmentScore` is the weighted blend of those four scores.

That keeps the metric close to the user's actual question:

- are we doing the planned work at all
- are we doing it in order
- are we doing extra work that was not agreed
- are we doing the work well enough to land the intended end state

Forge also now rolls XP up per user in the shared directory so the human and
each bot can accumulate their own visible reward trail while still
participating in one collaborative strategy system.

## Recommended Strategy Authoring Pattern

When creating a strategy:

1. Define the end state in plain language.
2. Attach the goals or projects it is meant to land.
3. Build the smallest honest DAG that shows the real sequence.
4. Keep branches explicit when several paths can happen in parallel.
5. Link surrounding entities that help explain context.
6. Assign the strategy to the human or bot who owns the planning record.

Good strategy questions:

- What end state are we actually trying to reach?
- Which goal or project proves that this strategy landed?
- Which work must happen first?
- Which work can branch?
- Which node is truly next?

## Troubleshooting

### OpenClaw and Hermes do not see the same Forge data

Cause:

- they are pointing at different runtimes or different data roots

Fix:

- align `origin`
- align `port`
- align `dataRoot`

### The agent can read Forge but ownership is wrong

Cause:

- writes were created without the intended `userId`

Fix:

- set `userId` explicitly on writes
- use scoped reads while checking the result

### Cross-user links do not show up in the UI you expected

Cause:

- the current shell scope is filtered too narrowly

Fix:

- widen the shell user scope to include the relevant human or bot

### Strategy alignment looks lower than expected

Cause:

- some graph nodes are still incomplete or blocked
- target goals or projects are still behind

Fix:

- inspect the graph nodes and target progress separately
- check the "next nodes" rather than treating the percentage alone as the plan

## Summary

The main collaborative pattern in Forge is straightforward:

- one shared runtime
- explicit human and bot users
- deliberate ownership on writes
- scoped reads on demand
- cross-user links when work really spans owners
- strategies for plans that need real sequence and branching

That is what lets Forge stay readable for both the human and the agents over
time.
