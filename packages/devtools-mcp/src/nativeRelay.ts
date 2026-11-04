import {
  Array,
  Clock,
  Console,
  Data,
  Deferred,
  Effect,
  Match,
  Option,
  Order,
  Predicate,
  Ref,
  Schema,
  type Scope,
} from 'effect'
import {
  DevToolsEnvelope,
  Event,
  type EventFrame,
  RELAY_RECORD_VERSION,
  RelayRecord,
  Request,
  RequestFrame,
  Response,
  ResponseFrame,
  type RuntimeInfo,
} from 'foldkit/devtools-protocol'
import { randomUUID } from 'node:crypto'
import { type IncomingMessage, createServer } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'

import { resolveNativeProjectRoot } from './nativeRelayOptions.js'
import {
  MCP_RELAY_PATH,
  NATIVE_RELAY_PATH,
  RELAY_SERVER_PROOF_HEADER,
  acceptsNativeOrigin,
  authenticatesMcpRelay,
  computeRelayProof,
  hasRelayOrigin,
  makeRelayToken,
  relayChallenge,
} from './relayAuthentication.js'
import {
  type RelayPublisherServices,
  RelayRegistryDirectoryRefused,
  publishRelayRecord,
  retireRelayRecord,
} from './relayRegistryPublisher.js'
import { relayRegistryTrust } from './relayRegistryTrust.js'

const LOOPBACK_HOST = '127.0.0.1'
const HEARTBEAT_INTERVAL_MS = 10_000
const REQUEST_TIMEOUT_MS = 10_000
const MAX_PORT = 65535
const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404
const UPGRADE_REQUIRED = 426

/** Failure to bind or publish the native relay, or a listener failure. */
export class NativeRelayStartFailed extends Data.TaggedError(
  'NativeRelayStartFailed',
)<Readonly<{ message: string; cause: unknown }>> {}

/** A scoped listener and its authenticated discovery address. */
export type NativeRelay = Readonly<{
  port: number
  url: string
  awaitFailure: Effect.Effect<never, NativeRelayStartFailed>
}>

type ConnectedRuntime = Readonly<{
  runtime: RuntimeInfo
  socket: WebSocket
  sequence: number
}>

type PendingRequest = Readonly<{
  socket: WebSocket
  requester: WebSocket
  connectionId: string
  timeout: ReturnType<typeof setTimeout>
}>

type State = Readonly<{
  runtimes: Map<string, ConnectedRuntime>
  pending: Map<string, PendingRequest>
  mcpClients: Set<WebSocket>
  nativeClients: Map<WebSocket, { isAlive: boolean }>
  nextSequence: Ref.Ref<number>
}>

type RelayEvent = Data.TaggedEnum<{
  ReceivedMcpFrame: { socket: WebSocket; raw: string; isBinary: boolean }
  ReceivedNativeFrame: { socket: WebSocket; raw: string; isBinary: boolean }
  ClosedSocket: { socket: WebSocket }
  ElapsedRequestTimeout: { id: string }
  ElapsedHeartbeat: {}
}>
const RelayEvent = Data.taggedEnum<RelayEvent>()

const decodeEnvelope = Schema.decodeUnknownOption(
  Schema.fromJsonString(DevToolsEnvelope),
)
const encodeEnvelope = Schema.encodeSync(
  Schema.fromJsonString(DevToolsEnvelope),
)
const decodeRequest = Schema.decodeUnknownOption(
  Schema.fromJsonString(RequestFrame),
)
const encodeResponse = Schema.encodeSync(Schema.fromJsonString(ResponseFrame))
const parseRequestUrl = Option.liftThrowable(
  (request: IncomingMessage) => new URL(request.url ?? '/', 'http://relay'),
)
const byConnectionOrder: Order.Order<ConnectedRuntime> = Order.mapInput(
  Order.Number,
  ({ sequence }) => sequence,
)

const send = (socket: WebSocket, payload: string): void => {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }

  try {
    socket.send(payload, error => {
      if (error) {
        socket.terminate()
      }
    })
  } catch {
    socket.terminate()
  }
}

const reply = (socket: WebSocket, id: string, response: Response): void =>
  send(socket, encodeResponse(ResponseFrame.make({ id, response })))

const rejectRequest = (socket: WebSocket, id: string, reason: string): void =>
  reply(socket, id, Response.ResponseError({ reason }))

const removePending = (state: State, id: string): void => {
  const pending = state.pending.get(id)

  if (pending !== undefined) {
    clearTimeout(pending.timeout)
    state.pending.delete(id)
  }
}

const disconnectRuntime = (state: State, connectionId: string) =>
  Effect.gen(function* () {
    state.runtimes.delete(connectionId)

    for (const [id, pending] of state.pending) {
      if (pending.connectionId === connectionId) {
        removePending(state, id)
        rejectRequest(
          pending.requester,
          id,
          `Foldkit Runtime ${connectionId} disconnected.`,
        )
      }
    }

    yield* Console.log(
      `[foldkit:devTools] runtime disconnected: ${connectionId}`,
    )
  })

const handleLifecycle = (state: State, socket: WebSocket, frame: EventFrame) =>
  Event.match<Effect.Effect<void>>(frame.event, {
    EventConnected: ({ runtime }) =>
      Effect.gen(function* () {
        if (!Option.contains(frame.maybeConnectionId, runtime.connectionId)) {
          yield* Console.warn(
            '[foldkit:devTools] ignored a native runtime announcement with mismatched ids',
          )
          return
        }

        const existing = state.runtimes.get(runtime.connectionId)

        if (existing !== undefined) {
          if (existing.socket !== socket) {
            const { sequence } = existing
            state.runtimes.set(runtime.connectionId, {
              runtime,
              socket,
              sequence,
            })
            yield* Console.log(
              `[foldkit:devTools] runtime reconnected: ${runtime.connectionId} (${runtime.title})`,
            )
          }

          return
        }

        const sequence = yield* Ref.getAndUpdate(
          state.nextSequence,
          value => value + 1,
        )
        state.runtimes.set(runtime.connectionId, { runtime, socket, sequence })
        yield* Console.log(
          `[foldkit:devTools] runtime connected: ${runtime.connectionId} (${runtime.title})`,
        )
      }),
    EventDisconnected: ({ connectionId }) =>
      Effect.gen(function* () {
        if (!Option.contains(frame.maybeConnectionId, connectionId)) {
          return
        }

        if (state.runtimes.get(connectionId)?.socket === socket) {
          yield* disconnectRuntime(state, connectionId)
        }
      }),
  })

const handleResponse = (
  state: State,
  socket: WebSocket,
  frame: ResponseFrame,
) =>
  Effect.sync(() => {
    const pending = state.pending.get(frame.id)

    if (pending === undefined || pending.socket !== socket) {
      return
    }

    removePending(state, frame.id)
    const payload = encodeResponse(frame)

    for (const client of state.mcpClients) {
      send(client, payload)
    }
  })

const routeRequest = (
  state: State,
  socket: WebSocket,
  frame: RequestFrame,
  enqueue: (event: RelayEvent) => void,
) =>
  Effect.sync(() => {
    const maybeRuntime = Option.match(frame.maybeConnectionId, {
      onNone: () =>
        Array.last(
          Array.sort(
            Array.fromIterable(state.runtimes.values()),
            byConnectionOrder,
          ),
        ),
      onSome: connectionId =>
        Option.fromNullishOr(state.runtimes.get(connectionId)),
    })

    if (Option.isNone(maybeRuntime)) {
      rejectRequest(
        socket,
        frame.id,
        Option.match(frame.maybeConnectionId, {
          onNone: () =>
            'No connected Foldkit runtimes. Open a native app with DevTools enabled and try again.',
          onSome: connectionId =>
            `No connected Foldkit Runtime has the id ${connectionId}. Call foldkit_list_runtimes for the current ids.`,
        }),
      )
      return
    }

    const { runtime, socket: runtimeSocket } = maybeRuntime.value

    if (runtimeSocket.readyState !== WebSocket.OPEN) {
      rejectRequest(
        socket,
        frame.id,
        `Foldkit Runtime ${runtime.connectionId} disconnected.`,
      )
      return
    }

    const timeout = setTimeout(
      () => enqueue(RelayEvent.ElapsedRequestTimeout({ id: frame.id })),
      REQUEST_TIMEOUT_MS,
    )
    state.pending.set(frame.id, {
      socket: runtimeSocket,
      requester: socket,
      connectionId: runtime.connectionId,
      timeout,
    })
    send(
      runtimeSocket,
      encodeEnvelope(
        DevToolsEnvelope.Request({
          frame: RequestFrame.make({
            ...frame,
            maybeConnectionId: Option.some(runtime.connectionId),
          }),
        }),
      ),
    )
  })

const handleMcpFrame = (
  state: State,
  socket: WebSocket,
  raw: string,
  enqueue: (event: RelayEvent) => void,
) =>
  Effect.gen(function* () {
    const maybeFrame = decodeRequest(raw)

    if (Option.isNone(maybeFrame)) {
      yield* Console.warn(
        '[foldkit:devTools] ignored malformed MCP request frame',
      )
      return
    }

    const frame = maybeFrame.value

    if (state.pending.has(frame.id)) {
      rejectRequest(
        socket,
        frame.id,
        `A request with id ${frame.id} is already pending.`,
      )
      return
    }

    yield* Request.matchOrElse<Effect.Effect<void>>(
      frame.request,
      {
        RequestListRuntimes: () =>
          Effect.sync(() => {
            const runtimes = Array.map(
              Array.sort(
                Array.fromIterable(state.runtimes.values()),
                byConnectionOrder,
              ),
              ({ runtime }) => runtime,
            )
            reply(socket, frame.id, Response.ResponseRuntimes({ runtimes }))
          }),
      },
      () => routeRequest(state, socket, frame, enqueue),
    )
  })

const dispatchEvent = (
  state: State,
  event: RelayEvent,
  enqueue: (event: RelayEvent) => void,
): Effect.Effect<void> =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      ReceivedMcpFrame: ({ socket, raw, isBinary }) =>
        isBinary ? Effect.void : handleMcpFrame(state, socket, raw, enqueue),
      ReceivedNativeFrame: ({ socket, raw, isBinary }) =>
        Effect.gen(function* () {
          if (isBinary) {
            return
          }

          const maybeEnvelope = decodeEnvelope(raw)

          if (Option.isNone(maybeEnvelope)) {
            yield* Console.warn(
              '[foldkit:devTools] ignored malformed native frame',
            )
            return
          }

          yield* DevToolsEnvelope.match<Effect.Effect<void>>(
            maybeEnvelope.value,
            {
              Request: () =>
                Console.warn(
                  '[foldkit:devTools] ignored a request from a native socket',
                ),
              Response: ({ frame }) => handleResponse(state, socket, frame),
              Event: ({ frame }) => handleLifecycle(state, socket, frame),
            },
          )
        }),
      ClosedSocket: ({ socket }) =>
        Effect.gen(function* () {
          state.mcpClients.delete(socket)
          state.nativeClients.delete(socket)

          for (const [connectionId, connected] of state.runtimes) {
            if (connected.socket === socket) {
              yield* disconnectRuntime(state, connectionId)
            }
          }

          for (const [id, pending] of state.pending) {
            if (pending.requester === socket) {
              removePending(state, id)
            }
          }
        }),
      ElapsedRequestTimeout: ({ id }) =>
        Effect.sync(() => {
          const pending = state.pending.get(id)

          if (pending !== undefined) {
            removePending(state, id)
            rejectRequest(
              pending.requester,
              id,
              'The Foldkit Runtime did not respond within 10 seconds.',
            )
          }
        }),
      ElapsedHeartbeat: () =>
        Effect.gen(function* () {
          for (const [socket, heartbeat] of state.nativeClients) {
            if (!heartbeat.isAlive) {
              socket.terminate()
              yield* dispatchEvent(
                state,
                RelayEvent.ClosedSocket({ socket }),
                enqueue,
              )
              continue
            }

            heartbeat.isAlive = false

            yield* Effect.try(() => socket.ping()).pipe(
              Effect.catch(() => Effect.sync(() => socket.terminate())),
            )
          }
        }),
    }),
  )

const refuseUpgrade = (
  socket: Duplex,
  status: number,
  reason: string,
): void => {
  socket.on('error', () => socket.destroy())
  socket.once('finish', () => socket.destroy())
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  )
}

/** Start a loopback relay in the caller's Scope. Port zero is available to tests. */
export const startNativeRelay = (
  options: Readonly<{ projectRoot: string; port: number }>,
): Effect.Effect<
  NativeRelay,
  NativeRelayStartFailed,
  Scope.Scope | RelayPublisherServices
> =>
  Effect.gen(function* () {
    if (
      !globalThis.Number.isInteger(options.port) ||
      options.port < 0 ||
      options.port > MAX_PORT
    ) {
      return yield* Effect.fail(
        new NativeRelayStartFailed({
          message: 'Invalid native relay port.',
          cause: options.port,
        }),
      )
    }

    const root = yield* resolveNativeProjectRoot(options.projectRoot)
    const nextSequence = yield* Ref.make(0)
    const failure = yield* Deferred.make<never, NativeRelayStartFailed>()
    const state: State = {
      runtimes: new Map(),
      pending: new Map(),
      mcpClients: new Set(),
      nativeClients: new Map(),
      nextSequence,
    }
    const enqueue = (event: RelayEvent): void => {
      Effect.runSync(dispatchEvent(state, event, enqueue))
    }
    const id = yield* Effect.sync(randomUUID)
    const token = yield* Effect.sync(makeRelayToken)
    const resources = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const httpServer = createServer((request, response) => {
          const maybeUrl = parseRequestUrl(request)
          const isRelayPath = Option.exists(
            maybeUrl,
            url =>
              url.pathname === MCP_RELAY_PATH ||
              url.pathname === NATIVE_RELAY_PATH,
          )
          response.writeHead(isRelayPath ? UPGRADE_REQUIRED : NOT_FOUND).end()
        })
        const mcpServer = new WebSocketServer({ noServer: true })
        const nativeServer = new WebSocketServer({ noServer: true })
        const connections = new Set<Socket>()
        httpServer.on('connection', socket => {
          connections.add(socket)
          socket.on('close', () => connections.delete(socket))
          socket.on('error', () => socket.destroy())
        })
        const reportFailure = (cause: Error): void => {
          Effect.runSync(
            Deferred.fail(
              failure,
              new NativeRelayStartFailed({
                message: 'Native relay listener failed.',
                cause,
              }),
            ),
          )
        }
        httpServer.on('error', reportFailure)
        mcpServer.on('error', reportFailure)
        nativeServer.on('error', reportFailure)
        return { httpServer, mcpServer, nativeServer, connections }
      }),
      ({ httpServer, mcpServer, nativeServer, connections }) =>
        Effect.callback<void>(resume => {
          for (const pending of state.pending.values()) {
            clearTimeout(pending.timeout)
          }

          state.pending.clear()

          for (const server of [mcpServer, nativeServer]) {
            for (const socket of server.clients) {
              socket.terminate()
            }

            server.close()
          }

          for (const socket of connections) {
            socket.destroy()
          }

          httpServer.close(() => resume(Effect.void))
        }),
    )
    const { httpServer, mcpServer, nativeServer } = resources

    mcpServer.on('headers', (headers, request) => {
      const maybeChallenge = relayChallenge(request)

      if (Option.isSome(maybeChallenge)) {
        headers.push(
          `${RELAY_SERVER_PROOF_HEADER}: ${computeRelayProof(token, 'server', maybeChallenge.value)}`,
        )
      }
    })

    const attachSocket = (socket: WebSocket, isNative: boolean): void => {
      if (isNative) {
        const heartbeat = { isAlive: true }
        state.nativeClients.set(socket, heartbeat)
        socket.on('pong', () => {
          heartbeat.isAlive = true
        })
      } else {
        state.mcpClients.add(socket)
      }

      socket.on('message', (raw, isBinary) =>
        enqueue(
          isNative
            ? RelayEvent.ReceivedNativeFrame({
                socket,
                raw: raw.toString(),
                isBinary,
              })
            : RelayEvent.ReceivedMcpFrame({
                socket,
                raw: raw.toString(),
                isBinary,
              }),
        ),
      )
      socket.on('close', () => enqueue(RelayEvent.ClosedSocket({ socket })))
      socket.on('error', () => socket.terminate())
    }
    mcpServer.on('connection', socket => attachSocket(socket, false))
    nativeServer.on('connection', socket => attachSocket(socket, true))

    httpServer.on('upgrade', (request, socket, head) => {
      const maybeUrl = parseRequestUrl(request)

      if (Option.isNone(maybeUrl)) {
        refuseUpgrade(socket, BAD_REQUEST, 'Bad Request')
        return
      }

      const url = maybeUrl.value
      const isNative = url.pathname === NATIVE_RELAY_PATH

      if (!isNative && url.pathname !== MCP_RELAY_PATH) {
        refuseUpgrade(socket, NOT_FOUND, 'Not Found')
        return
      }

      const address = httpServer.address()

      if (address === null || Predicate.isString(address)) {
        refuseUpgrade(socket, BAD_REQUEST, 'Bad Request')
        return
      }

      if (
        isNative
          ? !acceptsNativeOrigin(request, address.port)
          : hasRelayOrigin(request)
      ) {
        refuseUpgrade(socket, FORBIDDEN, 'Forbidden')
        return
      }

      if (!isNative && !authenticatesMcpRelay(request, url, token)) {
        refuseUpgrade(socket, UNAUTHORIZED, 'Unauthorized')
        return
      }

      const server = isNative ? nativeServer : mcpServer

      try {
        server.handleUpgrade(request, socket, head, client =>
          server.emit('connection', client, request),
        )
      } catch {
        refuseUpgrade(socket, BAD_REQUEST, 'Bad Request')
      }
    })

    const port = yield* Effect.callback<number, NativeRelayStartFailed>(
      resume => {
        const onError = (cause: Error) =>
          resume(
            Effect.fail(
              new NativeRelayStartFailed({
                message: `Cannot listen on ${LOOPBACK_HOST}:${options.port}. The port must be available.`,
                cause,
              }),
            ),
          )
        httpServer.once('error', onError)
        httpServer.listen(options.port, LOOPBACK_HOST, () => {
          httpServer.off('error', onError)
          const address = httpServer.address()

          if (address === null || Predicate.isString(address)) {
            onError(new Error('The native relay has no bound port.'))
          } else {
            resume(Effect.succeed(address.port))
          }
        })
        return Effect.sync(() => {
          httpServer.off('error', onError)
        })
      },
    )
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        setInterval(
          () => enqueue(RelayEvent.ElapsedHeartbeat()),
          HEARTBEAT_INTERVAL_MS,
        ),
      ),
      timer => Effect.sync(() => clearInterval(timer)),
    )

    const url = `ws://${LOOPBACK_HOST}:${port}${MCP_RELAY_PATH}?token=${token}`
    const startedAt = yield* Clock.currentTimeMillis
    yield* Effect.acquireRelease(
      publishRelayRecord(
        RelayRecord.make({
          version: RELAY_RECORD_VERSION,
          id,
          root,
          url,
          pid: process.pid,
          startedAt,
        }),
        relayRegistryTrust,
      ),
      directory => retireRelayRecord(id, directory).pipe(Effect.ignore),
    )
    yield* Console.log(
      `[foldkit:devTools] native relay listening on ${LOOPBACK_HOST}:${port} for ${root}`,
    )

    const relay: NativeRelay = {
      port,
      url,
      awaitFailure: Deferred.await(failure),
    }
    return relay
  }).pipe(
    Effect.mapError(cause => {
      if (cause instanceof NativeRelayStartFailed) {
        return cause
      }

      if (cause instanceof RelayRegistryDirectoryRefused) {
        return new NativeRelayStartFailed({
          message: `Cannot publish the native relay record: ${cause.directory} ${cause.reason}. Set FOLDKIT_DEVTOOLS_RELAY_DIRECTORY to a private directory shared with the MCP process.`,
          cause,
        })
      }

      return new NativeRelayStartFailed({
        message: 'Cannot start the native relay.',
        cause,
      })
    }),
  )
