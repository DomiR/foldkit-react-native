# @foldkit/native

Run a Foldkit program with React Native using `makeNativeProgram` and render its
snapshots with `FoldkitRoot`. The shared runtime drives the Model, Messages,
Commands, Subscriptions, and ManagedResources.

## DevTools

Add `devTools: { Message, name: 'My native app' }` to `makeNativeProgram` to enable
inspection and replay through `@foldkit/devtools-mcp`. `Message` is your
application's Message Schema. Supplying it lets an agent dispatch validated
Messages. Omitting it permits inspection and replay but rejects agent dispatch.

DevTools requires `__DEV__` to be true. Omitting `devTools`, passing `false`, or
running a release build disables recording and the socket connection.

Start the installed relay from the app's project root:

```sh
foldkit-devtools-mcp relay
```

See the [DevTools MCP README](../devtools-mcp/README.md) for installation, agent
configuration, and project discovery. The relay listens on `127.0.0.1:9989`.
Native apps connect to `127.0.0.1` on iOS and `10.0.2.2` on Android by default.
The Expo bundle host and the DevTools relay host are separate settings.

Set `relayPort` in the native configuration when starting the relay with a custom
`--port`. `relayHost` accepts only `127.0.0.1`, `localhost`, or `10.0.2.2`, and
`relayPort` must be an integer from 1 to 65535. An invalid value logs a warning
and disables DevTools. This connection supports local simulators and emulators;
the relay does not listen on the LAN.

For Android's localhost alternative, run:

```sh
adb reverse tcp:9989 tcp:9989
```

Then configure `relayHost: '127.0.0.1'` in the program. Remove the reverse rule
with `adb reverse --remove tcp:9989` when finished.

The native channel reconnects when the relay restarts and retains the running
program's history. `program.dispose()` closes the connection and cancels retries.
You can tune recording with `maxEntries`, `keyframeInterval`, and
`excludeFromHistory`, using the core DevTools defaults and limits.

Replay shows the historical view while the live Model can advance through
Commands, Subscriptions, or agent dispatch. Taps and `program.dispatch` are
ignored until resume restores the live view and React commits it. Replay does
not replace the live Model or run historical Commands.

Connected agents can read Models and retained Message payloads. Local processes
are inside the relay's trust boundary. Read
[Sensitive Runtime Data](../devtools-mcp/README.md#sensitive-runtime-data) before
enabling DevTools for data that should not enter an agent's context.

The [native showcase](../../examples/native-showcase/App.tsx) opts in with
`EXPO_PUBLIC_FOLDKIT_DEVTOOLS=1`. Optional
`EXPO_PUBLIC_FOLDKIT_DEVTOOLS_HOST` and `EXPO_PUBLIC_FOLDKIT_DEVTOOLS_PORT` values
override the defaults. Restart Metro with `--clear` after changing these values
so Expo substitutes them into the bundle.
