import { relative } from 'node:path'

import {
  collectAstParentSlots,
  collectViewIdentityWraps,
  findNearestPackage,
  isAlreadyBranded,
  isAstNode,
  isEligibleModuleId,
  isWorkletModule,
  packageNameFromModuleSpecifier,
  stripQuery,
  toPosixPath,
  type NearestPackage,
} from './viewIdentityCore.js'

const DEFAULT_BRAND_MODULE = 'foldkit/brand'
const BRAND_EXPORT_NAME = 'brandViewResult'
const BRAND_IMPORT_ALIAS = '__foldkitBrandViewResult'
const FIRST_ALIAS_SUFFIX = 2
const FOLDKIT_PACKAGE_NAME = 'foldkit'

interface BabelBuilderNode {
  readonly type: string
  [field: string]: unknown
}

interface BabelTypes {
  callExpression(
    callee: BabelBuilderNode,
    arguments_: ReadonlyArray<BabelBuilderNode>,
  ): BabelBuilderNode
  identifier(name: string): BabelBuilderNode
  stringLiteral(value: string): BabelBuilderNode
  importDeclaration(
    specifiers: ReadonlyArray<BabelBuilderNode>,
    source: BabelBuilderNode,
  ): BabelBuilderNode
  importSpecifier(
    local: BabelBuilderNode,
    imported: BabelBuilderNode,
  ): BabelBuilderNode
}

interface BabelPluginApi {
  readonly types: BabelTypes
}

interface BabelScope {
  readonly crawl: () => void
  readonly hasBinding: (name: string) => boolean
  readonly hasGlobal: (name: string) => boolean
}

interface BabelProgramPath {
  readonly node: BabelProgramNode
  readonly scope: BabelScope
}

interface BabelProgramNode {
  readonly type: string
  readonly start?: number | null
  readonly end?: number | null
  [field: string]: unknown
}

interface BabelFileOptions {
  readonly root?: string
  readonly cwd?: string
}

interface BabelFile {
  readonly code: string
  readonly opts: BabelFileOptions
}

interface BabelPluginState {
  readonly filename: string | undefined
  readonly file: BabelFile
}

interface BabelPlugin {
  readonly name: string
  readonly visitor: Readonly<{
    Program: Readonly<{
      enter: (path: BabelProgramPath, state: BabelPluginState) => void
    }>
  }>
}

/** Options for the default Babel plugin export. */
export type FoldkitViewIdentityBabelOptions = Readonly<{
  /**
   * Module specifier used by the injected import. Defaults to `foldkit/brand`;
   * its package is never transformed.
   */
  brandModule?: string
  /**
   * Directory that identity paths are relative to. Defaults to Babel's root.
   */
  root?: string
}>

const uniqueBrandAlias = (code: string, path: BabelProgramPath): string => {
  const isTaken = (candidate: string): boolean =>
    code.includes(candidate) ||
    path.scope.hasBinding(candidate) ||
    path.scope.hasGlobal(candidate)
  if (!isTaken(BRAND_IMPORT_ALIAS)) {
    return BRAND_IMPORT_ALIAS
  }
  for (let suffix = FIRST_ALIAS_SUFFIX; ; suffix += 1) {
    const candidate = `${BRAND_IMPORT_ALIAS}${suffix}`
    if (!isTaken(candidate)) {
      return candidate
    }
  }
}

const foldkitViewIdentityBabel = (
  api: BabelPluginApi,
  options: FoldkitViewIdentityBabelOptions = {},
): BabelPlugin => {
  const packageCache = new Map<string, NearestPackage | undefined>()
  const brandModule = options.brandModule ?? DEFAULT_BRAND_MODULE
  const brandPackageName = packageNameFromModuleSpecifier(brandModule)

  const enterProgram = (
    path: BabelProgramPath,
    state: BabelPluginState,
  ): void => {
    const filename = state.filename
    if (filename === undefined) {
      return
    }
    const root =
      options.root ??
      state.file.opts.root ??
      state.file.opts.cwd ??
      process.cwd()
    const nearestPackage = findNearestPackage(filename, packageCache)
    if (!isEligibleModuleId(filename, nearestPackage !== undefined)) {
      return
    }
    if (
      nearestPackage?.name === FOLDKIT_PACKAGE_NAME ||
      nearestPackage?.name === brandPackageName
    ) {
      return
    }
    const programCandidate = path.node
    if (!isAstNode(programCandidate)) {
      return
    }
    const program = programCandidate
    if (isWorkletModule(program)) {
      return
    }
    if (
      isAlreadyBranded(program, new Set([DEFAULT_BRAND_MODULE, brandModule]))
    ) {
      return
    }
    const modulePath = toPosixPath(relative(root, stripQuery(filename)))
    const wraps = collectViewIdentityWraps(program, modulePath)
    if (wraps.length === 0) {
      return
    }
    const brandAlias = uniqueBrandAlias(state.file.code, path)
    const parentSlots = collectAstParentSlots(program)
    for (const { target, functionId } of wraps) {
      const parentSlot = parentSlots.get(target)
      if (parentSlot === undefined) {
        continue
      }
      const replacement = api.types.callExpression(
        api.types.identifier(brandAlias),
        [target, api.types.stringLiteral(functionId)],
      )
      if (parentSlot.index === undefined) {
        if (parentSlot.parent[parentSlot.fieldName] === target) {
          parentSlot.parent[parentSlot.fieldName] = replacement
        }
      } else {
        const fieldValue = parentSlot.parent[parentSlot.fieldName]
        if (
          Array.isArray(fieldValue) &&
          fieldValue.at(parentSlot.index) === target
        ) {
          fieldValue.splice(parentSlot.index, 1, replacement)
        }
      }
    }
    const body = program['body']
    if (!Array.isArray(body)) {
      return
    }
    const importDeclaration = api.types.importDeclaration(
      [
        api.types.importSpecifier(
          api.types.identifier(brandAlias),
          api.types.identifier(BRAND_EXPORT_NAME),
        ),
      ],
      api.types.stringLiteral(brandModule),
    )
    body.unshift(importDeclaration)
    path.scope.crawl()
  }

  return {
    name: 'foldkit:view-identity-babel',
    visitor: {
      Program: {
        enter: enterProgram,
      },
    },
  }
}

/**
 * Babel plugin that applies Foldkit view identity branding before Metro's
 * subsequent Babel plugins transform TypeScript, JSX, or native worklets.
 */
export default foldkitViewIdentityBabel
