#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_PATH="$IOS_DIR/ForgeCompanion.xcodeproj"
SCHEME="ForgeWatch Watch App"
DERIVED_DATA_PATH="${FORGE_WATCH_MEASURE_DERIVED_DATA:-$IOS_DIR/.artifacts/watch-measure-derived}"
OUTPUT_DIR="${FORGE_WATCH_MEASURE_OUTPUT_DIR:-$IOS_DIR/.artifacts/watch-usability}"
BUNDLE_ID="com.albertbuchard.ForgeCompanion.watchkitapp"
REQUESTED_DEVICE_NAME="${FORGE_WATCH_MEASURE_DEVICE_NAME:-Apple Watch Series 11 (46mm)}"
WAIT_SECONDS="${FORGE_WATCH_MEASURE_WAIT_SECONDS:-3}"
SURFACES="${FORGE_WATCH_MEASURE_SURFACES:-now work habits psyche health sync}"
DEVICE_NAME=""
SIMULATOR_UDID=""

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

find_simulator() {
  local device_name="$1"
  local udid
  udid="$(
    xcrun simctl list devices available |
      awk -v device="$device_name" '
        index($0, device) > 0 {
          if (match($0, /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/)) {
            print substr($0, RSTART, RLENGTH);
            exit;
          }
        }
      '
  )"
  if [[ -n "$udid" ]]; then
    DEVICE_NAME="$device_name"
    SIMULATOR_UDID="$udid"
    return 0
  fi
  return 1
}

if ! find_simulator "$REQUESTED_DEVICE_NAME"; then
  for candidate in "Apple Watch Series 11 (46mm)" "Apple Watch Series 10 (46mm)" "Apple Watch Ultra 3 (49mm)" "Apple Watch Ultra 2 (49mm)"; do
    if find_simulator "$candidate"; then
      break
    fi
  done
fi

if [[ -z "$SIMULATOR_UDID" ]]; then
  echo "Could not find an available watchOS simulator matching '$REQUESTED_DEVICE_NAME' or the fallback list." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

BOOT_START_MS="$(now_ms)"
xcrun simctl boot "$SIMULATOR_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIMULATOR_UDID" -b >/dev/null
BOOT_MS="$(( $(now_ms) - BOOT_START_MS ))"

BUILD_START_MS="$(now_ms)"
xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -destination "platform=watchOS Simulator,id=$SIMULATOR_UDID" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  build \
  CODE_SIGNING_ALLOWED=NO >/dev/null
BUILD_MS="$(( $(now_ms) - BUILD_START_MS ))"

APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug-watchsimulator/ForgeWatch Watch App.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected built app at '$APP_PATH' but it was not found." >&2
  exit 1
fi

INSTALL_START_MS="$(now_ms)"
xcrun simctl uninstall "$SIMULATOR_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$SIMULATOR_UDID" "$APP_PATH" >/dev/null
INSTALL_MS="$(( $(now_ms) - INSTALL_START_MS ))"

SUMMARY_PATH="$OUTPUT_DIR/watch-usability-summary.json"
REPORT_PATH="$OUTPUT_DIR/watch-usability-summary.md"
rm -f "$SUMMARY_PATH" "$REPORT_PATH"

cat >"$SUMMARY_PATH" <<JSON
{
  "deviceName": "$DEVICE_NAME",
  "deviceUdid": "$SIMULATOR_UDID",
  "bundleId": "$BUNDLE_ID",
  "previewMode": true,
  "waitSecondsBeforeScreenshot": $WAIT_SECONDS,
  "bootMs": $BOOT_MS,
  "buildMs": $BUILD_MS,
  "installMs": $INSTALL_MS,
  "expectedPhoneRefreshRequests": 0,
  "surfaces": [
JSON

first=1
for surface in $SURFACES; do
  screenshot_path="$OUTPUT_DIR/watch-${surface}-preview.png"
  launch_start_ms="$(now_ms)"
  xcrun simctl terminate "$SIMULATOR_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch "$SIMULATOR_UDID" "$BUNDLE_ID" --forge-watch-preview "--forge-watch-surface=${surface}" >/dev/null
  sleep "$WAIT_SECONDS"
  xcrun simctl io "$SIMULATOR_UDID" screenshot "$screenshot_path" >/dev/null
  launch_capture_ms="$(( $(now_ms) - launch_start_ms ))"
  file_bytes="$(wc -c <"$screenshot_path" | tr -d ' ')"

  if [[ "$first" -eq 0 ]]; then
    printf ',\n' >>"$SUMMARY_PATH"
  fi
  first=0
  cat >>"$SUMMARY_PATH" <<JSON
    {
      "surface": "$surface",
      "screenshotPath": "$screenshot_path",
      "screenshotBytes": $file_bytes,
      "launchToScreenshotMs": $launch_capture_ms
    }
JSON
done

cat >>"$SUMMARY_PATH" <<JSON

  ]
}
JSON

{
  echo "# Forge Watch Usability Measurement"
  echo
  echo "- Device: $DEVICE_NAME ($SIMULATOR_UDID)"
  echo "- Preview mode: true"
  echo "- Wait before screenshot: ${WAIT_SECONDS}s"
  echo "- Boot: ${BOOT_MS}ms"
  echo "- Build: ${BUILD_MS}ms"
  echo "- Install: ${INSTALL_MS}ms"
  echo "- Expected phone refresh requests in preview mode: 0"
  echo
  echo "| Surface | Launch to screenshot | Screenshot |"
  echo "|---|---:|---|"
  node -e '
    const fs = require("fs");
    const summary = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const surface of summary.surfaces) {
      console.log(`| ${surface.surface} | ${surface.launchToScreenshotMs}ms | ${surface.screenshotPath} |`);
    }
  ' "$SUMMARY_PATH"
} >"$REPORT_PATH"

echo "Watch usability measurement complete."
echo "Summary: $SUMMARY_PATH"
echo "Report: $REPORT_PATH"
