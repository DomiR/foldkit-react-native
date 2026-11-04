# @foldkit/devtools-mcp

A Model Context Protocol server that exposes a running [Foldkit](https://foldkit.dev) app to AI agents (Claude Code, Codex, Cursor, Windsurf, anything that speaks MCP).

With it attached, agents can:

- Read the current Model, or any historical Model by history index
- Narrow reads with dot-string paths and summarized payloads to fit token budgets
- List and inspect the Message history, with Command and Mount lifecycle, diffs, and Submodel chains
- Query history server-side: filter entries by changed Model paths, count Messages by tag, tail the latest entries, and diff the Models at two indices
- Read the recorded init Model, the Commands returned from `init`, and the Mounts that fired during the first render
- Inspect Runtime state: current index, retained history bounds, pause status
- Replay to any past state and resume
- Discover the Runtime's `Message` Schema as JSON Schema so agents can construct valid payloads without reading the application source
- Dispatch Messages into the Runtime, singly or as an ordered batch, decoded against your `Message` Schema

## Quick Start

Projects scaffolded with [`create-foldkit-app`](https://foldkit.dev/get-started) ship with the MCP server pre-wired. Open the project in your AI agent and the tools appear under the `foldkit-devtools` prefix.

For existing projects, run the init command in your project root:

```bash
npx @foldkit/devtools-mcp init
```

This writes a `.mcp.json` (or merges into an existing one) so any MCP-aware agent picks up the server.

For faster startup, install the MCP server as a devDependency. Otherwise `npx` fetches it on each AI agent restart:

```bash
npm install -D @foldkit/devtools-mcp
# or
pnpm add -D @foldkit/devtools-mcp
# or
yarn add -D @foldkit/devtools-mcp
```

Pass your `Message` Schema to `Runtime.makeApplication` to let the agent dispatch Messages. The Runtime rejects a payload that does not match the Schema before it reaches update:

```typescript
Runtime.makeApplication({
  devTools: {
    // Rest of your DevTools config
    Message,
  },
})
```

Restart your dev server, then restart your AI agent. The MCP server will appear with the `foldkit_*` tools attached.

The bridge runs inside your app. The MCP server sees browser tabs and native apps while their DevTools bridges are connected. Closing a tab or disconnecting a native app removes its Runtime from `foldkit_list_runtimes`.

## React Native

Start the relay from the native app's project root and leave it running:

```bash
npx @foldkit/devtools-mcp relay
```

Opt the app in with the `devTools` option on `makeNativeProgram`. Pass its `Message` Schema to support dispatch:

```typescript
makeNativeProgram({
  ...programConfig,
  devTools: { name: 'My app', Message },
})
```

See the [native package README](../native/README.md) for the complete configuration. Native DevTools are disabled by default and in release builds. Start the app in development, then call `foldkit_list_runtimes` from your MCP agent to find its connection id.

The relay binds only to `127.0.0.1`, on port `9989` by default. The iOS simulator connects to `127.0.0.1`; the Android emulator uses `10.0.2.2`. These defaults are independent of Expo's bundle host. Physical iOS devices are unsupported.

For Android through USB forwarding, run:

```bash
adb reverse tcp:9989 tcp:9989
```

Set `devTools.relayHost` to `'127.0.0.1'` in that app. The emulator default does not require this reverse rule.

To select a project root or use another fixed port:

```bash
npx @foldkit/devtools-mcp relay --project-root ./apps/mobile --port 9990
```

Set the app's `devTools.relayPort` to the same port. An occupied port fails startup; the relay does not select another port. Use separate ports for relays serving different projects or worktrees. `--help` prints the command options. Ctrl-C stops the listener and removes its discovery record.

Keep `FOLDKIT_DEVTOOLS_MCP_PORT` and `FOLDKIT_DEVTOOLS_MCP_HOST` unset in the MCP process. They select the legacy Vite endpoint and bypass discovery; they do not configure this relay. `FOLDKIT_PROJECT_ROOT` selects the agent's discovery root. If you override `FOLDKIT_DEVTOOLS_RELAY_DIRECTORY`, use the same private directory in the relay and MCP processes.

Loopback binding and the native socket's Origin check form the native transport's trust boundary. Native upgrades accept an absent Origin, or exactly `http://<host>:<port>` or `ws://<host>:<port>`, with host `127.0.0.1`, `localhost`, or `10.0.2.2` and the listening port. Other origins, including `null`, multiple values, different ports, and lookalike hosts, are rejected. This blocks unrelated browser pages from announcing a native Runtime. Other local processes are inside the trust boundary. MCP clients authenticate through the private registry token and challenge handshake.

## Sensitive Runtime Data

Treat this server as privileged access to the running application. A connected agent can read the current, initial, and retained historical Models; every retained Message payload; and the arguments passed to recorded Commands and Mounts. Anything returned by one of these tools enters the agent's context.

Keep API keys, passwords, access and refresh tokens, authorization headers, session material, and private personal data out of those values. Long-lived secrets belong behind a server boundary, including in local demos. If the app must temporarily carry a sensitive value, use Effect `Redacted` with a `Schema.Redacted` field configured with `disallowJsonEncode: true`. `Redacted` protects normal string, JSON, and inspection output; it does not encrypt the value or hide a client-side credential from the person running the app.

`excludeFromHistory` is for noisy Messages, not sensitive ones. The resulting Model remains inspectable. Omitting `DevToolsConfig.Message` disables dispatch only; read and replay tools remain available. Set `devToolsMcpPort: false` in the Foldkit Vite plugin options to keep the in-browser DevTools without starting the MCP relay, or set `devTools: false` in the application config to disable recording and its bridge too. Native apps opt in through `makeNativeProgram`; stopping their standalone relay disconnects MCP access.

## Tools

Every tool except `foldkit_list_runtimes` accepts an optional `runtime_id`. Without one, the tool uses the most recently connected Runtime of the most recently started relay.

| Tool                            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `foldkit_list_runtimes`         | Returns metadata for every connected browser tab and native app. Each Runtime carries the `projectRoot` of its relay, unless `FOLDKIT_DEVTOOLS_MCP_PORT` or `FOLDKIT_DEVTOOLS_MCP_HOST` is set. Agents call this first to discover which Runtime to target.                                                                                                                                                                                                                                               |
| `foldkit_get_model`             | Snapshots the current Model. Accepts an optional `path` to narrow to a subtree and `expand` to control summarization.                                                                                                                                                                                                                                                                                                                                                                                     |
| `foldkit_get_model_at`          | Snapshots a historical Model after a given history entry. Pass `index: N - 1` to read the Model just before Message `N`. Same `path`/`expand` semantics as `foldkit_get_model`. Indices outside the readable range (older entries are evicted past the rolling buffer) are rejected with the valid bounds. For the initial Model (and the init Commands and Mounts), use `foldkit_get_init`.                                                                                                              |
| `foldkit_get_init`              | Reads the recorded initial Model, the Commands returned from the application's `init` function, and the Mounts that fired during the first render. Each Command and Mount carries its declared args. Equivalent to selecting the synthetic "init" row in the DevTools panel.                                                                                                                                                                                                                              |
| `foldkit_get_runtime_state`     | Snapshots the Runtime's DevTools state: history bounds, current paused/live status, and whether init is recorded. Useful for understanding what `foldkit_list_messages` and `foldkit_get_message` will see and detecting whether the Runtime is paused.                                                                                                                                                                                                                                                   |
| `foldkit_list_messages`         | Lists Message history entries. Each entry carries the Message body, Commands triggered (with args), Mounts that started or ended during the resulting render (with args), timestamp, an `isModelChanged` flag, the diff path lists (`changedPaths` / `affectedPaths`), and any extracted Submodel chain. Filter server-side with `changed_paths_match`, read the latest entries with `from_end`, and paginate forward with `since_index`.                                                                 |
| `foldkit_count_messages_by_tag` | Counts retained history entries by Message tag, without payloads, sorted by count descending. A cheap reconnaissance call before paging through history: it surfaces the high-frequency Messages worth filtering out, and with `changed_paths_match` it answers which Message tags touch a Model subtree.                                                                                                                                                                                                 |
| `foldkit_diff_models`           | Diffs the Models at two history indices server-side, returning path-level changes `{ path, before, after }` with summarized values. Each side is `{ _tag: 'Present', value }`, or `{ _tag: 'Absent' }` when the path does not exist on that side. Pass `changed_paths_match` to narrow the diff to a subtree.                                                                                                                                                                                             |
| `foldkit_get_message`           | Reads one entry at a given index. The response carries the SerializedEntry only; to inspect the Model around the entry, call `foldkit_get_model_at` with `index - 1` (before) and `index` (after). Use `foldkit_get_init` for the synthetic init entry.                                                                                                                                                                                                                                                   |
| `foldkit_list_keyframes`        | Returns the indices Foldkit can replay back to. Index `-1` is the initial Model.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `foldkit_replay_to_keyframe`    | Time-travels the Runtime to a previous state. The Runtime is paused at that snapshot until `foldkit_resume` is called.                                                                                                                                                                                                                                                                                                                                                                                    |
| `foldkit_resume`                | Resumes normal execution after a replay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `foldkit_get_message_schema`    | Describes the Runtime's Message Schema so agents can construct valid Messages without reading the application source. With no arguments, returns a small variant index (top-level tag names plus payload fields). With `variant_tag` set to a dot-separated path of variant tags (e.g. `"GotChildMessage.Opened"`), narrows the JSON Schema along the chain and collapses deeper unions to summary placeholders. Returns `maybeResult: None` when the Runtime hasn't configured `DevToolsConfig.Message`. |
| `foldkit_dispatch_message`      | Dispatches a Message into the Runtime as if your application produced it. The Runtime decodes the payload against your Schema and returns a clean error if it does not match.                                                                                                                                                                                                                                                                                                                             |
| `foldkit_dispatch_messages`     | Dispatches an ordered batch of 1 to 100 Messages in one call, first to last. The Runtime validates every payload before dispatching any of them, so one invalid entry rejects the whole batch with its zero-based position and nothing is dispatched. The response reports the predicted history index for each Message.                                                                                                                                                                                  |

### Reading the Model efficiently

`foldkit_get_model` and `foldkit_get_model_at` are designed for AI agents reading state into a token-bounded context. Two parameters control the payload size:

- **`path`** is a dot-string anchored at `root` that narrows the response to a subtree. The alphabet matches the `changedPaths` array on each `SerializedEntry`, so a path observed in `foldkit_list_messages` can be passed straight back. Examples: `'root'` (the whole Model), `'root.route'`, `'root.session.user'`, `'root.cards.0'`. When the path doesn't resolve, the response is an error listing the keys available at the deepest segment that did resolve, so the agent can refine in one follow-up call.
- **`expand`** controls summarization. By default (`false`), large arrays collapse to `{ _summary: 'array', length, sample: [head, last] }`, deeply nested records collapse to `{ _summary: 'record', keys }`, and long strings collapse to `{ _summary: 'string', length, head }`. Tagged-union variants (`{ _tag, ... }`) keep their tag and recursively summarize children. With `expand: true`, the literal value at the path is returned with no summarization. Pair a narrow `path` with `expand: true` to read a specific subtree at full fidelity without paying for the rest of the Model.

### Querying history efficiently

High-frequency flows (drag-paint, scroll, keystroke) can fill the history buffer with thousands of entries; reading them page by page burns agent context. The history tools query server-side instead, in Model terms rather than Message-tag terms:

1. **Recon with `foldkit_count_messages_by_tag`.** A few hundred bytes regardless of history size. It shows which tags dominate and the absolute index range retained.
2. **Filter with `changed_paths_match`.** Both `foldkit_list_messages` and `foldkit_count_messages_by_tag` accept dot-string patterns matched against each entry's `changedPaths`. Patterns compare segment by segment for the length of the shorter side, so `root.grid` matches every change inside the grid subtree and `root.grid.5.3` also matches a wholesale replacement recorded at `root.grid`. `*` matches exactly one segment: `root.cards.*.title`. The path alphabet is the same one `foldkit_get_model` uses, so paths can be copied between tools.
3. **Tail with `from_end: true`.** The natural live-debugging lens is "what just happened". `from_end` returns the final `limit` matching entries without first discovering the total count.
4. **Diff with `foldkit_diff_models`.** Once the interesting indices are known, ask for the path-level delta between them instead of fetching two full snapshots and diffing client-side.

## Architecture

The Runtime bridge, relay, and MCP server cooperate across two transports:

- **Runtime bridge** (in `foldkit`): subscribes to the DevTools store. Browser apps exchange typed frames over Vite's HMR WebSocket; `@foldkit/native` uses a reconnecting WebSocket to the native relay.
- **Relay**: `@foldkit/vite-plugin` starts a loopback listener for each web dev server by default. This package's `relay` command starts a standalone loopback listener for native apps. Both publish authenticated discovery records and route requests by Runtime id.
- **MCP server** (this package): runs as a Node child process under your AI agent, discovers both kinds of relay, and exposes the typed tools over MCP's stdio transport.

Multiple browser tabs and native apps can connect at once. Each has a connection id for targeting requests. Socket closure removes its Runtimes; the native relay also sends heartbeat pings to detect vanished emulators.

## Configuration

An agent started at a workspace root can inspect every Foldkit app running under it. If no relay runs under the agent's project root, the MCP server finds the nearest root that encloses it. This also lets an agent started in `src/` or through a symlink find the app. `foldkit_list_runtimes` lists the Runtimes from every matching relay and includes each relay's `projectRoot`.

The MCP server connects when a tool is called. It checks the registry on every call, so the next call can reach a relay that started or restarted after the agent.

| Environment variable               | What it changes                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FOLDKIT_PROJECT_ROOT`             | Project to search. Defaults to the working directory.                                                                                                                                                                                                                                      |
| `FOLDKIT_DEVTOOLS_MCP_PORT`        | Skips discovery and connects to the legacy Vite fixed-port endpoint. Set it to `devToolsMcpPort` in your Vite config. Leave it unset for native relays.                                                                                                                                    |
| `FOLDKIT_DEVTOOLS_MCP_HOST`        | Skips discovery and connects to this host, on `FOLDKIT_DEVTOOLS_MCP_PORT` or `9988`. Set it when a `devToolsMcpPort` relay runs on another host.                                                                                                                                           |
| `FOLDKIT_DEVTOOLS_RELAY_DIRECTORY` | Registry location. Defaults to a directory under `XDG_RUNTIME_DIR` when set, `~/.cache` on macOS and Linux, or the user temporary directory on Windows. Set it in both processes if they use different sandboxes. On Windows, it must be a direct child of the user's temporary directory. |

An automatically discovered relay's registry record contains a random token. The MCP client uses it to sign a connection challenge and checks the relay's response before sending tool requests. Each relay refuses to publish its record if another user can read or replace the registry directory. The MCP server applies the same check before reading it. Both reject symlinks and junctions; on macOS they also check directory ACLs. Clients without access to the registry cannot connect, but the agent using this MCP server can inspect the Runtime data.

On Windows, both processes use PowerShell to check the directory's owner, access list, ancestors, and reparse points. The registry must be a private direct child of the user's temporary directory. If publication is refused, set `FOLDKIT_DEVTOOLS_RELAY_DIRECTORY` to a private, supported directory in both processes. Vite also offers a legacy fixed-port mode through `devToolsMcpPort` and `FOLDKIT_DEVTOOLS_MCP_PORT`. That Vite mode listens on every interface without a token and must not be used on a shared or untrusted network. The native relay always requires authenticated MCP access and binds only to loopback.

## Notes

- The MCP bridge shares its lifecycle with Foldkit DevTools. If you set `devTools: false` in your program config, the bridge does not start and the Runtime is invisible to MCP. Browser apps enable the bridge in development by default. Native apps must opt in and only enable it in development builds.
- Without a `Message` Schema in the DevTools configuration, dispatch is rejected. Inspection and replay tools work without it.
- Vite starts its relay during development. The native relay is a separate foreground process; native release builds disable their DevTools bridge.

## Documentation

See [foldkit.dev/ai/mcp](https://foldkit.dev/ai/mcp) for the full guide.

## License

MIT
