---
'@foldkit/devtools-mcp': minor
---

Add `foldkit-devtools-mcp relay` to connect native Foldkit apps to MCP tools. Run it from the app's project root, enable `devTools` on `makeNativeProgram`, and use `foldkit_list_runtimes` to select a connected simulator or emulator.

The relay listens on loopback port 9989 by default, accepts `--project-root` and `--port`, and publishes an authenticated discovery record. Native connections enforce an exact Origin rule. Runtime ownership checks, heartbeat pings, and scoped cleanup remove disconnected runtimes and retire the relay's record on shutdown.

Keep `FOLDKIT_DEVTOOLS_MCP_PORT` and `FOLDKIT_DEVTOOLS_MCP_HOST` unset when using native relay discovery.
