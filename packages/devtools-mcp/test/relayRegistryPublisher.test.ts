import { Array, Effect, FileSystem, Option, Schema } from 'effect'
import { RELAY_RECORD_VERSION, RelayRecord } from 'foldkit/devtools-protocol'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  publishRelayRecord,
  retireRelayRecord,
} from '../src/relayRegistryPublisher.ts'
import { relayRegistryTrust } from '../src/relayRegistryTrust.ts'
import { spawnRelayCommand, startRelay } from './nativeRelayFixtures.ts'
import { useWorkspace } from './relayFixtures.ts'
import { runWithNode } from './relayRegistryFixtures.ts'

const PRIVATE_FILE_MODE = 0o600
const PERMISSION_MASK = 0o777
const decodeRecord = Schema.decodeUnknownSync(
  Schema.fromJsonString(RelayRecord),
)
const encodeRecord = Schema.encodeSync(Schema.fromJsonString(RelayRecord))

const record = (root: string) =>
  RelayRecord.make({
    version: RELAY_RECORD_VERSION,
    id: randomUUID(),
    root,
    url: `ws://127.0.0.1:1/__foldkit/devtools-mcp?token=${'a'.repeat(64)}`,
    pid: process.pid,
    startedAt: 1,
  })

describe('native relay registry publication', () => {
  const workspace = useWorkspace()

  it('publishes a private record with the exact discovery URL and retires it on close', async () => {
    const relay = await startRelay(workspace.root)
    expect(relay.url).toMatch(
      new RegExp(
        `^ws://127\\.0\\.0\\.1:${relay.port}/__foldkit/devtools-mcp\\?token=[0-9a-f]{64}$`,
      ),
    )
    const files = await readdir(workspace.registry)
    expect(files).toHaveLength(1)
    const path = join(workspace.registry, Option.getOrThrow(Array.head(files)))
    const published = decodeRecord(await readFile(path, 'utf8'))
    expect(published).toMatchObject({
      root: workspace.root,
      url: relay.url,
      pid: process.pid,
      version: RELAY_RECORD_VERSION,
    })

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & PERMISSION_MASK).toBe(PRIVATE_FILE_MODE)
    }

    await relay.close()
    expect(await readdir(workspace.registry)).toEqual([])
  })

  it('publishes canonical project roots reached through symlinks or junctions', async () => {
    const target = join(workspace.root, 'target')
    const link = join(workspace.root, 'link')
    await mkdir(target)
    await symlink(
      target,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await startRelay(link)
    const files = await readdir(workspace.registry)
    const published = decodeRecord(
      await readFile(
        join(workspace.registry, Option.getOrThrow(Array.head(files))),
        'utf8',
      ),
    )
    expect(published.root).toBe(target)
  })

  it('retires only its own record when multiple relays share a project', async () => {
    const first = await startRelay(workspace.root)
    const second = await startRelay(workspace.root)
    expect(await readdir(workspace.registry)).toHaveLength(2)
    await first.close()
    const files = await readdir(workspace.registry)
    expect(files).toHaveLength(1)
    expect(
      decodeRecord(
        await readFile(
          join(workspace.registry, Option.getOrThrow(Array.head(files))),
          'utf8',
        ),
      ).url,
    ).toBe(second.url)
  })

  it('does not retire a replacement record under an owned filename', async () => {
    const original = record(workspace.root)
    const replacement = record(workspace.root)
    const directory = await runWithNode(
      publishRelayRecord(original, relayRegistryTrust),
    )
    const path = join(directory, `${original.id}.json`)
    await writeFile(path, encodeRecord(replacement))
    await runWithNode(retireRelayRecord(original.id, directory))
    expect(decodeRecord(await readFile(path, 'utf8'))).toEqual(replacement)
  })

  it('makes the completed record visible only through an atomic rename', async () => {
    const published = record(workspace.root)
    await runWithNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const intercepting: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (from, to) =>
            Effect.gen(function* () {
              expect(from.endsWith('.pending')).toBe(true)
              expect(to.endsWith('.json')).toBe(true)
              expect(yield* fileSystem.exists(to)).toBe(false)
              expect(
                decodeRecord(yield* fileSystem.readFileString(from)),
              ).toEqual(published)
              yield* fileSystem.rename(from, to)
            }),
        }
        yield* publishRelayRecord(published, relayRegistryTrust).pipe(
          Effect.provideService(FileSystem.FileSystem, intercepting),
        )
      }),
    )
    expect(await readdir(workspace.registry)).toEqual([`${published.id}.json`])
  })

  it('removes a pending file when atomic publication fails', async () => {
    await expect(
      runWithNode(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const intercepting: FileSystem.FileSystem = {
            ...fileSystem,
            rename: (_from, to) =>
              fileSystem.rename(join(workspace.root, 'missing'), to),
          }
          yield* publishRelayRecord(
            record(workspace.root),
            relayRegistryTrust,
          ).pipe(Effect.provideService(FileSystem.FileSystem, intercepting))
        }),
      ),
    ).rejects.toThrow()
    expect(await readdir(workspace.registry)).toEqual([])
  })

  it('releases the listener if registry trust refuses publication', async () => {
    const initial = await startRelay(workspace.root)
    const { port } = initial
    await initial.close()
    const inspection = vi
      .spyOn(relayRegistryTrust, 'inspect')
      .mockImplementation(directory =>
        Effect.succeed({
          directory,
          maybeRefusal: Option.some('is not private'),
        }),
      )
    await expect(startRelay(workspace.root, port)).rejects.toThrow(
      'Cannot publish the native relay record',
    )
    expect(await readdir(workspace.registry)).toEqual([])
    inspection.mockRestore()
    const replacement = await startRelay(workspace.root, port)
    expect(replacement.port).toBe(port)
  })

  it.skipIf(process.platform === 'win32')(
    'refuses a registry readable by other users',
    async () => {
      await chmod(workspace.registry, 0o755)
      await expect(
        runWithNode(
          publishRelayRecord(record(workspace.root), relayRegistryTrust),
        ),
      ).rejects.toThrow()
      expect(await readdir(workspace.registry)).toEqual([])
    },
  )

  const signals: ReadonlyArray<NodeJS.Signals> = ['SIGINT', 'SIGTERM']

  it.skipIf(process.platform === 'win32').each(signals)(
    'retires its record and releases the port on %s',
    async signal => {
      const initial = await startRelay(workspace.root)
      const { port } = initial
      await initial.close()
      const command = spawnRelayCommand(workspace.root, [
        '--port',
        globalThis.String(port),
      ])
      await expect
        .poll(() => command.output.join(''), { timeout: 10_000 })
        .toContain('native relay listening')
      expect(await readdir(workspace.registry)).toHaveLength(1)
      command.child.kill(signal)
      await command.exited
      expect(await readdir(workspace.registry)).toEqual([])
      expect((await startRelay(workspace.root, port)).port).toBe(port)
    },
    30_000,
  )
})
