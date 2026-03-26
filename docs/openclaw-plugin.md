# Forge OpenClaw Plugin

Forge ships a native OpenClaw plugin add-on with a deliberately small public surface.

The intended workflow is:

- start with `forge_get_operator_overview`
- use `forge_search_entities` before mutating when duplicates are possible
- create, update, delete, and restore through the batch entity tools
- store agent-authored recommendations with `forge_post_insight`
- use `forge_get_ui_entrypoint` when the user should continue in the visual Forge UI

The plugin no longer mirrors Forge’s full CRUD and UI API. Forge itself still has the full `/api/v1` surface for the web app and internal runtime.
When the configured origin is `localhost` or `127.0.0.1`, the plugin auto-starts the bundled Forge runtime on the configured port.

## Which manifest does what

There are three files involved on purpose:

- [`openclaw.plugin.json`](../openclaw.plugin.json): source-of-truth plugin manifest in the main Forge repo
- [`openclaw-plugin/openclaw.plugin.json`](../openclaw-plugin/openclaw.plugin.json): packaged copy that ships in the npm artifact
- [`openclaw-plugin/package.json`](../openclaw-plugin/package.json): npm package metadata and `openclaw.extensions` entry wiring

## Install

Current OpenClaw builds should use package discovery:

```bash
openclaw plugins install forge-openclaw-plugin
openclaw gateway restart
```

For release-parity local development:

```bash
openclaw plugins install ./projects/forge/openclaw-plugin
openclaw gateway restart
```

For older OpenClaw builds that still need the repo-local fallback entry:

```bash
openclaw plugins install ./projects/forge
openclaw gateway restart
```

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
- `forge_get_agent_onboarding`
- `forge_get_ui_entrypoint`
- `forge_search_entities`
- `forge_create_entities`
- `forge_update_entities`
- `forge_delete_entities`
- `forge_restore_entities`
- `forge_post_insight`

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
2. go to `Settings` -> `Collaboration Settings`
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
      "psyche.comment",
      "psyche.insight",
      "psyche.mode"
    ]
  }'
```

## Diagnose

```bash
openclaw plugins info forge-openclaw-plugin
forge health
forge overview
forge onboarding
forge ui
forge doctor
forge route-check
```

`forge doctor` checks connectivity, onboarding, and curated route coverage.
