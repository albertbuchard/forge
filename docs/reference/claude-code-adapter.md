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

Forge also writes a Forge-owned Claude user rule at:

```bash
~/.claude/rules/forge-memory.md
```

That rule is the Claude-native equivalent of the Forge agent skill guidance used
by the other adapters. The MCP entry gives Claude Code access to Forge tools.
The rule teaches Claude when and how to use those tools for wiki ingestion, page
curation, duplicate merging, evidence preservation, data-root safety, and secret
redaction.

Without this instruction layer, Claude Code can connect to Forge but may treat
it like an ordinary tool bucket instead of the canonical memory system.

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

`forge-memory configure --adapters claude` only updates `mcpServers.forge` in
Claude's user config and the Forge-owned managed block in
`~/.claude/rules/forge-memory.md`. It preserves unrelated Claude settings,
project settings, unrelated MCP servers, and any user content outside the
Forge-managed rules block. File edits are backed up before writing.

`forge-memory uninstall` keeps Claude config by default. If the user explicitly
passes `--remove-adapters` or confirms adapter removal during interactive
uninstall, Forge removes only the Forge-owned `mcpServers.forge` entry when it
still points to `npx forge-memory mcp`, plus the Forge-owned Claude rules
block/file. It does not remove unrelated Claude settings or user-authored rule
content.

## Why This Uses Claude Rules

Claude Code separates tool wiring from operating instructions. Its MCP config
lives in `~/.claude.json`, while persistent behavior guidance lives in
`CLAUDE.md` files or user rules under `~/.claude/rules/`.

Forge uses the user-rules path because it is private to the operator, applies
across projects, and avoids modifying project source trees or overwriting a
user's global `CLAUDE.md`.
