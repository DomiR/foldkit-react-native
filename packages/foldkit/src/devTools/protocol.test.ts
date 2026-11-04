import { Option, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { DevToolsEnvelope, Event, Request, Response } from './protocol.js'

const jsonEnvelopeSchema = Schema.fromJsonString(DevToolsEnvelope)
const encodeEnvelope = Schema.encodeUnknownSync(jsonEnvelopeSchema)
const decodeEnvelope = Schema.decodeUnknownSync(jsonEnvelopeSchema)

const roundTrip = (envelope: DevToolsEnvelope): DevToolsEnvelope =>
  decodeEnvelope(encodeEnvelope(envelope))

describe('DevToolsEnvelope', () => {
  it('round-trips Request, Response, and Event envelopes through JSON', () => {
    const envelopes: ReadonlyArray<DevToolsEnvelope> = [
      DevToolsEnvelope.Request({
        frame: {
          id: 'request-1',
          maybeConnectionId: Option.some('runtime-1'),
          request: Request.RequestGetModel({
            maybePath: Option.some('root.count'),
            expand: true,
          }),
        },
      }),
      DevToolsEnvelope.Response({
        frame: {
          id: 'request-1',
          response: Response.ResponseError({ reason: 'not found' }),
        },
      }),
      DevToolsEnvelope.Event({
        frame: {
          maybeConnectionId: Option.none(),
          event: Event.EventDisconnected({ connectionId: 'runtime-1' }),
        },
      }),
    ]

    for (const envelope of envelopes) {
      expect(roundTrip(envelope)).toEqual(envelope)
    }
  })

  it('encodes Option fields as JSON null or their values', () => {
    const encoded = encodeEnvelope(
      DevToolsEnvelope.Request({
        frame: {
          id: 'request-1',
          maybeConnectionId: Option.none(),
          request: Request.RequestGetInit(),
        },
      }),
    )

    expect(JSON.parse(encoded)).toEqual({
      _tag: 'Request',
      frame: {
        id: 'request-1',
        maybeConnectionId: null,
        request: { _tag: 'RequestGetInit' },
      },
    })
  })

  it('rejects malformed, unknown, and mismatched envelopes', () => {
    expect(() => decodeEnvelope('{')).toThrow()
    expect(() =>
      decodeEnvelope(
        JSON.stringify({
          _tag: 'Unknown',
          frame: {},
        }),
      ),
    ).toThrow()
    expect(() =>
      decodeEnvelope(
        JSON.stringify({
          _tag: 'Request',
          frame: {
            id: 'request-1',
            maybeConnectionId: null,
            response: { _tag: 'ResponseError', reason: 'wrong direction' },
          },
        }),
      ),
    ).toThrow()
  })
})
