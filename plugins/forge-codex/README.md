# Forge Codex Plugin

Repo-local Codex plugin for Forge.

This plugin exposes the Forge MCP tool surface through the same curated contract as the Forge OpenClaw adapter.

It also carries a bundled built Forge runtime under [`runtime/`](./runtime), so local Codex use does not depend on a separately started Forge process.

- start from the operator overview
- search before creating duplicates
- use batch entity tools for normal multi-entity work
- post structured insights
- hand off to the Forge UI when Kanban, review, or Psyche exploration is easier visually

The MCP server is launched by [`./scripts/run-mcp.sh`](./scripts/run-mcp.sh), which starts the bundled MCP bridge and reuses the built Forge OpenClaw tool registrations from the packaged runtime.

Environment variables:

- `FORGE_ORIGIN`
- `FORGE_PORT`
- `FORGE_API_TOKEN`
- `FORGE_ACTOR_LABEL`
- `FORGE_TIMEOUT_MS`

Defaults match the local Forge runtime:

- origin: `http://127.0.0.1`
- port: `4317`
- actor: `codex`

If nothing is already listening on the configured local Forge port, the plugin auto-starts the bundled runtime.
