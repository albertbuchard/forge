# Forge Companion iOS

Native SwiftUI companion app for Forge.

## Scope

This Apple companion is the sensor, sync, and micro-command bridge for Forge. The
iPhone app pairs with Forge, owns credentials, and handles HealthKit and movement
sync. The watch app is a wrist-first command surface that can call Forge directly
over a secure Tailscale or HTTPS route and uses the paired iPhone as a backup when
the watch cannot reach Forge itself.

The current shipped surfaces focus on:

- QR pairing with Forge
- HealthKit permission onboarding
- Sleep import
- Workout and recovery import
- Interruption-safe HealthKit chunk sync with bounded foreground and background transfer recovery
- Manual sync + background refresh hooks
- Native Agent Messages inbox, outbox, detail, default-agent selection, and immediate voice/text composer
- AES-GCM encrypted offline Agent Messages queue with stable retry identities, Wi-Fi/cellular policy, and truthful iOS-scheduled delivery states
- Full-screen embedded Forge web app after pairing
- Floating native control center for sync, HealthKit, and companion settings
- WatchConnectivity bootstrap + direct-first watch action delivery with paired-iPhone backup
- watchOS crown-selected command surfaces for Now, Work, Habits, Goals, Today, Health, Movement, Psyche, Inbox, and Sync
- watchOS habits with 7-segment streak rings and Done/Missed or Resisted/Performed decisions
- watchOS task-run controls for starting, heartbeating, completing, releasing, and moving work
- watchOS quick capture for emotions, triggers, routines, prompts, places, trips, workouts, and notes
- watchOS WidgetKit / App Intents launch points for Habits, Check In, Mark Moment, and Emotion

The companion architecture intentionally keeps the watch compact but no longer
one-dimensional. The phone builds the compact watch snapshot and handles heavy sensor
sync. The watch presents dense command cards, stores outgoing actions durably, tries
the direct secure Forge route first, and falls back to the paired iPhone only when
that direct route is unavailable. Forge is still the canonical source of truth.

The architecture still leaves room for richer Apple Watch biometrics and passive
context surfaces, but each mutation must continue to receive a Forge backend receipt
before the watch treats it as complete.

## Xcode project maintenance

The canonical Xcode project is the root project at
`apps/ios-companion/ForgeCompanion.xcodeproj`. Maintain its file references and
build phases manually. `project.yml` is historical reference only; XcodeGen must
not regenerate or overwrite the canonical project.

Do not open a nested `ForgeCompanion/ForgeCompanion.xcodeproj` path if one appears in
old local state or backups. That stale project drifted from the generated source of
truth and can compile the wrong target graph.

When adding a Swift source file, add the file reference and target build-phase
entry to the canonical project and run the repository's Xcode reference check
before building.

## Key frameworks

- SwiftUI
- HealthKit
- BackgroundTasks
- AVFoundation
- CryptoKit
- Network
- UserNotifications
- CoreLocation
- WatchConnectivity
- WidgetKit
- AppIntents

## Pairing contract

Forge web settings generate a QR payload with:

- `apiBaseUrl`
- `uiBaseUrl`
- `sessionId`
- `pairingToken`
- `expiresAt`
- requested capabilities
- `transportMode`
- `transport`

The active `transportMode` must match the selected connection strategy. When the user
pairs through Tailscale or another secure direct HTTPS URL, the API/UI URLs are the
primary route and Iroh metadata must not be used for that session. When Iroh is
selected, the QR includes the desktop Iroh node id, the pairing token, an optional
relay hint, and ALPN `forge-companion/1`.

The companion scans the QR payload, stores it in the keychain-backed app model,
requests the relevant permissions, then sends sync payloads to Forge. For Iroh
payloads, the Swift app uses the native Rust bridge to dial the desktop node id over
Iroh/QUIC and carries Forge API request envelopes over the authenticated stream. If the
Iroh bridge times out and the pairing has an HTTP(S) API URL, the app retries that
request over URLSession. For manual payloads, it keeps the direct HTTP/TCP path.

Manual HTTP/TCP remains available when the operator intentionally wants LAN,
Tailscale, or debugging behavior:

```bash
npx forge-memory pair-ios --manual-http
```

Large HealthKit transfers are resumable. Direct HTTPS uploads use a bounded
3-request window, background uploads remain serial, and one session-status refresh
reconciles an ambiguous timeout or temporary server failure before the app retries
only missing chunks. The embedded Forge view also waits for a committed React render;
it attempts one cache-bypassing reload when startup stalls and then presents a clear
native error instead of looping.

Watch actions use a direct-first contract. If the watch has a secure non-loopback
`https://` route, such as a Tailscale MagicDNS URL, it submits idempotent commands to
`/mobile/watch/actions:batch` itself. If that route is unavailable, it sends the same
durable action envelopes to the paired iPhone through WatchConnectivity as a backup.
Forge records command receipts before sending a refreshed compact snapshot back to
the watch and widget surfaces.

Runtime discovery can still surface Bonjour candidates for known local or manual
routes. When Forge advertises `_forge._tcp`, it can include phone-reachable
HTTPS/Tailscale API and UI hints alongside Iroh metadata such as the node id, pair
payload, and `forge-companion/1` ALPN. The app must keep those strategies separated:
Tailscale pairings use Tailscale; Iroh pairings use Iroh.

The deeper transport reference lives in `docs/reference/companion-iroh.md`.

## Agent Messages delivery and privacy

Agent Messages is asynchronous mail, not real-time chat. The native composer can
send text, one original M4A voice note, or both to the default or a selected
connected agent. Microphone denial leaves text available.

Before any network attempt, the app gives the message stable reservation and
message idempotency keys and writes the complete item to an AES-GCM encrypted
queue. The random 256-bit queue key uses Keychain
`AfterFirstUnlockThisDeviceOnly`; the queue uses complete-until-first-
authentication Data Protection. The current implementation does not persist a
second plaintext upload-staging file. It decrypts voice into memory only while
the app is active or iOS grants background-processing time.

Delivery is retried when connectivity returns, the app becomes active, or iOS
grants another existing background task window. iOS controls that scheduling,
so the UI says `Waiting for iOS background time` instead of promising immediate
or deadline-bound delivery. Voice notes over 5 MiB wait for Wi-Fi unless the
user explicitly permits cellular use. Authorized local notifications contain
only the agent label and generic state, never content or transcript text.

The complete server, retention, voice-Artifact, agent-lease, and troubleshooting
contract is documented in [`docs/reference/agent-messages.md`](../../docs/reference/agent-messages.md).

## App Store release automation

This repo now includes a one-command Apple release flow for the iPhone companion
and its embedded watch targets. The disabled Screen Time report extension remains
in source for a future deliberate restoration, but is not embedded or signed in
production archives.

Public entrypoint:

- `./apps/ios-companion/scripts/publish-forge-companion.sh audit`
- `./apps/ios-companion/scripts/publish-forge-companion.sh validate`
- `./apps/ios-companion/scripts/publish-forge-companion.sh testflight`
- `./apps/ios-companion/scripts/publish-forge-companion.sh app-store`

The script bootstraps a local Fastlane toolchain under `apps/ios-companion/vendor/bundle`,
runs Forge repo checks, archives the canonical live Xcode project at
`apps/ios-companion/ForgeCompanion.xcodeproj`, and then uploads or submits
depending on the selected mode. It prefers an already-installed modern Ruby and only
falls back to Homebrew Ruby bootstrap when no suitable Ruby is available. It also
repairs a missing `rubygems.org` source for that Ruby automatically and can unlock a
local signing keychain when `FORGE_IOS_KEYCHAIN_PASSWORD` is set. Every lane checks
the protected launch, fullscreen, background-processing, input, and encryption plist
contract. Archive lanes also verify that every configured app and watch
bundle is embedded with the exact requested marketing version and build number.
The `audit` mode needs no Apple credentials, archive, or signing identity.

This repo now also includes tag-driven GitHub Actions release workflows:

- `ios-testflight-v<marketing-version>` runs screenshot capture plus the
  `testflight_release` lane
- `ios-app-store-v<marketing-version>` runs screenshot capture plus the
  `app_store_release` lane

Those tags must point at commits already on `main`, and the version in the tag must
match `apps/ios-companion/release/release.yml`.

### One-time local setup

1. Copy `apps/ios-companion/.release.env.example` to `apps/ios-companion/.release.env`
2. Fill in the App Store Connect API key values
   Optional:
   set `FORGE_IOS_KEYCHAIN_PATH` and `FORGE_IOS_KEYCHAIN_PASSWORD` if your local
   signing identities live in a locked keychain
3. Replace placeholder values in:
   - `apps/ios-companion/fastlane/metadata/en-US/support_url.txt`
   - `apps/ios-companion/fastlane/metadata/en-US/marketing_url.txt`
   - `apps/ios-companion/fastlane/metadata/en-US/privacy_url.txt`
4. Update `apps/ios-companion/release/release.yml` when you want a new marketing version
5. Update `apps/ios-companion/fastlane/metadata/en-US/release_notes.txt` before each release

### One-time Apple-side prep

Before the script can publish successfully, make sure App Store Connect / Apple
Developer already has:

- an app record for `Forge Companion`
- the iPhone, watch companion, and watch extension bundle ids configured correctly
- an App Store Connect API key with permission to upload builds and manage releases
- a persistent Apple Distribution certificate export and matching provisioning
  profiles prepared for CI import
- app category, pricing, availability, export compliance, privacy questionnaire, and age rating completed

### One-time GitHub Actions setup

For the CI workflow in `.github/workflows/release-ios-companion.yml`, add these
repository secrets. You can choose either of these setup styles:

1. One full release env secret:
   - `FORGE_IOS_RELEASE_ENV` with the raw multiline contents of `apps/ios-companion/.release.env`, or
   - `FORGE_IOS_RELEASE_ENV_BASE64` with a base64-encoded `.release.env` payload
2. Individual App Store Connect secrets:

- `FORGE_ASC_KEY_ID`
- `FORGE_ASC_ISSUER_ID`
- `FORGE_ASC_KEY_CONTENT_BASE64`
- optional `FORGE_APPLE_TEAM_ID` if you do not want to rely on the repo default

For GitHub-hosted CI, also add:

- `FORGE_IOS_BUILD_CERTIFICATE_BASE64`
- `FORGE_IOS_P12_PASSWORD`
- `FORGE_IOS_KEYCHAIN_PASSWORD`
- either `FORGE_IOS_PROVISIONING_PROFILES_BASE64` as newline-delimited base64
  `.mobileprovision` payloads
- or these three secrets when the combined payload is too large for GitHub Actions:
  `FORGE_IOS_PROFILE_APP_BASE64`, `FORGE_IOS_PROFILE_WATCH_APP_BASE64`, and
  `FORGE_IOS_PROFILE_WATCH_EXTENSION_BASE64`

Do not rely on Xcode-managed automatic signing on ephemeral GitHub runners. That
path creates throwaway Apple Development certificates, and repeated releases can
exhaust the Apple account certificate limit, which is what broke the hosted
TestFlight path after `1.0.18`.

The workflow writes a normalized `apps/ios-companion/.release.env` from the chosen secret
source, applies the default Apple team id when you do not override it, captures the
managed screenshots, and then calls the same publish script the local flow uses.

For the exact release tags, full prerequisites, and the combined plugin plus iOS
release flow, use `docs/release/release-cheat-sheet.md`.

### Screenshots

Screenshot upload is repo-managed but disabled by default. The release config lives in:

- `apps/ios-companion/release/release.yml`
- `apps/ios-companion/fastlane/screenshots/manifest.json`

When `upload_screenshots_for_app_store` is set to `true`, the release lanes treat the
manifest as the source-locale truth and automatically mirror that screenshot set into
every locale listed in `metadata.screenshot_locales` before validation, upload, and
submission.
