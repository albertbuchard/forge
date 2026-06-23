# Repository Structure

Forge is one source checkout that ships several runtimes from the same codebase:
the web app and API, OpenClaw, Hermes, Codex MCP, the `forge-memory` installer,
the Tauri shell, the Rust Iroh transport, and the native iOS/watchOS companion.
The repository layout should make those shipping boundaries explicit without
tracking generated build output.

## Top-Level Tree

```text
.
|-- .agents/plugins/         # Repo-scoped local plugin marketplace metadata
|-- .githooks/               # Optional local Git hook templates
|-- .github/workflows/        # CI, docs, plugin, package, and iOS release jobs
|-- .vision/                  # Product, architecture, stack, and design direction source of truth
|-- assets/                   # Source-owned design and app icon inputs
|-- companion-iroh/           # Rust Iroh/QUIC transport used by desktop and iOS
|-- docs/                     # Current references, release docs, and internal history
|-- e2e/                      # Playwright end-to-end browser coverage
|-- ios-companion/            # Swift iPhone/watchOS app, Fastlane, and release config
|-- openclaw-plugin/          # Publishable OpenClaw plugin package
|-- packages/forge-memory/    # `npx forge-memory` installer and runtime manager
|-- plugins/forge-codex/      # Codex MCP adapter package and launch scripts
|-- plugins/forge-hermes/     # Hermes Python plugin package
|-- public/                   # Static web icons and other Vite/Fastify assets
|-- scripts/                  # Grouped repo-level operational tooling
|-- server/                   # Fastify API, OpenAPI contract, SQLite migrations, services
|-- skills/forge-openclaw/    # Canonical Forge OpenClaw skill source
|-- src/                      # React app, feature modules, API clients, and OpenClaw bridge
|-- src-tauri/                # Tauri desktop shell wrapper
|-- test-fixtures/            # Shared fixture data for focused tests
|-- tools/atlas-cropper/      # Local visual asset tooling
|-- AGENTS.md                 # Forge-specific agent and verification rules
|-- CHANGELOG.md              # Release history
|-- LICENSE                   # Apache-2.0 license
|-- README.md                 # User and contributor entrypoint
|-- eslint.config.js          # ESLint configuration
|-- index.html                # Vite app shell
|-- package.json              # Root Node scripts and dependency contract
|-- openclaw.plugin.json      # Source OpenClaw native plugin manifest
|-- playwright.config.ts      # Browser E2E configuration
|-- prettier.config.cjs       # Prettier configuration
|-- tsconfig*.json            # TypeScript project references and base config
|-- vite.config.ts            # Web build and development server configuration
`-- vitest.setup.ts           # Shared Vitest browser/test setup
```

## Intentional Package Boundaries

- `server/` and `src/` are the canonical app runtime. The backend owns the API,
  OpenAPI, SQLite migrations, agent onboarding payloads, entity catalog, and
  specialized route families. The frontend owns the browser experience and local
  OpenClaw bridge code under `src/openclaw/`.
- `.agents/plugins/marketplace.json` is repo-scoped local plugin marketplace
  metadata for the Forge Codex adapter. Keep it small and declarative; do not
  put runtime data, generated packages, or host cache files under `.agents/`.
- `.vision/` keeps the binding project direction. `goal_alignment.md`,
  `product_requirements_document.md`, and `product_vision.md` are source-owned;
  `knowledge_graph_template/` is source-owned design reference material for the
  graph direction.
- `.githooks/` contains optional local Git hook templates. The enforced release
  and nested-repo checks still live in scripts and package commands so CI and
  non-hooked machines can run the same checks.
- `skills/forge-openclaw/` is the canonical source for the Forge OpenClaw skill.
  `openclaw-plugin/skills/forge-openclaw/` is the bundled package copy created by
  `npm run build:openclaw-plugin`.
- `openclaw.plugin.json` at the repo root is the source native plugin manifest.
  `openclaw-plugin/openclaw.plugin.json` is the publishable package manifest.
- `openclaw-plugin/` is a release package, not the main app source. It bundles
  runtime code, plugin docs, scripts, and copied skill material for OpenClaw.
- `plugins/forge-codex/` and `plugins/forge-hermes/` are adapter packages. They
  must keep their package metadata and launch scripts colocated because external
  hosts load them directly.
- `packages/forge-memory/` is the npm installer/runtime manager. It is the user
  entrypoint for normal installs and should remain separate from adapter package
  internals.
- `public/` is the canonical home for web app icons and other static browser
  assets. `index.html` must reference those files as root-absolute public URLs
  so Vite can prefix the configured `/forge/` base for both builds and local dev.
- `plugins/forge-codex/runtime/` is the repo-local Codex runtime package. Its
  `dist/` subtree is intentionally tracked generated output for local Codex
  plugin installs; see `plugins/forge-codex/runtime/README.md` before editing or
  rebuilding it.
- `ios-companion/` is a governed project subtree with its own `AGENTS.md`,
  `.vision/`, Fastlane release files, and the canonical
  `ForgeCompanion.xcodeproj`. Do not create nested replacement Xcode projects.
- `companion-iroh/` is Rust source used by both the desktop host and the iOS
  static library bridge. Its `target/` directory is generated output.

## Script Taxonomy

Repo-level scripts are grouped by operating surface so a new contributor can
find the right entrypoint without scanning a flat toolbox:

- `scripts/assets/`: app icons, gamification sprite generation, atlas cropper,
  and generated-asset validation.
- `scripts/ci/`: CI setup helpers such as Safe Chain installation.
- `scripts/database/`: local database repair, SQLite merge, and wiki migration tools.
- `scripts/dev/`: local runtime wrappers and the standalone Forge doctor.
- `scripts/docs/`: OpenAPI export and public docs screenshot/media generation.
- `scripts/release/`: guarded OpenClaw, Hermes, and iOS release-safety helpers.
- `scripts/smoke/`: package/runtime smoke tests that exercise published or
  packed artifacts.

## Release-Sensitive Paths

These paths are hardcoded or path-filtered by current release automation and
must be updated together if they move:

- `.github/workflows/github-pages.yml` publishes `openclaw-plugin/docs/` and
  runs `scripts/docs/export-openapi-docs.ts`.
- `.github/workflows/openclaw-plugin.yml` watches `openclaw-plugin/`,
  `src/openclaw/`, `server/src/app.ts`, `server/src/openapi.ts`, and
  `companion-iroh/`.
- `.github/workflows/release-openclaw-plugin.yml` calls
  `scripts/release/release-forge-openclaw-plugin.sh`.
- `.github/workflows/release-hermes-plugin.yml` calls
  `scripts/release/release-forge-hermes-plugin.sh`.
- `.github/workflows/release-forge-memory.yml` publishes
  `packages/forge-memory/`.
- `.github/workflows/release-ios-companion.yml` uses
  `ios-companion/release/release.yml` plus scripts under `ios-companion/scripts/`.
- `package.json` maps public npm commands to the grouped script families; use
  the npm aliases for normal use and the family paths for direct debugging.
- `scripts/release/release-forge-openclaw-plugin.sh` coordinates versions across
  `openclaw-plugin/`, `plugins/forge-codex/`, `plugins/forge-hermes/`, and
  `packages/forge-memory/`.
- `scripts/release/release-forge-hermes-plugin.sh` builds the Hermes Python package and
  verifies the shared OpenClaw route contract before release.
- `ios-companion/scripts/publish-forge-companion.sh` and
  `ios-companion/scripts/write-release-env.sh` own native companion release prep.

## Generated And Local-Only Paths

The following directories and files are local runtime output and must not be
tracked or referenced as source:

- `.DS_Store`, `.codex-runs/`, literal `$CODEX_HOME/`, and root-level temporary
  screenshots or probes such as `.tmp-*.png`, `forge-companion-post-fix*.png`,
  and `tmp-width-probe.cjs`
- `node_modules/`, root `dist/`, `coverage/`, `tmp/`, `test-results/`
- `data/` and `server/*.sqlite*`
- `companion-iroh/target/`
- `ios-companion/ForgeCompanion/build/`
- `ios-companion/.artifacts/`, `ios-companion/.bundle/`,
  `ios-companion/vendor/`
- `openclaw-plugin/data/`, generated OpenClaw package tarballs, and generated
  gamification raster archives
- `openclaw-plugin/node_modules/`
- `plugins/forge-hermes/.venv/`, `.pytest_cache/`, `__pycache__/`, `build/`,
  `dist/`, `python-dist/`, and `*.egg-info/`
- stale editor or ad hoc backup files such as `*.bak-*`

The exception is `plugins/forge-codex/runtime/dist/`: that bundle is deliberately
tracked for repo-local Codex plugin installs and is documented above as a package
boundary.

If a generated path appears in `git ls-files`, remove it from the index while
leaving the local file intact:

```bash
git rm -r --cached <generated-path>
```

For local cleanup of ignored residue that is not needed for the active runtime,
prefer targeted removal over broad resets. Keep `node_modules/`, `data/`, and
active package `dist/` directories when they are being used for development or a
linked plugin runtime.

## Cleanup Direction

The target structure is source-first: keep canonical source, generated package
copies, runtime data, and local build output in separate places. Future folder
moves should start with the release-sensitive paths above, update scripts and
workflows in the same change, then run the Forge mandatory checks from
`AGENTS.md` before committing.
