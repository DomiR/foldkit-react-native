import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

import { transformSync } from '@babel/core'

import foldkitViewIdentityBabel from '../src/babel.ts'
import { transformViewIdentity } from '../src/viewIdentity.ts'

const MODULE_ID = '/app/src/View.ts'
const ROOT = '/app'
const ALIAS = '__foldkitBrandViewResult'
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE_REMOVAL_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
}

const transformBabel = (
  code: string,
  filename: string = MODULE_ID,
  options: Readonly<{ brandModule?: string; root?: string }> = {},
): string => {
  const result = transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[foldkitViewIdentityBabel, { root: ROOT, ...options }]],
  })
  expect(result?.code).not.toBeNull()
  if (result?.code === null || result?.code === undefined) {
    throw new Error('expected Babel output')
  }
  return result.code
}

const transformBabelWithTypeScriptPreset = (code: string): string => {
  const result = transformSync(code, {
    filename: MODULE_ID,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[foldkitViewIdentityBabel, { root: ROOT }]],
    presets: [['@babel/preset-typescript', {}]],
  })
  expect(result?.code).not.toBeNull()
  if (result?.code === null || result?.code === undefined) {
    throw new Error('expected Babel output')
  }
  return result.code
}

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

const requireViteTransform = (code: string): string => {
  const result = transformViewIdentity(code, MODULE_ID, ROOT)
  expect(result).not.toBeNull()
  if (result === null) {
    throw new Error('expected a Vite transform result')
  }
  return result.code
}

const extractIdentities = (code: string): Array<string> => {
  const identities: Array<string> = []
  for (const match of code.matchAll(/src\/View\.ts#[A-Za-z0-9_~]+/g)) {
    const [identity] = match
    if (identity !== undefined) {
      identities.push(identity)
    }
  }
  return identities
}

const makePackageFixture = async (): Promise<
  Readonly<{
    root: string
    brandFile: string
    appFile: string
    foldkitFile: string
  }>
> => {
  const root = await mkdtemp(join(tmpdir(), 'foldkit-babel-package-'))
  onTestFinished(async () => {
    await rm(root, FIXTURE_REMOVAL_OPTIONS)
  })

  const brandPackageRoot = join(root, 'packages/brandpkg')
  const appRoot = join(root, 'apps/app')
  const foldkitPackageRoot = join(root, 'packages/foldkit')
  const brandFile = join(brandPackageRoot, 'src/brand.ts')
  const appFile = join(appRoot, 'src/View.ts')
  const foldkitFile = join(foldkitPackageRoot, 'src/view.ts')

  await mkdir(join(brandPackageRoot, 'src'), { recursive: true })
  await mkdir(join(appRoot, 'src'), { recursive: true })
  await mkdir(join(appRoot, 'node_modules/@scope'), { recursive: true })
  await mkdir(join(foldkitPackageRoot, 'src'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture-workspace' }),
  )
  await writeFile(
    join(brandPackageRoot, 'package.json'),
    JSON.stringify({ name: '@scope/brandpkg' }),
  )
  await writeFile(
    join(appRoot, 'package.json'),
    JSON.stringify({ name: 'fixture-app' }),
  )
  await writeFile(
    join(foldkitPackageRoot, 'package.json'),
    JSON.stringify({ name: 'foldkit' }),
  )
  await writeFile(brandFile, 'const view = () => 1\n')
  await writeFile(appFile, 'const view = () => 1\n')
  await writeFile(foldkitFile, 'const view = () => 1\n')
  await symlink(
    brandPackageRoot,
    join(appRoot, 'node_modules/@scope/brandpkg'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  return { root, brandFile, appFile, foldkitFile }
}

describe('function naming', () => {
  it('brands returns of a named function declaration', () => {
    const code = transformBabel(`function view() {
  return 1
}
`)
    expect(code).toContain('src/View.ts#view')
  })

  it('brands returns of a const arrow with a block body', () => {
    const code = transformBabel(`const view = () => {
  return 1
}
`)
    expect(code).toContain('return ' + ALIAS + '(1, "src/View.ts#view")')
  })

  it('wraps the body of an expression-body arrow', () => {
    const code = transformBabel('const view = () => 1\n')
    expect(code).toContain('const view = () => ' + ALIAS)
    expect(code).toContain('src/View.ts#view')
  })

  it('names an object method by its key', () => {
    const code = transformBabel(`const views = {
  render() {
    return 1
  },
}
`)
    expect(code).toContain('src/View.ts#render')
  })

  it('names an object property arrow by its key', () => {
    const code = transformBabel(`const handlers = {
  Viewing: () => 1,
}
`)
    expect(code).toContain('src/View.ts#Viewing')
  })

  it('names a class method by its key', () => {
    const code = transformBabel(`class Panel {
  render() {
    return 1
  }
}
`)
    expect(code).toContain('src/View.ts#render')
  })

  it('names an export-default function "default"', () => {
    const code = transformBabel(`export default function () {
  return 1
}
`)
    expect(code).toContain('src/View.ts#default')
  })

  it('names an export-default arrow "default"', () => {
    const code = transformBabel('export default () => 1\n')
    expect(code).toContain('src/View.ts#default')
  })

  it('names a member assignment by its property', () => {
    const code = transformBabel(`const host = {}
host.render = function () {
  return 1
}
`)
    expect(code).toContain('src/View.ts#render')
  })

  it('falls back to "anonymous" for unnameable functions', () => {
    const code = transformBabel('const views = [() => 1]\n')
    expect(code).toContain('src/View.ts#anonymous')
  })
})

describe('nested functions', () => {
  it('brands inner and outer functions with their own ids', () => {
    const code = transformBabel(`const outer = () => {
  const inner = () => 1
  return inner()
}
`)
    expect(code).toContain('src/View.ts#inner')
    expect(code).toContain('src/View.ts#outer')
    expect(countOccurrences(code, ALIAS + '(')).toBe(2)
  })

  it('does not let an outer function wrap returns of a nested function', () => {
    const code = transformBabel(`function outer() {
  return function inner() {
    return 1
  }
}
`)
    expect(countOccurrences(code, 'src/View.ts#outer')).toBe(1)
    expect(countOccurrences(code, 'src/View.ts#inner')).toBe(1)
  })

  it('nests calls correctly when inner and outer targets share an end', () => {
    const code = transformBabel('const outer = () => () => 1\n')
    expect(code).toContain('src/View.ts#outer')
    expect(code).toContain('src/View.ts#anonymous')
    expect(countOccurrences(code, ALIAS + '(')).toBe(2)
  })
})

describe('duplicate names', () => {
  it('disambiguates duplicate names deterministically in source order', () => {
    const code = transformBabel(`const render = () => 1
const panel = { render: () => 2 }
`)
    expect(code).toContain('src/View.ts#render')
    expect(code).toContain('src/View.ts#render~2')
  })
})

describe('returns and imports', () => {
  it('leaves bare return statements untouched', () => {
    expect(
      transformBabel(`function run() {
  return
}
`),
    ).not.toContain('brandViewResult')
  })

  it('returns unchanged code for a module with no functions', () => {
    const code = transformBabel('const value = 1\n')
    expect(code).not.toContain(ALIAS)
    expect(code).toContain('const value = 1')
  })

  it('injects the brand import exactly once', () => {
    const code = transformBabel(`const first = () => 1
const second = () => 2
const third = () => 3
`)
    expect(code.startsWith('import { brandViewResult as ' + ALIAS)).toBe(true)
    expect(countOccurrences(code, 'from "foldkit/brand"')).toBe(1)
  })

  it('extends the alias with a numeric suffix on collision', () => {
    const code = transformBabel(`const ${ALIAS} = 1
const view = () => 2
`)
    expect(code).toContain('brandViewResult as ' + ALIAS + '2')
    expect(code).toContain('src/View.ts#view')
  })

  it('keeps a parenthesized object-body arrow syntactically valid', () => {
    const code = transformBabel("const view = () => ({ label: 'x' })\n")
    expect(code).toContain(ALIAS)
    expect(code).toContain('label:')
  })
})

describe('eligibility', () => {
  const functionSource = 'const view = () => 1\n'

  it('skips a packages/foldkit path via the fallback when foldkit is unresolved', () => {
    const code = transformBabel(
      functionSource,
      '/app/packages/foldkit/src/html/index.ts',
    )
    expect(code).not.toContain(ALIAS)
    expect(code).toContain('const view = () => 1')
  })

  it('skips foldkit core under node_modules', () => {
    const code = transformBabel(
      functionSource,
      '/app/node_modules/foldkit/dist/index.js',
    )
    expect(code).not.toContain(ALIAS)
    expect(code).toContain('const view = () => 1')
  })

  it('does not skip @foldkit/ui modules', () => {
    expect(
      transformBabel(functionSource, '/app/packages/ui/src/button/button.ts'),
    ).toContain('packages/ui/src/button/button.ts#view')
  })

  it('skips virtual modules', () => {
    const code = transformBabel(functionSource, '\0virtual:module')
    expect(code).not.toContain(ALIAS)
    expect(code).toContain('const view = () => 1')
  })

  it('skips non-script extensions', () => {
    const code = transformBabel(functionSource, '/app/src/styles.css')
    expect(code).not.toContain(ALIAS)
    expect(code).toContain('const view = () => 1')
  })

  it('strips the query before checking the extension', () => {
    expect(transformBabel(functionSource, '/app/src/View.ts?v=123')).toContain(
      'src/View.ts#view',
    )
  })

  it('skips only whole node_modules path segments', () => {
    const code = transformBabel(
      functionSource,
      '/app/node_modules/some-lib/view.ts',
    )
    expect(code).not.toContain(ALIAS)
    expect(code).toContain('const view = () => 1')
    expect(
      transformBabel(functionSource, '/app/src/node_modules-demo.ts'),
    ).toContain('src/node_modules-demo.ts#view')
  })

  it('skips files under the package that owns the brand module', () => {
    const code = transformBabel(
      functionSource,
      resolve(PACKAGE_ROOT, '../foldkit/src/View.ts'),
      { root: PACKAGE_ROOT },
    )
    expect(code).not.toContain(ALIAS)
    expect(code).toContain('const view = () => 1')
  })

  it('uses nearest package names for brand and foldkit skips', async () => {
    const fixture = await makePackageFixture()
    const options = {
      brandModule: '@scope/brandpkg/brand',
      root: fixture.root,
    }
    const brandCode = transformBabel(functionSource, fixture.brandFile, options)
    const appCode = transformBabel(functionSource, fixture.appFile, options)
    const foldkitCode = transformBabel(
      functionSource,
      fixture.foldkitFile,
      options,
    )

    expect(brandCode).not.toContain(ALIAS)
    expect(appCode).toContain('apps/app/src/View.ts#view')
    expect(appCode).toContain('@scope/brandpkg/brand')
    expect(foldkitCode).not.toContain(ALIAS)
  })
})

describe('already-branded modules', () => {
  it('returns unchanged code when the module already imports foldkit/brand', () => {
    expect(
      transformBabel(`import { brandViewResult as ${ALIAS} } from 'foldkit/brand'
const view = () => ${ALIAS}(1, "src/View.ts#view")
`),
    ).toContain('brandViewResult as ' + ALIAS)
    expect(
      transformBabel(`import { brandViewResult } from 'foldkit/brand'
const view = () => 1
`),
    ).not.toContain(ALIAS)
  })

  it('recognizes a double-quoted foldkit/brand specifier', () => {
    const code = transformBabel(`import { brandViewResult } from "foldkit/brand"
const view = () => brandViewResult(1, "src/View.ts#view")
`)
    expect(countOccurrences(code, 'foldkit/brand')).toBe(1)
    expect(code).not.toContain(ALIAS)
  })

  it('is idempotent: transforming its own output returns unchanged code', () => {
    const first = transformBabel('const view = () => 1\n')
    const second = transformBabel(first)
    expect(second).toBe(first)
  })

  it('skips a module that re-exports foldkit/brand', () => {
    const code = transformBabel(`export { brandViewResult } from 'foldkit/brand'
const view = () => 1
`)
    expect(code).not.toContain(ALIAS)
  })

  it('brands a module whose comment mentions foldkit/brand', () => {
    const code = transformBabel(`// see 'foldkit/brand' for details
const view = () => 1
`)
    expect(code).toContain('src/View.ts#view')
    expect(countOccurrences(code, 'brandViewResult as')).toBe(1)
  })

  it('brands a module whose string literal mentions foldkit/brand', () => {
    const code = transformBabel(`const specifier = 'foldkit/brand'
const view = () => 1
`)
    expect(code).toContain('src/View.ts#view')
  })
})

describe('directive prologues', () => {
  it('keeps leading directives ahead of the injected import', () => {
    const code = transformBabel(`'use client'
'use strict'
const view = () => 1
`)
    const clientDirectiveIndex = code.search(/^['"]use client['"]/)
    const strictDirectiveIndex = code.search(/['"]use strict['"]/)
    const brandImportIndex = code.indexOf('brandViewResult as')

    expect(clientDirectiveIndex).toBe(0)
    expect(strictDirectiveIndex).toBeGreaterThan(clientDirectiveIndex)
    expect(brandImportIndex).toBeGreaterThan(strictDirectiveIndex)
  })
})

describe('output stability', () => {
  it('produces identical output across runs', () => {
    const source = `const view = () => 1
const panel = () => {
  return 2
}
`
    expect(transformBabel(source)).toBe(transformBabel(source))
  })
})

describe('identities reveal nothing about the source', () => {
  const viewSource = `export const field = () => h.input([h.Name('email')])\n`
  const secretSource =
    `const pin = import.meta.env.SSR ? '0427' : ''\n` +
    `export const field = () => h.input([h.Name('email')])\n`

  const identityOf = (source: string): string => {
    const identities = extractIdentities(transformBabel(source))
    const [identity] = identities
    if (identity === undefined) {
      throw new Error('no identity found')
    }
    return identity
  }

  it('names the source position and nothing else', () => {
    expect(identityOf(viewSource)).toBe('src/View.ts#field')
  })

  it('does not change when the module body changes around a view', () => {
    expect(identityOf(secretSource)).toBe(identityOf(viewSource))
  })

  it('carries no hexadecimal digest suffix', () => {
    expect(identityOf(secretSource)).not.toMatch(/@[0-9a-f]{8,}$/)
  })
})

describe('Babel-specific behavior', () => {
  it('keeps a value import when the TypeScript preset removes a type import', () => {
    const code =
      transformBabelWithTypeScriptPreset(`import type { Value } from './types'
import { value } from './value'
const view: Value = () => value
`)
    expect(code).toContain('foldkit/brand')
    expect(code).toContain('./value')
    expect(code).not.toContain('./types')
  })

  it('uses the same identities as the Vite transform', () => {
    const source = `const outer = () => () => 1
const panel = { render() { return 2 } }
`
    expect(extractIdentities(transformBabel(source))).toEqual(
      extractIdentities(requireViteTransform(source)),
    )
  })

  it('uses the configured brand module in the injected import', () => {
    const code = transformBabel('const view = () => 1\n', MODULE_ID, {
      brandModule: '@foldkit/native/brand',
    })
    expect(code).toContain('@foldkit/native/brand')
  })

  it('skips a worklet function while branding an outside function', () => {
    const code = transformBabel(`const worklet = () => {
  'worklet'
  return 1
}
const outside = () => 2
`)
    expect(code).not.toContain('src/View.ts#worklet')
    expect(code).toContain('src/View.ts#outside')
  })

  it('skips functions nested in a worklet while branding an outside function', () => {
    const code = transformBabel(`const worklet = () => {
  'worklet'
  const nested = () => 1
  return nested()
}
const outside = () => 2
`)
    expect(code).not.toContain('src/View.ts#worklet')
    expect(code).not.toContain('src/View.ts#nested')
    expect(code).toContain('src/View.ts#outside')
  })

  it('skips a module with a file-level worklet directive', () => {
    const code = transformBabel(`'worklet'
const outside = () => 1
`)
    expect(code).not.toContain(ALIAS)
    expect(code).toContain('const outside = () => 1')
  })
})
