# Forge Codex Plugin

Repo-local Codex plugin for Forge.

This plugin exposes the Forge MCP tool surface through the same curated contract as the Forge OpenClaw adapter.

It also carries a bundled built Forge runtime under [`runtime/`](./runtime), so local Codex use does not depend on a separately started Forge process.
The current Codex integration model is MCP-first: Codex connects to a local MCP
server and shares that MCP setup across the CLI and IDE extension. This adapter
therefore ships the Codex plugin metadata in
[`./.codex-plugin/plugin.json`](./.codex-plugin/plugin.json), the MCP server
definition in [`./.mcp.json`](./.mcp.json), and a local stdio bridge in
[`./scripts/forge-codex-mcp.mjs`](./scripts/forge-codex-mcp.mjs).

The MCP bridge now also registers itself into Forge's live agent-session
registry when the server process starts. Forge can therefore show active Codex
bridges next to OpenClaw and Hermes, track recent MCP activity, detect stale
sessions, and surface reconnect guidance in the onboarding and token-management
contract without requiring a Settings click.

- start from the operator overview
- search before creating duplicates
- use batch entity tools for normal multi-entity work
- post structured insights
- hand off to the Forge UI when Kanban, review, or Psyche exploration is easier visually

The current PM contract it should understand is:

- `Goal -> Strategy -> Project -> Strategy -> Issue -> Task -> Subtask`
- one mixed board for `project | issue | task | subtask`
- one compact hierarchy view with shared filters and level visibility
- shared `executionMode` + `acceptanceCriteria` support on issues and tasks
- hierarchy-aware linking and creation flows
- `completionReport = { modifiedFiles[], workSummary, linkedGitRefIds[] }`
- direct work on `main` by default

The MCP server is launched by [`./scripts/run-mcp.sh`](./scripts/run-mcp.sh), which starts the bundled MCP bridge and reuses the built Forge OpenClaw tool registrations from the packaged runtime.

The MCP bridge now reports the live plugin version from the Codex plugin
manifest instead of a stale hard-coded server version, so Codex and Forge stay
aligned across local installs and releases.

Environment variables:

- `FORGE_ORIGIN`
- `FORGE_PORT`
- `FORGE_API_TOKEN`
- `FORGE_ACTOR_LABEL`
- `FORGE_TIMEOUT_MS`
- `FORGE_DATA_ROOT`

Defaults match the local Forge runtime:

- origin: `http://127.0.0.1`
- port: `4317`
- actor: `codex`
- data root: shared Forge runtime root, resolved from local runtime preferences
  when present

If nothing is already listening on the configured local Forge port, the plugin auto-starts the bundled runtime.

## Notes

- The Codex MCP server name stays short and explicit as `forge`, which matches
  current Codex MCP guidance and makes tool selection clearer inside Codex.
- This adapter is repo-local on purpose. It is meant to run against the checked
  out Forge tree and bundled runtime artifacts, not a separate published npm
  package.
