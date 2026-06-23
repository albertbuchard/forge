fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios validate_release

```sh
[bundle exec] fastlane ios validate_release
```

Validate Forge Companion release inputs and produce a local archive without uploading

### ios testflight_release

```sh
[bundle exec] fastlane ios testflight_release
```

Archive and upload Forge Companion to TestFlight

### ios app_store_release

```sh
[bundle exec] fastlane ios app_store_release
```

Archive, upload, and submit Forge Companion for App Store review

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
