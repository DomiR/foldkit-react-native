import MagicString, { type SourceMap } from 'magic-string'
import { relative } from 'node:path'
import { type Plugin, parseAst } from 'vite'

import {
  collectViewIdentityWraps,
  isAlreadyBranded,
  isAstNode,
  isDirectiveStatement,
  isEligibleModuleId,
  isUnderDirectory,
  resolvePackageExportPath,
  resolvePackageRoot,
  stripQuery,
  toPosixPath,
  type AstNode,
} from './viewIdentityCore.js'

const BRAND_MODULE_SPECIFIER = 'foldkit/brand'
const BRAND_EXPORT_NAME = 'brandViewResult'
const BRAND_IMPORT_ALIAS = '__foldkitBrandViewResult'
const FIRST_ALIAS_SUFFIX = 2
const FOLDKIT_PACKAGE_NAME = 'foldkit'

const parseProgram = (code: string): AstNode | null => {
  try {
    const program: unknown = parseAst(code)
    if (isAstNode(program)) {
      return program
    }
    return null
  } catch {
    return null
  }
}

const hashbangEndOffset = (program: AstNode): number => {
  const hashbang = program['hashbang']
  if (isAstNode(hashbang)) {
    return hashbang.end
  }
  return 0
}

const importInsertionOffset = (program: AstNode): number => {
  const body = program['body']
  if (!Array.isArray(body)) {
    return hashbangEndOffset(program)
  }
  let offset = hashbangEndOffset(program)
  for (const statement of body) {
    if (!isAstNode(statement) || !isDirectiveStatement(statement)) {
      break
    }
    offset = statement.end
  }
  return offset
}

const uniqueBrandAlias = (code: string): string => {
  if (!code.includes(BRAND_IMPORT_ALIAS)) {
    return BRAND_IMPORT_ALIAS
  }
  for (let suffix = FIRST_ALIAS_SUFFIX; ; suffix += 1) {
    const candidate = `${BRAND_IMPORT_ALIAS}${suffix}`
    if (!code.includes(candidate)) {
      return candidate
    }
  }
}

/** Result of {@link transformViewIdentity}: rewritten code plus a source map. */
export type ViewIdentityTransformResult = Readonly<{
  code: string
  map: SourceMap
}>

/**
 * Brands the return value of every function in a module with that function's
 * identity via `brandViewResult` from `foldkit/brand`.
 *
 * Identities are `${posixRelativePathFromRoot}#${functionName}`, with the
 * function name taken from, in order: the function's own id (declarations and
 * named function expressions), the variable a function expression is bound
 * to, the non-computed key of an object property, class method, or class field,
 * `default` for an export-default function, the member name of an `x.y = fn`
 * assignment, and `anonymous` otherwise. Duplicate names within a module are
 * disambiguated in source order with `~2`, `~3`, and so on, so ids are fully
 * deterministic.
 *
 * Expression-body arrows have their body wrapped in the branding call; block
 * bodies have every `return` argument belonging directly to the function
 * wrapped (nested functions instrument their own returns, and bare `return`
 * is untouched). Branding is set-if-absent on vnodes at runtime, so wrapping
 * every function, including async and generator functions and functions that
 * never produce a vnode, is inert outside view results.
 *
 * Skips foldkit core modules: if the element factory's own returns were
 * branded, every vnode would carry an identity at construction and
 * set-if-absent would neutralize the feature. Core under `node_modules` is
 * always skipped. The plugin resolves the installed foldkit package and passes
 * `isFoldkitCoreResolved`; when it resolved, the plugin's precise package-root
 * gate is authoritative and the coarse `packages/foldkit/` path fragment is
 * left to the resolution-failed fallback, so a consumer whose own path merely
 * contains that segment is still branded.
 *
 * Skips modules whose parsed program imports or re-exports the
 * `foldkit/brand` specifier: packages such as `@foldkit/ui` and
 * `@foldkit/devtools` brand their dist at package build time, and pnpm symlink
 * realpaths can surface that dist outside `node_modules`, where the module-id
 * checks alone would let a build wrap the same returns twice. A module that
 * merely mentions the specifier in a comment or string is still branded; the
 * raw-text check is only a fast negative prefilter.
 *
 * A Program with a leading `'worklet'` directive is skipped. Functions whose
 * block body begins with that directive, and functions nested inside them, are
 * left untouched while retaining their name slots for other identities.
 *
 * Returns `null` when the module needs no changes.
 */
export const transformViewIdentity = (
  code: string,
  id: string,
  root: string,
  options?: Readonly<{
    isFoldkitCoreResolved?: boolean
  }>,
): ViewIdentityTransformResult | null => {
  if (!isEligibleModuleId(id, options?.isFoldkitCoreResolved ?? false)) {
    return null
  }
  const program = parseProgram(code)
  if (program === null) {
    return null
  }
  if (
    code.includes(BRAND_MODULE_SPECIFIER) &&
    isAlreadyBranded(program, new Set([BRAND_MODULE_SPECIFIER]))
  ) {
    return null
  }
  const modulePath = toPosixPath(relative(root, stripQuery(id)))
  const wraps = collectViewIdentityWraps(program, modulePath)
  if (wraps.length === 0) {
    return null
  }
  const brandAlias = uniqueBrandAlias(code)
  const sourceText = new MagicString(code)
  // NOTE: applied in descending target order so that when a nested wrap ends
  // exactly where its enclosing wrap ends (`return () => x`), the inner
  // closer is appended first and the calls nest correctly.
  const orderedWraps = [...wraps].sort(
    (first, second) => second.target.start - first.target.start,
  )
  for (const { target, functionId } of orderedWraps) {
    sourceText.appendLeft(target.start, `${brandAlias}((`)
    sourceText.appendRight(target.end, `), ${JSON.stringify(functionId)})`)
  }
  const importStatement = `import { ${BRAND_EXPORT_NAME} as ${brandAlias} } from '${BRAND_MODULE_SPECIFIER}'\n`
  const insertionOffset = importInsertionOffset(program)
  if (insertionOffset === 0) {
    sourceText.prepend(importStatement)
  } else {
    sourceText.appendLeft(insertionOffset, `\n${importStatement}`)
  }
  return {
    code: sourceText.toString(),
    map: sourceText.generateMap({ hires: 'boundary' }),
  }
}

/**
 * Vite plugin that applies {@link transformViewIdentity} to application
 * modules in both dev and build. Skips `node_modules`, virtual modules,
 * non-script files, and foldkit core itself, resolved from the config root so
 * that configs aliasing `foldkit` straight into `packages/foldkit/src` are
 * excluded too. `@foldkit/ui` and `@foldkit/devtools` modules are branded on
 * purpose.
 *
 * Also pins `foldkit/brand` to the installed package's brand module via a
 * `resolve.alias` entry, so the injected import keeps resolving in configs
 * whose own `foldkit` alias would otherwise swallow the subpath.
 */
export const foldkitViewIdentity = (): Plugin => {
  let resolvedRoot = process.cwd()
  let foldkitPackageRoot: string | undefined
  return {
    name: 'foldkit:view-identity',
    config: userConfig => {
      const brandModulePath = resolvePackageExportPath(
        userConfig.root ?? process.cwd(),
        FOLDKIT_PACKAGE_NAME,
        './brand',
      )
      if (brandModulePath === undefined) {
        return undefined
      }
      // NOTE: returned as an array because Vite's mergeAlias puts array
      // entries from a plugin ahead of the user's aliases; object-form
      // entries would land after a user's bare `foldkit` alias and the
      // injected specifier would be rewritten into a nonexistent path.
      return {
        resolve: {
          alias: [
            { find: BRAND_MODULE_SPECIFIER, replacement: brandModulePath },
          ],
        },
      }
    },
    configResolved: config => {
      resolvedRoot = config.root
      const packageRoot = resolvePackageRoot(config.root, FOLDKIT_PACKAGE_NAME)
      foldkitPackageRoot =
        packageRoot === undefined ? undefined : toPosixPath(packageRoot)
    },
    transform: (code, id) => {
      if (
        foldkitPackageRoot !== undefined &&
        isUnderDirectory(toPosixPath(stripQuery(id)), foldkitPackageRoot)
      ) {
        return null
      }
      return transformViewIdentity(code, id, resolvedRoot, {
        isFoldkitCoreResolved: foldkitPackageRoot !== undefined,
      })
    },
  }
}
