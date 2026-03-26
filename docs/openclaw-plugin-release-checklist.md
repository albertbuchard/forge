# Forge OpenClaw Plugin Release Checklist

Use this checklist before publishing `forge-openclaw-plugin`.

1. Confirm the public Forge repo is up to date and `projects/forge` is being worked as a nested public repo.
2. Bump versions in:
   - root [`openclaw.plugin.json`](../openclaw.plugin.json)
   - public package [`openclaw-plugin/package.json`](../openclaw-plugin/package.json)
   - public package [`openclaw-plugin/openclaw.plugin.json`](../openclaw-plugin/openclaw.plugin.json)
3. Run:
   - `npm exec -- tsc --noEmit`
   - `npm exec -- tsc -p server/tsconfig.json --noEmit`
   - `npm exec -- vitest run src/openclaw/parity.test.ts src/openclaw/index.test.ts src/openclaw/api-client.test.ts src/openclaw/manifest.test.ts`
   - `node --import tsx --test --test-concurrency=1 server/src/app.test.ts`
   - `npm run build:openclaw-plugin`
4. Smoke check local runtime:
   - `/api/v1/health`
   - `/api/v1/operator/overview`
   - `/api/v1/agents/onboarding`
   - `/api/v1/entities/search`
   - `/forge/v1/entities/search`
   - `/forge/v1/ui`
5. Smoke install the package in a clean OpenClaw workspace:
   - `openclaw plugins install ./openclaw-plugin`
   - `openclaw gateway restart`
   - `forge doctor`
6. Verify the skill still foregrounds:
   - `forge_get_operator_overview`
   - `forge_get_ui_entrypoint`
   - `forge_search_entities`
   - batch create/update/delete/restore
   - `forge_post_insight`
   - entity format cards
   - non-intrusive end-of-message save suggestions and occasional UI hints
7. Publish the package artifact.
8. Re-run a clean install using the published package name and confirm `forge doctor` and `forge overview` still succeed.
