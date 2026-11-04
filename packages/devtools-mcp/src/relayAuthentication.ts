import { Array, Option, Predicate, pipe } from 'effect'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Authenticated MCP socket endpoint. */
export const MCP_RELAY_PATH = '/__foldkit/devtools-mcp'
/** Native runtime socket endpoint. */
export const NATIVE_RELAY_PATH = '/__foldkit/devtools-runtime'
/** Challenge header shared with the Vite relay. */
export const RELAY_CHALLENGE_HEADER = 'x-foldkit-relay-challenge'
/** Client proof header shared with the Vite relay. */
export const RELAY_CLIENT_PROOF_HEADER = 'x-foldkit-relay-client-proof'
/** Server proof header shared with the Vite relay. */
export const RELAY_SERVER_PROOF_HEADER = 'X-Foldkit-Relay-Server-Proof'

const TOKEN_BYTES = 32
const PROOF_PATTERN = /^[0-9a-f]{64}$/
const NATIVE_HOSTS = ['127.0.0.1', 'localhost', '10.0.2.2']

const headerValues = (request: IncomingMessage, name: string) =>
  pipe(
    request.rawHeaders,
    Array.chunksOf(2),
    Array.map(pair => {
      const [header, value] = pair
      return header?.toLowerCase() === name
        ? Option.fromNullishOr(value)
        : Option.none<string>()
    }),
    Array.getSomes,
  )

/** Create the same 64-hex capability token used by Vite discovery. */
export const makeRelayToken = (): string =>
  randomBytes(TOKEN_BYTES).toString('hex')

/** Sign a challenge using the Vite relay handshake. */
export const computeRelayProof = (
  token: string,
  role: 'client' | 'server',
  challenge: string,
): string =>
  createHmac('sha256', token).update(`${role}:${challenge}`).digest('hex')

/** Accept only absent Origin or an exact native loopback target Origin. */
export const acceptsNativeOrigin = (
  request: IncomingMessage,
  port: number,
): boolean => {
  const origins = headerValues(request, 'origin')

  if (!Array.isArrayNonEmpty(origins)) {
    return request.headers.origin === undefined
  }

  if (origins.length !== 1) {
    return false
  }

  const origin = Array.headNonEmpty(origins)
  return NATIVE_HOSTS.some(
    host =>
      origin === `http://${host}:${port}` || origin === `ws://${host}:${port}`,
  )
}

/** MCP sockets never accept a browser Origin, even with a valid token. */
export const hasRelayOrigin = (request: IncomingMessage): boolean =>
  request.headers.origin !== undefined ||
  Array.isArrayNonEmpty(headerValues(request, 'origin'))

/** Return a valid challenge for the server's upgrade response. */
export const relayChallenge = (
  request: IncomingMessage,
): Option.Option<string> => {
  const challenge = request.headers[RELAY_CHALLENGE_HEADER]
  return Predicate.isString(challenge) && PROOF_PATTERN.test(challenge)
    ? Option.some(challenge)
    : Option.none()
}

/** Authenticate a query token or signed challenge exactly as the Vite relay does. */
export const authenticatesMcpRelay = (
  request: IncomingMessage,
  url: URL,
  token: string,
): boolean => {
  const maybePresentedToken = Option.fromNullishOr(
    url.searchParams.get('token'),
  )

  if (Option.isSome(maybePresentedToken)) {
    const expected = Buffer.from(token, 'utf8')
    const actual = Buffer.from(maybePresentedToken.value, 'utf8')

    if (
      expected.length === actual.length &&
      timingSafeEqual(expected, actual)
    ) {
      return true
    }
  }

  const maybeChallenge = relayChallenge(request)
  const presentedProof = request.headers[RELAY_CLIENT_PROOF_HEADER]

  if (
    Option.isNone(maybeChallenge) ||
    !Predicate.isString(presentedProof) ||
    !PROOF_PATTERN.test(presentedProof)
  ) {
    return false
  }

  return timingSafeEqual(
    Buffer.from(
      computeRelayProof(token, 'client', maybeChallenge.value),
      'hex',
    ),
    Buffer.from(presentedProof, 'hex'),
  )
}
