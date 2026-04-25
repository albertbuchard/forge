# Forge Release Cheat Sheet

This is the fastest accurate reference for shipping Forge releases from the nested
`projects/forge` repository.

The release model now splits into two phases:

1. local prep on a clean checkout of `main`
2. tag-driven publish in GitHub Actions

That keeps npm, PyPI, and App Store Connect auth out of your interactive shell during
normal releases.

## Release Types

Forge currently has three automated release tracks:

- OpenClaw plugin to npm
- Hermes plugin to PyPI
- Forge Companion iOS release to TestFlight or the App Store

The GitHub Actions workflows live in:

- `.github/workflows/release-openclaw-plugin.yml`
- `.github/workflows/release-hermes-plugin.yml`
- `.github/workflows/release-ios-companion.yml`

All release tags must point at commits already on `main`. The workflows verify that.

## One-Time Requirements

### GitHub

- the `projects/forge` nested repo must be connected to GitHub with Actions enabled
- you need permission to push `main` and push tags
- the workflows must stay in the Forge repo, not only in the parent monorepo

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
- the workflow installs Node `22.14.0` and upgrades npm to `11.5.1+` because that is
  required for npm trusted publishing

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

- release config file: `ios-companion/release/release.yml`
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
   - `com.albertbuchard.ForgeCompanion.ForgeScreenTimeReportExtension`
3. Make sure app category, pricing, availability, export compliance, privacy
   questionnaire, and age rating are complete
4. Create an App Store Connect API key with permission to upload builds and manage
   releases
5. Prepare persistent Apple Distribution signing assets for GitHub Actions CI.
   Do not rely on Xcode-managed automatic signing on hosted runners, because each
   fresh runner can create another throwaway Apple Development certificate and
   eventually exhaust the Apple account certificate limit.

## GitHub Secrets

### Required for iOS workflow

Choose one of these secret styles in the Forge GitHub repo.

Single-secret setup:

- `FORGE_IOS_RELEASE_ENV` with the raw multiline contents of `ios-companion/.release.env`, or
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
- or these four split secrets:
- `FORGE_IOS_PROFILE_APP_BASE64`
- `FORGE_IOS_PROFILE_SCREENTIME_BASE64`
- `FORGE_IOS_PROFILE_WATCH_APP_BASE64`
- `FORGE_IOS_PROFILE_WATCH_EXTENSION_BASE64`

Formatting note:

- `FORGE_IOS_RELEASE_ENV(_BASE64)` should include the same values you would put in
  `ios-companion/.release.env`
- `FORGE_ASC_KEY_CONTENT_BASE64` should be the base64 body of the `.p8` App Store
  Connect key
- `FORGE_IOS_BUILD_CERTIFICATE_BASE64` should be the base64 body of the exported `.p12`
- `FORGE_IOS_PROVISIONING_PROFILES_BASE64` should be one or more base64
  `.mobileprovision` payloads separated by newlines, but GitHub secret size limits
  may require using the four split profile secrets instead
- the provisioning-profile secret set must cover the iPhone app, watch app, watch
  extension, and screen-time report extension bundle ids used by
  `ForgeCompanion.xcodeproj`

## Local Prep Commands

Run these from `/Users/omarclaw/Documents/aurel-monorepo/projects/forge`.

### OpenClaw

Patch release:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release-forge-openclaw-plugin.sh patch
```

Explicit version:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release-forge-openclaw-plugin.sh 0.2.27
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
FORGE_RELEASE_MODE=prepare ./scripts/release-forge-hermes-plugin.sh patch
```

Explicit version:

```bash
FORGE_RELEASE_MODE=prepare ./scripts/release-forge-hermes-plugin.sh 0.2.27
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

Before tagging:

1. update `ios-companion/release/release.yml`
2. update `ios-companion/fastlane/metadata/en-US/release_notes.txt`
3. replace any metadata placeholders if still present
4. commit and push to `main`

Then tag:

```bash
git -C /Users/omarclaw/Documents/aurel-monorepo/projects/forge tag ios-testflight-v1.0
git -C /Users/omarclaw/Documents/aurel-monorepo/projects/forge push origin ios-testflight-v1.0
```

### iOS App Store

Before tagging:

1. update `ios-companion/release/release.yml`
2. update `ios-companion/fastlane/metadata/en-US/release_notes.txt`
3. verify screenshots or let CI regenerate them
4. commit and push to `main`

Then tag:

```bash
git -C /Users/omarclaw/Documents/aurel-monorepo/projects/forge tag ios-app-store-v1.0
git -C /Users/omarclaw/Documents/aurel-monorepo/projects/forge push origin ios-app-store-v1.0
```

Important iOS rule:

- the marketing version in `ios-companion/release/release.yml` must exactly match the
  version embedded in the iOS release tag

## What CI Actually Runs

### OpenClaw workflow

When a `v*` tag lands on a `main` commit, the workflow:

- checks out Forge
- verifies the tag commit is on `origin/main`
- installs Node and npm
- installs dependencies
- runs `FORGE_RELEASE_MODE=publish-from-tag ./scripts/release-forge-openclaw-plugin.sh <version>`
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
- writes `ios-companion/.release.env` from GitHub secrets
- optionally installs signing certs and provisioning profiles
- verifies the marketing version matches the tag
- captures App Store screenshots
- runs `./ios-companion/scripts/publish-forge-companion.sh testflight` or `app-store`
- uploads release artifacts and screenshots back to GitHub Actions

## Exact Tag Reference

- OpenClaw: `v0.2.27`
- Hermes: `hermes-v0.2.27`
- iOS TestFlight: `ios-testflight-v1.0`
- iOS App Store: `ios-app-store-v1.0`

## Quick Release Checklist

### Plugin release

1. Make sure `projects/forge` is clean
2. Make sure you are on `main`
3. Run the prepare command for OpenClaw or Hermes
4. Watch the matching GitHub Actions workflow
5. Confirm the package version is live on npm or PyPI

### iOS release

1. Update `ios-companion/release/release.yml`
2. Update `ios-companion/fastlane/metadata/en-US/release_notes.txt`
3. Push the changes on `main`
4. Push the correct iOS tag
5. Watch the GitHub Actions workflow
6. Confirm TestFlight upload or App Store submission in App Store Connect

## Fallback Local No-Prompt Mode

The recommended path is CI publishing. If you must publish locally without repeated
prompts, these are the practical fallbacks:

### npm local fallback

- run `npm login` once on the machine so npm stores credentials in `~/.npmrc`
- then run the OpenClaw release script without `FORGE_RELEASE_MODE=prepare`

Important:

- if npm package settings force interactive 2FA for every publish, local direct publish
  may still prompt
- Trusted Publishing through GitHub Actions is the cleaner path

### PyPI local fallback

- keep using CI if possible
- if you must publish locally, store Twine credentials in a supported local config such
  as `~/.pypirc` or your system keychain and run the Hermes release script without
  `FORGE_RELEASE_MODE=prepare`

### iOS local fallback

- keep `ios-companion/.release.env` filled once
- then run:

```bash
./ios-companion/scripts/publish-forge-companion.sh testflight
./ios-companion/scripts/publish-forge-companion.sh app-store
```

That script already supports non-interactive App Store Connect API key auth, so it
should not ask you to log in each time as long as the local Apple signing state is
good enough for the build.
