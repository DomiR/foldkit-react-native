import { Array, Duration, Effect, Option, Schema, pipe } from 'effect'

import { startWebSocketBridge } from '../devTools/webSocketBridge.js'
import { DialogRuntime } from '../dom/dialogRuntime.js'
import { releaseDialogResources } from '../dom/dom.js'
import type { Document } from '../html/index.js'
import { fromString as urlFromString } from '../url/index.js'
import { makeBrowserDrainScheduler } from './browserDrainScheduler.js'
import { addNavigationEventListeners } from './browserListeners.js'
import { provideBrowserScheduler } from './browserScheduler.js'
import { applyDocumentMetadata } from './documentMetadata.js'
import { assertRuntimeId } from './hostContainer.js'
import {
  type DuplicateIdScanner,
  createDuplicateIdScanner,
} from './duplicateIdScanner.js'
import {
  type HydrationConfig,
  resolveHydrationHandoff,
} from './hydrationHandoff.js'
import {
  preserveModel,
  resolvePreservedModel,
} from './modelPreservationBridge.js'
import type { RuntimeHost } from './platform.js'
import { makePreserveScheduler } from './preserveScheduler.js'
import type { ResolvedViewTransition } from './renderer.js'
import {
  preserveScrollPosition,
  restorePreservedScrollPosition,
} from './scrollPreservation.js'
import {
  type ViewTransitionConfig,
  __resolveStartViewTransition,
} from './viewTransition.js'

/** The browser handoff consumed by the first render of a boot. @internal */
export type BrowserRendererState<Model, Message> = Readonly<{
  maybeHydrationRoot: Option.Option<HTMLElement>
  duplicateIdScanner: DuplicateIdScanner | undefined
  maybeResolvedViewTransition: Option.Option<
    ResolvedViewTransition<Model, Message>
  >
  applyMetadata: (view: Document, root: Node | undefined) => void
}>

/** Supplies browser navigation, hydration, dialog lifetimes, and development
 * Model and scroll preservation to the platform-independent core. @internal */
export const makeBrowserHost = <Model, Message>({
  runtimeId,
  container,
  hydration,
  manageDocument,
  preserveScroll,
  viewTransition,
}: Readonly<{
  runtimeId: string
  container: HTMLElement
  hydration: HydrationConfig | undefined
  manageDocument: boolean
  preserveScroll: boolean | undefined
  viewTransition: ViewTransitionConfig<Model, Message> | undefined
}>): RuntimeHost<Message, BrowserRendererState<Model, Message>> => {
  const duplicateIdScanner = import.meta.hot
    ? createDuplicateIdScanner()
    : undefined

  // NOTE: unconfigured transitions must not read DOM globals during construction.
  const maybeResolvedViewTransition = pipe(
    Option.fromNullishOr(viewTransition),
    Option.flatMap(decide =>
      Option.map(__resolveStartViewTransition(), startViewTransition => ({
        decide,
        startViewTransition,
        reducedMotionQuery: window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ),
      })),
    ),
  )

  const applyMetadata = (view: Document, root: Node | undefined): void => {
    if (manageDocument) {
      applyDocumentMetadata(view, root)
    }
  }

  const isPreserveScrollActive =
    preserveScroll !== false && manageDocument && !!import.meta.hot

  return {
    isDevelopment: !!import.meta.hot,
    isDevToolsDevelopment: () =>
      !!import.meta.hot && window.self === window.top,
    validateRuntime: Effect.sync(() => assertRuntimeId(runtimeId)),
    resolvePreservedModel: resolvePreservedModel(runtimeId),
    provideScheduler: provideBrowserScheduler,
    currentUrl: () => urlFromString(window.location.href),
    addNavigationListeners: addNavigationEventListeners,
    resolveBoot: context =>
      Effect.map(
        context.preparedHandoff === undefined
          ? resolveHydrationHandoff({ ...context, container, hydration })
          : Effect.succeed(context.preparedHandoff),
        ({ maybeHydrationRoot, resolveFlags }) => ({
          rendererState: {
            maybeHydrationRoot,
            duplicateIdScanner,
            maybeResolvedViewTransition,
            applyMetadata,
          },
          resolveFlags,
        }),
      ),
    makeDrainScheduler: makeBrowserDrainScheduler,
    makeRuntimeServices: () => {
      const dialogIds = new Set<string>()

      return {
        provideRuntime: effect =>
          Effect.provideService(effect, DialogRuntime, {
            register: id => {
              dialogIds.add(id)
            },
            unregister: id => {
              dialogIds.delete(id)
            },
          }),
        releaseRendererResources: Effect.suspend(() =>
          Effect.forEach(
            pipe(dialogIds, Array.fromIterable, Array.reverse),
            releaseDialogResources,
            { discard: true },
          ),
        ),
      }
    },
    makeModelPreserver: <Model>(encodeModel: (model: Model) => unknown) =>
      Effect.gen(function* () {
        const PRESERVE_DEBOUNCE = Duration.millis(200)
        const preserveScheduler = yield* makePreserveScheduler<Model>(
          {
            onDebounce: model =>
              Effect.sync(() =>
                preserveModel(runtimeId, encodeModel(model), false),
              ),
            onFlush: model =>
              Effect.sync(() =>
                preserveModel(runtimeId, encodeModel(model), true),
              ),
          },
          PRESERVE_DEBOUNCE,
        )

        const hot = import.meta.hot
        if (hot) {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              // NOTE: Vite reloads immediately after this callback. `flush`
              // must stay synchronous so the plugin receives the Model first.
              const handler = (): void => {
                Effect.runSync(preserveScheduler.flush)
              }
              hot.on('vite:beforeFullReload', handler)
              return handler
            }),
            handler =>
              Effect.sync(() => hot.off('vite:beforeFullReload', handler)),
          )
          yield* Effect.addFinalizer(() => preserveScheduler.cancel)
        }

        if (hot && isPreserveScrollActive) {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const handler = (): void => preserveScrollPosition(runtimeId)
              hot.on('vite:beforeFullReload', handler)
              return handler
            }),
            handler =>
              Effect.sync(() => hot.off('vite:beforeFullReload', handler)),
          )
        }

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => duplicateIdScanner?.cancel()),
        )

        return hot ? preserveScheduler.schedule : () => Effect.void
      }),
    afterInitialRender: isPreserveScrollActive
      ? restorePreservedScrollPosition(runtimeId)
      : Effect.void,
    connectDevTools: (store, prepareDispatch, devTools) => {
      const hot = import.meta.hot
      if (!hot) {
        return Effect.void
      }

      const maybeMessageSchema =
        devTools !== undefined && devTools !== false
          ? Option.fromNullishOr(devTools.dispatchSchema)
          : Option.none<Schema.Codec<any, any, never, never>>()

      return startWebSocketBridge(store, hot, maybeMessageSchema, prepareDispatch)
    },
  }
}
