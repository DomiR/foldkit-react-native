import { Effect, Option } from 'effect'
import { Scene } from 'foldkit'
import { makeWebAnimationHost } from 'foldkit/strict/web'
import { fromString } from 'foldkit/url'
import { describe, test } from 'vitest'

import { makeShowcaseLayer } from './layer'
import { ShowcaseBlock } from './showcase'

const urlOrThrow = (raw: string) =>
  Option.getOrThrowWith(
    fromString(raw),
    () => new Error(`Failed to parse url: ${raw}`),
  )

const showcase = {
  block: ShowcaseBlock,
  layer: makeShowcaseLayer(makeWebAnimationHost()),
}

describe('embedded child Blocks', () => {
  test('the Counter strict view renders inside the showcase and updates its Block', () =>
    Effect.runPromise(
      Scene.scene(
        showcase,
        Scene.init(urlOrThrow('http://localhost/examples/counter')),
        Scene.expect(Scene.label('Count: 0')).toExist(),
        Scene.click(Scene.role('button', { name: 'Increment' })),
        Scene.click(Scene.role('button', { name: 'Increment' })),
        Scene.expect(Scene.label('Count: 2')).toExist(),
        Scene.click(Scene.role('button', { name: 'Decrement' })),
        Scene.expect(Scene.label('Count: 1')).toExist(),
      ),
    ))

  test('the Form strict view reports validation from its own Block', () =>
    Effect.runPromise(
      Scene.scene(
        showcase,
        Scene.init(urlOrThrow('http://localhost/examples/form')),
        Scene.type(Scene.label('Email'), 'not-an-email'),
        Scene.expect(
          Scene.text('Please enter a valid email address'),
        ).toExist(),
      ),
    ))
})
