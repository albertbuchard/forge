# Forge watchOS Companion Command Surface Goal

## Copy/Paste Goal Prompt

```text
/goal The code architecture of the Forge watchOS companion is untenable. Audit, redesign, implement, test, commit, push, and release the watchOS companion architecture described in projects/forge/docs/watchos-companion-command-surface-goal.md. The current app is reportedly stuck on a single Command Center page and the user cannot do anything useful; treat that as a blocking UX failure. Build a clean, clear, wrist-first watchOS app where the Digital Crown moves vertically between main Forge entity/surface types, left/right swipes move horizontally through entity units/cards inside the selected surface, and tapping a card opens a small fast logging/action modal. Every main surface must give the user a fast way to log or act: Work/Kanban, Habits, Goals/Projects, Today, Health, Movement, Psyche, Inbox, Sync, and Now. The watch should automatically ask the iPhone to relay/sync queued data whenever possible, while preserving explicit retry/force-sync controls in the Sync surface. Keep the watch phone-relay-first through WatchConnectivity; the iPhone owns pairing credentials, retry queues, backend calls, snapshot publishing, and automatic sync. Read the existing docs and discussion captured in this file before implementation. Audit the current Watch, iPhone bridge, Fastify, migration, test, and Xcode-project code before editing; fix architectural issues instead of piling more code into one giant ContentView. Update Forge and iOS companion vision docs so watchOS is explicitly a wrist-first command/logging surface backed by compact snapshots and idempotent command batches. Use existing Forge task-run and task status semantics for start/stop/focus/complete/pause/move work actions; do not create a second task system. Test server contracts, migration behavior, watch navigation, command encoding, queue/ack retry behavior, automatic iPhone relay/sync, iOS build, Watch app build, TypeScript checks, relevant Forge server tests, release validation, and actual TestFlight upload. If backend, onboarding, OpenClaw/Hermes/Codex plugin contracts, bundled skills, or package artifacts changed, rebuild and release the affected plugin versions using projects/forge/docs/release-cheat-sheet.md and projects/forge/docs/openclaw-plugin-release-checklist.md instead of inventing a release flow. Audit thoroughly that no Forge data was deleted except clear duplicates if any are proven and backed up, and verify stable identification/idempotency prevents duplicate workout, metric, watch action, habit, task-run, and capture-event uploads. Stay on main, do not run XcodeGen, use the live Xcode project at projects/forge/ios-companion/ForgeCompanion.xcodeproj, commit only intended files, push main, and do not mark the goal complete until TestFlight and required plugin releases have succeeded or are explicitly proven unnecessary.
```

## Summary

Forge’s watchOS app must stop being a fragile capture satellite or a single decorative command page. The latest reported failure is that the app is stuck on one Command Center page and exposes no useful action path. That is a blocking product failure, not a cosmetic issue. The watch should become a dense, fast command and logging surface for key Forge functionality while remaining subordinate to the iPhone bridge and canonical Forge backend.

The target interaction grammar is:

- Digital Crown moves vertically through Forge surfaces/entities.
- Left/right paging moves through the selected surface’s cards or subcomponents.
- Tap opens the selected card’s action modal.
- Every surface uses the same navigation shell and command queue.
- The iPhone relays all network work to Forge; the watch does not own API credentials or direct network sync.
- The watch automatically asks the iPhone to flush queued actions and refresh the snapshot whenever the phone is reachable.

The implementation must be architecture-first. Do not bolt more views onto a broken carousel or a single huge `ContentView.swift`. Replace or extract the current shell into a shared navigation model, shared snapshot contract, shared command envelope, reusable card/action primitives, and backend endpoints that wrap existing Forge domain functions.

The goal is end-to-end, not a code-only spike. The run must audit the existing code, implement the watch command surface, test it, validate the release package, commit the intended changes on `main`, push `main`, and ship the new iOS companion build to TestFlight. If the implementation changes plugin-facing contracts, bundled skills, onboarding payloads, OpenClaw route mirrors, Hermes tools, or Codex adapter surfaces, the affected plugin packages must be rebuilt, verified, and released through the documented Forge release flow.

## Goal Runner Contract

This is the file to use as the source of truth for a new `/goal` run. The runner must not treat the watch as a decorative widget, a four-tab capture app, or a second Forge data model. The watch is a wrist-first command surface backed by compact backend snapshots and idempotent command batches. The core grammar is fixed: the Digital Crown chooses the active Forge surface vertically, left/right paging chooses the selected card or entity inside that surface, and tapping opens a compact modal with the actions available for that card.

The implementation must cover the full surface list in this document: Now, Work/Kanban, Habits, Goals/Projects, Today, Health, Movement, Psyche, Inbox, and Sync. Each surface should be information-rich enough to make decisions from the wrist without forcing the user into the phone for basic control. Deep editing, long reading, graph exploration, wiki authoring, planning documents, and complex forms stay in the web app or iPhone companion.

The release obligation is also fixed. The run is not complete at “it builds locally.” It must verify the backend, iPhone bridge, Watch app, release metadata, archive/IPA contents, local Forge runtime health, and the documented TestFlight upload path. Plugin releases are required only when plugin-facing contracts, bundled skills, onboarding payloads, OpenClaw route mirrors, Hermes tools, Codex adapter behavior, or package metadata changed; when they are not required, the run must state why.

## Implementation Plan For The Goal Run

### Phase 0 — Protect The Workspace

- Verify the active branch is `main` before edits, commits, tags, or release commands.
- Read the root, Forge, and iOS companion `AGENTS.md` files plus `ios-companion/CRITICAL_XCODE_PROJECT_RULES.md`.
- Inspect `git status --short` and separate pre-existing dirty files from files the run intentionally changes.
- Do not revert user or generated work unrelated to this watchOS goal.
- Do not run XcodeGen. Use the live project at `ios-companion/ForgeCompanion.xcodeproj`.

### Phase 1 — Reproduce And Audit The Stuck Watch UI

- Reproduce or explain the reported stuck-on-Command-Center failure by inspecting navigation state, crown binding, focus ownership, surface count, card count, launch destination, cached bootstrap, and WatchConnectivity bootstrap flow.
- Review all watch files under `ForgeWatch Watch App/`, shared watch models, `WatchSessionManager.swift`, `ForgeSyncClient.swift`, `server/src/watch-mobile.ts`, and watch-related migrations.
- Compare current dirty work against git history so the run knows what is partial, what is stale, and what accidentally regressed.
- Produce a short audit note before major edits, naming exactly why the current app is stuck or non-actionable.

### Phase 2 — Rebuild The Watch Architecture Around Navigation And Logging

- Keep the root grammar fixed: Digital Crown changes surface, horizontal swipe changes entity/card inside that surface, tap opens a compact modal.
- Do not leave the watch trapped on one Command Center card. The UI must expose the current surface title/index and a reliable movement path to other surfaces even with a sparse snapshot.
- Split monolithic surface code out of `ContentView.swift` when it blocks testability or clarity.
- Keep `WatchAppModel` responsible for snapshot, queue, WatchConnectivity activation, launch destination, automatic relay requests, and command submission.
- Keep `WatchNavigationModel` responsible only for selected surface, per-surface card index, crown detents, and index clamping.
- Keep surface views as pure renderers of snapshot data plus command callbacks.

### Phase 3 — Make Every Surface Useful For Fast Logging

- Now: current run, next task, due habits, pending prompts, snapshot age, queue state, mark moment, force sync.
- Work/Kanban: active run, focus, in-progress, blocked, backlog/next, recently done; start/focus/heartbeat/complete/release/move/log blocker.
- Habits: one card per active habit, polarity-aware labels, streak/cadence/history, positive and negative action modals.
- Goals/Projects: active goals/projects, linked open work counts, next task, capture note, open on phone.
- Today: agenda/timebox when available, due work, recent completions, checkpoint, mark moment.
- Health: sleep/recovery, last workout, hard-minutes/training-load signal, vitals, log RPE/mood/recovery note when supported.
- Movement: latest stay/trip/place, unlabeled counts, place/trip labeling, social/context note.
- Psyche: emotion, trigger, routine, urge/resisted/indulged, short self-observation.
- Inbox: one card per pending prompt, choices, skip/defer, open on phone.
- Sync: iPhone link, backend readiness, last snapshot, queue count, last error, force refresh, retry queue.
- Every surface must have at least one useful fallback action when its full snapshot is empty.

### Phase 4 — Finish Phone Relay, Automatic Sync, And Idempotency

- Keep the iPhone as the only holder of pairing token, API base URL, Iroh/manual transport state, and backend retry policy.
- Automatically flush queued watch actions and request/publish a fresh snapshot when the watch app launches, the phone becomes reachable, a command is queued, an ack arrives, or the user taps force sync.
- Remove queued watch commands only after matching backend receipts.
- Replay successful commands without duplicating task runs, habit check-ins, status updates, capture events, workouts, or metrics.
- Store permanent validation failures so the watch/iPhone queue can stop retrying impossible commands.
- Leave retryable transport/backend failures queued.
- Verify every capture event in a batch carries its own dedupe key.

### Phase 5 — Update Vision, Docs, Tests, And Release

- Update Forge and iOS companion `.vision` files so watchOS is a wrist-first command/logging surface using Swift 5, SwiftUI, WatchConnectivity, WidgetKit/App Intents, Fastify, SQLite, and the React/TypeScript Forge runtime.
- Run focused backend tests for watch bootstrap, actions, idempotency, task-run actions, capture dedupe, habit polarity, and capability gates.
- Run Swift tests for navigation, command encoding, queue/ack behavior, model decoding, and habit labels.
- Build the iOS app and Watch app with the live Xcode project.
- Run required TypeScript/server checks and local Forge runtime health verification.
- Inspect Tailscale Serve/Funnel status only; do not mutate network exposure unless explicitly approved.
- Run iOS release validation, inspect archive/IPA metadata for iPhone app, Watch app, Watch extension, and screen-time extension version/build alignment, then upload TestFlight.
- Release plugin/package versions only when plugin-facing contracts or bundled artifacts changed; otherwise report why no plugin release is necessary.
- Audit and state that no Forge data was deleted, unless clear duplicates were proven, backed up, and intentionally removed.

## Current Code Findings

The watch app lives under:

```text
projects/forge/ios-companion/ForgeCompanion/ForgeWatch Watch App/
```

Important existing files:

- `ContentView.swift` already contains a partial crown-first shell with `WatchNavigationModel`, `WatchSurfacePager`, and reusable command modals.
- `WatchShared/WatchSharedModels.swift` defines `WatchSurface`, `ForgeWatchBootstrap`, work snapshots, health snapshots, movement snapshots, sync snapshots, and `ForgeWatchActionKind`.
- `WatchAppModel.swift` stores the snapshot, queues habit check-ins, capture events, and generic commands, then sends outbound envelopes through WatchConnectivity.
- `WatchSessionManager.swift` on iPhone fetches `/mobile/watch/bootstrap`, publishes the snapshot, receives watch envelopes, calls Forge, and acks back to the watch.
- `ForgeSyncClient.swift` has watch bootstrap, habit check-in, capture batch, and action batch client methods.
- `server/src/watch-mobile.ts` contains the v2 command kind schema, snapshot construction, command processing, and action receipt lookup/storage.
- `server/migrations/066_watch_action_receipts.sql` exists for command idempotency.

Current backend watch routes:

- `POST /api/v1/mobile/watch/bootstrap`
- `POST /api/v1/mobile/watch/habits/:id/check-ins`
- `POST /api/v1/mobile/watch/capture-events:batch`
- `POST /api/v1/mobile/watch/actions:batch`

Key problems to audit and fix:

- The reported user experience is still stuck on one Command Center page, despite the partial crown-first shell in source.
- The root shell, internal card pagers, crown focus, and sparse snapshot behavior may be fighting each other.
- `ContentView.swift` is too large and is carrying shell, navigation, modal, card, and surface responsibilities together.
- The iPhone bridge must prove that outgoing watch commands are removed only after a matching backend ack, and that stale/replayed acks cannot drop newer queued work.
- Shared Swift models must be actually target-shared through the live Xcode project, not manually copied into divergent files.
- Every surface needs a fast logging/action fallback when the full backend snapshot is empty.
- Automatic iPhone relay/sync must be reliable after launch, reachability changes, queued commands, ack receipt, and explicit force sync.
- The iOS simulator/local pairing capabilities omit `watch-ready`, which can block watch bootstrap even though the backend default supports it.
- `submitWatchCaptureBatch` currently maps every event in a batch to the same `dedupeKey` when called with more than one event. That can cause events inside a batch to dedupe each other.
- The iOS companion `.vision` still says the watch remains a lightweight capture satellite, which is now outdated.

## Product Direction

The watchOS companion should let the user control most key Forge functions that make sense on a wrist:

- start, focus, pause, complete, and move work items from the Kanban/work system
- inspect current work, active runs, and next tasks
- check off habits, with positive and negative habit language handled correctly
- answer prompts and label movement context
- mark moments and log short state/emotion/trigger signals
- inspect compact health/training/readiness context
- see sync state and retry status

It should not try to become the full Forge web app. Deep editing, long reading, graph exploration, wiki editing, planning documents, and complex forms remain phone/web tasks. The watch can offer “open on phone” or “capture note” actions for those cases.

## Watch Interaction Contract

Use Apple’s watchOS conventions directly:

- Use the Digital Crown for primary vertical navigation between surfaces.
- Use horizontal page gestures for cards inside a surface.
- Back up Crown navigation with touch affordances where reasonable.
- Do not rely on Digital Crown press; watchOS reserves Crown press for system behavior.
- Use compact haptics on surface changes, successful commands, queued offline commands, and command failures.
- Keep every card information-rich but readable at watch size.
- Avoid nested list-heavy screens. Prefer dense cards, chips, rings, sparklines, and two-button action modals.

Implementation shape:

- Keep or extract the current crown-first root into `ForgeWatchShell`; do not regress to a root carousel or a single stuck Command Center page.
- Add `WatchNavigationModel` with:
  - selected surface index
  - per-surface selected card index
  - crown detent binding
  - card count clamping after snapshot updates
  - launch destination handling
- Use `.digitalCrownRotation` for discrete surface selection.
- Use one horizontal card deck per surface, and verify whether `.page` or `.carousel` gives the better watchOS behavior without stealing crown focus.
- Use a reusable `WatchActionSheet` / `WatchCommandModal` for tap actions.

## Watch Surfaces

### Now

Purpose: the default operating overview.

Cards:

- Current work card: active/current task run, elapsed time, lease state, project, status.
- Next action card: best next task from focus/in-progress/backlog.
- Day card: next event/timebox, due count, AP/readiness summary.
- Sync card: last snapshot age, queued commands, iPhone link state.

Actions:

- start current/next task
- pause active run
- complete active run
- mark moment
- force refresh

### Work / Kanban

Purpose: wrist control for the Forge execution board.

Cards:

- Active run card
- Focus lane card
- In-progress lane card
- Blocked lane card
- Backlog/next lane card
- Recently done card

Each lane card should show compact counts and the selected task/work item. Horizontal paging moves through lane cards and task cards.

Actions:

- start task run
- focus existing active run
- heartbeat/keep alive when needed
- complete run
- release/pause run
- move task to `focus`, `in_progress`, `blocked`, or `done`
- add short note/capture blocker

Use existing Forge semantics:

- task statuses: `backlog`, `focus`, `in_progress`, `blocked`, `done`
- task-run operations: claim/start, heartbeat, focus, complete, release

Do not create watch-specific task state.

### Habits

Purpose: fast habit check-in.

Cards:

- One card per active habit.
- Each card shows title, polarity, cadence, streak, due state, current period state, and last-7 history.

Actions:

- Positive habits: `Done` and `Missed`
- Negative habits: `Resisted` and `Indulged`

Wire compatibility:

- Keep canonical backend statuses as `done` and `missed` unless a broader habit schema migration is intentionally added.
- For negative habits, `missed` means aligned/resisted under the existing backend logic.
- UI labels must never expose the confusing positive-habit wording for negative habits.

### Goals / Projects

Purpose: compact direction and context.

Cards:

- Active goals summary
- Active projects summary
- Selected goal/project with linked counts
- Highest priority linked work items

Actions:

- focus linked next task
- start linked work item
- capture goal/project note
- open on phone

### Today

Purpose: current day execution context.

Cards:

- Agenda/next event
- Timeboxes
- Due work
- Recent completions
- End-of-day checkpoint

Actions:

- start linked task
- mark linked task done
- capture note
- mark moment

### Health

Purpose: compact readiness/training/body context.

Cards:

- Sleep/recovery summary
- Last workout summary
- Training load / hard-minutes summary
- Vitals snapshot

Actions:

- log RPE
- log mood after workout
- add recovery note
- mark body state

This surface is mostly read-only. It should not mutate HealthKit data.

### Movement

Purpose: correct and annotate current movement context.

Cards:

- Current/last place
- Recent stay
- Recent trip
- Unknown place/stay/trip prompt

Actions:

- label place
- label trip
- classify unknown block
- mark moment
- capture social/context note

### Psyche

Purpose: fast emotional, trigger, routine, and urge support.

Cards:

- Emotion picker
- Trigger picker
- Routine prompt
- Negative habit/urge support
- Short self-observation note

Actions:

- log emotion
- log trigger
- resisted/indulged
- save routine answer
- dictate short note

### Inbox

Purpose: answer pending prompts.

Cards:

- One card per pending prompt.
- Show prompt title, context, age, and choices.

Actions:

- choose answer
- skip/defer
- open on phone when prompt is too large

### Sync

Purpose: trust and diagnostics.

Cards:

- Pairing/iPhone bridge status
- Last snapshot timestamp
- Queue count and last error
- Backend watch readiness/capability state

Actions:

- force refresh from iPhone
- retry queue
- open companion settings on phone when available

## Backend Contract

Keep existing routes compatible, but add a v2 contract.

Add or evolve a snapshot builder in `server/src/watch-mobile.ts`:

```text
ForgeWatchSnapshotV2
  schemaVersion
  generatedAt
  user
  sync
  surfaces
  now
  work
  habits
  goals
  today
  health
  movement
  psyche
  inbox
  settings
```

The snapshot must stay compact. It should send enough data to act from the watch, not full Forge entity payloads.

Add a command batch route:

```text
POST /api/v1/mobile/watch/actions:batch
```

Request:

```text
sessionId
pairingToken
device
commands[]
```

Each command:

```text
id
kind
createdAt
payload
```

Command kinds:

- `habit_check_in`
- `capture_event`
- `task_run_start`
- `task_run_heartbeat`
- `task_run_focus`
- `task_run_complete`
- `task_run_release`
- `task_status_update`

Response:

```text
receipt
snapshot
```

Use existing Forge repositories/services:

- `createHabitCheckIn`
- `ingestWatchCaptureBatch`
- `claimTaskRun`
- `heartbeatTaskRun`
- `focusTaskRun`
- `completeTaskRun`
- `releaseTaskRun`
- `updateTask`

Do not create a parallel watch task system.

Plugin-facing contracts must be audited after backend changes. If the new watch snapshot or action route affects OpenAPI, onboarding payloads, OpenClaw/Hermes/Codex tools, or public plugin documentation, update those surfaces in the same goal run and use the release checklist before publishing.

## Idempotency

Add a migration such as:

```text
watch_action_receipts
```

Fields:

- `id`
- `pairing_session_id`
- `user_id`
- `action_id`
- `kind`
- `received_at`
- `processed_at`
- `status`
- `result_json`
- `error_json`

Constraints:

- unique `(user_id, action_id)`

Behavior:

- Replayed successful commands return the stored result and a fresh snapshot.
- Failed commands with permanent validation errors are not retried forever.
- Transport failures remain queued on iPhone/watch until acknowledged.
- Capture events inside a batch must each retain their own dedupe key.

## iPhone Bridge

Refactor `WatchSessionManager` into a reliable command bridge:

- Load/save the latest v2 snapshot.
- Publish snapshots to the watch via `updateApplicationContext`.
- Receive command batches via `sendMessageData` when reachable.
- Receive durable command batches via `transferUserInfo` when not reachable.
- Persist incoming commands in the app group until the backend acknowledges them.
- Process commands through `ForgeSyncClient`.
- Send ack envelopes back to the watch.
- Save fresh snapshots after every successful command batch.
- Reload WidgetKit timelines after snapshot updates.

Keep the iPhone as the only component that owns:

- pairing token
- API base URL
- Iroh/manual transport details
- backend retry policy

## Watch App Architecture

Create or refactor into these components:

- `ForgeWatchShell`
- `WatchNavigationModel`
- `WatchSnapshotStore`
- `WatchCommandQueue`
- `WatchCommandModal`
- `WatchSurfaceDescriptor`
- `WatchCardDescriptor`
- `WatchCommandDescriptor`
- `WatchSurfaceHeader`
- `WatchMetricChip`
- `WatchProgressRing`
- `WatchSparkline`
- `WatchLaneCard`
- `WatchHabitCard`
- `WatchPromptCard`

State ownership:

- `WatchAppModel` owns snapshot, queue, session activation, launch destination, and command submission.
- `WatchNavigationModel` owns local UI navigation only.
- Surface views are pure SwiftUI renderers of snapshot data plus command callbacks.
- Shared models are target-shared, not manually duplicated.

Backward compatibility:

- Existing cached `ForgeWatchBootstrap` should decode into the new snapshot with only habits/check-in/prompt surfaces populated.
- Existing watch widgets should continue to show due habit count until updated to richer data.

## Xcode Project Rules

Use the live Xcode project:

```text
projects/forge/ios-companion/ForgeCompanion.xcodeproj
```

Do not run:

```text
xcodegen generate
```

If adding Swift files, update the live `.xcodeproj` carefully or place files where the existing project target membership already picks them up only if that is actually true. Verify with `xcodebuild`.

Before release, verify that the iPhone app embeds the Watch app and that the Watch app embeds the Watch extension. Inspect the generated archive and exported IPA, not only the simulator build. The release version must agree across:

- `ios-companion/release/release.yml`
- `ForgeCompanion.xcodeproj/project.pbxproj`
- iPhone app `Info.plist`
- Watch app `Info.plist`
- Watch extension `Info.plist`
- screen-time extension `Info.plist`
- archive metadata
- exported IPA metadata

## Vision And Docs Updates

Update:

- `projects/forge/.vision/goal_alignment.md`
- `projects/forge/.vision/product_requirements_document.md`
- `projects/forge/ios-companion/.vision/goal_alignment.md`
- `projects/forge/ios-companion/.vision/product_requirements_document.md`

Required content changes:

- Explicitly state watchOS is a wrist-first Forge command surface.
- Keep phone-relay-first architecture.
- State that deep editing remains in Forge web/iPhone.
- State that watch data contracts are compact snapshots plus idempotent command batches.
- Keep the production stack explicit: Swift 5, SwiftUI, WatchConnectivity, WidgetKit/App Intents, Fastify, SQLite, React/TypeScript Forge runtime.

## Test Plan

Server tests:

- Extend existing watch bootstrap tests to assert v2 snapshot shape.
- Assert habit polarity labels and canonical check-in behavior.
- Assert work surface includes active runs and lane/task cards.
- Assert task-run commands start, focus, heartbeat, complete, and release existing Forge task runs.
- Assert task status commands move tasks across `backlog`, `focus`, `in_progress`, `blocked`, and `done`.
- Assert command idempotency returns replayed receipts without duplicating task runs or capture events.
- Assert `watch-ready` is required.
- Assert capture batch events use independent dedupe keys.

Swift/watch tests:

- `WatchNavigationModel` Crown detents clamp/wrap as intended.
- Surface changes preserve per-surface horizontal card indexes.
- Horizontal card indexes clamp after snapshot refresh.
- Habit positive/negative labels map correctly.
- Command encoding includes stable action IDs and per-event IDs.
- Optimistic habit/task state updates are reversible after backend snapshot ack.
- Queue removal only happens after matching ack.
- Cached old bootstrap decodes into a compatible v2 snapshot.

Build/check commands:

```bash
cd projects/forge
npm run check
npm run test:server
```

```bash
xcodebuild -project projects/forge/ios-companion/ForgeCompanion.xcodeproj -scheme ForgeCompanion build -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO
```

```bash
xcodebuild -project projects/forge/ios-companion/ForgeCompanion.xcodeproj -scheme "ForgeWatch Watch App" build -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO
```

If frontend or plugin-facing contracts are touched, also run the relevant Forge checks:

```bash
cd projects/forge
npm run build
npm run build:openclaw-plugin
npm run check:openclaw-plugin
```

Release validation:

```bash
cd projects/forge
bash ./ios-companion/scripts/publish-forge-companion.sh validate
```

Inspect the validation archive and IPA for embedded Watch content and version/build alignment.

TestFlight release:

```bash
cd projects/forge
bash ./ios-companion/scripts/publish-forge-companion.sh testflight
```

Plugin release checks, when plugin-facing contracts changed:

```bash
cd projects/forge
npm exec -- tsc --noEmit
npm exec -- tsc -p server/tsconfig.json --noEmit
npm run build:openclaw-plugin
npm run check:openclaw-plugin
```

Use `projects/forge/docs/release-cheat-sheet.md` for the actual tag-driven plugin release path. Do not publish OpenClaw, Hermes, Forge Memory, or iOS artifacts from an improvised command path.

## Acceptance Criteria

- Opening the watch app shows the new command shell, not the old carousel.
- Turning the Digital Crown changes the selected Forge surface.
- Swiping left/right changes the card within the selected surface.
- Tapping a habit card opens the correct positive/negative habit modal.
- Tapping a work card can start, focus, pause, complete, or move work using existing Forge task semantics.
- Watch actions work while the phone is reachable and queue durably when it is not.
- The iPhone processes queued watch commands idempotently and publishes a fresh snapshot after success.
- Backend replay does not duplicate task runs, habit check-ins, or capture events.
- The watch snapshot remains compact and versioned.
- The iPhone and Watch targets use one shared model contract or an explicitly generated/guarded equivalent.
- All listed checks pass.
- Release docs were read and followed, including the Forge release cheat sheet and OpenClaw plugin release checklist when relevant.
- The iOS archive and exported IPA contain the embedded Watch app and Watch extension.
- Release version/build numbers are consistent between release config, Xcode settings, plists, archive, IPA, and TestFlight upload.
- The intended implementation and release metadata are committed on `main`.
- `main` is pushed.
- A new TestFlight build is uploaded successfully.
- If plugin-facing contracts changed, the affected plugin packages are released through the documented Forge release flow; if not, the run reports exactly why plugin release was not necessary.

## Assumptions

- V1 remains iPhone-relay-only; no direct watch-to-Fastify networking.
- Existing Forge task-run semantics remain canonical.
- Existing habit status semantics remain canonical for now: `done` and `missed`.
- The watch exposes high-frequency control and capture, not deep editing.
- Implementation happens on `main`.
- XcodeGen is not used.
