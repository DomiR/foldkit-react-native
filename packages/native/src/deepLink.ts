import { Option, String, pipe } from 'effect'
import type { Url } from 'foldkit/url'

const deepLinkPattern =
  /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?(?:#(.*))?$/

const expoPathSegment = '/--/'

const maybeNonEmpty = (value: string | undefined): Option.Option<string> =>
  pipe(
    Option.fromNullishOr(value),
    Option.flatMap(Option.liftPredicate(String.isNonEmpty)),
  )

const standardAuthorityToParts = (
  authority: string,
): Readonly<{ host: string; port: Option.Option<string> }> =>
  pipe(
    authority,
    String.lastIndexOf(':'),
    Option.match({
      onNone: () => ({ host: authority, port: Option.none() }),
      onSome: separator => ({
        host: pipe(authority, String.slice(0, separator)),
        port: maybeNonEmpty(pipe(authority, String.slice(separator + 1))),
      }),
    }),
  )

const standardPathname = (path: string): string => {
  const maybeExpoSegmentStart = pipe(path, String.indexOf(expoPathSegment))
  if (Option.isSome(maybeExpoSegmentStart)) {
    const expoPath = pipe(
      path,
      String.slice(maybeExpoSegmentStart.value + expoPathSegment.length),
    )

    return String.isEmpty(expoPath) ? '/' : `/${expoPath}`
  }

  if (path.endsWith('/--')) {
    return '/'
  }

  return String.isEmpty(path) ? '/' : path
}

const customPathname = (authority: string, path: string): string => {
  if (String.isEmpty(authority)) {
    return String.isEmpty(path) ? '/' : path
  }

  return `/${authority}${path}`
}

/** Parses a native deep link into a Foldkit `Url` without using the platform URL API. */
export const deepLinkToUrl = (rawUrl: string): Option.Option<Url> =>
  pipe(
    Option.fromNullishOr(deepLinkPattern.exec(rawUrl)),
    Option.map(
      ([, rawScheme = '', authority = '', path = '', search, hash]) => {
        const scheme = rawScheme.toLowerCase()
        const protocol = `${scheme}:`
        const isStandardScheme =
          scheme === 'http' ||
          scheme === 'https' ||
          scheme === 'exp' ||
          scheme === 'exps'

        if (isStandardScheme) {
          const { host, port } = standardAuthorityToParts(authority)

          return {
            protocol,
            host,
            port,
            pathname: standardPathname(path),
            search: maybeNonEmpty(search),
            hash: maybeNonEmpty(hash),
          }
        } else {
          return {
            protocol,
            host: '',
            port: Option.none(),
            pathname: customPathname(authority, path),
            search: maybeNonEmpty(search),
            hash: maybeNonEmpty(hash),
          }
        }
      },
    ),
  )
