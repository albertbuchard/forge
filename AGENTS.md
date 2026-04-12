# AGENTS.md — Forge

## Scope

This file governs the `projects/forge` subtree and supplements the root `AGENTS.md`.

## Branch rule

All Forge work must happen on `main` unless Albert explicitly asks for a different branch.
Do not create, switch to, or keep working on feature branches by default.

## OpenClaw plugin rule

When Forge work involves the OpenClaw plugin, treat the repo-local plugin folder as the default install source.

- Use the documented local-dev flow from `/Users/omarclaw/Documents/aurel-monorepo/projects/forge/openclaw-plugin/README.md`.
- Prefer `openclaw plugins install ./projects/forge/openclaw-plugin`, then `openclaw plugins enable forge-openclaw-plugin`, then repair `plugins.allow` if needed, then `openclaw gateway restart`, then `openclaw forge health`.
- Do not switch to the published npm package or another global install path unless Albert explicitly asks for that.
- Do not change the Forge plugin `dataRoot` in `~/.openclaw/openclaw.json` unless Albert explicitly asks for a data-path change.
- When verifying state, confirm `openclaw plugins info forge-openclaw-plugin` reports the repo-local Forge plugin as the source path.
- If Forge backend routes, the OpenClaw plugin package, onboarding contract, or Forge skill files changed, rebuild the plugin before verification so the running agent surface matches the source tree.
- After such changes, do not stop at static inspection. Rebuild, restart the OpenClaw gateway, then re-check `openclaw plugins info forge-openclaw-plugin` and `openclaw forge health`.

## Post-change verification (mandatory)

After every code change to Forge:

1. **Type-check** — run `npx tsc --noEmit` and fix any errors before considering the task done.
2. **Dev server** — confirm the Vite dev server and the backend API server are both running:
   - Backend API: `npm run dev:server:openclaw-data`
   - Vite dev: `FORGE_BASE_PATH=/forge/ npm run dev` (port 3027)
3. **Tailscale serve** — verify `tailscale serve status` shows `/forge` mapped to the dev server and that the MagicDNS URL returns a successful response.
4. If any of the above are down, restart them and re-verify before reporting the task as complete.

Do **not** skip this verification. Do **not** report a task as done until the live app is confirmed reachable.
