# AGENTS.md — Forge iOS Companion

## Scope

This file governs the `projects/forge/ios-companion` subtree and overrides broader
instructions when they conflict.

## Mandatory pre-read

Before making substantive changes anywhere in this subtree, read:

1. `/Users/omarclaw/Documents/aurel-monorepo/projects/forge/AGENTS.md`
2. `/Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/CRITICAL_XCODE_PROJECT_RULES.md`

If the task touches any of these files or concerns build, launch, signing, fullscreen
behavior, app presentation, project structure, or Xcode configuration, the critical
rules file is mandatory and binding:

- `ForgeCompanion.xcodeproj/project.pbxproj`
- `ForgeCompanion/Info.plist`
- `ForgeCompanion/ForgeScreenTimeReportExtension/Info.plist`
- `project.yml`
- any `.xcodeproj`
- any `.xcworkspace`
- any entitlements file

## Xcode project rule

Treat `/Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion.xcodeproj`
as the only live Xcode project for this subtree.

Do not create, regenerate, or replace Xcode project files casually.

## XcodeGen ban

Do not run `xcodegen generate` in this subtree unless Albert explicitly asks for it in
that turn.

Do not use XcodeGen as a convenience step, cleanup step, repair step, or guess-based
build fix.

If a build mismatch exists, debug the actual live Xcode project first.

## Safety rule for plist and display behavior

Do not change app-display or app-launch behavior in plist or project build settings
unless the user explicitly asked for that behavior change or a verified build error
proves it is required.

This includes fullscreen behavior, launch configuration, indirect input behavior,
device family, scene generation, and orientation settings.

## Required repair posture

When touching project/build settings:

1. inspect git history first
2. compare against the current live `.xcodeproj` and relevant plist files
3. preserve historically important app-display settings unless Albert explicitly wants
   them changed
4. verify with the real root Xcode project, not an invented alternate path

## Verification

When project/build settings change, verify with:

`xcodebuild -project /Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion.xcodeproj -scheme ForgeCompanion build -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO`

If tests are relevant, also run:

`xcodebuild -project /Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion.xcodeproj -scheme ForgeCompanion -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:ForgeCompanionTests test CODE_SIGNING_ALLOWED=NO`
