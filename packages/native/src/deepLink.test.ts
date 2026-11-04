import { Option } from 'effect'
import type { Url } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { deepLinkToUrl } from './deepLink'

const url = (
  protocol: string,
  host: string,
  pathname: string,
  port: Option.Option<string> = Option.none(),
  search: Option.Option<string> = Option.none(),
  hash: Option.Option<string> = Option.none(),
): Url => ({ protocol, host, port, pathname, search, hash })

describe('deepLinkToUrl', () => {
  test.each([
    {
      rawUrl: 'exp://127.0.0.1:8083/--/examples/counter?x=1#top',
      expected: Option.some(
        url(
          'exp:',
          '127.0.0.1',
          '/examples/counter',
          Option.some('8083'),
          Option.some('x=1'),
          Option.some('top'),
        ),
      ),
    },
    {
      rawUrl: 'exps://127.0.0.1:8083/--',
      expected: Option.some(
        url('exps:', '127.0.0.1', '/', Option.some('8083')),
      ),
    },
    {
      rawUrl: 'exp://127.0.0.1:8083/prefix/--/counter',
      expected: Option.some(
        url('exp:', '127.0.0.1', '/counter', Option.some('8083')),
      ),
    },
    {
      rawUrl: 'HTTP://example.com:8080',
      expected: Option.some(
        url('http:', 'example.com', '/', Option.some('8080')),
      ),
    },
    {
      rawUrl: 'https://example.com/gestures',
      expected: Option.some(url('https:', 'example.com', '/gestures')),
    },
    {
      rawUrl: 'exp://example.com/counter',
      expected: Option.some(url('exp:', 'example.com', '/counter')),
    },
    {
      rawUrl: 'exps://example.com/',
      expected: Option.some(url('exps:', 'example.com', '/')),
    },
    {
      rawUrl: 'foldkit-showcase://examples/counter',
      expected: Option.some(url('foldkit-showcase:', '', '/examples/counter')),
    },
    {
      rawUrl: 'foldkit-showcase:///examples/counter',
      expected: Option.some(url('foldkit-showcase:', '', '/examples/counter')),
    },
    {
      rawUrl: 'foldkit-showcase://',
      expected: Option.some(url('foldkit-showcase:', '', '/')),
    },
    {
      rawUrl: 'https://example.com/path?#',
      expected: Option.some(url('https:', 'example.com', '/path')),
    },
    {
      rawUrl: '',
      expected: Option.none(),
    },
    {
      rawUrl: 'foldkit-showcase:examples/counter',
      expected: Option.none(),
    },
    {
      rawUrl: 'not-a-url',
      expected: Option.none(),
    },
  ])('parses $rawUrl', ({ rawUrl, expected }) => {
    expect(deepLinkToUrl(rawUrl)).toStrictEqual(expected)
  })
})
