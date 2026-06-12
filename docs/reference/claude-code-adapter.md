# Claude Code Adapter

Forge Memory can configure Claude Code as a first-class MCP host adapter.

The normal path is:

```bash
npx forge-memory configure
```

Select `Claude Code` in the adapter list. Forge writes one user-scope Claude MCP server named `forge` to `~/.claude.json`. The server command is:

```bash
npx forge-memory mcp
```

Claude Code then uses the same Forge runtime, API URL, and data root as OpenClaw, Hermes, Codex, and the iOS companion. It does not create a second database or a Claude-specific runtime.

## Manual Setup

Use the official Claude MCP command shape when debugging a host install:

```bash
claude mcp add --scope user \
  --env FORGE_ORIGIN=http://127.0.0.1 \
  --env FORGE_PORT=4317 \
  --env FORGE_ACTOR_LABEL=claude \
  --env FORGE_AGENT_PROVIDER=claude \
  --env FORGE_TIMEOUT_MS=15000 \
  --env FORGE_DATA_ROOT="$HOME/.forge" \
  forge -- npx forge-memory mcp
```

Verify:

```bash
claude mcp list
claude mcp get forge
curl -s http://127.0.0.1:4317/api/v1/health
```

Inside Claude Code, use `/mcp` to confirm Forge is connected.

## Config Preservation

`forge-memory configure --adapters claude` only updates `mcpServers.forge` in Claude's user config. It preserves unrelated Claude settings, project settings, and unrelated MCP servers.

`forge-memory uninstall` keeps Claude config by default. If the user explicitly passes `--remove-adapters` or confirms adapter removal during interactive uninstall, Forge removes only the Forge-owned `mcpServers.forge` entry when it still points to `npx forge-memory mcp`.
