# AGENTS.md — Forge

## Scope

This file governs the `projects/forge` subtree and supplements the root `AGENTS.md`.

## Branch rule

All Forge work must happen on `main` unless Albert explicitly asks for a different branch.
Do not create, switch to, or keep working on feature branches by default.
Before any Forge commit, verify `git branch --show-current` returns `main`.

## Parent monorepo mirror rule

The Forge repository is the source of truth for files under `projects/forge`.
The parent monorepo may mirror Forge files, but parent merge resolution is not authoritative for Forge source.

- Do not let a parent-monorepo checkout, merge, or conflict resolution downgrade Forge files.
- If parent and Forge disagree, inspect Forge `main` first and restore from the Forge repository's `HEAD`.
- Before staging Forge release metadata, run `scripts/audit-release-guard.sh`.
- The local Forge pre-commit hook also runs the release guard. It fails if the working or staged iOS marketing version is older than the latest `ios-testflight-v*` tag.

## OpenClaw plugin rule

When Forge work involves the OpenClaw plugin, treat the repo-local plugin folder as the default install source.

- Before changing, reinstalling, restarting, or debugging Forge, OpenClaw, Hermes, or the Forge Codex adapter, verify the effective data root from explicit config and live runtime evidence. Do not infer the database from generic defaults.
- Check both config and runtime evidence when storage is in question: OpenClaw plugin config, Hermes Forge config, `FORGE_DATA_ROOT`, and a live process/file-handle check such as `lsof -p <forge-pid> | rg 'forge.sqlite|forge.json'`.
- Treat fallback locations such as `~/.forge`, plugin extension folders, package-local `data/`, and adapter-local data folders as candidates only until config or runtime evidence proves they are active.
- Before any data-root repair, migration, restore, or merge, create a timestamped backup of every candidate Forge database and config file. Do not merge side databases into the selected canonical database unless an ID/content-level audit proves the side database contains relevant user data that is missing from that canonical database.
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
2. **Runtime contract** — confirm the backend/plugin runtime on `4317` is healthy when plugin behavior is involved, and confirm dev mode separately when Albert expects the live development checkout:
   - Stable backend/plugin runtime: `http://127.0.0.1:4317/`
   - Dev API: `HOST=127.0.0.1 PORT=3017 npm exec -- tsx server/src/index.ts`
   - Dev Vite UI: `FORGE_BASE_PATH=/forge/ npm run dev:web -- --host 127.0.0.1 --port 3027`
   - On this Mac, the restored 6-hour Tailscale automation manages `/forge -> http://127.0.0.1:4317/forge/`, but `4317/forge/` must still be source-backed dev mode with `/forge/@vite/client` and `/forge/src/main.tsx`. Do not use `/forge-dev`, and do not map `/forge` to bare `3027`. Normal plugin installs on other machines must keep the packaged runtime default unless explicitly opted into dev mode.
3. **Tailscale Serve/Funnel** — inspect `tailscale serve status` and `tailscale funnel status` only. Do not create, repair, reset, or refresh Serve/Funnel mappings unless Albert explicitly approves that network exposure step in the current task. If a mapping already exists, verify it; if it is missing or stale, report that instead of repairing it.
4. If the local Forge runtime is down, restart the local runtime and re-verify before reporting the task as complete. Do not use Tailscale Serve/Funnel repair as part of the default recovery path.

Do **not** skip this verification. Do **not** report a task as done until the live app is confirmed reachable.
