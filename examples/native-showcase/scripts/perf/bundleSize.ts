import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const SHOWCASE_DIR = resolve(import.meta.dirname, '../..')
const REPO_DIR = resolve(SHOWCASE_DIR, '../..')
const BASE64_DIGITS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

type JsonRecord = Readonly<Record<string, unknown>>

type SourceMap = Readonly<{
  mappings: string
  sourceRoot?: string
  sources: ReadonlyArray<string>
}>

type SourceMapSection = Readonly<{
  offset: Readonly<{ line: number; column: number }>
  map: SourceMap
}>

type SourceMapDocument =
  | Readonly<{ kind: 'flat'; map: SourceMap }>
  | Readonly<{ kind: 'indexed'; sections: ReadonlyArray<SourceMapSection> }>

type MappingSegment = Readonly<{
  column: number
  sourcePath: string | undefined
}>

type DecodedSection = Readonly<{
  offset: Readonly<{ line: number; column: number }>
  mappings: ReadonlyMap<number, ReadonlyArray<MappingSegment>>
}>

type AttributionRange = Readonly<{
  startColumn: number
  endColumn: number
  segments: ReadonlyArray<MappingSegment>
  attributeTailToLastSegment: boolean
}>

type ByteAttribution = Readonly<{
  packages: ReadonlyMap<string, number>
  files: ReadonlyMap<string, number>
}>

type PackageRow = Readonly<{
  package: string
  bytes: number
  percent: number
}>

type FileRow = Readonly<{
  file: string
  bytes: number
}>

type BundleReport = Readonly<{
  sizes: Readonly<{
    hbcBytes: number
    hbcGzipBytes: number
    jsBytes: number
    jsGzipBytes: number
    jsBrotliBytes: number
  }>
  packages: ReadonlyArray<PackageRow>
  topFiles: Readonly<Record<string, ReadonlyArray<FileRow>>>
}>

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readJson = (filePath: string): unknown =>
  JSON.parse(readFileSync(filePath, 'utf8'))

const getRecord = (value: unknown, key: string): JsonRecord | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const nested = value[key]
  return isRecord(nested) ? nested : undefined
}

const getString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const nested = value[key]
  return typeof nested === 'string' ? nested : undefined
}

const parseArgs = (): Readonly<{ outDir: string; skipExport: boolean }> => {
  let outArg: string | undefined
  let skipExport = false
  const args = process.argv.slice(2)

  for (let index = 0; index < args.length; index += 1) {
    const argument = args.at(index)
    if (argument === '--skip-export') {
      skipExport = true
    } else if (argument === '--out') {
      const value = args.at(index + 1)
      if (value === undefined) {
        throw new Error('--out requires a directory.')
      }
      outArg = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument ?? '<empty>'}`)
    }
  }

  return {
    outDir:
      outArg === undefined
        ? join(SHOWCASE_DIR, '.perf', 'bundle')
        : resolve(process.cwd(), outArg),
    skipExport,
  }
}

const exportBundle = (outDir: string, skipExport: boolean): void => {
  if (skipExport) {
    return
  }

  const environment: NodeJS.ProcessEnv = { ...process.env, CI: '1' }
  delete environment['EXPO_PUBLIC_FOLDKIT_PERF']
  const hbcDir = join(outDir, 'hbc')
  const jsDir = join(outDir, 'js')
  mkdirSync(outDir, { recursive: true })

  execFileSync(
    'npx',
    [
      'expo',
      'export',
      '--platform',
      'android',
      '--output-dir',
      hbcDir,
      '--clear',
    ],
    { cwd: SHOWCASE_DIR, env: environment, stdio: 'inherit' },
  )
  execFileSync(
    'npx',
    [
      'expo',
      'export',
      '--platform',
      'android',
      '--no-bytecode',
      '--source-maps',
      'true',
      '--output-dir',
      jsDir,
    ],
    { cwd: SHOWCASE_DIR, env: environment, stdio: 'inherit' },
  )
}

const listFiles = (directory: string): Array<string> => {
  if (!existsSync(directory)) {
    return []
  }

  const files: Array<string> = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(path))
    } else {
      files.push(path)
    }
  }
  return files
}

const metadataBundle = (exportDir: string): string | undefined => {
  const metadataPath = join(exportDir, 'metadata.json')
  if (!existsSync(metadataPath)) {
    return undefined
  }

  const metadata = readJson(metadataPath)
  const android = getRecord(getRecord(metadata, 'fileMetadata'), 'android')
  const bundle = getString(android, 'bundle')
  return bundle === undefined ? undefined : resolve(exportDir, bundle)
}

const locateBundle = (exportDir: string, isJavaScript: boolean): string => {
  const metadataPath = metadataBundle(exportDir)
  if (metadataPath !== undefined && existsSync(metadataPath)) {
    return metadataPath
  }

  const staticDirectory = join(exportDir, '_expo', 'static', 'js', 'android')
  const files = listFiles(staticDirectory).filter(
    filePath => !filePath.endsWith('.map'),
  )
  const bundle = isJavaScript
    ? files.find(filePath => extname(filePath) === '.js')
    : (files.find(filePath => extname(filePath) === '.hbc') ??
      files.find(filePath => extname(filePath) === '.js'))
  if (bundle === undefined) {
    throw new Error(`Could not locate an Android bundle under ${exportDir}.`)
  }
  return bundle
}

const locateSourceMap = (javascriptBundle: string): string => {
  const direct = `${javascriptBundle}.map`
  if (existsSync(direct)) {
    return direct
  }

  const siblingMaps = readdirSync(dirname(javascriptBundle), {
    withFileTypes: true,
  })
    .filter(entry => entry.isFile() && entry.name.endsWith('.map'))
    .map(entry => join(dirname(javascriptBundle), entry.name))
  if (siblingMaps.length === 1) {
    const onlyMap = siblingMaps.at(0)
    if (onlyMap !== undefined) {
      return onlyMap
    }
  }

  const bundleStem = basename(javascriptBundle).replace(/\.js$/i, '')
  const hashSeparator = bundleStem.lastIndexOf('-')
  const prefix =
    hashSeparator > 0 ? bundleStem.slice(0, hashSeparator) : bundleStem
  const matching = siblingMaps.find(filePath =>
    basename(filePath).startsWith(prefix),
  )
  if (matching !== undefined) {
    return matching
  }

  throw new Error(
    `Could not locate a source map beside ${javascriptBundle}. Expected a .map sibling.`,
  )
}

const decodeVlqSegment = (segment: string): Array<number> => {
  const values: Array<number> = []
  let value = 0
  let shift = 0

  for (const character of segment) {
    const digit = BASE64_DIGITS.indexOf(character)
    if (digit < 0) {
      throw new Error(`Invalid base64 VLQ digit ${character}.`)
    }

    const continuation = (digit & 32) !== 0
    value += (digit & 31) * 2 ** shift
    if (!continuation) {
      const isNegative = value % 2 !== 0
      const magnitude = Math.floor(value / 2)
      values.push(isNegative ? -magnitude : magnitude)
      value = 0
      shift = 0
    } else {
      shift += 5
    }
  }

  if (shift !== 0) {
    throw new Error(`Unterminated base64 VLQ segment ${segment}.`)
  }

  return values
}

const nonNegativeInteger = (
  value: unknown,
  name: string,
): number | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const candidate = value[name]
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 0
    ? candidate
    : undefined
}

const sourceMapFromValue = (value: unknown, mapPath: string): SourceMap => {
  const map = value
  if (!isRecord(map)) {
    throw new Error(`Source map section in ${mapPath} is not an object.`)
  }
  if (map['sections'] !== undefined) {
    throw new Error(`Nested indexed source maps are not supported: ${mapPath}.`)
  }

  const mappings = getString(map, 'mappings')
  const sourceValues = map['sources']
  if (mappings === undefined || !Array.isArray(sourceValues)) {
    throw new Error(`Source map ${mapPath} is missing mappings or sources.`)
  }

  const sources: Array<string> = []
  for (const source of sourceValues) {
    if (typeof source !== 'string') {
      throw new Error(`Source map ${mapPath} is missing mappings or sources.`)
    }
    sources.push(source)
  }

  const sourceRoot = getString(map, 'sourceRoot')

  return sourceRoot === undefined
    ? { mappings, sources }
    : { mappings, sources, sourceRoot }
}

const sourceMapFromFile = (mapPath: string): SourceMapDocument => {
  const value = readJson(mapPath)
  if (!isRecord(value)) {
    throw new Error(`Source map ${mapPath} is not an object.`)
  }

  const sectionValues = value['sections']
  if (sectionValues === undefined) {
    return { kind: 'flat', map: sourceMapFromValue(value, mapPath) }
  }
  if (!Array.isArray(sectionValues)) {
    throw new Error(`Indexed source map sections are not an array: ${mapPath}.`)
  }

  const sections: Array<SourceMapSection> = []
  for (const sectionValue of sectionValues) {
    const section = getRecord(sectionValue, 'map')
    const offset = getRecord(sectionValue, 'offset')
    const line = nonNegativeInteger(offset, 'line')
    const column = nonNegativeInteger(offset, 'column')
    if (section === undefined || line === undefined || column === undefined) {
      throw new Error(`Indexed source map has an invalid section: ${mapPath}.`)
    }
    sections.push({
      offset: { line, column },
      map: sourceMapFromValue(section, mapPath),
    })
  }

  return { kind: 'indexed', sections }
}

const stripSourcePrefix = (source: string): string => {
  let normalized = source.replaceAll('\\', '/')
  const isWebpackPath = normalized.startsWith('webpack://')
  normalized = normalized.replace(/^webpack:\/\/\/?/, '')
  normalized = normalized.replace(/^webpack:\/\/[^/]+\//, '')
  normalized = normalized.replace(/^\/\[metro-project\]\//, '')
  if (isWebpackPath) {
    normalized = normalized.replace(/^\/+/, '')
    normalized = normalized.replace(/^\[metro-project\]\//, '')
  }
  return normalized
}

const resolveSourcePath = (
  source: string,
  sourceRoot: string | undefined,
  exportDir: string,
): string => {
  const strippedSource = stripSourcePrefix(source)
  const strippedRoot =
    sourceRoot === undefined ? '' : stripSourcePrefix(sourceRoot)
  const sourceWithRoot =
    strippedRoot === '' ? strippedSource : join(strippedRoot, strippedSource)
  if (/^\/(?:node_modules|packages|examples)\//.test(sourceWithRoot)) {
    return normalizePath(resolve(REPO_DIR, sourceWithRoot.slice(1)))
  }
  return isAbsolute(sourceWithRoot)
    ? normalizePath(sourceWithRoot)
    : normalizePath(resolve(exportDir, sourceWithRoot))
}

const normalizePath = (path: string): string => path.replaceAll('\\', '/')

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8')

const addBytes = (
  bytes: Map<string, number>,
  key: string,
  amount: number,
): void => {
  if (amount === 0) {
    return
  }
  bytes.set(key, (bytes.get(key) ?? 0) + amount)
}

const packageNameFor = (
  sourcePath: string,
  packageNames: Map<string, string>,
): string => {
  const normalized = normalizePath(sourcePath)
  const nodeModulesIndex = normalized.startsWith('node_modules/')
    ? 0
    : normalized.lastIndexOf('/node_modules/')
  if (nodeModulesIndex >= 0) {
    const markerLength =
      nodeModulesIndex === 0 ? 'node_modules/'.length : '/node_modules/'.length
    const packagePath = normalized.slice(nodeModulesIndex + markerLength)
    const packageParts = packagePath.split('/').filter(part => part !== '')
    const firstPart = packageParts.at(0)
    if (firstPart === undefined) {
      return '[other]'
    }
    if (firstPart.startsWith('@')) {
      return `${firstPart}/${packageParts.at(1) ?? '[unknown]'}`
    }
    return firstPart
  }

  const relativePath = relative(REPO_DIR, sourcePath).replaceAll('\\', '/')
  if (
    relativePath !== '..' &&
    !relativePath.startsWith('../') &&
    !isAbsolute(relativePath)
  ) {
    const packageMatch = /^packages\/([^/]+)(?:\/|$)/.exec(relativePath)
    if (packageMatch?.[1] !== undefined) {
      const packageDirectory = packageMatch[1]
      const cached = packageNames.get(packageDirectory)
      if (cached !== undefined) {
        return cached
      }
      const packageJsonPath = join(
        REPO_DIR,
        'packages',
        packageDirectory,
        'package.json',
      )
      if (existsSync(packageJsonPath)) {
        const name = getString(readJson(packageJsonPath), 'name')
        if (name !== undefined) {
          packageNames.set(packageDirectory, name)
          return name
        }
      }
    }

    const exampleMatch = /^examples\/([^/]+)(?:\/|$)/.exec(relativePath)
    if (exampleMatch?.[1] !== undefined) {
      return `example:${exampleMatch[1]}`
    }
  }

  return '[other]'
}

const decodeSection = (
  section: SourceMapSection,
  exportDir: string,
): DecodedSection => {
  const sourcePaths = section.map.sources.map(source =>
    resolveSourcePath(source, section.map.sourceRoot, exportDir),
  )
  let sourceIndex = 0
  let originalLine = 0
  let originalColumn = 0
  let nameIndex = 0
  const mappings = new Map<number, Array<MappingSegment>>()

  for (const [lineIndex, mappingLine] of section.map.mappings
    .split(';')
    .entries()) {
    const segments =
      mappingLine === ''
        ? []
        : mappingLine.split(',').map(segment => decodeVlqSegment(segment))
    const segmentColumns: Array<MappingSegment> = []
    let generatedColumn = 0

    for (const segment of segments) {
      const generatedColumnDelta = segment.at(0)
      if (generatedColumnDelta === undefined) {
        throw new Error(
          `Invalid empty source map segment on generated line ${lineIndex + 1}.`,
        )
      }
      generatedColumn += generatedColumnDelta
      const mappedSource = segment.at(1)
      if (mappedSource !== undefined) {
        sourceIndex += mappedSource
        const originalLineDelta = segment.at(2)
        const originalColumnDelta = segment.at(3)
        if (
          originalLineDelta === undefined ||
          originalColumnDelta === undefined
        ) {
          throw new Error(
            `Invalid mapped source segment on generated line ${lineIndex + 1}.`,
          )
        }
        originalLine += originalLineDelta
        originalColumn += originalColumnDelta
        const mappedName = segment.at(4)
        if (mappedName !== undefined) {
          nameIndex += mappedName
        }
        segmentColumns.push({
          column:
            generatedColumn + (lineIndex === 0 ? section.offset.column : 0),
          sourcePath: sourceIndex < 0 ? undefined : sourcePaths.at(sourceIndex),
        })
      } else {
        segmentColumns.push({
          column:
            generatedColumn + (lineIndex === 0 ? section.offset.column : 0),
          sourcePath: undefined,
        })
      }
    }

    segmentColumns.sort((left, right) => left.column - right.column)
    mappings.set(section.offset.line + lineIndex, segmentColumns)
  }

  return { offset: section.offset, mappings }
}

const decodedSectionsFor = (
  sourceMap: SourceMapDocument,
  exportDir: string,
): Array<DecodedSection> => {
  const sections =
    sourceMap.kind === 'flat'
      ? [{ offset: { line: 0, column: 0 }, map: sourceMap.map }]
      : sourceMap.sections
  return sections
    .map(section => decodeSection(section, exportDir))
    .sort((left, right) => {
      const lineDifference = left.offset.line - right.offset.line
      return lineDifference === 0
        ? left.offset.column - right.offset.column
        : lineDifference
    })
}

const clampColumn = (column: number, lineLength: number): number =>
  Math.max(0, Math.min(column, lineLength))

const rangesForSections = (
  sections: ReadonlyArray<DecodedSection>,
  generatedLineLengths: ReadonlyArray<number>,
): ReadonlyMap<number, ReadonlyArray<AttributionRange>> => {
  const ranges = new Map<number, Array<AttributionRange>>()

  const addRange = (
    line: number,
    startColumn: number,
    endColumn: number,
    segments: ReadonlyArray<MappingSegment>,
    attributeTailToLastSegment: boolean,
  ): void => {
    const lineLength = generatedLineLengths.at(line) ?? 0
    const start = clampColumn(startColumn, lineLength)
    const end = clampColumn(endColumn, lineLength)
    if (end <= start) {
      return
    }
    const existing = ranges.get(line)
    const range = {
      startColumn: start,
      endColumn: end,
      segments,
      attributeTailToLastSegment,
    }
    if (existing === undefined) {
      ranges.set(line, [range])
    } else {
      existing.push(range)
    }
  }

  for (
    let sectionIndex = 0;
    sectionIndex < sections.length;
    sectionIndex += 1
  ) {
    const section = sections.at(sectionIndex)
    if (section === undefined) {
      continue
    }
    const nextSection = sections.at(sectionIndex + 1)
    const endLine = nextSection?.offset.line ?? generatedLineLengths.length
    const firstLine = section.offset.line
    const segmentsFor = (line: number): ReadonlyArray<MappingSegment> =>
      section.mappings.get(line) ?? []

    for (let line = firstLine; line < endLine; line += 1) {
      addRange(
        line,
        line === firstLine ? section.offset.column : 0,
        generatedLineLengths.at(line) ?? 0,
        segmentsFor(line),
        false,
      )
    }

    if (nextSection?.offset.line === firstLine) {
      addRange(
        firstLine,
        section.offset.column,
        nextSection.offset.column,
        segmentsFor(firstLine),
        nextSection.offset.column > 0,
      )
    }
  }

  for (const lineRanges of ranges.values()) {
    lineRanges.sort((left, right) => left.startColumn - right.startColumn)
  }
  return ranges
}

const attributeMappedRange = (
  generatedLine: string,
  range: AttributionRange,
  packageBytes: Map<string, number>,
  fileBytes: Map<string, number>,
): void => {
  let previousColumn = range.startColumn
  for (
    let segmentIndex = 0;
    segmentIndex < range.segments.length;
    segmentIndex += 1
  ) {
    const segment = range.segments.at(segmentIndex)
    if (segment === undefined || segment.column >= range.endColumn) {
      break
    }
    const segmentColumn = clampColumn(
      Math.max(segment.column, range.startColumn),
      range.endColumn,
    )
    const nextSegment = range.segments.at(segmentIndex + 1)
    const segmentEnd = clampColumn(
      nextSegment?.column ?? range.endColumn,
      range.endColumn,
    )
    if (segmentEnd <= segmentColumn) {
      continue
    }
    addBytes(
      packageBytes,
      '[unmapped]',
      byteLength(generatedLine.slice(previousColumn, segmentColumn)),
    )
    const segmentBytes = byteLength(
      generatedLine.slice(segmentColumn, segmentEnd),
    )
    if (segment.sourcePath === undefined) {
      addBytes(packageBytes, '[unmapped]', segmentBytes)
    } else {
      addBytes(fileBytes, segment.sourcePath, segmentBytes)
    }
    previousColumn = segmentEnd
  }
  const tailBytes = byteLength(
    generatedLine.slice(previousColumn, range.endColumn),
  )
  const lastSegment = range.segments.at(-1)
  if (range.attributeTailToLastSegment && lastSegment !== undefined) {
    if (lastSegment.sourcePath === undefined) {
      addBytes(packageBytes, '[unmapped]', tailBytes)
    } else {
      addBytes(fileBytes, lastSegment.sourcePath, tailBytes)
    }
  } else {
    addBytes(packageBytes, '[unmapped]', tailBytes)
  }
}

const attributeBytes = (
  javascript: string,
  sourceMap: SourceMapDocument,
  exportDir: string,
): ByteAttribution => {
  const packageBytes = new Map<string, number>()
  const fileBytes = new Map<string, number>()
  const generatedLines = javascript.split('\n')
  const generatedLineTexts = generatedLines.map(line =>
    line.endsWith('\r') ? line.slice(0, -1) : line,
  )
  const generatedLineLengths = generatedLineTexts.map(line => line.length)
  const sections = decodedSectionsFor(sourceMap, exportDir)
  const ranges = rangesForSections(sections, generatedLineLengths)

  for (
    let lineIndex = 0;
    lineIndex < generatedLineTexts.length;
    lineIndex += 1
  ) {
    const generatedLine = generatedLineTexts.at(lineIndex) ?? ''
    const lineRanges = ranges.get(lineIndex) ?? []
    let previousColumn = 0
    for (const range of lineRanges) {
      addBytes(
        packageBytes,
        '[unmapped]',
        byteLength(generatedLine.slice(previousColumn, range.startColumn)),
      )
      attributeMappedRange(generatedLine, range, packageBytes, fileBytes)
      previousColumn = Math.max(previousColumn, range.endColumn)
    }
    addBytes(
      packageBytes,
      '[unmapped]',
      byteLength(generatedLine.slice(previousColumn)),
    )
    const generatedLineWithBreak = generatedLines.at(lineIndex) ?? ''
    const hasCarriageReturn = generatedLineWithBreak.endsWith('\r')
    const newlineBytes =
      lineIndex < generatedLines.length - 1 ? (hasCarriageReturn ? 2 : 1) : 0
    addBytes(packageBytes, '[unmapped]', newlineBytes)
  }

  const packageNames = new Map<string, string>()
  for (const [sourcePath, bytes] of fileBytes) {
    const packageName = packageNameFor(sourcePath, packageNames)
    addBytes(packageBytes, packageName, bytes)
  }

  return { packages: packageBytes, files: fileBytes }
}

const sortedPackages = (
  bytes: ReadonlyMap<string, number>,
  totalBytes: number,
): Array<PackageRow> =>
  [...bytes]
    .filter(([, packageBytes]) => packageBytes > 0)
    .sort(([, leftBytes], [, rightBytes]) => rightBytes - leftBytes)
    .map(([packageName, packageBytes]) => ({
      package: packageName,
      bytes: packageBytes,
      percent: totalBytes === 0 ? 0 : (packageBytes / totalBytes) * 100,
    }))

const topFilesFor = (
  files: ReadonlyMap<string, number>,
  packageName: string,
  packageNames: Map<string, string>,
  limit: number,
): Array<FileRow> =>
  [...files]
    .filter(
      ([filePath]) => packageNameFor(filePath, packageNames) === packageName,
    )
    .sort(([, leftBytes], [, rightBytes]) => rightBytes - leftBytes)
    .slice(0, limit)
    .map(([filePath, bytes]) => ({
      file: normalizePath(relative(REPO_DIR, filePath)),
      bytes,
    }))

const kilobytes = (bytes: number): string => (bytes / 1024).toFixed(1)

const markdownReport = (report: BundleReport): string => {
  const lines = [
    '# Bundle size',
    '',
    '| Artifact | Bytes | KB |',
    '| --- | ---: | ---: |',
    `| HBC raw | ${report.sizes.hbcBytes} | ${kilobytes(report.sizes.hbcBytes)} |`,
    `| HBC gzip | ${report.sizes.hbcGzipBytes} | ${kilobytes(report.sizes.hbcGzipBytes)} |`,
    `| Minified JS raw | ${report.sizes.jsBytes} | ${kilobytes(report.sizes.jsBytes)} |`,
    `| Minified JS gzip | ${report.sizes.jsGzipBytes} | ${kilobytes(report.sizes.jsGzipBytes)} |`,
    `| Minified JS brotli | ${report.sizes.jsBrotliBytes} | ${kilobytes(report.sizes.jsBrotliBytes)} |`,
    '',
    'Attribution is of minified JS bytes. HBC size is reported whole because bytecode is not source-mapped per module.',
    '',
    '## Packages',
    '',
    '| Package | KB | % of JS |',
    '| --- | ---: | ---: |',
    ...report.packages.map(
      row =>
        `| ${row.package} | ${kilobytes(row.bytes)} | ${row.percent.toFixed(2)}% |`,
    ),
  ]

  for (const [packageName, files] of Object.entries(report.topFiles)) {
    lines.push(
      '',
      `## Top files in ${packageName}`,
      '',
      '| File | KB |',
      '| --- | ---: |',
    )
    lines.push(
      ...files.map(file => `| ${file.file} | ${kilobytes(file.bytes)} |`),
    )
  }

  return `${lines.join('\n')}\n`
}

const main = (): void => {
  const { outDir, skipExport } = parseArgs()
  exportBundle(outDir, skipExport)

  const hbcDir = join(outDir, 'hbc')
  const jsDir = join(outDir, 'js')
  const hbcBundle = locateBundle(hbcDir, false)
  const javascriptBundle = locateBundle(jsDir, true)
  const sourceMapPath = locateSourceMap(javascriptBundle)
  const hbc = readFileSync(hbcBundle)
  const javascript = readFileSync(javascriptBundle, 'utf8')
  const sourceMap = sourceMapFromFile(sourceMapPath)
  const attribution = attributeBytes(javascript, sourceMap, jsDir)
  const packageNames = new Map<string, string>()
  const topFiles = {
    effect: topFilesFor(attribution.files, 'effect', packageNames, 15),
    foldkit: topFilesFor(attribution.files, 'foldkit', packageNames, 10),
    '@foldkit/native': topFilesFor(
      attribution.files,
      '@foldkit/native',
      packageNames,
      10,
    ),
  }
  const report: BundleReport = {
    sizes: {
      hbcBytes: hbc.byteLength,
      hbcGzipBytes: gzipSync(hbc, { level: 9 }).byteLength,
      jsBytes: Buffer.byteLength(javascript, 'utf8'),
      jsGzipBytes: gzipSync(Buffer.from(javascript, 'utf8'), { level: 9 })
        .byteLength,
      jsBrotliBytes: brotliCompressSync(Buffer.from(javascript, 'utf8'), {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).byteLength,
    },
    packages: sortedPackages(
      attribution.packages,
      Buffer.byteLength(javascript, 'utf8'),
    ),
    topFiles,
  }
  const markdown = markdownReport(report)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'bundle-size.md'), markdown)
  writeFileSync(
    join(outDir, 'bundle-size.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  process.stdout.write(markdown)
}

try {
  main()
} catch (error) {
  console.error(String(error))
  process.exitCode = 1
}
