# Desktop, iPhone, Android, and public demo distribution

Launchpad's Distribution tab shows what can run now and what still depends on an external release authority. Forge does not label an App Store, Play Store, signed desktop, or hosted demo release as available before the corresponding platform accepts it.

## Signed desktop updates

The Tauri desktop workflow builds separate Apple Silicon and Intel packages. It stops unless the Tauri signing key, pinned updater public key, Apple certificate, signing identity, Apple account, and Apple team credentials are present. The installed app accepts an update only when its signature matches the pinned public key. It shows download progress, installs the package, and restarts while retaining the existing data root.

The source path is implemented. Public desktop availability still requires successful signing and notarization, clean install, upgrade, downgrade, failed-update recovery, uninstall, and data-preservation checks on both architectures.

## iPhone and Apple Watch

The native pairing, approval, Watch, screenshot, signed archive, TestFlight, and App Store submission paths exist. Apple credentials, current privacy disclosures, a successful signed submission, and Apple review approval remain required.

## Android companion

The Android companion supports HTTPS QR pairing, Android Keystore encryption, and Health Connect. No category is selected by default. A user may explicitly select Steps, Heart rate, or Weight, enable or pause background work, sync now, inspect the encrypted local queue, retry, discard, or disconnect. Disconnecting deletes queued payloads and cancels background work.

The release workflow requires the Android keystore and all signing passwords before it creates an Android App Bundle for Play Console review. A signed build and device-level Health Connect tests remain required before public availability.

## Public demo

The demo gateway creates one random temporary data root and one Forge API process for each signed browser session. It uses deterministic sample data and blocks settings, agents, credentials, pairing, device, download, and raw-data routes. It limits the service to 20 concurrent sessions, 30 minutes per session, 15 minutes of inactivity, 120 requests per minute per session, and 1 MiB request bodies.

The container workflow can build and publish the reviewed gateway image. Hosting still requires an approved domain, TLS termination, a strong runtime session secret, cost monitoring, and an abuse response process.
