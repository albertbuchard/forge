# AGENTS.md — Forge

## Scope

This file governs the `projects/forge` subtree and supplements the root `AGENTS.md`.

## Post-change verification (mandatory)

After every code change to Forge:

1. **Type-check** — run `npx tsc --noEmit` and fix any errors before considering the task done.
2. **Dev server** — confirm the Vite dev server and the backend API server are both running:
   - Backend API: `npm run dev:server:openclaw-data`
   - Vite dev: `FORGE_BASE_PATH=/forge/ npm run dev` (port 3027)
3. **Tailscale serve** — verify `tailscale serve status` shows `/forge` mapped to the dev server and that the MagicDNS URL returns a successful response.
4. If any of the above are down, restart them and re-verify before reporting the task as complete.

Do **not** skip this verification. Do **not** report a task as done until the live app is confirmed reachable.
