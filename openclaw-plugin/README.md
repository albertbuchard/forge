# Forge OpenClaw Plugin

`forge-openclaw-plugin` is the publishable OpenClaw package for Forge.
When the plugin targets `localhost` or `127.0.0.1`, it auto-starts the bundled Forge runtime so the local install path stays one-step.

## Install

Current OpenClaw builds should use package discovery:

```bash
openclaw plugins install forge-openclaw-plugin
openclaw gateway restart
```

Older OpenClaw builds can keep using the repo/manual install path during the transition:

```bash
openclaw plugins install ./projects/forge
openclaw gateway restart
```

That repo-local path is the fallback only. The published package stays on the SDK `definePluginEntry` entrypoint. The OpenClaw plugin id is `forge-openclaw-plugin`, while the product name stays `Forge` and the CLI namespace stays `forge`.

## Recommended usage

The public mental model is intentionally small:

1. `forge_get_operator_overview`
2. `forge_get_ui_entrypoint` when the user should continue in the visual Forge UI
3. `forge_search_entities`
4. `forge_create_entities` or `forge_update_entities`
5. `forge_delete_entities` or `forge_restore_entities` when needed
6. `forge_post_insight` for recommendations

The skill is entity-format-driven. It teaches the agent how to:

- keep the conversation natural
- make only gentle end-of-message save suggestions
- lightly suggest the Forge UI when visual review or editing would be easier
- ask only for missing fields
- capture goals, projects, tasks, values, patterns, behaviors, beliefs, and trigger reports

For local use, set the plugin origin to `http://127.0.0.1` or `http://localhost` and the plugin will bring Forge up on the configured port automatically.
