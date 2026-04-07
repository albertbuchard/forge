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
targets, but the current manually curated Xcode project lives at
`ForgeCompanion/ForgeCompanion.xcodeproj`.

If you want to regenerate later:

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen)
2. Run `xcodegen generate` from `ios-companion/`
3. Open `ForgeCompanion/ForgeCompanion.xcodeproj`

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
