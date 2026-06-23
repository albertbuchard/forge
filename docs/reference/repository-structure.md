# Repository Structure

Forge is one source checkout that ships several runtimes from the same codebase:
the React web app, the Fastify API, OpenClaw, Hermes, Codex MCP, the
`forge-memory` installer, the Tauri shell, the Rust Iroh transport, and the
native iOS/watchOS companion. The repository is organized by ownership boundary,
not by historical arrival order.

## Top-Level Tree

```text
.
|-- apps/
|   |-- web/                 # React 19/Vite/Tailwind browser app and web public assets
|   |-- api/                 # Fastify API, OpenAPI contract, SQLite migrations, services
|   |-- desktop-tauri/       # Tauri desktop shell wrapper
|   `-- ios-companion/       # Swift iPhone/watchOS app, Fastlane, release config
|-- plugins/
|   |-- openclaw/            # Publishable forge-openclaw-plugin package
|   |-- codex/               # Repo-local Codex MCP plugin package and launch scripts
|   `-- hermes/              # forge-hermes-plugin Python package
|-- packages/
|   |-- forge-memory/        # `npx forge-memory` installer/runtime manager
|   `-- companion-iroh/      # Rust Iroh/QUIC transport used by desktop and iOS
|-- tests/
|   |-- e2e/                 # Playwright end-to-end browser coverage
|   `-- fixtures/            # Shared fixture data for focused tests
|-- scripts/
|   |-- assets/              # App icons, gamification tooling, atlas cropper
|   |-- ci/                  # CI setup helpers
|   |-- database/            # SQLite repair, merge, and wiki migration tools
|   |-- dev/                 # Local runtime wrappers and standalone doctor
|   |-- docs/                # OpenAPI export and docs media generation
|   |-- release/             # OpenClaw, Hermes, and iOS release guards
|   `-- smoke/               # Packed/published package runtime smoke tests
|-- docs/                    # Public references and release docs only
|-- assets/                  # Source-owned design and app icon inputs
|-- .agents/plugins/         # Repo-scoped local plugin marketplace metadata
|-- .github/workflows/       # CI, docs, plugin, package, and iOS release jobs
|-- .vision/                 # Product, architecture, stack, and design direction
|-- AGENTS.md                # Forge-specific agent and verification rules
|-- README.md                # User and contributor entrypoint
|-- package.json             # Root Node scripts and dependency contract
|-- playwright.config.ts     # Browser E2E configuration
|-- tsconfig*.json           # TypeScript project and base config
|-- vite.config.ts           # Web build and development server configuration
`-- vitest.setup.ts          # Shared Vitest browser/test setup
```

There is no source-owned root `src/`, `server/`, `src-tauri/`, `ios-companion/`,
`openclaw-plugin/`, `e2e/`, `test-fixtures/`, or `tools/atlas-cropper/`
directory. If one reappears, treat it as a regression unless a future migration
explicitly documents the new boundary.

## Intentional Package Boundaries

- `apps/web/` owns the browser app, routed pages, feature components, API
  clients, and the source OpenClaw bridge under `apps/web/src/openclaw/`.
- `apps/api/` owns the Fastify runtime, OpenAPI, SQLite migrations, agent
  onboarding payload, entity catalog, and specialized route families.
- `apps/desktop-tauri/` owns the Tauri shell wrapper.
- `apps/ios-companion/` is a governed native project subtree with its own
  `AGENTS.md`, `.vision/`, Fastlane release files, and canonical
  `ForgeCompanion.xcodeproj`.
- `plugins/openclaw/` is the publishable `forge-openclaw-plugin` package. Its
  source manifest, docs, skill, package scripts, generated package runtime, and
  local server wrapper live together there.
- `plugins/codex/` is the repo-local Codex MCP plugin package. Its runtime
  `dist/` bundle is generated from the OpenClaw package build and is ignored in
  Git, not maintained as source.
- `plugins/hermes/` is the `forge-hermes-plugin` Python package. Its package
  runtime is built from the OpenClaw runtime and stores migrations under
  `forge_hermes/runtime/apps/api/migrations/`.
- `packages/forge-memory/` is the public npm installer/runtime manager and must
  preserve the `forge-memory` package and CLI identity.
- `packages/companion-iroh/` is Rust source used by both the desktop host and
  iOS static library bridge. Its `target/` directory is generated output.
- `.agents/plugins/marketplace.json` is small host metadata for the local Codex
  plugin marketplace. Do not put runtime data, generated packages, or host cache
  files under `.agents/`.
- `.vision/` keeps binding product and architecture direction. It is source
  owned, but it is not a work log.

## Release-Sensitive Paths

These paths are hardcoded or path-filtered by current release automation and
must be updated together if they move:

- `.github/workflows/github-pages.yml` publishes `plugins/openclaw/docs/` and
  runs `scripts/docs/export-openapi-docs.ts`.
- `.github/workflows/openclaw-plugin.yml` watches `plugins/openclaw/`,
  `apps/web/src/openclaw/`, `apps/api/src/app.ts`, `apps/api/src/openapi.ts`,
  and `packages/companion-iroh/`.
- `.github/workflows/release-openclaw-plugin.yml` calls
  `scripts/release/release-forge-openclaw-plugin.sh`.
- `.github/workflows/release-hermes-plugin.yml` calls
  `scripts/release/release-forge-hermes-plugin.sh`.
- `.github/workflows/release-forge-memory.yml` publishes
  `packages/forge-memory/`.
- `.github/workflows/release-ios-companion.yml` uses
  `apps/ios-companion/release/release.yml` and scripts under
  `apps/ios-companion/scripts/`.
- `package.json` maps public npm commands to the grouped script families.
- `scripts/release/release-forge-openclaw-plugin.sh` coordinates versions across
  `plugins/openclaw/`, `plugins/codex/`, `plugins/hermes/`, and
  `packages/forge-memory/`.
- `scripts/release/release-forge-hermes-plugin.sh` builds the Hermes Python
  package and verifies the shared OpenClaw route contract before release.
- `apps/ios-companion/scripts/publish-forge-companion.sh` and
  `apps/ios-companion/scripts/write-release-env.sh` own native companion release
  prep.

## Generated And Local-Only Paths

The following directories and files are local runtime output or generated
package output and must not be treated as source:

- `.DS_Store`, `.codex-runs/`, literal `$CODEX_HOME/`, and root-level temporary
  screenshots or probes such as `.tmp-*.png`, `forge-companion-post-fix*.png`,
  and `tmp-width-probe.cjs`
- `node_modules/`, root `dist/`, `coverage/`, `tmp/`, `test-results/`
- `data/` and `apps/api/*.sqlite*`
- `packages/companion-iroh/target/`
- `apps/ios-companion/ForgeCompanion/build/`
- `apps/ios-companion/.artifacts/`, `apps/ios-companion/.bundle/`,
  `apps/ios-companion/vendor/`
- `plugins/openclaw/dist/`, `plugins/openclaw/server/migrations/`,
  `plugins/openclaw/data/`, package tarballs, and generated gamification raster
  archives
- `plugins/codex/runtime/dist/` and `plugins/codex/runtime/server/migrations/`
- `plugins/hermes/.venv/`, `.pytest_cache/`, `__pycache__/`, `build/`,
  `dist/`, `python-dist/`, and `*.egg-info/`
- stale editor or ad hoc backup files such as `*.bak-*`

If a generated path appears in `git ls-files`, remove it from the index while
leaving the local file intact:

```bash
git rm -r --cached <generated-path>
```

For local cleanup of ignored residue that is not needed for the active runtime,
prefer targeted removal over broad resets. Keep `node_modules/`, `data/`, and
active package `dist/` directories when they are being used for development or a
linked plugin runtime.

## Public Repository Privacy

Private goal prompts, `/goal` handoffs, private discussion summaries,
automation memory, internal audits, private model-response captures, and
conversation-derived planning notes do not belong in the public Forge
repository. Do not preserve or recreate any historical private-docs subtree in
public Forge. Keep those artifacts in the private parent monorepo or under
`$CODEX_HOME`.

Before public commits and pushes, scan tracked and staged docs/Markdown for
private terms and move any private artifact out of the public repo.

## Cleanup Direction

Future folder moves should preserve the visible ownership boundaries above:
source code in `apps/`, host adapters in `plugins/`, public packages in
`packages/`, tests in `tests/`, scripts in `scripts/`, public docs in `docs/`,
and source-owned assets in `assets/`. Start every move by updating the
release-sensitive paths above, then run the mandatory Forge checks from
`AGENTS.md` before committing.
