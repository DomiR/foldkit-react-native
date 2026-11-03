import {
  __htmlBuilder as htmlBuilderFor,
  type Document,
  type HtmlBuilder,
} from '../html/index.js'
import type { BrowserRendererState } from './browserHost.js'
import type { CrashConfig } from './crashUI.js'
import type { RuntimeRenderer } from './platform.js'
import { makeRenderer } from './renderer.js'

/** Binds a browser container and view to the scoped renderer factory. @internal */
export const makeBrowserRenderer = <Model, Message>({
  container,
  view,
  crash,
}: Readonly<{
  container: HTMLElement
  view: (model: Model, h: HtmlBuilder<Message>) => Document
  crash: CrashConfig<Model, Message> | undefined
}>): RuntimeRenderer<Model, Message, BrowserRendererState<Model, Message>> => {
  const htmlBuilder = htmlBuilderFor<Message>()

  return context =>
    makeRenderer({
      ...context,
      ...context.hostState,
      container,
      view,
      htmlBuilder,
      crash,
    })
}
