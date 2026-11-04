import { Effect } from 'effect'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readNativeRelayOptions } from '../src/nativeRelayOptions.ts'
import { spawnRelayCommand, startRelay } from './nativeRelayFixtures.ts'
import { useWorkspace } from './relayFixtures.ts'

describe('native relay options', () => {
  const workspace = useWorkspace()

  it('uses the current root and port 9989 by default', async () => {
    expect(
      await Effect.runPromise(readNativeRelayOptions([], workspace.root)),
    ).toEqual({
      _tag: 'Start',
      projectRoot: workspace.root,
      port: 9989,
    })
  })

  it('accepts explicit project roots and port limits', async () => {
    for (const port of ['1', '65535']) {
      expect(
        await Effect.runPromise(
          readNativeRelayOptions(
            ['--project-root', '.', '--port', port],
            workspace.root,
          ),
        ),
      ).toEqual({
        _tag: 'Start',
        projectRoot: workspace.root,
        port: globalThis.Number(port),
      })
    }
  })

  it.each([
    ['--port'],
    ['--project-root'],
    ['--port', '--help'],
    ['--project-root', ''],
    ['--host', 'localhost'],
    ['unexpected'],
    ['--port', '0'],
    ['--port', '-1'],
    ['--port', '65536'],
    ['--port', '1.5'],
    ['--port', '1e3'],
    ['--port', 'NaN'],
  ])('rejects invalid arguments %j', async (...args) => {
    await expect(
      Effect.runPromise(readNativeRelayOptions(args, workspace.root)),
    ).rejects.toThrow()
  })

  it('rejects a missing project root', async () => {
    await expect(
      Effect.runPromise(
        readNativeRelayOptions([
          '--project-root',
          join(workspace.root, 'missing'),
        ]),
      ),
    ).rejects.toThrow('existing directory')
  })

  it('rejects port 80 because WebSocket URL normalization prevents discovery', async () => {
    await expect(
      Effect.runPromise(
        readNativeRelayOptions(['--port', '80'], workspace.root),
      ),
    ).rejects.toThrow(
      'Port 80 cannot be used for native relay discovery because WebSocket URLs omit the default port. Choose another port.',
    )
  })

  it('rejects a file used as the project root', async () => {
    const path = join(workspace.root, 'file')
    await writeFile(path, '')
    await expect(
      Effect.runPromise(readNativeRelayOptions(['--project-root', path])),
    ).rejects.toThrow('existing directory')
  })

  it('returns help without requiring a project directory or starting a listener', async () => {
    expect(
      await Effect.runPromise(
        readNativeRelayOptions(['--help'], '/missing/foldkit-project'),
      ),
    ).toEqual({ _tag: 'Help' })
  })

  it('fails on an occupied port instead of selecting another', async () => {
    const relay = await startRelay(workspace.root)
    await expect(startRelay(workspace.root, relay.port)).rejects.toThrow(
      'port must be available',
    )
  })

  it('prints help and exits without publishing a relay', async () => {
    const command = spawnRelayCommand(workspace.root, ['--help'])
    expect(await command.exited).toBe(0)
    expect(command.output.join('')).toContain(
      'Usage: foldkit-devtools-mcp relay',
    )
    expect(await readdir(workspace.registry)).toEqual([])
  })

  it('exits nonzero with a message for an unknown flag', async () => {
    const command = spawnRelayCommand(workspace.root, ['--unknown'])
    expect(await command.exited).not.toBe(0)
    expect(command.output.join('')).toContain('Unknown relay option')
    expect(await readdir(workspace.registry)).toEqual([])
  })
})
