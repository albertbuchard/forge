#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_PATH="$IOS_DIR/ForgeCompanion.xcodeproj"
SCHEME="ForgeWatch Watch App"
DERIVED_DATA_PATH="${FORGE_WATCH_MEASURE_DERIVED_DATA:-$IOS_DIR/.artifacts/watch-measure-derived}"
OUTPUT_DIR="${FORGE_WATCH_MEASURE_OUTPUT_DIR:-$IOS_DIR/.artifacts/watch-usability}"
BUNDLE_ID="com.albertbuchard.ForgeCompanion.watchkitapp"
REQUESTED_DEVICE_NAME="${FORGE_WATCH_MEASURE_DEVICE_NAME:-Apple Watch Series 11 (46mm)}"
WAIT_SECONDS="${FORGE_WATCH_MEASURE_WAIT_SECONDS:-3}"
READY_TIMEOUT_SECONDS="${FORGE_WATCH_MEASURE_READY_TIMEOUT_SECONDS:-20}"
READY_POLL_SECONDS="${FORGE_WATCH_MEASURE_READY_POLL_SECONDS:-1}"
READY_SETTLE_SECONDS="${FORGE_WATCH_MEASURE_READY_SETTLE_SECONDS:-1}"
SURFACES="${FORGE_WATCH_MEASURE_SURFACES:-now work habits psyche health sync}"
REQUIRE_EXTERNAL_ROOT="${FORGE_WATCH_MEASURE_REQUIRE_EXTERNAL_ROOT:-0}"
DEVICE_NAME=""
SIMULATOR_UDID=""

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

surface_title() {
  case "$1" in
    now) echo "Now" ;;
    work) echo "Work" ;;
    habits) echo "Habits" ;;
    psyche) echo "Psyche" ;;
    health) echo "Health" ;;
    sync) echo "Sync" ;;
    *)
      echo "Unsupported measured watch surface: $1" >&2
      return 1
      ;;
  esac
}

REPOSITORY_ROOT="$(cd "$IOS_DIR/../.." && pwd -P)"

assert_external_release_root() {
  local candidate="$1"
  case "$candidate" in
    "$REPOSITORY_ROOT"|"$REPOSITORY_ROOT"/*)
      echo "Release watch evidence must stay outside the public repository: $candidate" >&2
      exit 1
      ;;
  esac
}

if [[ "$REQUIRE_EXTERNAL_ROOT" == "1" ]]; then
  assert_external_release_root "$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$DERIVED_DATA_PATH")"
  assert_external_release_root "$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$OUTPUT_DIR")"
fi

mkdir -p "$DERIVED_DATA_PATH" "$OUTPUT_DIR"
DERIVED_DATA_PATH="$(cd "$DERIVED_DATA_PATH" && pwd -P)"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
if [[ "$DERIVED_DATA_PATH" == "$OUTPUT_DIR" ]]; then
  echo "Watch derived data and usability evidence must use separate directories." >&2
  exit 1
fi
if [[ "$REQUIRE_EXTERNAL_ROOT" == "1" ]]; then
  assert_external_release_root "$DERIVED_DATA_PATH"
  assert_external_release_root "$OUTPUT_DIR"
fi
chmod 700 "$DERIVED_DATA_PATH" "$OUTPUT_DIR"

VERIFIER_BINARY="$DERIVED_DATA_PATH/verify-watch-screenshot"
xcrun swiftc "$SCRIPT_DIR/verify-watch-screenshot.swift" -o "$VERIFIER_BINARY"
"$VERIFIER_BINARY" --self-test >/dev/null

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
SEEN_HASHES_PATH="$OUTPUT_DIR/.accepted-watch-screenshot-hashes.tsv"
rm -f "$SEEN_HASHES_PATH"
touch "$SEEN_HASHES_PATH"
chmod 600 "$SEEN_HASHES_PATH"

cat >"$SUMMARY_PATH" <<JSON
{
  "deviceName": "$DEVICE_NAME",
  "deviceUdid": "$SIMULATOR_UDID",
  "bundleId": "$BUNDLE_ID",
  "previewMode": true,
  "waitSecondsBeforeScreenshot": $WAIT_SECONDS,
  "readyTimeoutSeconds": $READY_TIMEOUT_SECONDS,
  "readyPollSeconds": $READY_POLL_SECONDS,
  "readySettleSeconds": $READY_SETTLE_SECONDS,
  "bootMs": $BOOT_MS,
  "buildMs": $BUILD_MS,
  "installMs": $INSTALL_MS,
  "expectedPhoneRefreshRequests": 0,
  "surfaces": [
JSON

first=1
for surface in $SURFACES; do
  expected_title="$(surface_title "$surface")"
  screenshot_path="$OUTPUT_DIR/watch-${surface}-preview.png"
  candidate_path="$OUTPUT_DIR/.watch-${surface}-candidate.png"
  verification_log="$OUTPUT_DIR/.watch-${surface}-verification.log"
  rm -f "$screenshot_path" "$candidate_path" "$verification_log"
  launch_start_ms="$(now_ms)"
  xcrun simctl terminate "$SIMULATOR_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch "$SIMULATOR_UDID" "$BUNDLE_ID" --forge-watch-preview "--forge-watch-surface=${surface}" >/dev/null
  sleep "$WAIT_SECONDS"
  readiness_deadline_ms="$(( $(now_ms) + READY_TIMEOUT_SECONDS * 1000 ))"
  readiness_attempts=0
  screenshot_sha256=""
  while [[ "$(now_ms)" -le "$readiness_deadline_ms" ]]; do
    readiness_attempts="$((readiness_attempts + 1))"
    xcrun simctl io "$SIMULATOR_UDID" screenshot "$candidate_path" >/dev/null
    if "$VERIFIER_BINARY" --title-only "$candidate_path" "$expected_title" 2>"$verification_log" >/dev/null; then
      sleep "$READY_SETTLE_SECONDS"
      xcrun simctl io "$SIMULATOR_UDID" screenshot "$candidate_path" >/dev/null
      if screenshot_sha256="$(
        "$VERIFIER_BINARY" \
          "$candidate_path" \
          "$expected_title" \
          "$surface" \
          "$SEEN_HASHES_PATH" \
          2>"$verification_log"
      )"; then
        mv "$candidate_path" "$screenshot_path"
        chmod 600 "$screenshot_path"
        break
      fi
    fi
    sleep "$READY_POLL_SECONDS"
  done
  if [[ -z "$screenshot_sha256" || ! -f "$screenshot_path" ]]; then
    echo "The '$surface' watch surface did not render '$expected_title' within ${READY_TIMEOUT_SECONDS}s." >&2
    if [[ -s "$verification_log" ]]; then
      cat "$verification_log" >&2
    fi
    exit 1
  fi
  rm -f "$candidate_path" "$verification_log"
  launch_capture_ms="$(( $(now_ms) - launch_start_ms ))"
  file_bytes="$(wc -c <"$screenshot_path" | tr -d ' ')"

  if [[ "$first" -eq 0 ]]; then
    printf ',\n' >>"$SUMMARY_PATH"
  fi
  first=0
  cat >>"$SUMMARY_PATH" <<JSON
    {
      "surface": "$surface",
      "expectedTitle": "$expected_title",
      "screenshotPath": "$screenshot_path",
      "screenshotBytes": $file_bytes,
      "screenshotSha256": "$screenshot_sha256",
      "readinessAttempts": $readiness_attempts,
      "launchToScreenshotMs": $launch_capture_ms
    }
JSON
done
rm -f "$SEEN_HASHES_PATH"

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
chmod 600 "$SUMMARY_PATH" "$REPORT_PATH"

echo "Watch usability measurement complete."
echo "Summary: $SUMMARY_PATH"
echo "Report: $REPORT_PATH"
