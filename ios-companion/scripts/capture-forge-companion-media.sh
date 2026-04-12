#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="/Users/omarclaw/Documents/aurel-monorepo/projects/forge"
IOS_DIR="$ROOT_DIR/ios-companion"
PROJECT_PATH="$IOS_DIR/ForgeCompanion.xcodeproj"
SCHEME="ForgeCompanion"
DERIVED_DATA_PATH="$IOS_DIR/.artifacts/screenshot-derived-data"
RAW_OUTPUT_DIR="$IOS_DIR/.artifacts/screenshot-raw"
FINAL_OUTPUT_DIR="$IOS_DIR/fastlane/screenshots/en-US/iphone-65"
BUNDLE_ID="com.albertbuchard.ForgeCompanion"
REQUESTED_DEVICE_NAME="${FORGE_IOS_SCREENSHOT_DEVICE_NAME:-iPhone 17 Pro Max}"
DEVICE_NAME=""
SIMULATOR_UDID=""

find_simulator() {
  local device_name="$1"
  local udid
  udid="$(
    xcrun simctl list devices available | awk -F '[()]' -v device="$device_name" '$0 ~ device {print $2; exit}'
  )"
  if [[ -n "${udid}" ]]; then
    DEVICE_NAME="${device_name}"
    SIMULATOR_UDID="${udid}"
    return 0
  fi
  return 1
}

if ! find_simulator "${REQUESTED_DEVICE_NAME}"; then
  for candidate in "iPhone 17 Pro Max" "iPhone 16 Pro Max" "iPhone 15 Pro Max" "iPhone 14 Pro Max"; do
    if find_simulator "${candidate}"; then
      break
    fi
  done
fi

if [[ -z "${SIMULATOR_UDID}" ]]; then
  echo "Could not find an available simulator matching '${REQUESTED_DEVICE_NAME}' or the fallback list." >&2
  exit 1
fi

mkdir -p "$RAW_OUTPUT_DIR" "$FINAL_OUTPUT_DIR"
rm -f "$FINAL_OUTPUT_DIR"/*.png

cleanup() {
  xcrun simctl status_bar "$SIMULATOR_UDID" clear >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Booting simulator $DEVICE_NAME ($SIMULATOR_UDID)..."
xcrun simctl boot "$SIMULATOR_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIMULATOR_UDID" -b

echo "Applying screenshot status bar override..."
xcrun simctl status_bar "$SIMULATOR_UDID" override \
  --time "9:41" \
  --batteryState charged \
  --batteryLevel 100 \
  --wifiBars 3 \
  --wifiMode active \
  --cellularMode notSupported >/dev/null

echo "Building Forge Companion for simulator screenshots..."
xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  build >/dev/null

APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug-iphonesimulator/ForgeCompanion.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected built app at $APP_PATH but it was not found." >&2
  exit 1
fi

echo "Installing app..."
xcrun simctl uninstall "$SIMULATOR_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$SIMULATOR_UDID" "$APP_PATH" >/dev/null

capture_scenario() {
  local scenario="$1"
  local filename="$2"
  local wait_seconds="$3"
  local raw_path="$RAW_OUTPUT_DIR/$filename"
  local final_path="$FINAL_OUTPUT_DIR/$filename"

  echo "Capturing $scenario -> $final_path"
  xcrun simctl terminate "$SIMULATOR_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  SIMCTL_CHILD_FORGE_SCREENSHOT_SCENARIO="$scenario" \
    xcrun simctl launch "$SIMULATOR_UDID" "$BUNDLE_ID" >/dev/null
  sleep "$wait_seconds"
  xcrun simctl io "$SIMULATOR_UDID" screenshot "$raw_path" >/dev/null
  sips -z 2778 1284 "$raw_path" --out "$final_path" >/dev/null
}

capture_scenario "pairing" "01-pairing.png" 4
capture_scenario "home" "02-home.png" 4
capture_scenario "life-timeline" "03-life-timeline.png" 5
capture_scenario "diagnostics" "04-diagnostics.png" 5

echo
echo "Final screenshot sizes:"
for file in "$FINAL_OUTPUT_DIR"/*.png; do
  size_output="$(sips -g pixelWidth -g pixelHeight "$file" 2>/dev/null)"
  width="$(printf '%s\n' "$size_output" | awk '/pixelWidth:/ {print $2}')"
  height="$(printf '%s\n' "$size_output" | awk '/pixelHeight:/ {print $2}')"
  echo "  $(basename "$file"): ${width}x${height}"
done

echo
echo "Ready media folder:"
echo "  $FINAL_OUTPUT_DIR"
