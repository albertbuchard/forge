# Forge Release Cheat Sheet

This is the fastest accurate reference for shipping Forge releases from the nested
`projects/forge` repository.

The release model now splits into two phases:

1. local prep on a clean checkout of `main`
2. tag-driven publish in GitHub Actions

That keeps npm, PyPI, and App Store Connect auth out of your interactive shell during
normal releases.

## Release Types

Forge currently has five release tracks:

- `forge-memory` guided installer to npm
- OpenClaw plugin to npm
- Hermes plugin to PyPI
- Forge Companion iOS release to TestFlight or the App Store
- Forge Connectivity Service package, source archive, and GHCR image

The GitHub Actions workflows live in:

- `.github/workflows/release-forge-memory.yml`
- `.github/workflows/release-openclaw-plugin.yml`
- `.github/workflows/release-hermes-plugin.yml`
- `.github/workflows/release-ios-companion.yml`
- `.github/workflows/release-connectivity-service.yml`

`forge-memory` is implemented under `packages/forge-memory/`. It uses the same
Forge plugin version as OpenClaw, Hermes, and the Codex runtime package. The
normal release script bumps all of those version surfaces together, then the
same `v<version>` tag triggers both the OpenClaw package workflow and the Forge
Memory workflow. Local verification should use:

```bash
npm run test:forge-memory
npm run pack:forge-memory
version=$(node -p "require('./packages/forge-memory/package.json').version")
npm exec --yes --package ./packages/forge-memory/forge-memory-${version}.tgz -- forge-memory --help
```

All release tags must point at commits already on `main`. The workflows verify that.

Registry-owned plugin releases must be prepared and tagged from the public Forge
repository `albertbuchard/forge`, with commands run from its repository root. Do not push OpenClaw,
Forge Memory, or Hermes release tags from the parent private monorepo
`albertbuchard/aurel-monorepo`: npm and PyPI trusted publishing are registered to
the public Forge repository and will reject parent-monorepo runs with npm
`E404`/permission errors or PyPI `invalid-publisher` errors. When that happens,
the fix is to release again from the public Forge repo through GitHub Actions,
not to invent local registry secrets or switch away from tag-driven CI.

## One-Time Requirements

### GitHub

- the `projects/forge` nested repo must be connected to GitHub with Actions enabled
- you need permission to push `main` and push tags
- the workflows must stay in the Forge repo, not only in the parent monorepo
- Rust stable must be available for release smoke tests because the package now
  ships Forge's `companion-iroh` source and verifies that the host can be built
  locally for iOS pairing

### OpenClaw npm release

### Forge Memory npm release

- package: `forge-memory`
- registry: npm
- workflow trigger tag: `v<version>`
- version source: the shared Forge plugin version

One-time registry setup:

1. Create the `forge-memory` npm package.
2. Open npm package settings for `forge-memory`.
3. Configure Trusted Publishing for this GitHub repository.
4. Point it at the `release-forge-memory.yml` workflow.
5. Keep the workflow on GitHub-hosted runners.

Release flow:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release/release-forge-openclaw-plugin.sh patch
```

This uses the bounded `fast` release profile by default. Run the exhaustive server
matrix separately when needed:

```bash
FORGE_RELEASE_TEST_PROFILE=full FORGE_RELEASE_MODE=prepare \
  ./scripts/release/release-forge-openclaw-plugin.sh patch
```

The workflow verifies the tag is on `main`, checks that
`packages/forge-memory/package.json` matches the shared tag version, runs the
package smoke tests, packs the tarball, smoke-runs the packed CLI, then
publishes with npm Trusted Publishing.

### OpenClaw npm release

- package: `forge-openclaw-plugin`
- registry: npm
- workflow trigger tag: `v<version>`
- example tag: `v0.2.27`

One-time registry setup:

1. Open npm package settings for `forge-openclaw-plugin`
2. Configure Trusted Publishing for this GitHub repository
3. Point it at the `release-openclaw-plugin.yml` workflow
4. Keep the workflow on GitHub-hosted runners

Notes:

- npm Trusted Publishing currently requires GitHub-hosted runners
- the workflow installs Node `22.19.0` and upgrades npm to `11.5.1+` because that is
  required for npm trusted publishing
- the workflow installs Rust stable so smoke tests can build the bundled
  `companion-iroh-src` on the target machine; the published npm package should not
  include native `forge-companion-iroh` desktop binaries

### Hermes PyPI release

- package: `forge-hermes-plugin`
- registry: PyPI
- workflow trigger tag: `hermes-v<version>`
- example tag: `hermes-v0.2.27`

One-time registry setup:

1. Open the `forge-hermes-plugin` project on PyPI
2. Configure this GitHub repository as a Trusted Publisher
3. Use the release workflow `release-hermes-plugin.yml`
4. Keep the publish step on the GitHub-hosted Linux runner

### Forge Companion iOS release

- release config file: `apps/ios-companion/release/release.yml`
- workflow trigger tags:
  - `ios-testflight-v<marketing-version>`
  - `ios-app-store-v<marketing-version>`
- examples:
  - `ios-testflight-v1.0`
  - `ios-app-store-v1.0`

One-time Apple-side setup:

1. Create the App Store Connect app record for `Forge Companion`
2. Make sure these bundle ids exist and match the project:
   - `com.albertbuchard.ForgeCompanion`
   - `com.albertbuchard.ForgeCompanion.watchkitapp`
   - `com.albertbuchard.ForgeCompanion.watchkitapp.ForgeWatch`
3. Make sure app category, pricing, availability, export compliance, privacy
   questionnaire, and age rating are complete
4. Create an App Store Connect API key with permission to upload builds and manage
   releases
5. Prepare persistent Apple Distribution signing assets for GitHub Actions CI.
   Do not rely on Xcode-managed automatic signing on hosted runners, because each
   fresh runner can create another throwaway Apple Development certificate and
   eventually exhaust the Apple account certificate limit.
6. The iOS workflow installs Rust stable with `aarch64-apple-ios`,
   `aarch64-apple-ios-sim`, and `x86_64-apple-ios` targets so Xcode can link the
   native Forge Iroh bridge.

### Forge Connectivity Service release

- package: `forge-connectivity-service`
- source: `packages/forge-connectivity-service`
- workflow trigger tag: `connectivity-v<version>`
- container: `ghcr.io/albertbuchard/forge-connectivity-service`

The release workflow runs the independent format, lint, type, unit, integration,
upgrade, abuse, load, OpenAPI, license, SBOM, package, audit, and clean-install
gates. It attaches an npm-compatible tarball, source archive, CycloneDX SBOM,
checksums, and Sigstore bundles to the GitHub release. It also publishes and signs
`linux/amd64` and `linux/arm64` images with BuildKit and GitHub provenance.

No npm registry is required. Install the attached tarball directly, or run the
digest-pinned GHCR image. Publishing the package to npm later is an independent
Trusted Publishing step and must not block the self-hosted release.

## GitHub Secrets

### Required for iOS workflow

Choose one of these secret styles in the Forge GitHub repo.

Single-secret setup:

- `FORGE_IOS_RELEASE_ENV` with the raw multiline contents of `apps/ios-companion/.release.env`, or
- `FORGE_IOS_RELEASE_ENV_BASE64` with a base64-encoded `.release.env` payload

Split-secret setup:

- `FORGE_ASC_KEY_ID`
- `FORGE_ASC_ISSUER_ID`
- `FORGE_ASC_KEY_CONTENT_BASE64`

Optional in either setup:

- `FORGE_APPLE_TEAM_ID` if you do not want to rely on the default team `KZ65F7924F`

### Also required for GitHub-hosted CI signing

- `FORGE_IOS_BUILD_CERTIFICATE_BASE64`
- `FORGE_IOS_P12_PASSWORD`
- `FORGE_IOS_KEYCHAIN_PASSWORD`
- either `FORGE_IOS_PROVISIONING_PROFILES_BASE64`
- or these three split secrets:
- `FORGE_IOS_PROFILE_APP_BASE64`
- `FORGE_IOS_PROFILE_WATCH_APP_BASE64`
- `FORGE_IOS_PROFILE_WATCH_EXTENSION_BASE64`

Formatting note:

- `FORGE_IOS_RELEASE_ENV(_BASE64)` should include the same values you would put in
  `apps/ios-companion/.release.env`
- `FORGE_ASC_KEY_CONTENT_BASE64` should be the base64 body of the `.p8` App Store
  Connect key
- `FORGE_IOS_BUILD_CERTIFICATE_BASE64` should be the base64 body of the exported `.p12`
- `FORGE_IOS_PROVISIONING_PROFILES_BASE64` should be one or more base64
  `.mobileprovision` payloads separated by newlines, but GitHub secret size limits
  may require using the three split profile secrets instead
- the provisioning-profile secret set must cover the iPhone app, watch app, watch
  extension bundle ids used by `ForgeCompanion.xcodeproj`. The disabled Screen Time
  report extension remains in source but is not embedded or signed for production.

## Local Prep Commands

Run these from the Forge repository root.

### People and peer sharing release gate

The aggregate gate requires a new, empty test root with its own safety marker. It
rejects the normal Forge data folder, backup folders, unmarked paths, and databases
that are open in another process. `lsof` is required; the gate fails closed when it
cannot prove that the isolated database is unused. The full plan also checks the
OpenClaw, Hermes, Codex, Forge Memory, connectivity-service, Rust, web, API, and
native release surfaces.

```bash
test_root="$(mktemp -d "${TMPDIR:-/tmp}/forge-people-release.XXXXXX")"
artifact_root="$(mktemp -d "${TMPDIR:-/tmp}/forge-people-artifacts.XXXXXX")"
npm run check:people-sharing-release -- --initialize-root "$test_root"

FORGE_PEOPLE_RELEASE_DATA_ROOT="$test_root" \
FORGE_PEOPLE_RELEASE_ARTIFACT_ROOT="$artifact_root" \
npm run check:people-sharing-release
```

Use `--plan` to list every command. Use `--groups static,tests` only while diagnosing
a named group. A release candidate must run the complete plan twice from a clean
`main` checkout. Keep the resulting package archives and test evidence until the
published release has been checked independently.

### OpenClaw

If Hermes is already ahead of OpenClaw/Forge Memory, release Hermes first to the
next shared version, then release OpenClaw/Forge Memory to that exact same version.
The OpenClaw release script also rewrites shared Forge plugin version surfaces, so
the correct alignment order is:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release/release-forge-hermes-plugin.sh patch
FORGE_RELEASE_MODE=prepare ./scripts/release/release-forge-openclaw-plugin.sh <same-version>
```

Patch release:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release/release-forge-openclaw-plugin.sh patch
```

Explicit version:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release/release-forge-openclaw-plugin.sh 0.2.27
```

What it does:

- verifies the Forge repo is clean
- bumps aligned OpenClaw release versions
- runs the verification suite
- commits the release
- pushes `main`
- pushes tag `v<version>`

What happens next:

- GitHub Actions publishes `forge-openclaw-plugin` to npm from that tag

### Hermes

Patch release:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release/release-forge-hermes-plugin.sh patch
```

Explicit version:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release/release-forge-hermes-plugin.sh 0.2.27
```

What it does:

- verifies the Forge repo is clean
- bumps Hermes release versions
- bundles the runtime payload
- builds wheel and sdist
- runs Forge plus Hermes verification
- smoke-installs the wheel in a temporary virtualenv
- commits the release
- pushes `main`
- pushes tag `hermes-v<version>`

What happens next:

- GitHub Actions publishes `forge-hermes-plugin` to PyPI from that tag

### iOS TestFlight

Do not run Fastlane manually as the normal release command. The operator process is
tag-driven GitHub Actions from the public nested Forge repo: update metadata, commit
to `main`, push `main`, push the `ios-testflight-v<marketing-version>` tag, and
watch the `Release Forge Companion iOS` workflow. The workflow implementation may
call the iOS release script internally, but the release action is the tag.

Before tagging:

1. update `apps/ios-companion/release/release.yml`
2. update `apps/ios-companion/fastlane/metadata/en-US/release_notes.txt`
3. replace any metadata placeholders if still present
4. run `npm run release:ios-companion:audit`
5. commit and push to `main`

Every tagged TestFlight release must be delivered to testers, not merely uploaded
to App Store Connect. Keep `release.skip_testflight_submission: false`, name the
intended external group in `release.testflight_groups`, and keep
`release.notify_external_testers: true`. The release audit rejects an empty group,
a skipped submission, or disabled tester notifications so a successful workflow
cannot silently leave the new build invisible to external testers.

The current Forge Companion external group is `Beta external`. The internal
`Beta` group has access to all builds automatically and does not need to be named
in each release.

Icon rule:

- TestFlight and installed iOS/watchOS app icons come from the uploaded binary's
  Xcode asset catalogs, not from App Store Connect metadata forms.
- Do not try to repair a TestFlight app icon by using Fastlane `deliver app_icon`;
  that field is deprecated for the current App Store Connect API.
- A duplicate build-number response is not a successful icon release. If App Store
  Connect says the bundle version has already been used, bump `CFBundleVersion`
  and upload a fresh build.
- After upload, verify the release summary contains a non-empty
  `app_store_build_icon_asset_token`; that is App Store Connect's API signal that
  the processed build includes an app icon from the binary.

Then tag:

```bash
git tag ios-testflight-v1.0
git push origin ios-testflight-v1.0
```

### iOS App Store

Before tagging:

1. update `apps/ios-companion/release/release.yml`
2. update `apps/ios-companion/fastlane/metadata/en-US/release_notes.txt`
3. verify screenshots or let CI regenerate them
4. commit and push to `main`

Then tag:

```bash
git tag ios-app-store-v1.0
git push origin ios-app-store-v1.0
```

### Forge Connectivity Service

Before tagging, update the package, lockfile, runtime, OpenAPI, and Dockerfile
versions together, then run:

```bash
npm ci --ignore-scripts --prefix packages/forge-connectivity-service
npm run verify:connectivity-service
npm run audit:connectivity-service
git tag connectivity-v0.1.0
git push origin connectivity-v0.1.0
```

The tag must match `packages/forge-connectivity-service/package.json` exactly and
must point to a commit already on `origin/main`.

iOS release rule:

- the marketing version in `apps/ios-companion/release/release.yml` must exactly match the
  version embedded in the iOS release tag
- release completion requires App Store Connect to accept and process a new build
  number for the intended IPA. Do not count an already-existing TestFlight build as
  proof that the new binary was released.
- 2026-05-22: Forge Companion `ios-testflight-v1.0.48` shipped through GitHub
  Actions run `26258880832` and distributed `1.0.48 (26)` to Internal testers.
  Do not re-tag the same TestFlight version just to repair plugin releases.
- 2026-05-22: Public plugin release `0.2.81` shipped from this public Forge repo
  after the HealthKit compressed-chunk server audit. `hermes-v0.2.81` published
  `forge-hermes-plugin==0.2.81` from GitHub Actions run `26315978932`; `v0.2.81`
  published `forge-openclaw-plugin@0.2.81` from run `26316264957` and
  `forge-memory@0.2.81` from run `26316264949`. Registry checks confirmed all
  three latest versions at `0.2.81`.
- 2026-06-04: App Store Connect returned a ContentDelivery checksum `500` after
  accepting Forge Companion `1.0.79 (30)`, then rejected reruns as duplicate build
  `30`. The Fastlane lane may reconcile ambiguous checksum errors by querying App
  Store Connect, but true duplicate build-number responses must fail unless
  `FORGE_IOS_ACCEPT_DUPLICATE_TESTFLIGHT_UPLOAD=1` is intentionally set for an
  identical already-accepted IPA.
- 2026-06-06: Forge Companion `1.0.82 (32)` was already valid in TestFlight and
  therefore did not carry the new Forge icon. The corrected icon build is
  `1.0.82 (33)`. Future TestFlight/App Store lanes verify App Store Connect's
  `iconAssetToken` and record it in `release-summary.json`.
- Current non-blocking workflow cleanup: GitHub Actions annotates
  `actions/upload-artifact@v4` as a Node.js 20 action. GitHub will force Node 24
  defaults starting 2026-06-02, so update the artifact action path before that
  becomes noisy or risky.

## What CI Actually Runs

### OpenClaw workflow

When a `v*` tag lands on a `main` commit, the workflow:

- checks out Forge
- verifies the tag commit is on `origin/main`
- installs Node and npm
- installs dependencies
- runs `FORGE_RELEASE_MODE=publish-from-tag ./scripts/release/release-forge-openclaw-plugin.sh <version>`
- publishes to npm through Trusted Publishing

### Hermes workflow

When a `hermes-v*` tag lands on a `main` commit, the workflow:

- checks out Forge
- verifies the tag commit is on `origin/main`
- installs Node and Python
- installs dependencies
- runs the Hermes build and verification path with upload disabled
- uploads the built dist artifacts to the publish job
- publishes to PyPI through Trusted Publishing

### iOS workflow

When an iOS release tag lands on a `main` commit, the workflow:

- checks out Forge
- verifies the tag commit is on `origin/main`
- derives release mode from the tag name
- installs dependencies
- writes `apps/ios-companion/.release.env` from GitHub secrets
- optionally installs signing certs and provisioning profiles
- verifies the marketing version matches the tag
- captures App Store screenshots
- runs `./apps/ios-companion/scripts/publish-forge-companion.sh testflight` or `app-store`
- uploads release artifacts and screenshots back to GitHub Actions

## Exact Tag Reference

- OpenClaw: `v0.2.27`
- Hermes: `hermes-v0.2.27`
- iOS TestFlight: `ios-testflight-v1.0`
- iOS App Store: `ios-app-store-v1.0`
- Forge Connectivity Service: `connectivity-v0.1.0`

## Quick Release Checklist

### Plugin release

1. Make sure `projects/forge` is clean
2. Make sure you are on `main`
3. Run the prepare command for OpenClaw or Hermes
4. Watch the matching GitHub Actions workflow
5. Confirm the package version is live on npm or PyPI:

```bash
npm view forge-openclaw-plugin version dist-tags --json
npm view forge-memory version dist-tags --json
python3 -m pip index versions forge-hermes-plugin
```

### iOS release

1. Update `apps/ios-companion/release/release.yml`
2. Update `apps/ios-companion/fastlane/metadata/en-US/release_notes.txt`
3. Push the changes on `main`
4. Push the correct iOS tag
5. Watch the GitHub Actions workflow
6. Confirm TestFlight upload or App Store submission in App Store Connect
7. Confirm the release summary has `uploaded: true`, the expected
   `build_number`, and a non-empty `app_store_build_icon_asset_token`

Normal iOS release commands must be limited to git operations and GitHub Actions
inspection. Local `./apps/ios-companion/scripts/publish-forge-companion.sh testflight`
is a fallback only, not the standard release process.

### Connectivity service release

1. Run `npm run verify:connectivity-service` and `npm run audit:connectivity-service`
2. Confirm the package version matches the intended tag
3. Push the feature/release commit to `main`
4. Push `connectivity-v<version>`
5. Confirm the GitHub release contains the package, source, SBOM, checksums, and signatures
6. Confirm both image platforms exist at the recorded digest
7. Verify the artifact attestations and Sigstore identities before deployment

Rollback does not erase the service database. Stop routing new peers to the
affected provider, pin clients to the last verified image digest, and restore an
application-consistent SQLite backup only when a schema rollback is explicitly
required. Never replace the database with an empty volume as a release rollback.

## Recent Verified Releases

### 0.2.82 HealthKit raw-deflate compatibility

- Fix commit: `8219cd0` (`Fix raw deflate HealthKit chunks`)
- Hermes release commit/tag: `98cb7d1`, `hermes-v0.2.82`
- OpenClaw and Forge Memory release commit/tag: `87f905b`, `v0.2.82`
- GitHub Actions:
  - `26317293766` published `forge-hermes-plugin==0.2.82`
  - `26317382762` published `forge-openclaw-plugin@0.2.82`
  - `26317382763` published `forge-memory@0.2.82`
- Registry verification confirmed npm latest `0.2.82` for OpenClaw and Forge
  Memory, and PyPI latest `0.2.82` for Hermes.

HealthKit compression note: Forge Companion's `NSData.compressed(using: .zlib)`
payloads are raw DEFLATE streams in practice. The server must accept both
zlib-wrapped DEFLATE and raw DEFLATE for `payload_json_deflate_base64`, while
preserving the decoded-size limit so compressed chunks cannot inflate past
`HEALTH_MOBILE_SYNC_CHUNK_MAX_BYTES`. The screenshot symptom for this bug was a
`sleep_nights` chunk failing with `invalid_chunk_payload` and
`The HealthKit sync compressed payload cannot be decompressed`.

### 0.2.85 progressive HealthKit archive visibility

- Fix commit: `b5a6c5c` (`Fix progressive HealthKit archive visibility`)
- Release commit/tag: `b9197eb`, `v0.2.85`, `hermes-v0.2.85`,
  `ios-testflight-v1.0.51`
- GitHub Actions:
  - `26345638737` published `forge-openclaw-plugin@0.2.85`
  - `26345638738` published `forge-memory@0.2.85`
  - `26345657938` published `forge-hermes-plugin==0.2.85`
  - `26345660863` uploaded Forge Companion TestFlight `1.0.51 (26)` and
    distributed it to Internal testers
- Registry verification confirmed npm latest `0.2.85` for OpenClaw and Forge
  Memory, and PyPI version `0.2.85` for Hermes.

HealthKit progressive visibility note: `workout_archive` chunks must be ingested
as they arrive, not only at `/complete`. The Sports browser should receive a
lightweight long session list while analytics-heavy payloads stay bounded, so the
web app is not capped at 40 visible workouts and does not ship heavy analytics
for every historical session.

## Fallback Local No-Prompt Mode

The recommended path is CI publishing. If you must publish locally without repeated
prompts, these are the practical fallbacks:

### npm local fallback

- run `npm login` once on the machine so npm stores credentials in `~/.npmrc`
- then run the OpenClaw release script without `FORGE_RELEASE_MODE=prepare`

npm fallback constraints:

- if npm package settings force interactive 2FA for every publish, local direct publish
  may still prompt
- Trusted Publishing through GitHub Actions is the cleaner path

### PyPI local fallback

- keep using CI if possible
- if you must publish locally, store Twine credentials in a supported local config such
  as `~/.pypirc` or your system keychain and run the Hermes release script without
  `FORGE_RELEASE_MODE=prepare`

### iOS local fallback

- keep `apps/ios-companion/.release.env` filled once
- then run:

```bash
./apps/ios-companion/scripts/publish-forge-companion.sh testflight
./apps/ios-companion/scripts/publish-forge-companion.sh app-store
```

That script already supports non-interactive App Store Connect API key auth, so it
should not ask you to log in each time as long as the local Apple signing state is
good enough for the build.
