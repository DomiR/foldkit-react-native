import type { Effect, Option, Schema } from 'effect'

import type { Document, HtmlBuilder } from '../html/index.js'
import type { ManagedResources } from '../managedResource/index.js'
import type { AnyMountHandler, LayeredMountDefinition } from '../mount/index.js'
import type { Ports } from '../port/index.js'
import type { Registrations } from '../subscription/subscription.js'
import type { Return as UpdateReturn } from '../update/index.js'
import type { Url } from '../url/index.js'
import { makeBrowserHost } from './browserHost.js'
import type { RoutingConfig } from './browserListeners.js'
import { makeBrowserRenderer } from './browserRenderer.js'
import type { CrashConfig } from './crashUI.js'
import type { RuntimeDevToolsConfig } from './devToolsConfig.js'
import type { HydrationConfig } from './hydrationHandoff.js'
import { type MakeRuntimeReturn, makeRuntime } from './runtime.js'
import type { SlowConfig } from './slowPhase.js'
import type { ViewTransitionConfig } from './viewTransition.js'

/** Full runtime configuration including Model Schema, Flags, init, update, view, and optional routing/stream config. */
export type RuntimeConfig<
  Model,
  Message,
  Flags,
  Resources = never,
  ManagedResourceServices = never,
  P extends Ports | undefined = undefined,
  Kind extends 'Application' | 'Element' = 'Application' | 'Element',
> = Readonly<{
  kind: Kind
  ports: P
  Model: Schema.Codec<Model, any, never, never>
  Flags: Schema.Codec<Flags, any, never, never>
  configuredFlags: Option.Option<Effect.Effect<Flags, never, Resources>>
  isFlagsRequired: boolean
  init: (
    flags: Flags,
    url?: Url,
  ) => UpdateReturn<Model, Message, Resources | ManagedResourceServices>
  update: (
    model: Model,
    message: Message,
  ) => UpdateReturn<Model, Message, Resources | ManagedResourceServices>
  view: (model: Model, h: HtmlBuilder<Message, AnyMountHandler>) => Document
  /**
   * Whether the runtime owns document-level state. When `true`, each render
   * applies the view's `title`, `canonical`, and `og:url` to the document
   * `<head>`. When `false`, the runtime is scoped to its container and never
   * touches the `<head>`, so an app can be embedded at a node without
   * clobbering the host page's metadata. `makeApplication` sets this to `true`;
   * `makeElement` sets it to `false`.
   */
  manageDocument: boolean
  subscriptions?: Registrations<
    Model,
    Message,
    Resources | ManagedResourceServices
  >
  mounts?: ReadonlyArray<LayeredMountDefinition>
  container: HTMLElement
  /**
   * Present when `makeApplication` found a server-rendered root stamped with
   * `data-foldkit-app`. The first render then adopts that DOM in place
   * instead of replacing it, and when the config declares Flags, `init` is
   * fed the Schema-decoded Flags payload the server embedded, so both sides
   * compute the same Model. Missing or undecodable handoff data is fatal.
   * A Model restored after a development reload gets a fresh replace boot
   * against the stamped root because the restored code may no longer match the
   * served DOM.
   */
  hydration?: HydrationConfig
  routing?: RoutingConfig<Message>
  crash?: CrashConfig<Model, Message>
  slow?: SlowConfig<Model, Message>
  /**
   * Wraps qualifying renders in `document.startViewTransition` so the browser
   * animates between the old and new DOM states. Return `false` for a plain
   * render, `true` to transition, or `{ types }` to tag the transition for
   * `:active-view-transition-type(...)` CSS scoping.
   *
   * The predicate runs after `update` and before the render it is deciding
   * about, and receives both states: `context.previousModel` is the Model
   * behind the DOM on screen, `context.model` is the one the render will
   * paint. Comparing the two is how a predicate derives direction without the
   * application keeping route history in its Model.
   *
   * Renders fall through to the plain path when the browser lacks the API,
   * when `prefers-reduced-motion: reduce` is set, and during DevTools replay,
   * crash, and initial renders.
   *
   * Defaults to `undefined`: no render is wrapped in a transition, and the
   * runtime resolves nothing about the browser's support for them.
   */
  viewTransition?: ViewTransitionConfig<Model, Message>
  /**
   * Deep-freezes the Model after `init` and after every `update`, so accidental
   * mutations (e.g. `model.items.push(...)`) throw a `TypeError` at the exact
   * write site with a stack trace, rather than silently corrupting state or
   * breaking reference-equality change detection.
   *
   * Defaults to `true`. Activates only under Vite's dev server, so production
   * builds pay nothing. Pass `false` to disable.
   *
   * Scope: only the Model is frozen. Messages are short-lived and are not
   * frozen.
   */
  freezeModel?: boolean
  /**
   * Restores the window scroll position across Vite dev reloads. Every edit
   * triggers a full page reload, which resets scroll to the top; this captures
   * `window.scrollX`/`scrollY` just before the reload and reapplies it once the
   * restored view has rendered, so editing a page you've scrolled deep into
   * doesn't bounce you back to the top on every save.
   *
   * Defaults to `true`. Activates only under Vite's dev server and the
   * runtime owns the document, so production builds and embedded `makeElement`
   * apps (which do not own the page's scroll) pay nothing. Pass `false` to
   * disable, for an app that drives its own scroll restoration.
   *
   * Scope: only the window scroll offset is preserved. Scroll positions of
   * nested `overflow` containers are not.
   */
  preserveScroll?: boolean
  /**
   * Model-driven handle registrations collected from the completed Block
   * graph. The Runtime acquires and releases handles as their requirements
   * change. Features declare local registries with `managedResources`;
   * registered child bindings supply their occurrence-scoped registrations.
   */
  managedResources?: ManagedResources<Model, Message, ManagedResourceServices>
  devTools?: RuntimeDevToolsConfig
}>

/** Configures the browser host and renderer for a Foldkit runtime. @internal */
export const makeBrowserRuntime = <
  Model,
  Message,
  Flags,
  Resources,
  ManagedResourceServices,
  P extends Ports | undefined,
  Kind extends 'Application' | 'Element',
>(
  config: RuntimeConfig<
    Model,
    Message,
    Flags,
    Resources,
    ManagedResourceServices,
    P,
    Kind
  >,
): MakeRuntimeReturn<P, Flags, Resources, Kind> => {
  const {
    container,
    hydration,
    manageDocument,
    preserveScroll,
    viewTransition,
  } = config
  const runtimeId =
    hydration !== undefined && hydration.runtimeId !== ''
      ? hydration.runtimeId
      : (container?.id ?? '')
  const host = makeBrowserHost<Model, Message>({
    runtimeId,
    container,
    hydration,
    manageDocument,
    preserveScroll,
    viewTransition,
  })
  const renderer = makeBrowserRenderer({
    container,
    view: config.view,
    crash: config.crash,
    mounts: config.mounts ?? [],
  })

  return makeRuntime({ ...config, runtimeId, host, renderer })
}
