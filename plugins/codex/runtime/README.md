# Forge Codex Runtime Bundle

This directory is the repo-local runtime payload used by the Forge Codex MCP
adapter.

- `package.json` is the tiny runtime package contract used by the adapter.
- `dist/` is generated output. It lets the local Codex plugin start Forge
  without requiring a globally installed Forge package, but it is not tracked in
  git because Vite asset hashes create noisy source-control churn.

Do not edit files under `dist/` by hand. Rebuild the bundle from the Forge root
with:

```bash
npm run build:openclaw-plugin
```

The Codex MCP launch wrapper also rebuilds the bundle when required files are
missing. Rerun the OpenClaw/Codex contract tests before committing runtime
contract changes.
