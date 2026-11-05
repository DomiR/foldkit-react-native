import { Effect, Option } from 'effect'
import { Request } from 'foldkit/devtools-protocol'
import { createHmac, randomBytes } from 'node:crypto'
import { get } from 'node:http'
import { describe, expect, it, onTestFinished } from 'vitest'
import { WebSocket } from 'ws'

import {
  MCP_RELAY_PATH,
  RELAY_CHALLENGE_HEADER,
  RELAY_CLIENT_PROOF_HEADER,
  computeRelayProof,
  makeRelayToken,
} from '../src/relayAuthentication.ts'
import { resolveRelayTargets } from '../src/relayLocation.ts'
import { makeRelayRegistryReader } from '../src/relayRegistry.ts'
import {
  nativeUrl,
  openSocket,
  refusedUpgrade,
  request,
  startRelay,
} from './nativeRelayFixtures.ts'
import { listedIds, openSession, useWorkspace } from './relayFixtures.ts'
import { runWithNode } from './relayRegistryFixtures.ts'

describe('native relay authentication', () => {
  const workspace = useWorkspace()

  it('creates 64-hex tokens and uses the Vite HMAC challenge format', () => {
    const token = makeRelayToken()
    const challenge = randomBytes(32).toString('hex')
    expect(token).toMatch(/^[0-9a-f]{64}$/)

    const roles: ReadonlyArray<'client' | 'server'> = ['client', 'server']

    for (const role of roles) {
      expect(computeRelayProof(token, role, challenge)).toBe(
        createHmac('sha256', token)
          .update(`${role}:${challenge}`)
          .digest('hex'),
      )
    }
  })

  it('accepts absent Origin and only the six exact loopback target origins', async () => {
    const relay = await startRelay(workspace.root)
    const absent = await openSocket(nativeUrl(relay))
    expect(absent.readyState).toBe(WebSocket.OPEN)

    for (const host of ['127.0.0.1', 'localhost', '10.0.2.2']) {
      for (const protocol of ['http', 'ws']) {
        const socket = await openSocket(nativeUrl(relay), {
          origin: `${protocol}://${host}:${relay.port}`,
        })
        expect(socket.readyState).toBe(WebSocket.OPEN)
      }
    }
  })

  it('rejects foreign, null, malformed, duplicate and lookalike origins before upgrading', async () => {
    const relay = await startRelay(workspace.root)
    const origins = [
      'null',
      '',
      'http://foreign.example',
      `http://localhost:${relay.port + 1}`,
      `http://localhost.evil:${relay.port}`,
      `http://127.0.0.1:${relay.port}/`,
      `http://user@localhost:${relay.port}`,
      `https://localhost:${relay.port}`,
      `http://LOCALHOST:${relay.port}`,
      `http://localhost:${relay.port}?query=1`,
      `http://localhost:${relay.port}, http://localhost:${relay.port}`,
    ]

    for (const origin of origins) {
      expect(
        await refusedUpgrade(nativeUrl(relay), { headers: { Origin: origin } }),
      ).toBe(403)
    }

    expect(
      await refusedUpgrade(nativeUrl(relay), {
        headers: {
          Origin: [
            `http://localhost:${relay.port}`,
            `http://localhost:${relay.port}`,
          ],
        },
      }),
    ).toBe(403)
  })

  it('keeps native Origin permissions separate from MCP authentication', async () => {
    const relay = await startRelay(workspace.root)
    const plainMcpUrl = `ws://127.0.0.1:${relay.port}${MCP_RELAY_PATH}`
    expect(await refusedUpgrade(plainMcpUrl)).toBe(401)
    expect(await refusedUpgrade(`${plainMcpUrl}?token=wrong`)).toBe(401)
    expect(
      await refusedUpgrade(relay.url, {
        origin: `http://127.0.0.1:${relay.port}`,
      }),
    ).toBe(403)
    expect(await refusedUpgrade(plainMcpUrl, { origin: 'null' })).toBe(403)
    expect(
      await refusedUpgrade(plainMcpUrl, {
        headers: {
          [RELAY_CHALLENGE_HEADER]: 'a'.repeat(64),
          [RELAY_CLIENT_PROOF_HEADER]: 'b'.repeat(64),
        },
      }),
    ).toBe(401)
    expect(await refusedUpgrade(`ws://127.0.0.1:${relay.port}/unknown`)).toBe(
      404,
    )
    expect(await refusedUpgrade(`ws://127.0.0.1:${relay.port}/`)).toBe(404)
    const mcp = await openSocket(relay.url)
    expect(
      (await request(mcp, Request.RequestListRuntimes())).response._tag,
    ).toBe('ResponseRuntimes')
  })

  it('proves server token possession during the upgrade', async () => {
    const relay = await startRelay(workspace.root)
    const url = new URL(relay.url)
    const token = Option.getOrThrow(
      Option.fromNullishOr(url.searchParams.get('token')),
    )
    url.search = ''
    const challenge = randomBytes(32).toString('hex')
    const socket = new WebSocket(url, {
      headers: {
        [RELAY_CHALLENGE_HEADER]: challenge,
        [RELAY_CLIENT_PROOF_HEADER]: createHmac('sha256', token)
          .update(`client:${challenge}`)
          .digest('hex'),
      },
    })
    onTestFinished(() => socket.terminate())
    const proof = await new Promise<string | ReadonlyArray<string> | undefined>(
      (resolve, reject) => {
        socket.once('upgrade', response =>
          resolve(response.headers['x-foldkit-relay-server-proof']),
        )
        socket.once('error', reject)
      },
    )
    expect(proof).toBe(
      createHmac('sha256', token).update(`server:${challenge}`).digest('hex'),
    )
  })

  it('answers plain HTTP without exposing the token', async () => {
    const relay = await startRelay(workspace.root)
    const status = (path: string) =>
      new Promise<number | undefined>((resolve, reject) => {
        get(`http://127.0.0.1:${relay.port}${path}`, response => {
          response.resume()
          resolve(response.statusCode)
        }).once('error', reject)
      })
    expect(await status(MCP_RELAY_PATH)).toBe(426)
    expect(await status('/__foldkit/devtools-runtime')).toBe(426)
    expect(await status('/')).toBe(404)
  })

  it('uses the same discovered-client handshake as the Vite relay', async () => {
    const relay = await startRelay(workspace.root)
    const targets = await runWithNode(
      Effect.flatMap(makeRelayRegistryReader, registryReader =>
        resolveRelayTargets(
          {
            projectRoot: workspace.root,
            maybeConfiguredHost: Option.none(),
            maybeConfiguredPort: Option.none(),
          },
          registryReader,
        ),
      ),
    )
    const client = await openSession(workspace.root)
    expect(await listedIds(client)).toEqual([])
    expect(targets).toHaveLength(1)
    expect(targets.map(({ url }) => url)).toEqual([relay.url])
  })
})
