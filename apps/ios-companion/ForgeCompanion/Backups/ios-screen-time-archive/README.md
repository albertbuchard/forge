# iOS Screen Time Archive

This folder preserves the removed iOS Screen Time implementation so it can be reused later when we build the Android companion flow.

Status:
- Removed from the live iOS companion app on April 12, 2026.
- Not shipped in the active iOS UI anymore.
- Kept here as a backup reference only.

Why it was removed:
- The `DeviceActivityReport` content rendered blank in captured debug images.
- The OCR fallback was not reliable enough for production.
- We are preserving the logic for future cross-platform work instead of continuing to ship a broken iOS surface.

Backed up files:
- `ScreenTimeStore.swift.backup`
- `ScreenTimeSettingsSheet.swift.backup`
- `ScreenTimeCaptureHost.swift.backup`
- `PairedForgeScreen.swift.backup`
- `CompanionMenuSheet.swift.backup`
- `CompanionDiagnosticsSheet.swift.backup`
- `CompanionAppModel.swift.backup`

What these backups contain:
- The removed iOS Screen Time menu and settings views.
- The report capture and OCR experiment.
- The app wiring that exposed Screen Time inside the iOS companion.

Intended future use:
- Reuse the product shape and sync concepts when adding Screen Time support to the Android companion.
- Treat these backups as reference material, not as working iOS code.
