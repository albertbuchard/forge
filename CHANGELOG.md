# Changelog

## 0.3.81

- Fixed the Companion sync failure that could leave HealthKit data stale for
  days after Forge reported `database table is locked`. Finalization now
  retries transient SQLite contention, keeps the upload session and every
  accepted chunk available when Forge is still busy, and stores one immutable
  completion receipt so a lost response can be retried without importing the
  data twice.
- Added a negotiated, replay-protected background-request proof with a maximum
  24-hour lifetime. iOS background uploads no longer fail merely because the
  system delivered them more than two minutes after they were queued; current
  foreground and older Companion requests remain compatible with the existing
  short-lived proof.
- Made system-cancelled HealthKit transfers converge on Forge's durable chunk
  records while preserving deliberate whole-sync cancellation. Incomplete
  expected counts remain resumable instead of permanently failing the session,
  and upload, completion, status, and abort operations are bound to the exact
  paired device.

## 0.3.80

- Made Forge Memory replace obsolete Forge OpenClaw development load paths
  when the authoritative source checkout changes. Configuration now identifies
  paths by the exact Forge plugin manifest, removes only older paths for that
  plugin ID, preserves unrelated OpenClaw plugins, and leaves exactly one
  canonical Forge path. An older release clone can no longer shadow the current
  plugin after Forge itself has moved back to the canonical repository.

## 0.3.79

- Corrected the public master-password OpenAPI contract to match the shipped
  policy. Forge accepts any matching 15-to-128-character value, password
  strength remains advisory, and no hidden composition or predictability rule
  can be inferred from the generated API documentation.

## 0.3.78

- Fixed the development client WebSocket address when Forge is served through
  default-port HTTPS. The HMR client now omits an empty port separator, so a
  Tailscale page resolves `/forge/__vite_hmr` on its own origin while direct
  local development continues to retain explicit ports such as `:3027`.
- Added bounded retention for expired browser-session credentials. One-use
  local-service sessions remain available for 24 hours, paired and operator
  browser sessions remain available for 30 days after retirement, active
  sessions are never selected, and each maintenance pass removes at most
  25,000 rows. The separate security audit log and durable trusted-device,
  refresh, client, passkey, and master-password records are unchanged.

## 0.3.77

- Made large Companion HealthKit transfers tolerant of normal network delay
  without leaving ordinary Forge requests unbounded. The chunk route now uses
  a 30-second inactivity deadline and a 150-second hard limit, while all other
  request bodies retain the existing 15-second absolute deadline.
- Made interrupted HealthKit uploads converge on the server's accepted chunk
  records. Duplicate and concurrent deliveries now repair session progress
  from durable rows, and the iPhone performs one bounded status refresh before
  replaying only missing, byte-identical chunks after an ambiguous network
  failure.
- Reduced direct iPhone upload pressure from 12 simultaneous requests to 3,
  kept background transfers serial even when the app becomes active, and gave
  direct chunks the full 120-second request budget. Intentional background
  cancellation and successful abort responses no longer produce misleading
  waiter or response-decoding failures.
- Made the embedded Forge view wait for a committed React render instead of
  treating HTML navigation as application readiness. A stalled start receives
  one cache-bypassing recovery load and then shows a clear native error instead
  of remaining indefinitely on “Forge is starting” or an empty page.

## 0.3.76

- Fixed Forge pages that could remain on “Forge is starting” after a fresh web
  build. When the active preview and the local fallback contain different
  hashed JavaScript or CSS files, Forge now serves the exact asset referenced
  by the active page instead of returning a stale-build 404. HTML fallbacks
  are still rejected for hashed assets, so a missing file remains a clear,
  non-cacheable error rather than executable HTML with the wrong content type.

## 0.3.75

- Replaced the clipped phone tab rails in Work, Job searches, Documents, and
  record details with one large current-section control that opens a labelled
  bottom-sheet menu. Every destination remains available without requiring
  horizontal scrolling or squeezing desktop navigation into a phone viewport;
  an open phone menu closes cleanly if the viewport crosses into desktop
  navigation.
- Prevented Work page grids and their children from retaining desktop minimum
  widths on compact screens. Summary cards, filters, engagement lists,
  application workspaces, and detail sections now stay inside the visible phone
  width while desktop and tablet layouts retain their existing structure.
- Kept Current work focused on active arrangements and the organizations that
  are actually connected to them. Unrelated job-search targets no longer appear
  in that view merely because they exist elsewhere in Work.

## 0.3.74

- Reworked Work and Job searches around focused, human-readable views. The
  seven Work sections now adapt across phone, tablet, and desktop; Job searches
  separates searches, roles, targets and outreach, and activity; Documents
  separates positioning, files, and saved answers; and application pipelines
  show one selected stage on smaller screens instead of squeezing a desktop
  board into the viewport.
- Split Work record details into clear sections, moved exact identifiers under
  Technical details, removed machine-like fallback names, hid empty connection
  groups, and added the shared smart multi-search with visible record types for
  adding relationships. Supporting data now loads only for the visible view or
  opened action, so hidden failures cannot blank an unrelated Work screen.
- Kept opportunity and application detail actions attached to the exact record
  being viewed, even when that record falls outside a bounded overview page.
  Starting an application now includes the current opportunity, and an
  application workspace loads its linked opportunity and primary campaign
  directly instead of showing incomplete context.
- Finished the Work mobile accessibility repair. Work buttons and selectors now
  meet the 44-pixel touch target, campaign criteria are keyboard-focusable and
  labelled, and the summary strip uses valid definition-list semantics.
- Made prepare-only OpenClaw and Hermes releases genuinely local. Prepare mode
  now creates the reviewed commit and tag without pushing either one, so a
  canonical migration, import readback, rollback preview, and outgoing privacy
  gate can run against one immutable candidate before publication.

## 0.3.73

- Made **Use this browser session only** a definitive consent boundary. It now
  invalidates a device-trust attempt even while the registration-begin request
  is still pending, so a delayed response cannot open or complete a passkey
  ceremony after the user declined durable device trust or left the view.
- Made the packaged OpenClaw runtime identify itself from its own installed
  package manifest. An OpenClaw-started Forge server can now be verified and
  adopted by `npx forge-memory ui` after recovery instead of being rejected as
  a healthy runtime with an unknown package version. Source and development
  launches explicitly do not claim a packaged identity.
- Made the packaged server launcher derive from one checked-in source instead
  of an embedded build-script copy, preventing a build from silently replacing
  the runtime-identity repair with stale code. Failed release cleanup now
  restores only tracked paths, so an optional absent build path cannot block
  recovery of an already committed source file.

## 0.3.72

- Kept an approved remote browser usable while optional device-passkey setup is
  waiting. The browser-session fallback remains available immediately, and a
  stalled passkey ceremony now stops after a bounded fifteen-second attempt
  instead of trapping the user on the pairing screen.
- Added ordinary Work read/write authority to trusted-personal-assistant browser
  pairing. Existing paired browsers with the established generic read/write
  grant inherit only `work.read` and `work.write` without re-pairing; sensitive
  compensation and external-transmission scopes remain excluded.
- Gave the canonical fast publication gate enough time to finish its existing
  typecheck, lint, build, focused-test, plugin, and release-audit work instead
  of cancelling healthy releases at the former ten-minute boundary.
- Kept Forge Memory update backups bounded to live Forge data. Safety exports
  now omit existing `backups/`, `release-snapshots/`, and top-level SQLite
  `.bak`, `.bak-shm`, and `.bak-wal` files instead of recursively backing up
  redundant historical copies. The live database, security store, browser
  credentials, artifacts, and user data remain in the update backup.

## 0.3.71

- Fixed the global Forge context and activity calendar so Work activity from
  applications, engagements, campaigns, opportunities, check-ins, offers,
  interviews, outreach, and candidate documents remains readable after real
  Work data is created or imported. OpenAPI now derives its activity entity
  values from the same typed contract, and supporting candidate records use
  their canonical entity names instead of internal camelCase names.

## 0.3.70

- Added a permanent Work area for concurrent employment, appointments,
  contracts, freelance engagements, shifts, advisory work, and planned or past
  roles. Work Engagements preserve dates, notice and availability, schedule,
  compensation privacy, responsibilities, people, objectives, documents,
  provenance, links, and reversible lifecycle history.
- Added user-confirmed Work check-ins with versioned built-in and custom metric
  definitions, consistent response scales, contextual observations, trends,
  meaningful changes, and safeguards that prevent an agent suggestion from
  becoming a user-reported value.
- Added concurrent Opportunity Campaigns with versioned structured criteria,
  role and organization targets, saved searches, automation policies, sourced
  and deduplicated opportunities, campaign-specific evaluation history, and
  non-destructive “Looking for opportunities” state.
- Added guarded application workspaces, immutable stage events, exact document
  and answer use, interviews, offers, outreach, search-run evidence, duplicate
  protection, and accepted-offer conversion into one planned Work Engagement.
- Added exact external-transmission previews, central approval, sender binding,
  direct completion evidence, private-data redaction, and a dry-run/apply/
  rollback import path that never embeds personal data or invents subjective
  Work metrics.
- Added the complete typed Work HTTP/OpenAPI surface and the bounded
  `forge_call_work_route` contract across OpenClaw, Codex, and Hermes, including
  compound campaign context and explicit compensation and transmission scopes.
- Added the responsive Work experience with Overview, Current work, Check-ins,
  Goals and plans, Job searches, Applications, and Documents sections, plus
  list and board pipelines, global search, deep links, truthful empty and error
  states, and keyboard- and touch-operable dialogs.

## 0.3.66

- Made remote-browser authorization device-first: Forge now attempts silent
  renewal from the HttpOnly refresh cookie even when disposable browser storage
  was cleared, then automatically offers the discoverable device passkey before
  creating another pairing request.
- Changed the successful browser-pairing path to request one user-verified
  device passkey immediately. Compatible browsers using the same credential
  provider and exact Forge HTTPS relying party can restore the same client,
  profile, and scopes without another owner pairing approval. Declining or
  lacking WebAuthn keeps the newly paired browser session usable.
- Made `npx forge-memory ui` automatically attempt the existing verified,
  rollback-protected OpenClaw-to-Forge runtime ownership transfer when the live
  API lacks the current local-browser handler. Stale metadata from an adopted
  runtime no longer traps the CLI in a peer-setting mismatch loop, while a
  managed runtime with real configuration drift still fails closed.
- Made long-running `forge-memory mcp` clients inherit the same verified browser
  handler boundary. MCP startup now repairs a healthy runtime that cannot serve
  local browser authorization instead of accepting it and repeatedly returning
  `503 local_browser_owner_handler_unavailable`. Protected handoff verification
  now calls the authenticated API directly, so it cannot recursively enter the
  runtime bootstrap while already holding the startup lease.

## 0.3.64

- Declared the pinned `music-metadata@11.14.0` parser in the published
  OpenClaw runtime so an isolated install can start Agent Messages media
  verification instead of exiting on a missing production dependency.
- Added packed-runtime dependency regression coverage, regenerated the Hermes
  runtime metadata with the same parser dependency, and aligned the replacement
  Forge, OpenClaw, Codex, Hermes, Forge Memory, and iOS release versions.

## 0.3.63

- Added Agent Messages, a responsive asynchronous inbox/outbox for text, an
  original voice Artifact, or both, with default or selected connected-agent
  routing and complete detail history.
- Added atomic claim leases, generation fencing, exact idempotency receipts,
  progress, acknowledgement, reassignment with lease revocation, forwarding,
  handling, failure, retry children, actor-bound terminal receipts, complete
  forwarded/retry chains, and restart-safe retention cleanup. Box-specific
  keyset cursors retain immutable delivery order in Outbox and promote the
  newest unread eligible agent activity in Inbox through a stable traversal
  horizon.
- Added strict 25 MiB/600-second container-and-codec verification and a
  lease-bound sensitive media route without weakening Forge's human-only
  generic Artifact downloads.
- Added scoped OpenClaw and Codex Agent Messages tools, native MCP audio-block
  preservation for supported Codex runtimes, and a truthful text-only Hermes
  capability surface.
- Added the native SwiftUI Agent Messages mailbox and composer with immediate
  recording, AES-GCM encrypted offline queueing, stable retry identities,
  cursor paging, cellular policy, generic notification content, and truthful
  iOS background-processing states. Browser sends preserve retry identities
  through ambiguous responses but deliberately do not claim durable offline
  queueing across a page reload.

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
