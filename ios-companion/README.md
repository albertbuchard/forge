# Forge Companion iOS

Native SwiftUI companion app for Forge.

## Scope

This Apple companion is the sensor, sync, and micro-capture bridge for Forge. The
iPhone app remains the networked client that pairs with Forge, owns credentials, and
handles retries. The watch app is a paired wrist-first capture surface, not a second
Forge client.

The current shipped surfaces focus on:

- QR pairing with Forge
- HealthKit permission onboarding
- Sleep import
- Workout and recovery import
- Manual sync + background refresh hooks
- Full-screen embedded Forge web app after pairing
- Floating native control center for sync, HealthKit, and companion settings
- WatchConnectivity bootstrap + queued action bridge
- watchOS habits with 7-segment streak rings
- watchOS quick check-in, mark moment, and prompt inbox
- watchOS WidgetKit / App Intents launch points for Habits, Check In, Mark Moment, and Emotion

The companion architecture intentionally keeps the watch light. The phone does the
networking, prompt generation, sync retries, and projection into canonical Forge APIs.
The watch only captures or confirms moments that would otherwise be lost.

The architecture still leaves room for:

- Core Location
- passive motion signals
- richer Apple Watch prompts and biometrics surfaces

## Project generation

This folder keeps `project.yml` as the diffable XcodeGen definition for the Apple
targets. The canonical Xcode project is the generated root project at
`ios-companion/ForgeCompanion.xcodeproj`.

Do not open a nested `ForgeCompanion/ForgeCompanion.xcodeproj` path if one appears in
old local state or backups. That stale project drifted from the generated source of
truth and can compile the wrong target graph.

If you want to regenerate later:

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen)
2. Run `xcodegen generate` from `ios-companion/`
3. Open `ForgeCompanion.xcodeproj`

## Key frameworks

- SwiftUI
- HealthKit
- BackgroundTasks
- AVFoundation
- CoreLocation
- WatchConnectivity
- WidgetKit
- AppIntents

## Pairing contract

Forge web settings generate a QR payload with:

- `apiBaseUrl`
- `sessionId`
- `pairingToken`
- `expiresAt`
- requested capabilities

The companion scans the QR payload, stores it in the keychain-backed app model, requests the relevant permissions, then posts sync payloads to Forge.

Watch actions are never sent directly from the watch to Forge. The watch sends queued
messages to the iPhone through WatchConnectivity, the iPhone submits canonical habit
check-ins or watch capture batches to Forge, and the iPhone sends a compact bootstrap
snapshot back to the watch and widget surfaces.

Runtime discovery prefers Bonjour on the local network. The Forge runtime now
advertises `_forge._tcp` and, when Tailscale Serve is available, includes the
tailnet HTTPS base URLs in the Bonjour TXT record so the iPhone can discover both
local-network and Tailscale paths from one source.

## App Store release automation

This repo now includes a one-command Apple release flow for the iPhone companion and
its embedded watch targets.

Public entrypoint:

- `./ios-companion/scripts/publish-forge-companion.sh validate`
- `./ios-companion/scripts/publish-forge-companion.sh testflight`
- `./ios-companion/scripts/publish-forge-companion.sh app-store`

The script bootstraps a local Fastlane toolchain under `ios-companion/vendor/bundle`,
runs Forge repo checks, archives the canonical generated Xcode project at
`ios-companion/ForgeCompanion.xcodeproj`, and then uploads or submits
depending on the selected mode. It prefers an already-installed modern Ruby and only
falls back to Homebrew Ruby bootstrap when no suitable Ruby is available.

This repo now also includes tag-driven GitHub Actions release workflows:

- `ios-testflight-v<marketing-version>` runs screenshot capture plus the
  `testflight_release` lane
- `ios-app-store-v<marketing-version>` runs screenshot capture plus the
  `app_store_release` lane

Those tags must point at commits already on `main`, and the version in the tag must
match `ios-companion/release/release.yml`.

### One-time local setup

1. Copy `ios-companion/.release.env.example` to `ios-companion/.release.env`
2. Fill in the App Store Connect API key values
3. Replace placeholder values in:
   - `ios-companion/fastlane/metadata/en-US/support_url.txt`
   - `ios-companion/fastlane/metadata/en-US/marketing_url.txt`
   - `ios-companion/fastlane/metadata/en-US/privacy_url.txt`
4. Update `ios-companion/release/release.yml` when you want a new marketing version
5. Update `ios-companion/fastlane/metadata/en-US/release_notes.txt` before each release

### One-time Apple-side prep

Before the script can publish successfully, make sure App Store Connect / Apple
Developer already has:

- an app record for `Forge Companion`
- the iPhone bundle id and watch companion bundle ids configured correctly
- automatic signing working for team `KZ65F7924F`
- an App Store Connect API key with permission to upload builds and manage releases
- app category, pricing, availability, export compliance, privacy questionnaire, and age rating completed

### One-time GitHub Actions setup

For the CI workflow in `.github/workflows/release-ios-companion.yml`, add these
repository secrets. You can choose either of these setup styles:

1. One full release env secret:
   - `FORGE_IOS_RELEASE_ENV` with the raw multiline contents of `ios-companion/.release.env`, or
   - `FORGE_IOS_RELEASE_ENV_BASE64` with a base64-encoded `.release.env` payload
2. Individual App Store Connect secrets:

- `FORGE_ASC_KEY_ID`
- `FORGE_ASC_ISSUER_ID`
- `FORGE_ASC_KEY_CONTENT_BASE64`
- optional `FORGE_APPLE_TEAM_ID` if you do not want to rely on the repo default

If the GitHub runner cannot complete automatic signing with its own state, also add:

- `FORGE_IOS_BUILD_CERTIFICATE_BASE64`
- `FORGE_IOS_P12_PASSWORD`
- `FORGE_IOS_KEYCHAIN_PASSWORD`
- optional `FORGE_IOS_PROVISIONING_PROFILES_BASE64` as newline-delimited base64
  `.mobileprovision` payloads

The workflow writes a normalized `ios-companion/.release.env` from the chosen secret
source, applies the default Apple team id when you do not override it, captures the
managed screenshots, and then calls the same publish script the local flow uses.

For the exact release tags, full prerequisites, and the combined plugin plus iOS
release flow, use `docs/release-cheat-sheet.md`.

### Screenshots

Screenshot upload is repo-managed but disabled by default. The release config lives in:

- `ios-companion/release/release.yml`
- `ios-companion/fastlane/screenshots/manifest.json`

When `upload_screenshots_for_app_store` is set to `true`, the release lanes treat the
manifest as the source-locale truth and automatically mirror that screenshot set into
every locale listed in `metadata.screenshot_locales` before validation, upload, and
submission.
