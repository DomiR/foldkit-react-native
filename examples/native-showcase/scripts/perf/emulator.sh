#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PERF_DIR="$SHOWCASE_DIR/.perf"
EMULATOR="${ANDROID_HOME:-$HOME/Library/Android/sdk}/emulator/emulator"
AVD="${FOLDKIT_PERF_AVD:-Foldkit_Perf_API_35}"
SOURCE_AVD="${FOLDKIT_PERF_SOURCE_AVD:-Medium_Phone_API_35}"
AVD_HOME="$HOME/.android/avd"
AVD_DIR="$AVD_HOME/$AVD.avd"
AVD_INI="$AVD_HOME/$AVD.ini"
SOURCE_INI="$AVD_HOME/$SOURCE_AVD.ini"
PORT=5556
SERIAL=emulator-5556
BOOT_TIMEOUT_SECONDS=600
LOAD_AVERAGE_THRESHOLD=1.5
LOAD_SETTLE_INTERVAL_SECONDS=5
LOAD_SETTLE_TIMEOUT_SECONDS=300
PID_FILE="$PERF_DIR/emulator.pid"

is_listed() {
  adb devices | awk -v serial="$SERIAL" '$1 == serial { found = 1 } END { if (found) exit 0; exit 1 }'
}

print_usage() {
  echo "Usage: emulator.sh create | start <mid|lowend> | stop | status | delete"
}

validate_avd_name() {
  if [[ -z "$1" || "$1" == */* || "$1" == "." || "$1" == ".." ]]; then
    echo "Invalid AVD name: $1" >&2
    exit 1
  fi
}

source_avd_directory() {
  if [[ ! -f "$SOURCE_INI" ]]; then
    echo "Source AVD file not found at $SOURCE_INI." >&2
    return 1
  fi

  SOURCE_PATH="$(sed -n 's/^path=//p' "$SOURCE_INI" | head -n1 | tr -d '\r')"
  if [[ -z "$SOURCE_PATH" ]]; then
    echo "Source AVD file has no path entry: $SOURCE_INI." >&2
    return 1
  fi
  if [[ "$SOURCE_PATH" != /* ]]; then
    SOURCE_PATH="$AVD_HOME/$SOURCE_PATH"
  fi
  if [[ ! -d "$SOURCE_PATH" ]]; then
    echo "Source AVD directory not found at $SOURCE_PATH." >&2
    return 1
  fi
  cd "$SOURCE_PATH"
  pwd
}

rewrite_config() {
  CONFIG_PATH="$AVD_DIR/config.ini"
  CONFIG_TEMP="$(mktemp "$AVD_DIR/config.ini.XXXXXX")"
  awk \
    -v avd_id="$AVD" \
    -v display_name="Foldkit Perf API 35" \
    '
      BEGIN {
        have_avd_id = 0
        have_display_name = 0
        have_cold_boot = 0
        have_fast_boot = 0
        have_device_frame = 0
      }
      /^AvdId=/ {
        print "AvdId=" avd_id
        have_avd_id = 1
        next
      }
      /^avd\.ini\.displayname=/ {
        print "avd.ini.displayname=" display_name
        have_display_name = 1
        next
      }
      /^fastboot\.forceColdBoot=/ {
        print "fastboot.forceColdBoot=yes"
        have_cold_boot = 1
        next
      }
      /^fastboot\.forceFastBoot=/ {
        print "fastboot.forceFastBoot=no"
        have_fast_boot = 1
        next
      }
      /^showDeviceFrame=/ {
        print "showDeviceFrame=no"
        have_device_frame = 1
        next
      }
      { print }
      END {
        if (!have_avd_id) print "AvdId=" avd_id
        if (!have_display_name) print "avd.ini.displayname=" display_name
        if (!have_cold_boot) print "fastboot.forceColdBoot=yes"
        if (!have_fast_boot) print "fastboot.forceFastBoot=no"
        if (!have_device_frame) print "showDeviceFrame=no"
      }
    ' "$CONFIG_PATH" >"$CONFIG_TEMP"
  mv "$CONFIG_TEMP" "$CONFIG_PATH"
}

create_avd() {
  validate_avd_name "$AVD"
  validate_avd_name "$SOURCE_AVD"
  if [[ "$AVD" == "$SOURCE_AVD" ]]; then
    echo "The performance AVD name must differ from the source AVD name." >&2
    return 1
  fi
  if [[ -f "$AVD_INI" ]]; then
    echo "Performance AVD already exists: $AVD_INI"
    return 0
  fi

  SOURCE_PATH="$(source_avd_directory)"
  if [[ ! -f "$SOURCE_PATH/config.ini" ]]; then
    echo "Source AVD config not found at $SOURCE_PATH/config.ini." >&2
    return 1
  fi
  TARGET_LINE="$(sed -n 's/^target=.*/&/p' "$SOURCE_INI" | head -n1 | tr -d '\r')"
  if [[ -z "$TARGET_LINE" ]]; then
    echo "Source AVD file has no target entry: $SOURCE_INI." >&2
    return 1
  fi

  mkdir -p "$AVD_DIR"
  cp "$SOURCE_PATH/config.ini" "$AVD_DIR/config.ini"
  rewrite_config

  INI_TEMP="$(mktemp "$AVD_HOME/$AVD.ini.XXXXXX")"
  {
    printf '%s\n' 'avd.ini.encoding=UTF-8'
    printf 'path=%s\n' "$AVD_DIR"
    printf 'path.rel=avd/%s.avd\n' "$AVD"
    printf '%s\n' "$TARGET_LINE"
  } >"$INI_TEMP"
  mv "$INI_TEMP" "$AVD_INI"
  echo "Created performance AVD $AVD at $AVD_DIR."
}

find_expo_go_apk() {
  local apk_path="${FOLDKIT_PERF_EXPO_GO_APK:-}"
  if [[ -n "$apk_path" ]]; then
    if [[ ! -f "$apk_path" ]]; then
      echo "Expo Go APK not found at $apk_path." >&2
      return 1
    fi
    printf '%s\n' "$apk_path"
    return 0
  fi

  local newest_apk=""
  local candidate
  local -a candidates
  shopt -s nullglob
  candidates=("$HOME/.expo/android-apk-cache"/Expo-Go-58*.apk)
  shopt -u nullglob
  for candidate in "${candidates[@]}"; do
    if [[ -z "$newest_apk" || "$candidate" -nt "$newest_apk" ]]; then
      newest_apk="$candidate"
    fi
  done
  if [[ -z "$newest_apk" ]]; then
    echo "No Expo Go SDK 58 APK found under $HOME/.expo/android-apk-cache." >&2
    return 1
  fi
  printf '%s\n' "$newest_apk"
}

ensure_expo_go() {
  PACKAGES="$(adb -s "$SERIAL" shell pm list packages host.exp.exponent | tr -d '\r')"
  if [[ "$PACKAGES" == *"package:host.exp.exponent"* ]]; then
    return 0
  fi

  if ! EXPO_GO_APK="$(find_expo_go_apk)"; then
    echo "Expo Go is not installed on $SERIAL and no installable APK was found." >&2
    return 1
  fi
  echo "Installing Expo Go from $EXPO_GO_APK."
  adb -s "$SERIAL" install -r "$EXPO_GO_APK"
}

print_expo_go_version() {
  EXPO_GO_VERSION="$(adb -s "$SERIAL" shell dumpsys package host.exp.exponent | grep 'versionName' | head -n1 | tr -d '\r' || true)"
  if [[ -z "$EXPO_GO_VERSION" ]]; then
    echo "Expo Go versionName: unavailable" >&2
  else
    echo "Expo Go $EXPO_GO_VERSION"
  fi
}

read_load_average() {
  adb -s "$SERIAL" shell cat /proc/loadavg | awk '{ print $1 }' | tr -d '\r'
}

settle_device() {
  LOAD_BEFORE_SETTLE="$(read_load_average)"
  echo "Load before settle: $LOAD_BEFORE_SETTLE"
  adb -s "$SERIAL" shell cmd package bg-dexopt-job >/dev/null 2>&1 || true

  LOAD_AFTER_SETTLE="$LOAD_BEFORE_SETTLE"
  LOAD_SETTLED=0
  for ((elapsed = 0; elapsed <= LOAD_SETTLE_TIMEOUT_SECONDS; elapsed += LOAD_SETTLE_INTERVAL_SECONDS)); do
    LOAD_AFTER_SETTLE="$(read_load_average)"
    if awk -v load="$LOAD_AFTER_SETTLE" -v threshold="$LOAD_AVERAGE_THRESHOLD" 'BEGIN { exit load < threshold ? 0 : 1 }'; then
      LOAD_SETTLED=1
      break
    fi
    if (( elapsed < LOAD_SETTLE_TIMEOUT_SECONDS )); then
      sleep "$LOAD_SETTLE_INTERVAL_SECONDS"
    fi
  done
  echo "Load after settle: $LOAD_AFTER_SETTLE"
  if [[ "$LOAD_SETTLED" != "1" ]]; then
    echo "Load average did not fall below $LOAD_AVERAGE_THRESHOLD within $LOAD_SETTLE_TIMEOUT_SECONDS seconds." >&2
  fi
}

if [[ "${1:-}" == "create" ]]; then
  create_avd
elif [[ "${1:-}" == "start" ]]; then
  PROFILE="${2:-}"
  case "$PROFILE" in
    mid)
      PROFILE_FLAGS=(-cores 4 -memory 4096)
      ;;
    lowend)
      PROFILE_FLAGS=(-cores 2 -memory 2048)
      ;;
    *)
      print_usage >&2
      exit 1
      ;;
  esac

  create_avd
  if is_listed; then
    echo "$SERIAL is already listed by adb." >&2
    exit 1
  fi
  if [[ ! -x "$EMULATOR" ]]; then
    echo "Android emulator binary not found at $EMULATOR." >&2
    exit 1
  fi

  mkdir -p "$PERF_DIR"
  LOG_FILE="$PERF_DIR/emulator-$PROFILE.log"
  nohup "$EMULATOR" -avd "$AVD" -no-snapshot -no-boot-anim -no-audio -port "$PORT" "${PROFILE_FLAGS[@]}" >"$LOG_FILE" 2>&1 &
  EMULATOR_PID=$!
  printf '%s\n' "$EMULATOR_PID" >"$PID_FILE"

  adb -s "$SERIAL" wait-for-device >/dev/null 2>&1 &
  WAIT_PID=$!
  BOOTED=0
  for ((second = 0; second < BOOT_TIMEOUT_SECONDS; second += 1)); do
    BOOT_STATE="$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [[ "$BOOT_STATE" == "1" ]]; then
      BOOTED=1
      break
    fi
    sleep 1
  done
  kill "$WAIT_PID" 2>/dev/null || true
  wait "$WAIT_PID" 2>/dev/null || true

  if [[ "$BOOTED" != "1" ]]; then
    echo "Timed out waiting for $SERIAL to boot after $BOOT_TIMEOUT_SECONDS seconds. See $LOG_FILE." >&2
    kill "$EMULATOR_PID" 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi

  ensure_expo_go
  print_expo_go_version
  settle_device
  adb -s "$SERIAL" shell settings put global window_animation_scale 1
  echo "Started $SERIAL with profile $PROFILE using AVD $AVD."
  echo "Cores: $(adb -s "$SERIAL" shell nproc | tr -d '\r')"
  echo "$(adb -s "$SERIAL" shell cat /proc/meminfo | awk '/^MemTotal:/ { print }')"
elif [[ "${1:-}" == "stop" ]]; then
  if is_listed; then
    adb -s "$SERIAL" emu kill >/dev/null 2>&1 || true
  fi
  STOPPED=0
  for ((second = 0; second < 60; second += 1)); do
    if ! is_listed; then
      STOPPED=1
      break
    fi
    sleep 1
  done
  rm -f "$PID_FILE"
  if [[ "$STOPPED" != "1" ]]; then
    echo "Timed out waiting for $SERIAL to stop." >&2
    exit 1
  fi
  echo "Stopped $SERIAL."
elif [[ "${1:-}" == "status" ]]; then
  if is_listed; then
    adb -s "$SERIAL" get-state || true
  else
    echo "$SERIAL is not listed by adb."
  fi
elif [[ "${1:-}" == "delete" ]]; then
  validate_avd_name "$AVD"
  validate_avd_name "$SOURCE_AVD"
  if [[ "$AVD" == "$SOURCE_AVD" ]]; then
    echo "Refusing to delete the source AVD $SOURCE_AVD." >&2
    exit 1
  fi
  "$0" stop
  rm -rf "$AVD_DIR"
  rm -f "$AVD_INI"
  echo "Deleted performance AVD $AVD."
else
  print_usage >&2
  exit 1
fi
