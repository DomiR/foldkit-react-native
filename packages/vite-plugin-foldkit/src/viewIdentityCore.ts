import { Predicate } from 'effect'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const FUNCTION_NODE_TYPES: ReadonlySet<string> = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
])

const NAMED_VALUE_NODE_TYPES: ReadonlySet<string> = new Set([
  'Property',
  'MethodDefinition',
  'PropertyDefinition',
  'ObjectProperty',
  'ClassProperty',
  'ClassPrivateProperty',
  'ClassAccessorProperty',
])

const BRAND_MODULE_STATEMENT_TYPES: ReadonlySet<string> = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
])

const NODE_MODULES_SEGMENT_PATTERN = /(?:^|\/)node_modules(?:\/|$)/
const SCRIPT_FILE_PATTERN = /\.(?:ts|tsx|js|jsx|mts|mjs)$/
const FOLDKIT_CORE_PATH_FRAGMENT = 'packages/foldkit/'
const VIRTUAL_MODULE_PREFIX = '\0'
const DEFAULT_EXPORT_FUNCTION_NAME = 'default'
const ANONYMOUS_FUNCTION_NAME = 'anonymous'
const FIRST_DUPLICATE_NAME_SUFFIX = 2

/** @internal */
export interface AstNode {
  readonly type: string
  readonly start: number
  readonly end: number
  [field: string]: unknown
}

interface IdentifierNode extends AstNode {
  readonly type: 'Identifier'
  readonly name: string
}

interface PrivateIdentifierNode extends AstNode {
  readonly type: 'PrivateIdentifier'
  readonly name: string
}

interface LiteralNode extends AstNode {
  readonly type: 'Literal' | 'StringLiteral'
  readonly value: unknown
}

interface PrivateNameNode extends AstNode {
  readonly type: 'PrivateName'
  readonly id: AstNode
}

interface MemberExpressionNode extends AstNode {
  readonly type: 'MemberExpression'
  readonly object: AstNode
  readonly property: AstNode
  readonly computed: boolean
}

interface AssignmentExpressionNode extends AstNode {
  readonly type: 'AssignmentExpression'
  readonly left: AstNode
  readonly right: AstNode
}

interface FunctionNode extends AstNode {
  readonly body: AstNode
  readonly id?: AstNode | null
  readonly key?: AstNode
  readonly computed?: boolean
}

interface ReturnStatementNode extends AstNode {
  readonly type: 'ReturnStatement'
  readonly argument: AstNode | null
}

interface VariableDeclaratorNode extends AstNode {
  readonly type: 'VariableDeclarator'
  readonly id: AstNode
  readonly init: AstNode | null
}

interface NamedValueNode extends AstNode {
  readonly key: AstNode
  readonly value: AstNode
  readonly computed?: boolean
}

/** @internal */
export type Wrap = Readonly<{
  target: AstNode
  functionId: string
}>

/** @internal */
export type AstParentSlot = Readonly<{
  parent: AstNode
  fieldName: string
  index: number | undefined
}>

/** @internal */
export const isAstNode = (value: unknown): value is AstNode =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  Predicate.isString(value.type)

const isIdentifier = (node: AstNode): node is IdentifierNode =>
  node.type === 'Identifier'

const isPrivateIdentifier = (node: AstNode): node is PrivateIdentifierNode =>
  node.type === 'PrivateIdentifier'

const isLiteral = (node: AstNode): node is LiteralNode =>
  node.type === 'Literal' || node.type === 'StringLiteral'

const isPrivateName = (node: AstNode): node is PrivateNameNode =>
  node.type === 'PrivateName' && isAstNode(node['id'])

const isMemberExpression = (node: AstNode): node is MemberExpressionNode =>
  node.type === 'MemberExpression'

const isAssignmentExpression = (
  node: AstNode,
): node is AssignmentExpressionNode => node.type === 'AssignmentExpression'

const isFunctionNode = (node: AstNode): node is FunctionNode =>
  FUNCTION_NODE_TYPES.has(node.type)

const isReturnStatement = (node: AstNode): node is ReturnStatementNode =>
  node.type === 'ReturnStatement'

const isVariableDeclarator = (node: AstNode): node is VariableDeclaratorNode =>
  node.type === 'VariableDeclarator'

const isNamedValueNode = (node: AstNode): node is NamedValueNode =>
  NAMED_VALUE_NODE_TYPES.has(node.type) &&
  isAstNode(node['key']) &&
  isAstNode(node['value'])

const isBabelMethodNode = (node: FunctionNode): boolean =>
  node.type === 'ObjectMethod' ||
  node.type === 'ClassMethod' ||
  node.type === 'ClassPrivateMethod'

const walkChildNodes = (
  node: AstNode,
  visitChild: (child: AstNode) => void,
): void => {
  for (const [fieldName, fieldValue] of Object.entries(node)) {
    if (fieldName === 'parent') {
      continue
    }
    if (isAstNode(fieldValue)) {
      visitChild(fieldValue)
    } else if (Array.isArray(fieldValue)) {
      for (const element of fieldValue) {
        if (isAstNode(element)) {
          visitChild(element)
        }
      }
    }
  }
}

const collectFunctionNodes = (
  program: AstNode,
): Readonly<{
  functionNodes: ReadonlyArray<FunctionNode>
  parentByNode: ReadonlyMap<AstNode, AstNode>
}> => {
  const functionNodes: Array<FunctionNode> = []
  const parentByNode = new Map<AstNode, AstNode>()
  const visitNode = (node: AstNode): void => {
    if (isFunctionNode(node)) {
      functionNodes.push(node)
    }
    walkChildNodes(node, child => {
      parentByNode.set(child, node)
      visitNode(child)
    })
  }
  visitNode(program)
  return {
    functionNodes: [...functionNodes].sort(
      (first, second) => first.start - second.start,
    ),
    parentByNode,
  }
}

/** @internal */
export const collectAstParentSlots = (
  program: AstNode,
): ReadonlyMap<AstNode, AstParentSlot> => {
  const parentSlots = new Map<AstNode, AstParentSlot>()
  const visitNode = (parent: AstNode): void => {
    for (const [fieldName, fieldValue] of Object.entries(parent)) {
      if (fieldName === 'parent') {
        continue
      }
      if (isAstNode(fieldValue)) {
        parentSlots.set(fieldValue, { parent, fieldName, index: undefined })
        visitNode(fieldValue)
      } else if (Array.isArray(fieldValue)) {
        for (const [index, element] of fieldValue.entries()) {
          if (isAstNode(element)) {
            parentSlots.set(element, { parent, fieldName, index })
            visitNode(element)
          }
        }
      }
    }
  }
  visitNode(program)
  return parentSlots
}

const namedKeyText = (key: AstNode): string | undefined => {
  if (isIdentifier(key) || isPrivateIdentifier(key)) {
    return key.name
  }
  if (isLiteral(key) && Predicate.isString(key.value)) {
    return key.value
  }
  if (isPrivateName(key) && isIdentifier(key.id)) {
    return key.id.name
  }
  return undefined
}

const rawFunctionName = (
  functionNode: FunctionNode,
  parentByNode: ReadonlyMap<AstNode, AstNode>,
): string => {
  if (
    functionNode.id !== null &&
    functionNode.id !== undefined &&
    isIdentifier(functionNode.id)
  ) {
    return functionNode.id.name
  }
  if (isBabelMethodNode(functionNode)) {
    const key = functionNode.key
    if (key !== undefined && functionNode.computed !== true) {
      return namedKeyText(key) ?? ANONYMOUS_FUNCTION_NAME
    }
  }
  const parent = parentByNode.get(functionNode)
  if (parent === undefined) {
    return ANONYMOUS_FUNCTION_NAME
  }
  if (
    isVariableDeclarator(parent) &&
    parent.init === functionNode &&
    isIdentifier(parent.id)
  ) {
    return parent.id.name
  }
  if (
    isNamedValueNode(parent) &&
    parent.value === functionNode &&
    parent.computed !== true
  ) {
    return namedKeyText(parent.key) ?? ANONYMOUS_FUNCTION_NAME
  }
  if (parent.type === 'ExportDefaultDeclaration') {
    return DEFAULT_EXPORT_FUNCTION_NAME
  }
  if (
    isAssignmentExpression(parent) &&
    parent.right === functionNode &&
    isMemberExpression(parent.left) &&
    !parent.left.computed &&
    isIdentifier(parent.left.property)
  ) {
    return parent.left.property.name
  }
  return ANONYMOUS_FUNCTION_NAME
}

// NOTE: a view identity names a source position, and a source position outlives
// the code that occupied it. Hydration compares identities to decide whether the
// server DOM and the client's first render describe the same logical element, so
// an identity that stays the same while the function's body changes tells it two
// different views are the same one: a stale page's `<input name="email">` is
// adopted by a new build's `<input name="ssn">`, and the value the visitor typed
// before hydration is carried into a field that means something else and submits
// under a new name. That is what the deployment's build id answers: it is
// compared before hydration reads anything the page carries, so a page from a
// build whose views mean something else is refused as a whole.
//
// An identity carries no digest of the module's source, and must not. Mixing
// one in would make a changed view rebuild its own subtree, which is the reason
// to want it, but the identity is emitted into the client bundle every visitor
// downloads, and a truncated hash of a whole source file is a check against that
// file's contents. A build that tree-shakes a low-entropy server-only value out
// of the client (a PIN behind `import.meta.env.SSR`) would still ship a digest
// of the source that contained it, and the value could be recovered by hashing
// candidates until one matched. The build id costs nothing to compare and
// reveals nothing about the source. `check:packed-ssr-consumer` asserts the
// absence against a real built bundle.
const assignFunctionIds = (
  functionNodes: ReadonlyArray<FunctionNode>,
  parentByNode: ReadonlyMap<AstNode, AstNode>,
  modulePath: string,
): ReadonlyMap<FunctionNode, string> => {
  const functionIds = new Map<FunctionNode, string>()
  const occurrenceCountsByName = new Map<string, number>()
  for (const functionNode of functionNodes) {
    const functionName = rawFunctionName(functionNode, parentByNode)
    const occurrenceCount = (occurrenceCountsByName.get(functionName) ?? 0) + 1
    occurrenceCountsByName.set(functionName, occurrenceCount)
    const uniqueFunctionName =
      occurrenceCount < FIRST_DUPLICATE_NAME_SUFFIX
        ? functionName
        : `${functionName}~${occurrenceCount}`
    functionIds.set(functionNode, `${modulePath}#${uniqueFunctionName}`)
  }
  return functionIds
}

/** @internal */
export const isDirectiveStatement = (node: AstNode): boolean =>
  node.type === 'ExpressionStatement' && Predicate.isString(node['directive'])

const isBabelWorkletDirective = (node: AstNode): boolean => {
  const value = node['value']
  return (
    isAstNode(value) &&
    Predicate.isString(value['value']) &&
    value['value'] === 'worklet'
  )
}

const hasWorkletDirective = (node: AstNode): boolean => {
  const directives = node['directives']
  if (
    Array.isArray(directives) &&
    directives.some(
      directive => isAstNode(directive) && isBabelWorkletDirective(directive),
    )
  ) {
    return true
  }
  const body = node['body']
  if (!Array.isArray(body)) {
    return false
  }
  for (const statement of body) {
    if (!isAstNode(statement) || !isDirectiveStatement(statement)) {
      return false
    }
    if (statement['directive'] === 'worklet') {
      return true
    }
  }
  return false
}

/** @internal */
export const isWorkletModule = (program: AstNode): boolean =>
  hasWorkletDirective(program)

const isWorkletFunction = (functionNode: FunctionNode): boolean =>
  functionNode.body.type === 'BlockStatement' &&
  hasWorkletDirective(functionNode.body)

const isNestedInWorklet = (
  functionNode: FunctionNode,
  parentByNode: ReadonlyMap<AstNode, AstNode>,
  workletFunctions: ReadonlySet<FunctionNode>,
): boolean => {
  let parent = parentByNode.get(functionNode)
  while (parent !== undefined) {
    if (isFunctionNode(parent) && workletFunctions.has(parent)) {
      return true
    }
    parent = parentByNode.get(parent)
  }
  return false
}

const ownReturnArguments = (functionBody: AstNode): Array<AstNode> => {
  const returnArguments: Array<AstNode> = []
  const collectFromNode = (node: AstNode): void => {
    if (isFunctionNode(node)) {
      return
    }
    if (isReturnStatement(node)) {
      if (node.argument !== null && node.argument !== undefined) {
        returnArguments.push(node.argument)
      }
      return
    }
    walkChildNodes(node, collectFromNode)
  }
  walkChildNodes(functionBody, collectFromNode)
  return returnArguments
}

const wrapTargets = (functionNode: FunctionNode): Array<AstNode> => {
  if (functionNode.body.type === 'BlockStatement') {
    return ownReturnArguments(functionNode.body)
  }
  return [functionNode.body]
}

/** @internal */
export const collectViewIdentityWraps = (
  program: AstNode,
  modulePath: string,
): ReadonlyArray<Wrap> => {
  if (isWorkletModule(program)) {
    return []
  }
  const { functionNodes, parentByNode } = collectFunctionNodes(program)
  const functionIds = assignFunctionIds(functionNodes, parentByNode, modulePath)
  const workletFunctions = new Set(functionNodes.filter(isWorkletFunction))
  const wraps: Array<Wrap> = []
  for (const functionNode of functionNodes) {
    if (
      workletFunctions.has(functionNode) ||
      isNestedInWorklet(functionNode, parentByNode, workletFunctions)
    ) {
      continue
    }
    const functionId = functionIds.get(functionNode)
    if (functionId === undefined) {
      continue
    }
    for (const target of wrapTargets(functionNode)) {
      wraps.push({ target, functionId })
    }
  }
  return wraps
}

/** @internal */
export const stripQuery = (id: string): string => {
  const [pathWithoutQuery] = id.split('?')
  return pathWithoutQuery ?? id
}

/** @internal */
export const toPosixPath = (filePath: string): string =>
  filePath.split(sep).join('/')

/** @internal */
export const isEligibleModuleId = (
  id: string,
  isFoldkitCoreResolved: boolean,
): boolean => {
  if (id.startsWith(VIRTUAL_MODULE_PREFIX)) {
    return false
  }
  const strippedId = stripQuery(id)
  const normalizedId = toPosixPath(strippedId)
  if (NODE_MODULES_SEGMENT_PATTERN.test(normalizedId)) {
    return false
  }
  if (!SCRIPT_FILE_PATTERN.test(strippedId)) {
    return false
  }
  // NOTE: the unanchored `packages/foldkit/` fragment is a best-effort
  // fallback, applied only when the installed foldkit package could not be
  // resolved. When it was resolved, the plugin's precise `foldkitPackageRoot`
  // gate already excluded core, so re-applying the fragment here would wrongly
  // un-brand a consumer whose own app path merely contains the segment (a
  // workspace named `foldkit`, a vendored fork holding app code).
  if (isFoldkitCoreResolved) {
    return true
  }
  return !normalizedId.includes(FOLDKIT_CORE_PATH_FRAGMENT)
}

/** @internal */
export const isAlreadyBranded = (
  program: AstNode,
  brandModuleSpecifiers: ReadonlySet<string>,
): boolean => {
  const body = program['body']
  if (!Array.isArray(body)) {
    return false
  }
  return body.some(statement => {
    if (
      !isAstNode(statement) ||
      !BRAND_MODULE_STATEMENT_TYPES.has(statement.type)
    ) {
      return false
    }
    const source = statement['source']
    return (
      isAstNode(source) &&
      isLiteral(source) &&
      Predicate.isString(source.value) &&
      brandModuleSpecifiers.has(source.value)
    )
  })
}

/** @internal */
export const packageNameFromModuleSpecifier = (
  moduleSpecifier: string,
): string => {
  const [firstSegment, secondSegment] = moduleSpecifier.split('/')
  if (firstSegment?.startsWith('@') && secondSegment !== undefined) {
    return `${firstSegment}/${secondSegment}`
  }
  return firstSegment ?? moduleSpecifier
}

// NOTE: `require.resolve('foldkit')` cannot produce a path here: Foldkit's
// export map is ESM-only, so resolving it under require conditions throws
// ERR_PACKAGE_PATH_NOT_EXPORTED. Walking the `node_modules` directories from
// the configured root through its ancestors locates the package without
// touching the export map. `NODE_PATH` and global folders are not resolution
// sources for Vite or Metro.
/** @internal */
export const resolvePackageRoot = (
  root: string,
  packageName: string,
): string | undefined => {
  let directory = resolve(root)

  while (true) {
    const packageDirectory = join(directory, 'node_modules', packageName)
    if (existsSync(join(packageDirectory, 'package.json'))) {
      try {
        return realpathSync(packageDirectory)
      } catch {
        return packageDirectory
      }
    }

    const parentDirectory = resolve(directory, '..')
    if (parentDirectory === directory) {
      return undefined
    }

    directory = parentDirectory
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** @internal */
export type NearestPackage = Readonly<{
  name: string | undefined
}>

/** @internal */
export const findNearestPackage = (
  filePath: string,
  packageCache: Map<string, NearestPackage | undefined>,
): NearestPackage | undefined => {
  const strippedPath = stripQuery(filePath)
  let realFilePath: string
  try {
    realFilePath = realpathSync(strippedPath)
  } catch {
    realFilePath = resolve(strippedPath)
  }

  let directory = dirname(realFilePath)
  const visitedDirectories: Array<string> = []
  const cacheResult = (
    nearestPackage: NearestPackage | undefined,
  ): NearestPackage | undefined => {
    for (const visitedDirectory of visitedDirectories) {
      packageCache.set(visitedDirectory, nearestPackage)
    }
    return nearestPackage
  }

  while (true) {
    if (packageCache.has(directory)) {
      return cacheResult(packageCache.get(directory))
    }
    visitedDirectories.push(directory)

    const packagePath = join(directory, 'package.json')
    if (existsSync(packagePath)) {
      let packageName: string | undefined
      try {
        const packageJson: unknown = JSON.parse(
          readFileSync(packagePath, 'utf8'),
        )
        if (isRecord(packageJson) && Predicate.isString(packageJson['name'])) {
          packageName = packageJson['name']
        }
      } catch {
        packageName = undefined
      }
      return cacheResult({ name: packageName })
    }

    const parentDirectory = resolve(directory, '..')
    if (parentDirectory === directory) {
      return cacheResult(undefined)
    }
    directory = parentDirectory
  }
}

/** @internal */
export const resolvePackageExportPath = (
  root: string,
  packageName: string,
  exportPath: string,
): string | undefined => {
  const packageRoot = resolvePackageRoot(root, packageName)
  if (packageRoot === undefined) {
    return undefined
  }
  try {
    const packageJson: unknown = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    )
    if (!isRecord(packageJson) || !isRecord(packageJson['exports'])) {
      return undefined
    }
    const exportEntry = packageJson['exports'][exportPath]
    const importTarget = isRecord(exportEntry)
      ? exportEntry['import']
      : exportEntry
    if (!Predicate.isString(importTarget)) {
      return undefined
    }
    const modulePath = join(packageRoot, importTarget)
    if (existsSync(modulePath)) {
      return modulePath
    }
    return undefined
  } catch {
    return undefined
  }
}

/** @internal */
export const isUnderDirectory = (
  posixPath: string,
  posixDirectory: string,
): boolean =>
  posixPath === posixDirectory || posixPath.startsWith(`${posixDirectory}/`)
