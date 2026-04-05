# Forge Companion iOS

Native SwiftUI companion app for Forge.

## Scope

This app is the personal sensor and health bridge for Forge. Phase 1 focuses on:

- QR pairing with Forge
- HealthKit permission onboarding
- Sleep import
- Workout and recovery import
- Manual sync + background refresh hooks
- Full-screen embedded Forge web app after pairing
- Floating native control center for sync, HealthKit, and companion settings

The architecture leaves room for:

- Core Location
- WatchConnectivity
- passive motion signals
- future Apple Watch and biometrics surfaces

## Project generation

This folder uses `project.yml` for XcodeGen so the app structure stays diffable in the repo.

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen)
2. Run `xcodegen generate`
3. Open `ForgeCompanion.xcodeproj`

## Key frameworks

- SwiftUI
- HealthKit
- BackgroundTasks
- AVFoundation
- CoreLocation
- WatchConnectivity

## Pairing contract

Forge web settings generate a QR payload with:

- `apiBaseUrl`
- `sessionId`
- `pairingToken`
- `expiresAt`
- requested capabilities

The companion scans the QR payload, stores it in the keychain-backed app model, requests the relevant permissions, then posts sync payloads to Forge.
