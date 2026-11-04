import { Effect, Exit, Option, Predicate, Schema, Scope } from 'effect'
import {
  DevToolsEnvelope,
  Event,
  EventFrame,
  Request,
  RequestFrame,
  Response,
  ResponseFrame,
  RuntimeInfo,
} from 'foldkit/devtools-protocol'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ClientRequestArgs } from 'node:http'
import { resolve } from 'node:path'
import { onTestFinished } from 'vitest'
import { type ClientOptions, type RawData, WebSocket } from 'ws'

import { type NativeRelay, startNativeRelay } from '../src/nativeRelay.ts'
import { NATIVE_RELAY_PATH } from '../src/relayAuthentication.ts'
import { runWithNode } from './relayRegistryFixtures.ts'

const RESPONSE_WAIT_MS = 2_000
const decodeEnvelope = Schema.decodeUnknownSync(
  Schema.fromJsonString(DevToolsEnvelope),
)
const encodeEnvelope = Schema.encodeSync(
  Schema.fromJsonString(DevToolsEnvelope),
)
const decodeResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(ResponseFrame),
)
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(RequestFrame))

export const startRelay = async (projectRoot: string, port = 0) => {
  const scope = Scope.makeUnsafe()
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void))
  onTestFinished(close)

  try {
    const relay = await runWithNode(
      startNativeRelay({ projectRoot, port }).pipe(
        Effect.provideService(Scope.Scope, scope),
      ),
    )
    return { ...relay, close }
  } catch (error) {
    await close()
    throw error
  }
}

export const nativeUrl = (relay: NativeRelay) =>
  `ws://127.0.0.1:${relay.port}${NATIVE_RELAY_PATH}`

export const openSocket = async (url: string, options: ClientOptions = {}) => {
  const socket = new WebSocket(url, options)
  onTestFinished(() => socket.terminate())
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

export const sendEnvelope = (socket: WebSocket, envelope: DevToolsEnvelope) =>
  socket.send(encodeEnvelope(envelope))

export const announce = (socket: WebSocket, connectionId: string) =>
  sendEnvelope(
    socket,
    DevToolsEnvelope.Event({
      frame: EventFrame.make({
        maybeConnectionId: Option.some(connectionId),
        event: Event.EventConnected({
          runtime: RuntimeInfo.make({
            connectionId,
            url: `foldkit-native://ios/${connectionId}`,
            title: connectionId,
          }),
        }),
      }),
    }),
  )

export const disconnect = (socket: WebSocket, connectionId: string) =>
  sendEnvelope(
    socket,
    DevToolsEnvelope.Event({
      frame: EventFrame.make({
        maybeConnectionId: Option.some(connectionId),
        event: Event.EventDisconnected({ connectionId }),
      }),
    }),
  )

export const flushSocket = (socket: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Socket did not pong')),
      RESPONSE_WAIT_MS,
    )
    socket.once('pong', () => {
      clearTimeout(timeout)
      resolve()
    })
    socket.ping()
  })

export const openNativeRuntime = async (
  relay: NativeRelay,
  connectionId: string,
  options: Readonly<{ isResponding?: boolean; autoPong?: boolean }> = {},
) => {
  const socket = await openSocket(nativeUrl(relay), {
    autoPong: options.autoPong ?? true,
  })
  const requests: Array<RequestFrame> = []
  socket.on('message', raw => {
    const envelope = decodeEnvelope(raw.toString())

    if (envelope._tag !== 'Request') {
      return
    }

    requests.push(envelope.frame)

    if (options.isResponding === false) {
      return
    }

    const response = Request.matchOrElse<Response>(
      envelope.frame.request,
      {
        RequestGetModel: () =>
          Response.ResponseModel({
            value: { connectionId },
            atPath: 'root',
            summarized: false,
          }),
        RequestGetInit: () =>
          Response.ResponseInit({
            maybeModel: Option.some({ connectionId }),
            commands: [],
            mountStarts: [],
          }),
      },
      () => Response.ResponseResumed(),
    )
    sendEnvelope(
      socket,
      DevToolsEnvelope.Response({
        frame: ResponseFrame.make({ id: envelope.frame.id, response }),
      }),
    )
  })
  announce(socket, connectionId)
  await flushSocket(socket)
  return { socket, requests }
}

export const waitForResponse = (
  socket: WebSocket,
  id: string,
): Promise<ResponseFrame> =>
  new Promise((resolve, reject) => {
    const detach = () => {
      clearTimeout(timeout)
      socket.off('message', received)
    }
    const received = (raw: RawData) => {
      const frame = decodeResponse(raw.toString())

      if (frame.id === id) {
        detach()
        resolve(frame)
      }
    }
    const timeout = setTimeout(() => {
      detach()
      reject(new Error(`No response for ${id}`))
    }, RESPONSE_WAIT_MS)
    socket.on('message', received)
  })

export const request = (
  socket: WebSocket,
  request: Request,
  maybeConnectionId: Option.Option<string> = Option.none(),
  id: string = randomUUID(),
) => {
  const response = waitForResponse(socket, id)
  socket.send(
    encodeRequest(RequestFrame.make({ id, maybeConnectionId, request })),
  )
  return response
}

export const getModel = Request.RequestGetModel({
  maybePath: Option.none(),
  expand: false,
})

export const refusedUpgrade = (
  url: string,
  options: ClientOptions | ClientRequestArgs = {},
): Promise<number> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options)
    onTestFinished(() => socket.terminate())
    socket.on('error', () => {})
    socket.once('open', () => {
      socket.terminate()
      reject(new Error('Upgrade unexpectedly accepted'))
    })
    socket.once('unexpected-response', (request, response) => {
      response.resume()
      request.destroy()
      resolve(Option.getOrThrow(Option.fromNullishOr(response.statusCode)))
    })
  })

export const spawnRelayCommand = (
  projectRoot: string,
  args: ReadonlyArray<string>,
) => {
  const child = spawn(
    process.execPath,
    [resolve(import.meta.dirname, '../dist/server.js'), 'relay', ...args],
    {
      cwd: projectRoot,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const output: Array<string> = []
  const lifecycle = { isExited: false }
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  const exited = new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', code => {
      lifecycle.isExited = true
      resolveExit(code)
    })
  })
  onTestFinished(async () => {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (!Predicate.hasProperty(error, 'code') || error.code !== 'ESRCH') {
          throw error
        }
      }
    } else if (!lifecycle.isExited) {
      child.kill('SIGKILL')
    }

    await exited
  })
  return { child, exited, output }
}
