import { Data, Effect, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const DEFAULT_PORT = 9989
const DEFAULT_WEBSOCKET_PORT = 80
const MAX_PORT = 65535

/** Options for the foreground native relay command. */
export const NativeRelayOptions = defineTaggedUnion({
  Help: {},
  Start: { projectRoot: Schema.String, port: Schema.Number },
})
/** Parsed native relay command options. */
export type NativeRelayOptions = typeof NativeRelayOptions.Type

/** A command line or project directory that cannot start a relay. */
export class NativeRelayOptionsInvalid extends Data.TaggedError(
  'NativeRelayOptionsInvalid',
)<Readonly<{ message: string }>> {}

/** Usage printed without starting a listener. */
export const NATIVE_RELAY_HELP = `Usage: foldkit-devtools-mcp relay [--project-root <dir>] [--port <1..65535>] [--help]

Start a native DevTools relay on 127.0.0.1 (default port: ${DEFAULT_PORT}).
Port ${DEFAULT_WEBSOCKET_PORT} is unavailable because WebSocket URL normalization prevents relay discovery.
The project root defaults to the current directory. Keep this process running
while inspecting native apps through MCP.`

/** Resolve a project directory to the canonical root used by discovery. */
export const resolveNativeProjectRoot = (projectRoot: string) =>
  Effect.tryPromise({
    try: async () => {
      const root = await realpath(projectRoot)
      const entry = await stat(root)

      if (!entry.isDirectory()) {
        throw new Error('Not a directory')
      }

      return root
    },
    catch: () =>
      new NativeRelayOptionsInvalid({
        message: `Cannot use project root ${projectRoot}: expected an existing directory.`,
      }),
  })

/** Parse relay arguments and validate the project root before binding. */
export const readNativeRelayOptions = (
  args: ReadonlyArray<string>,
  cwd: string = process.cwd(),
): Effect.Effect<NativeRelayOptions, NativeRelayOptionsInvalid> =>
  Effect.gen(function* () {
    let projectRoot = cwd
    let port = DEFAULT_PORT
    let isHelp = false
    const argumentsIterator = args.values()

    for (const flag of argumentsIterator) {
      if (flag === '--help') {
        isHelp = true
        continue
      }

      if (flag !== '--project-root' && flag !== '--port') {
        return yield* Effect.fail(
          new NativeRelayOptionsInvalid({
            message: `Unknown relay option: ${flag}. ${NATIVE_RELAY_HELP}`,
          }),
        )
      }

      const maybeValue = Option.fromNullishOr(argumentsIterator.next().value)

      if (
        Option.isNone(maybeValue) ||
        maybeValue.value === '' ||
        maybeValue.value.startsWith('--')
      ) {
        return yield* Effect.fail(
          new NativeRelayOptionsInvalid({
            message: `Missing value for ${flag}.`,
          }),
        )
      }

      if (flag === '--project-root') {
        projectRoot = resolve(cwd, maybeValue.value)
      } else {
        port = globalThis.Number(maybeValue.value)

        if (
          !/^\d+$/.test(maybeValue.value) ||
          !globalThis.Number.isInteger(port) ||
          port < 1 ||
          port > MAX_PORT
        ) {
          return yield* Effect.fail(
            new NativeRelayOptionsInvalid({
              message: `Invalid relay port: ${maybeValue.value}. Expected an integer from 1 to ${MAX_PORT}.`,
            }),
          )
        }

        if (port === DEFAULT_WEBSOCKET_PORT) {
          return yield* Effect.fail(
            new NativeRelayOptionsInvalid({
              message: `Port ${DEFAULT_WEBSOCKET_PORT} cannot be used for native relay discovery because WebSocket URLs omit the default port. Choose another port.`,
            }),
          )
        }
      }
    }

    if (isHelp) {
      return NativeRelayOptions.Help()
    } else {
      return NativeRelayOptions.Start({
        projectRoot: yield* resolveNativeProjectRoot(projectRoot),
        port,
      })
    }
  })
