import { Context, Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type Html, type HtmlBuilder, __htmlBuilder } from '../html/index.js'
import {
  clearRuntime,
  setRuntime,
  type DispatchSync,
} from '../html/runtimeSingleton.js'
import { defineMessageUnion } from '../message/index.js'
import { MountTracker } from '../mount/index.js'
import { propsModule } from '../propsModule.js'
import { Dispatch } from '../runtime/index.js'
import {
  attributesModule,
  classModule,
  datasetModule,
  eventListenersModule,
  init,
  styleModule,
  toVNode,
} from '../snabbdom/index.js'
import { FadeIn } from './animation.js'
import { mapMessages } from './mapMessages.js'
import { toStrictHtml } from './web.js'

const patch = init([
  attributesModule,
  classModule,
  datasetModule,
  eventListenersModule,
  propsModule,
  styleModule,
])

const ChildMessage = defineMessageUnion({ SubmittedChild: {} })
type ChildMessage = typeof ChildMessage.Type

const Message = defineMessageUnion({ Submitted: {}, SubmittedChild: {} })
type Message = typeof Message.Type

const render = (build: (h: HtmlBuilder<Message>) => Html): Element => {
  const vnode = build(__htmlBuilder<Message>())
  if (vnode === null) {
    throw new Error('render received a null VNode')
  }

  const result = patch(toVNode(document.createElement('div')), vnode)
  if (!(result.elm instanceof Element)) {
    throw new Error('expected rendered Element')
  }
  return result.elm
}

const textareaOf = (element: Element): HTMLTextAreaElement => {
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error('expected an HTMLTextAreaElement')
  }
  return element
}

let dispatched: Array<unknown>

beforeEach(() => {
  dispatched = []
  const dispatchSync: DispatchSync = message => {
    dispatched.push(message)
  }
  const dispatch = Dispatch.of({
    dispatchAsync: () => Effect.void,
    dispatchSync,
  })
  const context = Context.make(Dispatch, dispatch).pipe(
    Context.add(MountTracker, { started: () => {}, ended: () => {} }),
  )
  setRuntime(dispatchSync, context)
})

afterEach(() => {
  clearRuntime()
})

describe('strict textarea', () => {
  it('renders controlled textarea values, rows, and defaults', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.textarea([strict.Value('message'), strict.Rows(4)])
    })
    const textarea = textareaOf(element)

    expect(element.tagName).toBe('TEXTAREA')
    expect(textarea.value).toBe('message')
    expect(element.getAttribute('rows')).toBe('4')
    expect(element.getAttribute('type')).toBeNull()
    expect(textarea.style.resize).toBe('none')
  })

  it('does not prevent or dispatch textarea Enter', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.textarea([
        strict.Value('message'),
        strict.OnSubmitEditing(Message.Submitted()),
      ])
    })
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })

    document.body.appendChild(element)
    try {
      element.dispatchEvent(event)
    } finally {
      element.remove()
    }

    expect(event.defaultPrevented).toBe(false)
    expect(dispatched).toEqual([])
  })

  it('prevents default and dispatches on input Enter', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.input([strict.OnSubmitEditing(Message.Submitted())])
    })
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })

    document.body.appendChild(element)
    try {
      element.dispatchEvent(event)
    } finally {
      element.remove()
    }

    expect(event.defaultPrevented).toBe(true)
    expect(dispatched).toEqual([Message.Submitted()])
  })

  it('ignores Enter on a mapped textarea', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      const child = mapMessages(strict, (_message: ChildMessage) =>
        Message.SubmittedChild(),
      )
      return child.textarea([
        child.Value('hello'),
        child.OnSubmitEditing(ChildMessage.SubmittedChild()),
      ])
    })
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })

    document.body.appendChild(element)
    try {
      element.dispatchEvent(event)
    } finally {
      element.remove()
    }

    expect(event.defaultPrevented).toBe(false)
    expect(dispatched).toEqual([])
  })

  it('renders a bound textarea inside its wrapper', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.textarea([
        strict.Value('hello'),
        strict.Entering(FadeIn({})),
      ])
    })
    const textarea = element.querySelector('textarea')

    if (!(element instanceof HTMLElement)) {
      throw new Error('expected an HTMLElement wrapper')
    }

    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('expected a textarea inside the bound wrapper')
    }

    expect(element.tagName).toBe('DIV')
    expect(element.style.display).toBe('contents')
    expect(textarea.value).toBe('hello')
  })

  it('renders a keyed textarea', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.keyed('textarea')('message', [strict.Value('hello')])
    })

    expect(element.tagName).toBe('TEXTAREA')
  })
})
