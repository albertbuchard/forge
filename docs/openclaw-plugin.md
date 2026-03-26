# Forge OpenClaw Plugin

Forge ships a native OpenClaw plugin add-on that mirrors the stable Forge `/api/v1` contract under explicit plugin-owned routes.
The public mental model is intentionally small:

- read state with `forge_get_operator_overview`
- find or deduplicate entities with `forge_search_entities`
- create, update, delete, and restore through the batch entity routes
- store agent-authored recommendations with `forge_post_insight`

Narrow CRUD tools still exist for exact operations, timers, settings, approvals, rewards, and specialized Psyche work, but they are not the advertised day-to-day interface.

## Which manifest does what

There are three files involved on purpose:

- [`openclaw.plugin.json`](../openclaw.plugin.json): the source-of-truth Forge plugin manifest in the main Forge repo
- [`openclaw-plugin/openclaw.plugin.json`](../openclaw-plugin/openclaw.plugin.json): the packaged copy that ships inside the publishable npm artifact
- [`openclaw-plugin/package.json`](../openclaw-plugin/package.json): the npm package manifest; this is where `openclaw.extensions` declares the runtime entrypoint used by current OpenClaw builds

Rule:

- edit the root Forge manifest when plugin identity or config UI changes
- keep the packaged `openclaw.plugin.json` aligned with it
- use `openclaw-plugin/package.json` for npm metadata, package versioning, and extension entry wiring
- the private Forge root [`package.json`](../package.json) is separate again: it keeps a repo-local fallback entry for older OpenClaw installs, while the published package stays on the SDK entry

## Install the publishable package

On current OpenClaw builds, package discovery is the canonical install path:

```bash
openclaw plugins install forge-openclaw-plugin
openclaw gateway restart
```

This SDK declaration migration does not rename the plugin, routes, tools, or config keys.

## Install locally for release-parity development

From the monorepo root:

```bash
openclaw plugins install ./projects/forge/openclaw-plugin
```

For linked local development:

```bash
openclaw plugins install -l ./projects/forge/openclaw-plugin
```

## Older OpenClaw fallback

If you are still on an older OpenClaw interface that does not support the package-discovery flow cleanly, use the Forge repo-local fallback entry during the transition:

```bash
openclaw plugins install ./projects/forge
openclaw gateway restart
```

That repo-local path is only the fallback for older local installs. The publishable package remains `forge-openclaw-plugin`, and the public release stays on the SDK `definePluginEntry` path. The Forge plugin keeps the same plugin id, route paths, tool names, and config keys across this migration.

## Enable it

Workspace and local plugins are disabled by default until you enable them in OpenClaw config.

Example:

```json5
{
  plugins: {
    enabled: true,
    allow: ["forge"],
    entries: {
      forge: {
        enabled: true,
        config: {
          baseUrl: "http://127.0.0.1:3017",
          apiToken: "",
          actorLabel: "aurel",
          timeoutMs: 15000
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

## One-step local or Tailscale setup

For a localhost or Tailscale Forge instance, the plugin can bootstrap a Forge operator session automatically.

That means the fast path is:

1. install the plugin
2. point `baseUrl` at your running Forge instance
3. restart OpenClaw

If `baseUrl` is local or Tailscale, `apiToken` can stay blank and the plugin will request an operator session from Forge on first protected read or write, including mutating task, project, timer, comment, tag, and Psyche routes.

Examples:

- `http://127.0.0.1:3017`
- `http://100.96.75.87:3017`
- `http://<your-device>.ts.net:3017`

## Create a usable Forge operator token when you need explicit remote auth

Use an API token when:

- Forge is exposed through a non-local, non-Tailscale URL
- you want explicit scoped access instead of operator-session bootstrap
- you want a long-lived agent token with its own provenance posture

Best path:

1. open Forge in the browser locally or over Tailscale
2. go to `Settings` -> `Collaboration Settings`
3. issue or rotate a token there
4. copy the raw `fg_live_...` token when it is revealed once
5. paste it into `plugins.entries.forge.config.apiToken`

If you need a CLI path, bootstrap an operator session first and then use that session to create the token:

```bash
curl -i -c /tmp/forge.cookie http://127.0.0.1:3017/api/v1/auth/operator-session

curl -X POST http://127.0.0.1:3017/api/v1/settings/tokens \
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
      "psyche.comment",
      "psyche.insight",
      "psyche.mode"
    ]
  }'
```

Copy the returned `fg_live_...` token into `plugins.entries.forge.config.apiToken` when you want explicit tokened auth.

Forge reveals raw token values once. If you lose one, rotate it or issue a new token from Settings and replace it in the plugin config. Forge should not be treated as a vault for recovering old raw tokens.

## Recommended workflow

Start here:

1. `forge_get_operator_overview`
2. `forge_search_entities` before creating or updating if duplicates are possible
3. one batch mutation tool for the actual save
4. `forge_post_insight` when the agent is storing a recommendation rather than a goal/project/task/Psyche record

The advertised mutation tools are:

- `forge_search_entities`
- `forge_create_entities`
- `forge_update_entities`
- `forge_delete_entities`
- `forge_restore_entities`
- `forge_post_insight`

The skill should guide the conversation in natural language and only offer a Forge save gently near the end of the message when the entity signal is strong.

## Entity-driven capture

The plugin skill advertises entity format cards instead of a long CRUD catalog.
Common capture types are:

- `goal`
- `project`
- `task`
- `psyche_value`
- `behavior_pattern`
- `behavior`
- `belief_entry`
- `trigger_report`

For each of those, the skill teaches:

- what the entity is for
- minimum required fields
- useful optional fields
- a one-line description of each field
- what to ask next when something is missing

## Inspect and diagnose

```bash
openclaw plugins list
openclaw plugins info forge
openclaw plugins doctor
```

The Forge plugin registers CLI helpers inside the OpenClaw runtime. On current OpenClaw builds, the most reliable checks are:

```bash
openclaw plugins info forge
openclaw health
forge doctor
forge overview
forge route-check
```

Use `forge doctor` as the production readiness check. It validates the live Forge health surface, operator overview, onboarding contract, and current plugin route parity. Use `forge overview` as the one-shot current-state read before asking an agent to mutate work.

## Contract

- Forge `/api/v1` stays the source of truth.
- OpenClaw routes are explicitly registered under `/forge/v1/...`.
- Token bootstrap remains canonical through Forge `/api/v1/settings/tokens`; the plugin focuses on onboarding, diagnostics, and operator workflows.
- Localhost and Tailscale plugin installs can bootstrap an operator session automatically.
- Remote non-local installs should use `apiToken`.
- Plugin writes preserve Forge provenance headers.
- `forge doctor` should be green before trusting the plugin for production agent work.
- Agents should bootstrap from the Forge operator overview rather than shotgun many route reads.
- Public docs should foreground the batch entity tools and entity-format-driven intake flow.
- The full-operator surface includes CRUD for goals, projects, tasks, tags, comments, timers/settings control, work logging, reward-rule inspection and mutation, manual bonus XP, approvals, and the Psyche entity families.
