# Changelog

## Since 0.2.34

This changelog covers the Forge OpenClaw, Hermes, and Codex agent surfaces from
`v0.2.34` through the `0.2.59` release line.

### 0.2.59

- Repaired the gamification XP/trophy asset packaging for normal OpenClaw and Hermes installs.
- Replaced expanded packaged sprite directories with one validated `sprites.zip` runtime bundle containing only catalog-referenced 256/512 WEBP item and mascot sprites.
- Added backend first-run materialization of the sprite bundle into the Forge runtime data root and served gamification sprite URLs from that extracted cache.
- Anchored the packaged OpenClaw server entrypoint to its installed package root so normal `node_modules` installs resolve bundled `dist` assets correctly.

### 0.2.58

- Added dedicated agent route tools for Movement, Life Force, and Workbench so OpenClaw, Hermes, and Codex can call allowed specialized Forge routes without falling back to generic batch CRUD.
- Added tool-contract and Hermes coverage for specialized route path rendering, write classification, encoded path parameters, query arrays, and DELETE handling.
- Updated OpenClaw, Hermes, and Codex skill/playbook guidance so agents ask tighter follow-up questions and choose specialized surfaces only after the conversation narrows to those domains.
- Shipped the Forge gamification plugin update and aligned OpenClaw/Codex release metadata for `0.2.58`.

### 0.2.57

- Released aligned OpenClaw and Hermes packages after fixing release prep checks and OpenClaw version bump behavior.
- Improved Forge entity question flows for agent conversations.

### 0.2.56

- Compact operator-overview calendar context for agent-facing summaries.

### 0.2.53 - 0.2.54

- Fixed graph behavior so wiki pages appear in the knowledge graph.
- Cleaned knowledge graph lint issues.
- Made npm publish verification tolerate registry propagation delay.

### 0.2.50 - 0.2.52

- Moved Forge wiki content to SQLite-backed storage and protected the plugin wiki upgrade migration.
- Protected legacy wiki imports and shared memory access.
- Hardened iOS CI signing setup used by the broader Forge release pipeline.

### 0.2.48 - 0.2.49

- Tightened stable agent identity modeling for OpenClaw, Hermes, and Codex runtime sessions.
- Documented the Forge agent identity model.
- Normalized workout provider metadata across Swift ingestion, Fastify normalization, and React/API read models.
- Hardened OpenClaw plugin audit checks.

### 0.2.45 - 0.2.47

- Added agent bootstrap policy controls, scoped bootstrap/read controls, and OpenClaw bootstrap opt-out configuration.
- Refined specialized-surface onboarding guidance.
- Aligned OpenClaw and Hermes habit guidance and habit logging behavior.
- Documented the current local OpenClaw plugin install bypass.

### 0.2.42 - 0.2.44

- Hardened Forge task runtime behavior, task controls, and agent feedback.
- Pinned an audit-safe `ftp` dependency for plugin release checks.
- Shipped sleep timeline and stay-labeling backend support used by the iOS companion release line.

### 0.2.38 - 0.2.41

- Added live multi-adapter agent session runtime support and fixed local agent identity/session registration.
- Expanded Forge runtime and live task controls.
- Fixed OpenClaw Forge CLI registration.
- Kept Hermes cached Forge context across session turns.
- Aligned Codex MCP adapter behavior with current docs.
- Rewrote public docs, added Codex GitHub Pages install guidance, added a screenshot lightbox, and improved docs responsiveness.

### 0.2.35 - 0.2.37

- Added sleep data to the operator overview.
- Modernized Hermes skill registration.
- Improved agent onboarding and Hermes startup context.
- Raised the OpenClaw release audit floor.
- Kept OpenClaw and Hermes patch versions aligned for release governance.
