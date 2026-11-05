# Native smoke test

This smoke test runs the `examples/native-showcase` app in Expo Go on an iOS simulator and an Android emulator and drives it with [Maestro](https://maestro.dev) flows. It checks:

- Examples tab: counter increment, decrement and reset; push and back through the header back button, the iOS edge swipe and the Android system back; stopwatch start, stop and reset; todo entry with Add while the keyboard is open, with Enter, and completion through the switch; the form's invalid email message.
- Gestures tab: tap counts, swipe right and left count likes and dislikes, a slow drag reports the pan, long press resets.
- Animations tab: the box toggle completes a transition, items are added and removed, the draggable card springs back or flies out, and the prime count finishes on the background worklet.

The flows select elements by visible text and accessibility label, so the same files run on both platforms against Expo Go. Detox needs a development build. argent records its flows against a live device during an agent session, which suits exploration more than a committed check.

## Prerequisites

- Maestro 2.7.0 or a compatible version on `PATH`.
- Expo Go for SDK 58 installed on the booted iOS simulator and Android emulator.
- One booted iOS simulator and the `emulator-5554` Android emulator, unless overridden below. The Android Stop tap position assumes the `Medium_Phone_API_35` AVD (1080 x 2400).
- The iOS simulator hardware keyboard is off.
- Dependencies are installed, including `examples/native-showcase/node_modules/.bin/expo`.

## Usage

Run from `packages/examples-e2e`:

```sh
bash native/run.sh ios
bash native/run.sh android
bash native/run.sh all
```

The runner uses the first booted iOS simulator and Android serial `emulator-5554` by default. Set `IOS_UDID` or `ANDROID_SERIAL` to select another booted device. The Metro URL is always `exp://127.0.0.1:8082`, and port 8082 is not configurable. Once Metro is ready, it pre-warms the Expo manifest and its launch asset for every requested platform before any flow runs. The iOS pre-warm allows 120 seconds and the Android pre-warm allows 300 seconds.

Port 8082 must be free before the runner starts. The runner checks both listening sockets and TCP connections on IPv4 and IPv6, refuses to start when a listener is present, starts Metro in its own process group, removes the Android reverse it added, and waits for port 8082 to be free during cleanup. A stuck listener makes the run fail.

Maestro debug output is written to `test-results/native/ios`, `test-results/native/android`, and the Metro log is `test-results/native/metro.log`.

## Mutation check

From the repository root, make the counter increment by 2, run iOS, and expect the run to fail when it checks `Count: 2`:

```sh
sed -i '' 's/count + 1/count + 2/' examples/counter/src/program.ts
pnpm --filter @foldkit/examples-e2e test:native ios
git checkout -- examples/counter/src/program.ts
```

Restore the source even when the smoke test exits nonzero.

## Editing flows

Each flow starts with `open-showcase.yaml`, which stops Expo Go, opens the Metro URL and waits for the home screen, so flows do not depend on each other's state. iOS exposes a button's child texts as one accessibility label (`Counter, ›`), so selectors for multi-text buttons allow the suffix. On Android the stopwatch Stop button is tapped by its screen position (63%, 30% on the `Medium_Phone_API_35` emulator): while the stopwatch ticks, the view hierarchy never settles, so an element tap waits for Maestro's settle timeout and Expo Go can leave the foreground before the tap lands. The flow asserts `Start` after the tap, so a missed tap fails the run. Start and Stop are the same button. Write values that contain `${...}` in block-style mappings: oxfmt splits a `${...}` inside an inline `{ }` mapping and Maestro then rejects the file.
