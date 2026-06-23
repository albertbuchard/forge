# Forge OpenClaw Plugin Release Checklist

Use this checklist before publishing `forge-openclaw-plugin`.

1. Confirm the public Forge repo is up to date and `projects/forge` is being worked as a nested public repo.
2. Bump versions in:
   - plugin [`plugins/openclaw/openclaw.plugin.json`](../plugins/openclaw/openclaw.plugin.json)
   - public package [`plugins/openclaw/package.json`](../plugins/openclaw/package.json)
   - public package [`plugins/openclaw/openclaw.plugin.json`](../plugins/openclaw/openclaw.plugin.json)
3. Run:
   - `npm exec -- tsc --noEmit`
   - `npm exec -- tsc -p apps/api/tsconfig.json --noEmit`
   - `npm exec -- vitest run apps/web/src/openclaw/parity.test.ts apps/web/src/openclaw/index.test.ts apps/web/src/openclaw/api-client.test.ts apps/web/src/openclaw/manifest.test.ts apps/web/src/openclaw/tool-contract.test.ts`
   - `node --import tsx --test --test-concurrency=1 apps/api/src/app.test.ts`
   - `npm run build:openclaw-plugin`
4. Confirm the notes rollout is reflected in the public plugin/docs surface:
   - `note` is the only collaboration record terminology
   - no public docs or skills still mention `/api/v1/comments`, `psyche.comment`, or legacy comments
   - plugin docs explain nested `notes`, `closeoutNote`, and searchable `/forge/notes`
5. Smoke check local runtime:
   - `/api/v1/health`
   - `/api/v1/operator/overview`
   - `/api/v1/agents/onboarding`
   - `/api/v1/entities/search`
   - `/api/v1/notes`
   - `/forge/v1/entities/search`
   - `/forge/v1/ui`
6. Smoke install the package in a clean OpenClaw workspace:
   - `openclaw plugins install --dangerously-force-unsafe-install ./plugins/openclaw`
   - `openclaw gateway restart`
   - `openclaw plugins inspect forge-openclaw-plugin --runtime`
   - `openclaw forge doctor`
7. Verify the skill still foregrounds:
   - `forge_get_operator_overview`
   - `forge_get_ui_entrypoint`
   - `forge_search_entities`
   - batch create/update/delete/restore
   - first-class `note` usage, nested `notes`, and `closeoutNote`
   - `forge_post_insight`
   - entity format cards
   - non-intrusive end-of-message save suggestions and occasional UI hints
8. Publish the package artifact.
   - `cd plugins/openclaw && npm publish --access public`
   - if npm 2FA is enabled, use `npm publish --access public --otp=<code>`
9. Re-run a clean install using the published package name and confirm `openclaw forge doctor` and `openclaw forge overview` still succeed.
10. Submit or update the OpenClaw community plugin listing entry with:
   - npm package: `forge-openclaw-plugin`
   - repo: `https://github.com/albertbuchard/forge`
   - install docs: `plugins/openclaw/README.md`
11. ClawHub follow-up if desired:
   - publish a companion Forge skill there for discovery
   - do not treat ClawHub as the primary Forge plugin distribution path unless OpenClaw's plugin docs change
