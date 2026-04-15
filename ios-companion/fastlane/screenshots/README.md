## Forge Companion App Store Screenshots

Generate the current iPhone App Store screenshots with:

```bash
cd /Users/omarclaw/Documents/aurel-monorepo/projects/forge
npm run media:ios-companion:screenshots
```

The script captures deterministic seeded simulator states and writes the source App Store-ready files to:

- `ios-companion/fastlane/screenshots/en-US/iphone-65/01-pairing.png`
- `ios-companion/fastlane/screenshots/en-US/iphone-65/02-home.png`
- `ios-companion/fastlane/screenshots/en-US/iphone-65/03-life-timeline.png`
- `ios-companion/fastlane/screenshots/en-US/iphone-65/04-diagnostics.png`

Notes:

- The simulator source device is `iPhone 17 Pro Max`.
- The final exported PNGs are normalized to `1284 x 2778` so they fit the 6.5-inch App Store Connect slot.
- These screenshots are seeded from a local screenshot mode and do not require a live Forge runtime.
- `en-US` is the source locale. The Fastlane release pipeline automatically mirrors this
  screenshot set into every locale listed in `ios-companion/release/release.yml` under
  `metadata.screenshot_locales` before App Store validation and upload.
