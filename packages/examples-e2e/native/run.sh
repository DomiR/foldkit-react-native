#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$E2E_DIR/../.." && pwd)"
NATIVE_APP_DIR="$REPO_ROOT/examples/native-showcase"
EXPO_BIN="$NATIVE_APP_DIR/node_modules/.bin/expo"
FLOW_DIR="$SCRIPT_DIR/flows/native-showcase"
RESULT_DIR="$E2E_DIR/test-results/native"
METRO_LOG="$RESULT_DIR/metro.log"
METRO_URL="exp://127.0.0.1:8082"
METRO_PORT=8082

IOS_APP_ID="host.exp.Exponent"
ANDROID_APP_ID="host.exp.exponent"

IOS_UDID="${IOS_UDID:-}"
ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
METRO_PID=""
METRO_PGID=""
METRO_STARTED=0
ANDROID_REVERSE_ADDED=0
ANDROID_REVERSE_WAS_PRESENT=0

usage() {
  printf 'Usage: %s ios|android|all\n' "$0" >&2
}

port_is_listening() {
  if command -v lsof >/dev/null 2>&1 &&
    lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0
  fi

  if command -v nc >/dev/null 2>&1 &&
    nc -z -G 1 127.0.0.1 "$METRO_PORT" >/dev/null 2>&1; then
    return 0
  fi

  if command -v nc >/dev/null 2>&1 &&
    nc -z -G 1 ::1 "$METRO_PORT" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "$METRO_PGID" ]]; then
    kill -TERM -- "-$METRO_PGID" >/dev/null 2>&1 || true
  fi

  if (( ANDROID_REVERSE_ADDED == 1 )); then
    adb -s "$ANDROID_SERIAL" reverse --remove tcp:"$METRO_PORT" >/dev/null 2>&1 || true
  fi

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! port_is_listening; then
      break
    fi
    sleep 1
  done

  if port_is_listening && [[ -n "$METRO_PGID" ]]; then
    kill -KILL -- "-$METRO_PGID" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5; do
      if ! port_is_listening; then
        break
      fi
      sleep 1
    done
  fi

  if [[ -n "$METRO_PID" ]]; then
    wait "$METRO_PID" >/dev/null 2>&1 || true
  fi

  if (( METRO_STARTED == 1 )) && port_is_listening; then
    printf 'native smoke test cleanup failed: port %s is still held\n' "$METRO_PORT" >&2
    status=1
  fi

  exit "$status"
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

case "$1" in
  ios)
    RUN_IOS=1
    RUN_ANDROID=0
    ;;
  android)
    RUN_IOS=0
    RUN_ANDROID=1
    ;;
  all)
    RUN_IOS=1
    RUN_ANDROID=1
    ;;
  *)
    usage
    exit 2
    ;;
esac

if ! command -v lsof >/dev/null 2>&1 && ! command -v nc >/dev/null 2>&1; then
  printf 'native smoke test cannot run: lsof or nc is required to check port %s\n' "$METRO_PORT" >&2
  exit 1
fi

if port_is_listening; then
  printf 'native smoke test refused: port %s is already in use\n' "$METRO_PORT" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  printf 'native smoke test cannot run: curl is required\n' >&2
  exit 1
fi

if ! command -v maestro >/dev/null 2>&1; then
  printf 'native smoke test cannot run: maestro must be on PATH\n' >&2
  exit 1
fi

if [[ ! -x "$EXPO_BIN" ]]; then
  printf 'native smoke test cannot run: Expo CLI binary is missing at %s\n' "$EXPO_BIN" >&2
  exit 1
fi

mkdir -p "$RESULT_DIR/ios" "$RESULT_DIR/android"

IOS_READY=0
ANDROID_READY=0

if (( RUN_IOS == 1 )); then
  if ! command -v xcrun >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
    printf 'iOS native smoke test unavailable: xcrun and python3 are required\n' >&2
  else
    BOOTED_SIMULATORS=""
    if ! BOOTED_SIMULATORS="$(xcrun simctl list devices booted -j 2>/dev/null)"; then
      printf 'iOS native smoke test unavailable: could not list booted simulators\n' >&2
    else
      if [[ -z "$IOS_UDID" ]]; then
        IOS_UDID="$(python3 -c 'import json,sys; data=json.load(sys.stdin); print(next((device["udid"] for devices in data.get("devices", {}).values() for device in devices if device.get("state") == "Booted"), ""))' <<<"$BOOTED_SIMULATORS")"
      fi

      if [[ -z "$IOS_UDID" ]]; then
        printf 'iOS native smoke test unavailable: no booted simulator was found\n' >&2
      elif ! python3 -c 'import json,sys; data=json.load(sys.stdin); udid=sys.argv[1]; raise SystemExit(0 if any(device.get("udid") == udid and device.get("state") == "Booted" for devices in data.get("devices", {}).values() for device in devices) else 1)' "$IOS_UDID" <<<"$BOOTED_SIMULATORS"; then
        printf 'iOS native smoke test unavailable: simulator %s is not booted\n' "$IOS_UDID" >&2
      elif ! xcrun simctl get_app_container "$IOS_UDID" "$IOS_APP_ID" >/dev/null 2>&1; then
        printf 'iOS native smoke test unavailable: Expo Go is not installed on %s\n' "$IOS_UDID" >&2
      else
        IOS_READY=1
      fi
    fi
  fi
fi

if (( RUN_ANDROID == 1 )); then
  if ! command -v adb >/dev/null 2>&1; then
    printf 'Android native smoke test unavailable: adb is required\n' >&2
  elif [[ "$(adb -s "$ANDROID_SERIAL" get-state 2>/dev/null || true)" != "device" ]]; then
    printf 'Android native smoke test unavailable: device %s is not ready\n' "$ANDROID_SERIAL" >&2
  elif ! adb -s "$ANDROID_SERIAL" shell pm list packages 2>/dev/null | grep -q '^package:host\.exp\.exponent$'; then
    printf 'Android native smoke test unavailable: Expo Go is not installed on %s\n' "$ANDROID_SERIAL" >&2
  else
    ANDROID_READY=1
  fi
fi

if (( IOS_READY == 0 && ANDROID_READY == 0 )); then
  printf 'native smoke test did not start: no requested platform has a ready device\n' >&2
  exit 1
fi

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

set -m
(
  cd "$NATIVE_APP_DIR"
  CI=1 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 \
    "$EXPO_BIN" start --port "$METRO_PORT" --localhost >"$METRO_LOG" 2>&1
) &
METRO_PID=$!
METRO_STARTED=1
METRO_PGID="$(ps -o pgid= -p "$METRO_PID" | tr -d ' ')"
if [[ -z "$METRO_PGID" ]]; then
  METRO_PGID="$METRO_PID"
fi

METRO_READY=0
for ((second = 1; second <= 120; second += 1)); do
  if ! kill -0 "$METRO_PID" >/dev/null 2>&1 && ! port_is_listening; then
    printf 'native smoke test failed: Metro exited before readiness; see %s\n' "$METRO_LOG" >&2
    exit 1
  fi

  STATUS_BODY="$(curl --silent --show-error --fail --max-time 2 http://localhost:"$METRO_PORT"/status 2>/dev/null || true)"
  if [[ "$STATUS_BODY" == *packager-status*running* ]]; then
    METRO_READY=1
    break
  fi
  sleep 1
done

if (( METRO_READY == 0 )); then
  printf 'native smoke test failed: Metro was not ready on port %s within 120 seconds; see %s\n' "$METRO_PORT" "$METRO_LOG" >&2
  exit 1
fi

prewarm_bundle() {
  local platform=$1
  local manifest
  local bundle_url
  local max_time=120

  if [[ "$platform" == "android" ]]; then
    max_time=300
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    printf 'warning: %s bundle pre-warm skipped because python3 is unavailable\n' "$platform" >&2
    return 0
  fi

  if ! manifest="$(curl -sf \
    -H "expo-platform: $platform" \
    -H 'Accept: application/expo+json,application/json' \
    "http://127.0.0.1:$METRO_PORT/" 2>/dev/null)"; then
    printf 'warning: %s manifest pre-warm failed; Maestro will try the bundle directly\n' "$platform" >&2
    return 0
  fi

  if ! bundle_url="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["launchAsset"]["url"])' <<<"$manifest")"; then
    printf 'warning: %s manifest did not contain a launch asset; Maestro will try the bundle directly\n' "$platform" >&2
    return 0
  fi

  if [[ -z "$bundle_url" ]]; then
    printf 'warning: %s launch asset URL was empty; Maestro will try the bundle directly\n' "$platform" >&2
    return 0
  fi

  if ! bundle_url="$(python3 -c 'from urllib.parse import urlsplit,urlunsplit; import sys; parsed=urlsplit(sys.argv[1]); print(urlunsplit((parsed.scheme or "http", "127.0.0.1:8082", parsed.path or "/", parsed.query, parsed.fragment)))' "$bundle_url")"; then
    printf 'warning: %s launch asset URL could not be rewritten; Maestro will try the bundle directly\n' "$platform" >&2
    return 0
  fi

  if ! curl -sf --max-time "$max_time" -o /dev/null "$bundle_url"; then
    printf 'warning: %s bundle pre-warm failed; Maestro will try the bundle directly\n' "$platform" >&2
  fi
}

if (( IOS_READY == 1 )); then
  prewarm_bundle ios
fi
if (( ANDROID_READY == 1 )); then
  prewarm_bundle android
fi

run_maestro() {
  local platform=$1
  local device=$2
  local app_id=$3

  printf 'running native smoke flows on %s (%s)\n' "$platform" "$device"
  maestro --device "$device" test \
    -e "APP_ID=$app_id" \
    -e "METRO_URL=$METRO_URL" \
    --debug-output "$RESULT_DIR/$platform" \
    "$FLOW_DIR/examples.yaml" \
    "$FLOW_DIR/gestures.yaml" \
    "$FLOW_DIR/animations.yaml"
}

OVERALL_STATUS=0

if (( IOS_READY == 1 )); then
  if ! run_maestro ios "$IOS_UDID" "$IOS_APP_ID"; then
    OVERALL_STATUS=1
  fi
elif (( RUN_IOS == 1 )); then
  OVERALL_STATUS=1
fi

if (( ANDROID_READY == 1 )); then
  if adb -s "$ANDROID_SERIAL" reverse --list 2>/dev/null | grep -q "tcp:$METRO_PORT tcp:$METRO_PORT"; then
    ANDROID_REVERSE_WAS_PRESENT=1
  fi
  if ! adb -s "$ANDROID_SERIAL" reverse tcp:"$METRO_PORT" tcp:"$METRO_PORT"; then
    printf 'Android native smoke test failed: could not reverse port %s on %s\n' "$METRO_PORT" "$ANDROID_SERIAL" >&2
    OVERALL_STATUS=1
  else
    if (( ANDROID_REVERSE_WAS_PRESENT == 0 )); then
      ANDROID_REVERSE_ADDED=1
    fi
    if ! run_maestro android "$ANDROID_SERIAL" "$ANDROID_APP_ID"; then
      OVERALL_STATUS=1
    fi
  fi
elif (( RUN_ANDROID == 1 )); then
  OVERALL_STATUS=1
fi

exit "$OVERALL_STATUS"
