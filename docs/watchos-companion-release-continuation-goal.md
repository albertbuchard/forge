# Forge WatchOS Companion Release Continuation Goal

## Copy/Paste Goal Prompt

```text
/goal Continue the Forge watchOS companion command-surface release from projects/forge/docs/watchos-companion-release-continuation-goal.md. Stay on projects/forge main. Do not run XcodeGen. Use the live Xcode project at projects/forge/ios-companion/ForgeCompanion.xcodeproj. Audit the current uncommitted watchOS/iOS release changes, finish any missing command-surface requirements, especially task move actions including blocked, preserve the iPhone-relay-first WatchConnectivity architecture, and verify that Watch, iPhone, backend, and plugin contracts agree. Test thoroughly: release guard, TypeScript, relevant server tests, Watch app build, iPhone simulator build, release validation, exported IPA plist inspection, and runtime health/Tailscale status checks. Commit only intended files, remove generated build artifacts from the worktree, push main, create and push the next ios-testflight-v* tag, monitor GitHub release workflows, and do not mark complete until TestFlight upload succeeds and affected plugin releases are either successful or explicitly proven unnecessary. Restore or preserve the unrelated temporary weight-loss-app stash/worktree state; do not lose or stage it.
```

## Purpose

This goal file is a restart-ready handoff for finishing the Forge watchOS companion release. The broad product and architecture spec remains in `projects/forge/docs/watchos-companion-command-surface-goal.md`. This file is narrower: it captures the current implementation state, the known release blocker, the validation plan, and the exact completion criteria for the next `/goal` run.

The target is not just “make it build.” The target is a released TestFlight build with a coherent watchOS command surface, verified release metadata, no accidental Xcode project churn, and no data-loss or stash-loss around unrelated user work.

## Binding Rules

- Work in `/Users/omarclaw/Documents/aurel-monorepo/projects/forge`.
- `git branch --show-current` must be exactly `main` before editing, committing, tagging, or pushing.
- Do not create or switch to a feature branch unless Albert explicitly asks.
- Do not run XcodeGen.
- Treat `ios-companion/ForgeCompanion.xcodeproj` as the only live Xcode project.
- Read and follow:
  - `projects/forge/AGENTS.md`
  - `projects/forge/ios-companion/AGENTS.md`
  - `projects/forge/ios-companion/CRITICAL_XCODE_PROJECT_RULES.md`
  - `projects/forge/docs/release-cheat-sheet.md`
  - `projects/forge/docs/openclaw-plugin-release-checklist.md`
- Do not commit generated `ios-companion/build/` output.
- Do not stage unrelated user work.
- Preserve or restore the unrelated stash named `temporary-unrelated-weight-loss-app-ts`.

## Current State To Audit First

There are uncommitted release changes in the Forge nested repo. They are expected to include:

- `ios-companion/ForgeCompanion.xcodeproj/project.pbxproj`
- `ios-companion/ForgeCompanion/ForgeScreenTimeReportExtension/Info.plist`
- `ios-companion/ForgeCompanion/ForgeWatch Watch App/ContentView.swift`
- `ios-companion/ForgeCompanion/ForgeWatch/Info.plist`
- `ios-companion/ForgeCompanion/Info.plist`
- `ios-companion/project.yml`
- `ios-companion/release/release.yml`

There may also be generated `ios-companion/build/` output. Remove it from the worktree before commit if present.

Previous implementation work already added the core watch command-surface architecture:

- `WatchNavigationModel` owns selected surface, Digital Crown selection, and per-surface card selection.
- `ContentView` uses the navigation model instead of a single flat watch carousel.
- Each surface can expose a horizontal card deck.
- Card taps open compact command modals.
- The iPhone remains the relay owner for pairing credentials, queues, backend calls, and snapshot publishing.
- The Watch app now has the required `WKCompanionAppBundleIdentifier` build setting.
- Marketing version was bumped toward `1.0.77`; build number was bumped toward `27`.

Known item to check before release: task modals must include a `blocked` move action because the intended Work/Kanban watch surface includes `focus`, `in_progress`, `blocked`, and `done`. If it is missing, add it and rebuild the Watch target.

## Known Release History

The current release chain already shipped plugin packages:

- `forge-hermes-plugin` `0.2.101`, tag `hermes-v0.2.101`
- `forge-openclaw-plugin` `0.2.101`
- `forge-memory` `0.2.101`, tag `v0.2.101`

Those plugin releases were previously verified. Do not release another plugin version unless the continuation work changes backend/plugin contracts, bundled skills, OpenClaw route mirrors, Hermes tools, Codex adapter behavior, or package metadata.

Recent iOS release attempts:

- `ios-testflight-v1.0.74` failed on signing.
- `ios-testflight-v1.0.75` failed because the Watch app lacked required icon/display metadata.
- `ios-testflight-v1.0.76` archived/exported but TestFlight upload failed with missing `WKCompanionAppBundleIdentifier` in the Watch app plist.

The continuation must verify that the exported IPA contains the companion identifier in:

```text
Payload/ForgeCompanion.app/Watch/ForgeWatch Watch App.app/Info.plist
```

Expected value:

```text
WKCompanionAppBundleIdentifier = com.albertbuchard.ForgeCompanion
```

## Implementation Checklist

1. Verify branch and status.
2. Read the required Forge and iOS companion docs.
3. Inspect the current diff carefully.
4. Remove generated build output from the worktree.
5. Confirm the Watch command surface still follows the desired architecture:
   - Digital Crown selects the Forge surface.
   - Horizontal paging selects a card/subcomponent inside that surface.
   - Tapping a card opens an action modal.
   - Actions are queued/relayed through the iPhone, not direct Watch network calls.
6. Confirm Work/Kanban actions cover:
   - start
   - focus
   - heartbeat/keep alive where applicable
   - pause/release
   - complete
   - move to `focus`
   - move to `in_progress`
   - move to `blocked`
   - move to `done`
7. Confirm version/build alignment across:
   - `ios-companion/release/release.yml`
   - `ios-companion/project.yml`
   - `ios-companion/ForgeCompanion.xcodeproj/project.pbxproj`
   - iPhone app `Info.plist`
   - Watch app `Info.plist`
   - Screen Time extension `Info.plist`
8. Run static and targeted tests.
9. Run local release validation.
10. Inspect the exported IPA plist metadata.
11. Commit only intended files on `main`.
12. Push `main`.
13. Create and push the next `ios-testflight-v*` tag.
14. Monitor GitHub workflows until TestFlight upload succeeds.
15. Run local Forge runtime health checks.
16. Restore or explicitly preserve the unrelated stash/worktree state.

## Required Commands And Checks

Start with:

```bash
cd /Users/omarclaw/Documents/aurel-monorepo/projects/forge
git branch --show-current
git status --short
```

Static checks:

```bash
scripts/audit-release-guard.sh
npx tsc --noEmit
git diff --check
```

Targeted backend contract test:

```bash
node --import tsx --test --test-concurrency=1 --test-name-pattern='watch action batch' server/src/app.test.ts
```

Watch build:

```bash
xcodebuild \
  -project /Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion.xcodeproj \
  -target 'ForgeWatch Watch App' \
  build \
  CODE_SIGNING_ALLOWED=NO
```

iPhone companion build:

```bash
xcodebuild \
  -project /Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion.xcodeproj \
  -scheme ForgeCompanion \
  build \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO
```

Release validation:

```bash
bash ./ios-companion/scripts/publish-forge-companion.sh validate
```

After validation, inspect the generated `.ipa` rather than trusting project files alone. Confirm:

- iPhone bundle id is `com.albertbuchard.ForgeCompanion`.
- Watch app bundle id is `com.albertbuchard.ForgeCompanion.watchkitapp`.
- Watch app display name is `Forge`.
- Watch app has `CFBundleIconName = AppIcon`.
- Watch app has `WKCompanionAppBundleIdentifier = com.albertbuchard.ForgeCompanion`.
- Marketing version and build number match the intended release.
- The Watch extension is embedded.

Runtime checks before completion:

```bash
curl -fsS http://127.0.0.1:4317/api/v1/health
tailscale serve status
tailscale funnel status
```

Do not mutate Tailscale Serve/Funnel mappings unless Albert explicitly approves it in the current task.

## Commit, Push, And Release Flow

Before commit:

```bash
git branch --show-current
git status --short
scripts/audit-release-guard.sh
```

Commit only intended files. Suggested commit message:

```text
release(ios): v1.0.77 testflight
```

Then:

```bash
git push origin main
git tag ios-testflight-v1.0.77
git push origin ios-testflight-v1.0.77
```

If the version has already advanced by the time the goal run starts, use the next valid `ios-testflight-v*` version and keep every version/build file aligned.

Monitor GitHub Actions for:

- the Forge Companion iOS/TestFlight workflow for the pushed tag
- any OpenClaw plugin workflow triggered by the same tag

The goal is not complete until TestFlight upload succeeds.

## Completion Criteria

This goal may be marked complete only when all of these are true:

- The Watch command surface architecture is audited and missing command actions are fixed.
- The Watch app build succeeds.
- The iPhone companion build succeeds.
- TypeScript and release guard checks pass.
- Relevant server watch command tests pass.
- Release validation succeeds locally.
- Exported IPA plist metadata proves the Watch companion identifier, icon, display name, bundle ids, version, and build number are correct.
- The release commit is pushed to `origin/main`.
- The next `ios-testflight-v*` tag is pushed.
- GitHub release workflows are monitored to success.
- TestFlight upload succeeds.
- Plugin releases are verified or explicitly proven unnecessary for this continuation.
- Local Forge runtime health and Tailscale status checks are reported.
- The unrelated `temporary-unrelated-weight-loss-app-ts` stash/worktree state is restored or preserved without staging it.

## Non-Goals

- Do not redesign the full iPhone companion settings UI in this goal unless a release blocker requires it.
- Do not change HealthKit sync semantics unless a watch release check proves a contract conflict.
- Do not regenerate the Xcode project.
- Do not publish another plugin package version just because release work is happening; publish only if plugin-facing contracts changed.
- Do not mark completion based on local build success alone.
