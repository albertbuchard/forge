# Critical Xcode Project Rules

This file exists because Forge Companion previously lost important app behavior when
the Xcode project was regenerated instead of debugging the live project directly.

Read this file before changing project structure, build settings, plist behavior, or
launch/display configuration.

## Absolute rules

- Do not run `xcodegen generate` unless Albert explicitly asks for it in that turn.
- Do not treat `project.yml` as the safe source of truth when the live issue is in the
  current Xcode project.
- Do not “fix” build errors by recreating the project unless Albert explicitly asked
  for that risk.
- Do not touch fullscreen-related settings casually.
- Do not assume a generated project preserves app-display behavior.

## Canonical live project

The only live Xcode project for the iOS companion is:

`/Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion.xcodeproj`

Do not recreate nested project copies under `ForgeCompanion/`.

## Historically important app settings

These settings are considered critical and must not be removed or changed without
explicit user approval:

- app target `TARGETED_DEVICE_FAMILY = 1`
- app target `INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES`
- app target `INFOPLIST_KEY_UILaunchScreen_Generation = YES`
- app target `INFOPLIST_KEY_UIRequiresFullScreen = YES`
- app target `INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = UIInterfaceOrientationPortrait`
- app asset setting `ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor`
- app plist `UIRequiresFullScreen = true`
- app plist `UIApplicationSupportsIndirectInputEvents = true`

Relevant files:

- `/Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion.xcodeproj/project.pbxproj`
- `/Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion/Info.plist`
- `/Users/omarclaw/Documents/aurel-monorepo/projects/forge/ios-companion/ForgeCompanion/ForgeScreenTimeReportExtension/Info.plist`

## Repair procedure when build/project issues appear

1. Inspect the real live root project first.
2. Inspect git history for the affected `.xcodeproj` or plist.
3. Compare current settings against the historically working app-target settings.
4. Patch the live project directly when the issue is in the live project.
5. Verify with `xcodebuild` against the root project.

## What not to do

- Do not regenerate the project “just to make it build.”
- Do not silently widen device family.
- Do not silently drop fullscreen or launch-related flags.
- Do not silently rewrite build numbers between app and extension targets.
- Do not remove or recreate project files without checking whether Xcode is opening a
  stale path or duplicate bundle.
