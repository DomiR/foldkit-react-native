#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PERF_DIR="$SHOWCASE_DIR/.perf"
PROFILE="${1:-}"
STARTUP_RUNS="${2:-10}"
BENCH_RUNS="${3:-3}"
SERIAL=emulator-5556
PORT=8082
METRO_PGID=""
EMULATOR_STARTED=0
BUILD_ID="$(date +%s)-$$"

if [[ "$PROFILE" != "mid" && "$PROFILE" != "lowend" ]]; then
  echo "Usage: measureDevice.sh <mid|lowend> [startupRuns=10] [benchRuns=3]" >&2
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use." >&2
  exit 1
fi

mkdir -p "$PERF_DIR"

cleanup() {
  EXIT_CODE=$?
  if [[ -n "$METRO_PGID" ]]; then
    kill -- -"$METRO_PGID" 2>/dev/null || true
    for ((second = 0; second < 5; second += 1)); do
      if ! kill -0 -- -"$METRO_PGID" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    kill -9 -- -"$METRO_PGID" 2>/dev/null || true
  fi

  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is still in use after Metro cleanup." >&2
    EXIT_CODE=1
  fi

  if [[ "$EMULATOR_STARTED" == "1" ]]; then
    if ! "$SCRIPT_DIR/emulator.sh" stop; then
      EXIT_CODE=1
    fi
  fi
  exit "$EXIT_CODE"
}
trap cleanup EXIT

"$SCRIPT_DIR/emulator.sh" start "$PROFILE"
EMULATOR_STARTED=1
adb -s "$SERIAL" shell pm clear host.exp.exponent

set -m
(
  cd "$SHOWCASE_DIR"
  exec env EXPO_PUBLIC_FOLDKIT_PERF=1 EXPO_PUBLIC_FOLDKIT_PERF_BUILD_ID="$BUILD_ID" CI=1 npx expo start --port "$PORT" --no-dev --minify --clear >"$PERF_DIR/metro-$PROFILE.log" 2>&1
) &
METRO_PGID=$!

PACKAGER_READY=0
for ((second = 0; second < 120; second += 1)); do
  STATUS_BODY="$(curl -fsS "http://127.0.0.1:$PORT/status" 2>/dev/null || true)"
  if [[ "$STATUS_BODY" == *packager-status:running* ]]; then
    PACKAGER_READY=1
    break
  fi
  sleep 1
done
if [[ "$PACKAGER_READY" != "1" ]]; then
  echo "Timed out waiting for Metro on port $PORT." >&2
  exit 1
fi

node "$SCRIPT_DIR/startup.ts" --serial "$SERIAL" --port "$PORT" --runs "$STARTUP_RUNS" --profile "$PROFILE" --build-id "$BUILD_ID"
node "$SCRIPT_DIR/renderBench.ts" --serial "$SERIAL" --port "$PORT" --runs "$BENCH_RUNS" --profile "$PROFILE" --build-id "$BUILD_ID"
