# Forge Codex Runtime Bundle

This directory is the repo-local runtime payload used by the Forge Codex MCP
adapter.

- `package.json` is the tiny runtime package contract used by the adapter.
- `dist/` is intentionally tracked generated output. It lets the local Codex
  plugin start Forge without requiring a separate build step or a globally
  installed Forge package.

Do not edit files under `dist/` by hand. Rebuild the bundle from the Forge root
with:

```bash
npm run build:openclaw-plugin
```

Then rerun the OpenClaw/Codex contract tests before committing changes.
