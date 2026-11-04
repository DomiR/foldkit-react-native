import { Array, Effect, Option, Schema } from 'effect'
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
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  announce,
  disconnect,
  flushSocket,
  getModel,
  nativeUrl,
  openNativeRuntime,
  openSocket,
  request,
  sendEnvelope,
  startRelay,
  waitForResponse,
} from './nativeRelayFixtures.ts'
import { listedIds, openSession, useWorkspace } from './relayFixtures.ts'

describe('native relay', () => {
  const workspace = useWorkspace()

  it('discovers native runtimes through the existing client and forwards GetModel', async () => {
    const relay = await startRelay(workspace.root)
    const first = await openNativeRuntime(relay, 'first')
    const second = await openNativeRuntime(relay, 'second')
    const client = await openSession(workspace.root)

    expect(await listedIds(client)).toEqual(['first', 'second'])
    expect(
      await Effect.runPromise(
        client.sendRequest(getModel, Option.some('first')),
      ),
    ).toEqual(
      Response.ResponseModel({
        value: { connectionId: 'first' },
        atPath: 'root',
        summarized: false,
      }),
    )
    expect(Array.head(first.requests)).toEqual(
      Option.some(
        expect.objectContaining({ maybeConnectionId: Option.some('first') }),
      ),
    )
    expect(second.requests).toEqual([])

    const socket = await openSocket(relay.url)
    expect((await request(socket, getModel)).response).toEqual(
      Response.ResponseModel({
        value: { connectionId: 'second' },
        atPath: 'root',
        summarized: false,
      }),
    )
    expect(Array.head(second.requests)).toEqual(
      Option.some(
        expect.objectContaining({ maybeConnectionId: Option.some('second') }),
      ),
    )
  })

  it('answers empty lists and unknown targets immediately', async () => {
    const relay = await startRelay(workspace.root)
    const socket = await openSocket(relay.url)
    expect(
      (await request(socket, Request.RequestListRuntimes())).response,
    ).toEqual(Response.ResponseRuntimes({ runtimes: [] }))
    expect((await request(socket, getModel)).response._tag).toBe(
      'ResponseError',
    )
    expect(
      (await request(socket, getModel, Option.some('missing'))).response,
    ).toEqual(
      Response.ResponseError({
        reason:
          'No connected Foldkit Runtime has the id missing. Call foldkit_list_runtimes for the current ids.',
      }),
    )
  })

  it('broadcasts accepted responses to both MCP clients', async () => {
    const relay = await startRelay(workspace.root)
    await openNativeRuntime(relay, 'runtime')
    const first = await openSocket(relay.url)
    const second = await openSocket(relay.url)
    const broadcast = waitForResponse(second, 'broadcast')
    const response = await request(
      first,
      getModel,
      Option.some('runtime'),
      'broadcast',
    )
    expect(await broadcast).toEqual(response)
  })

  it('routes to the newest announcing socket and preserves it when the old socket closes', async () => {
    const relay = await startRelay(workspace.root)
    const first = await openNativeRuntime(relay, 'first')
    const second = await openNativeRuntime(relay, 'second')
    const client = await openSession(workspace.root)
    announce(first.socket, 'first')
    announce(first.socket, 'closing')
    await flushSocket(first.socket)
    const replacement = await openNativeRuntime(relay, 'first')
    disconnect(first.socket, 'first')
    await flushSocket(first.socket)
    sendEnvelope(
      second.socket,
      DevToolsEnvelope.Event({
        frame: EventFrame.make({
          maybeConnectionId: Option.some('wrong-id'),
          event: Event.EventConnected({
            runtime: RuntimeInfo.make({
              connectionId: 'spoofed',
              title: 'spoofed',
              url: 'foldkit-native://ios/spoofed',
            }),
          }),
        }),
      }),
    )
    await flushSocket(second.socket)

    expect(await listedIds(client)).toEqual(['first', 'second', 'closing'])
    expect(
      await Effect.runPromise(
        client.sendRequest(getModel, Option.some('first')),
      ),
    ).toEqual(
      Response.ResponseModel({
        value: { connectionId: 'first' },
        atPath: 'root',
        summarized: false,
      }),
    )
    expect(first.requests).toEqual([])
    expect(replacement.requests).toHaveLength(1)

    first.socket.terminate()
    await expect.poll(() => listedIds(client)).toEqual(['first', 'second'])
    expect(
      await Effect.runPromise(
        client.sendRequest(getModel, Option.some('first')),
      ),
    ).toEqual(
      Response.ResponseModel({
        value: { connectionId: 'first' },
        atPath: 'root',
        summarized: false,
      }),
    )
    expect(replacement.requests).toHaveLength(2)

    disconnect(replacement.socket, 'first')
    await flushSocket(replacement.socket)
    expect(await listedIds(client)).toEqual(['second'])
  })

  it('rejects spoofed responses and duplicate outstanding ids', async () => {
    const relay = await startRelay(workspace.root)
    const owner = await openNativeRuntime(relay, 'owner', {
      isResponding: false,
    })
    const stranger = await openNativeRuntime(relay, 'stranger', {
      isResponding: false,
    })
    const mcp = await openSocket(relay.url)
    const otherMcp = await openSocket(relay.url)
    const response = request(
      mcp,
      getModel,
      Option.some('owner'),
      'owned-request',
    )
    await expect.poll(() => owner.requests.length).toBe(1)

    sendEnvelope(
      stranger.socket,
      DevToolsEnvelope.Response({
        frame: ResponseFrame.make({
          id: 'owned-request',
          response: Response.ResponseResumed(),
        }),
      }),
    )
    await flushSocket(stranger.socket)
    expect(
      (
        await request(
          otherMcp,
          getModel,
          Option.some('stranger'),
          'owned-request',
        )
      ).response._tag,
    ).toBe('ResponseError')
    expect(stranger.requests).toEqual([])

    const expected = ResponseFrame.make({
      id: 'owned-request',
      response: Response.ResponseModel({
        value: 'owner',
        atPath: 'root',
        summarized: false,
      }),
    })
    sendEnvelope(owner.socket, DevToolsEnvelope.Response({ frame: expected }))
    expect(await response).toEqual(expected)
  })

  it('ignores malformed, binary and wrong-direction native frames', async () => {
    const relay = await startRelay(workspace.root)
    const socket = await openSocket(nativeUrl(relay))
    socket.send('{')
    socket.send(JSON.stringify({ _tag: 'Event', frame: {} }))
    socket.send(
      JSON.stringify({
        _tag: 'Event',
        frame: {
          maybeConnectionId: 'binary',
          event: {
            _tag: 'EventConnected',
            runtime: {
              connectionId: 'binary',
              title: 'binary',
              url: 'native://binary',
            },
          },
        },
      }),
      { binary: true },
    )
    sendEnvelope(
      socket,
      DevToolsEnvelope.Request({
        frame: RequestFrame.make({
          id: 'native-request',
          maybeConnectionId: Option.none(),
          request: Request.RequestListRuntimes(),
        }),
      }),
    )
    await flushSocket(socket)

    const client = await openSession(workspace.root)
    expect(await listedIds(client)).toEqual([])
    announce(socket, 'valid')
    await flushSocket(socket)
    expect(await listedIds(client)).toEqual(['valid'])
  })

  it('ignores malformed and binary MCP frames without forwarding them', async () => {
    const relay = await startRelay(workspace.root)
    const runtime = await openNativeRuntime(relay, 'runtime')
    const mcp = await openSocket(relay.url)
    mcp.send('{')
    mcp.send(JSON.stringify({ id: 'malformed', request: {} }))
    mcp.send(
      Schema.encodeSync(Schema.fromJsonString(RequestFrame))(
        RequestFrame.make({
          id: 'binary',
          maybeConnectionId: Option.some('runtime'),
          request: getModel,
        }),
      ),
      { binary: true },
    )
    await request(mcp, Request.RequestListRuntimes())
    await flushSocket(runtime.socket)
    expect(runtime.requests).toEqual([])
    expect((await request(mcp, getModel)).response._tag).toBe('ResponseModel')
  })

  it('prunes every runtime owned by a closed socket and rejects pending requests', async () => {
    const relay = await startRelay(workspace.root)
    const owner = await openNativeRuntime(relay, 'first', {
      isResponding: false,
    })
    announce(owner.socket, 'second')
    await flushSocket(owner.socket)
    const mcp = await openSocket(relay.url)
    const pending = request(mcp, getModel, Option.some('first'))
    await expect.poll(() => owner.requests.length).toBe(1)
    owner.socket.terminate()
    expect((await pending).response._tag).toBe('ResponseError')
    expect(
      (await request(mcp, Request.RequestListRuntimes())).response,
    ).toEqual(Response.ResponseRuntimes({ runtimes: [] }))
  })

  it('drops a runtime that stops answering heartbeat pings', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    try {
      const relay = await startRelay(workspace.root)
      await openNativeRuntime(relay, 'vanished', { autoPong: false })
      const client = await openSession(workspace.root)
      expect(await listedIds(client)).toEqual(['vanished'])
      await vi.advanceTimersByTimeAsync(20_000)
      expect(await listedIds(client)).toEqual([])
      await relay.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires pending requests and ignores responses received after expiry', async () => {
    const relay = await startRelay(workspace.root)
    const owner = await openNativeRuntime(relay, 'owner', {
      isResponding: false,
    })
    const mcp = await openSocket(relay.url)
    const responses: Array<ResponseFrame> = []
    const decode = Schema.decodeUnknownSync(
      Schema.fromJsonString(ResponseFrame),
    )
    mcp.on('message', raw => responses.push(decode(raw.toString())))
    const received = new Promise<void>(resolve =>
      owner.socket.once('message', () => resolve()),
    )
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      mcp.send(
        Schema.encodeSync(Schema.fromJsonString(RequestFrame))(
          RequestFrame.make({
            id: 'expired',
            maybeConnectionId: Option.some('owner'),
            request: getModel,
          }),
        ),
      )
      await received
      await vi.advanceTimersByTimeAsync(10_000)
    } finally {
      vi.useRealTimers()
    }

    await expect.poll(() => responses.length).toBe(1)
    expect(Array.head(responses)).toEqual(
      Option.some(
        ResponseFrame.make({
          id: 'expired',
          response: Response.ResponseError({
            reason: 'The Foldkit Runtime did not respond within 10 seconds.',
          }),
        }),
      ),
    )
    sendEnvelope(
      owner.socket,
      DevToolsEnvelope.Response({
        frame: ResponseFrame.make({
          id: 'expired',
          response: Response.ResponseResumed(),
        }),
      }),
    )
    await flushSocket(owner.socket)
    await request(mcp, Request.RequestListRuntimes())
    expect(responses.filter(({ id }) => id === 'expired')).toHaveLength(1)
  })

  it('discovers two applications and refreshes discovery after a relay restart', async () => {
    const appRoot = join(workspace.root, 'app')
    await mkdir(appRoot)
    const outer = await startRelay(workspace.root)
    const inner = await startRelay(appRoot)
    await openNativeRuntime(outer, 'outer')
    await openNativeRuntime(inner, 'inner')
    const client = await openSession(workspace.root)
    const peer = await openSession(workspace.root)
    expect(await listedIds(client)).toEqual(['outer', 'inner'])
    expect(await listedIds(peer)).toEqual(['outer', 'inner'])
    await inner.close()
    const restarted = await startRelay(appRoot)
    await openNativeRuntime(restarted, 'replacement')
    expect(await listedIds(client)).toEqual(['outer', 'replacement'])
    expect(
      (await Effect.runPromise(client.listRuntimes)).map(
        ({ maybeProjectRoot }) => maybeProjectRoot,
      ),
    ).toEqual([Option.some(workspace.root), Option.some(appRoot)])
  })
})
