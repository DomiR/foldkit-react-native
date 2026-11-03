# Proposal: React Native support for Foldkit

Status: experimental branch spike, covering five commits in `a471adb24..HEAD`. In landing order, those commits are:

- `95111f567`, `feat(foldkit): split the runtime into browser and portable runtime-core layers`. The platform contract is in `packages/foldkit/src/runtime/platform.ts`.
- `0bf1bd732`, `feat(foldkit): add strict views for portable rendering`. The shared builder is in `packages/foldkit/src/strict/strict.ts`.
- `d94c024ca`, `feat(counter,form,stopwatch,todo): expose program and strict view modules`. The module boundaries are exported by `examples/counter/package.json`, `examples/form/package.json`, `examples/stopwatch/package.json`, and `examples/todo/package.json`.
- `882e28b8b`, `feat(strict-showcase): add web showcase for strict views`. The web entry is `examples/strict-showcase/src/entry.ts`.
- `2bea3ec33`, `feat: add @foldkit/native renderer and the native-showcase Expo example`. The native entry is `examples/native-showcase/App.tsx`.

## Overview

This proposal adds a path for one Foldkit program to render on the web and on iOS or Android through a host-neutral strict view. The shared program keeps application state in its Model and processes Messages through update; its Commands and Subscriptions use services supplied by the host. The two showcases use the same program and `showcaseStrictView`, with separate startup wiring in `examples/strict-showcase/src/entry.ts` and `examples/native-showcase/App.tsx`; their shared definitions are in `examples/strict-showcase/src/showcase.ts` and `examples/strict-showcase/src/showcaseStrictView.ts`.

This document lives in `proposals/` because it asks maintainers to decide whether and how to accept unshipped experimental work. Website pages under `packages/website/src/page/` describe shipped behavior; the existing application startup contract is documented in `packages/website/src/page/core/runtime.md`. Keeping this decision document at the repository root avoids presenting the proposed native contract as part of that guidance.

## Motivation and goals

The concrete use case is sharing application behavior and a constrained view across browser and native hosts. The branch separates four existing examples into reusable program modules with additional strict views, while their `main.ts` files provide their browser views:

- Counter: `examples/counter/src/program.ts`, `examples/counter/src/strictView.ts`, and `examples/counter/src/main.ts`.
- Form: `examples/form/src/program.ts`, `examples/form/src/strictView.ts`, and `examples/form/src/main.ts`.
- Stopwatch: `examples/stopwatch/src/program.ts`, `examples/stopwatch/src/strictView.ts`, and `examples/stopwatch/src/main.ts`.
- Todo: `examples/todo/src/program.ts`, `examples/todo/src/strictView.ts`, and `examples/todo/src/main.ts`.

The proposed goals are:

- Reuse Foldkit's update loop and scoped effect execution across hosts. The extraction puts platform operations behind `RuntimeHost` and `RuntimeRenderer` in `packages/foldkit/src/runtime/platform.ts`, consumed by `makeRuntime` in `packages/foldkit/src/runtime/runtime.ts`.
- Let a shared view describe portable UI without importing React Native or browser types. `StrictView` in `packages/foldkit/src/strict/strict.ts` abstracts over both the node and attribute representation.
- Make platform dependencies explicit at startup. Todo's `SaveTodos` uses Effect's `KeyValueStore` service in `examples/todo/src/program.ts`; the web showcase supplies localStorage in `examples/strict-showcase/src/entry.ts`, while `examples/native-showcase/App.tsx` supplies `KeyValueStore.layerMemory` and `Option.none()` for stored todos. The native example therefore does not demonstrate persistence across app restarts.

The explicit non-goals are:

- Replacing `foldkit/html`. Its export is retained in `packages/foldkit/package.json`, and the strict web adapter consumes the existing `HtmlBuilder` in `packages/foldkit/src/strict/web.ts`.
- Providing a React compatibility layer for Foldkit application code. React interprets native node descriptions in `packages/native/src/react.tsx`; shared application state transitions live in `examples/strict-showcase/src/showcase.ts`.
- Making arbitrary browser views or DOM effects portable. `StrictHtmlBuilder` exposes a limited vocabulary in `packages/foldkit/src/strict/strict.ts`, and the native host has no browser navigation integration in `packages/native/src/host.ts`.

## What changes in core

### Public surface added

`packages/foldkit/package.json` adds three subpath exports with JavaScript and declaration targets under `dist`. Their contracts are marked experimental in the defining modules, so accepting them should not imply a stable platform API.

| Entry                  | Exported surface                                                                                                                                                               | Grounding                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `foldkit/runtime-core` | `makeRuntimeCore`; the runtime configuration and platform types; `DrainScheduler`                                                                                              | `packages/foldkit/src/runtime-core/public.ts`, `packages/foldkit/src/runtime-core/index.ts` |
| `foldkit/strict`       | The strict builder and view types; style and tag Schemas; navigation descriptions; gesture constructors and Schemas; animation services and descriptions; icons; `mapMessages` | `packages/foldkit/src/strict/public.ts`                                                     |
| `foldkit/strict/web`   | `toStrictHtml`, `makeWebAnimationHost`, and the `WebAnimationHost` type                                                                                                        | `packages/foldkit/src/strict/web.ts`, `packages/foldkit/src/strict/webAnimation.ts`         |

`makeRuntimeCore` is a re-export alias of `makeRuntime`, not a second runtime implementation (`packages/foldkit/src/runtime-core/index.ts`). The public platform types cover these groups:

- Runtime configuration and scheduling: `RuntimeCoreConfig`, `RuntimeCrashConfig`, and `DrainScheduler` (`packages/foldkit/src/runtime/runtime.ts`, `packages/foldkit/src/runtime/platform.ts`, `packages/foldkit/src/runtime/drainScheduler.ts`).
- Rendering: `RendererContext`, `RendererHandle`, and `RuntimeRenderer` (`packages/foldkit/src/runtime/platform.ts`).
- Host lifecycle and boot: `BootMode`, `RuntimeBoot`, `RuntimeBootContext`, `RuntimeHost`, and `RuntimeHostServices` (`packages/foldkit/src/runtime/platform.ts`).

Five changesets each request a minor release of `foldkit`:

- Runtime core: `.changeset/native-runtime-core.md`.
- Strict views and the web adapter: `.changeset/portable-strict-views.md`.
- Navigation and gestures: `.changeset/strict-navigation-gestures.md`.
- Navigation bodies and icons: `.changeset/strict-navigation-bodies-icons.md`.
- Animation and worklets: `.changeset/strict-animations-worklets.md`.

The native package and both showcase packages are ignored by Changesets in `.changeset/config.json`. These changesets do not schedule publication of `@foldkit/native`.

### What stays the same for web applications

Existing web consumers do not need to change their code to use the extracted runtime. The existing export-map entries are unchanged in `packages/foldkit/package.json`, and the public runtime barrels are unchanged across this range in `packages/foldkit/src/runtime/public.ts` and `packages/foldkit/src/runtime/index.ts`. The root barrel does not add the strict or runtime-core entries (`packages/foldkit/src/index.ts`). This is source-level compatibility evidence, not a claim that regression checks passed.

`makeApplication` and `makeElement` retain their public configuration APIs and delegate to `makeBrowserRuntime`. That function constructs the browser host and renderer before calling the shared runtime (`packages/foldkit/src/runtime/makeApplication.ts`, `packages/foldkit/src/runtime/makeElement.ts`, `packages/foldkit/src/runtime/browserRuntime.ts`). Adopting a strict view is optional.

The Todo example does change its own dependency wiring: its program receives `KeyValueStore` as a service, and its browser entry now supplies `BrowserKeyValueStore.layerLocalStorage`. That is part of extracting this example for reuse, not a migration imposed on all web consumers (`examples/todo/src/program.ts`, `examples/todo/src/entry.ts`).

## The renderer and host split

The core owns the application loop; the renderer owns painting; the host owns platform services. `makeRuntime` processes Messages through update and executes returned Commands in the runtime scope. It also connects Model changes to Subscription and ManagedResource lifetimes (`packages/foldkit/src/runtime/runtime.ts`, especially `processMessagePlain`, `forkCommand`, and the scoped startup body).

`RuntimeRenderer` is a scoped factory receiving `RendererContext` and returning `RendererHandle`. Its handle supplies rendering and crash operations alongside frame scheduling. It also carries the bridge needed for DevTools replay and a hook for skipping pending view transitions. The contract requires a crash to set runtime status before painting, and scheduled frames to stop after crash or disposal (`packages/foldkit/src/runtime/platform.ts`, `RendererHandle` and `RuntimeRenderer`).

`RuntimeHost` supplies the platform operations that do not belong to the update loop. For example:

- Boot and optional hydration handoff through `resolveBoot`, with `HostState` passed to the renderer.
- Scheduling through `provideScheduler` and `makeDrainScheduler`.
- URL access and navigation listeners through `currentUrl` and `addNavigationListeners`.
- Runtime services and renderer resource release through `makeRuntimeServices`.
- Development Model preservation and DevTools connection through `makeModelPreserver` and `connectDevTools`.

Those fields and their lifetimes are defined in `packages/foldkit/src/runtime/platform.ts`. The core config requires a host and renderer instead of a browser container and view. It retains `routing`, `slow`, `freezeModel`, and `devTools`, so this is a portable execution boundary with some browser-shaped concepts in its public types (`packages/foldkit/src/runtime/runtime.ts`, `RuntimeCoreConfig`).

The browser `RuntimeConfig` additionally owns these browser-specific inputs:

- `container` and `view`.
- `hydration` and `manageDocument`.
- `preserveScroll` and `viewTransition`.

`makeBrowserRuntime` assembles them in `packages/foldkit/src/runtime/browserRuntime.ts`. The browser implementations divide the work as follows:

- `makeBrowserHost` handles browser boot and development services. `BrowserRendererState` carries the hydration root and rendering metadata handoff (`packages/foldkit/src/runtime/browserHost.ts`).
- `makeBrowserRenderer` binds the existing HTML renderer to its container and view (`packages/foldkit/src/runtime/browserRenderer.ts`).
- `makeBrowserDrainScheduler` supplies a reusable `MessageChannel` boundary for deferred queue drains (`packages/foldkit/src/runtime/browserDrainScheduler.ts`).

The resulting layers are shown below. The browser path is assembled in `packages/foldkit/src/runtime/browserRuntime.ts`; the native path is assembled in `packages/native/src/runtime.ts` and interpreted in `packages/native/src/react.tsx`.

```text
                   Shared program and strict view
                                |
                  Foldkit runtime core + host
                       /                  \
          Browser renderer              Native renderer
          toStrictHtml                  NativeNode snapshots
                 |                             |
          Foldkit HTML renderer          FoldkitRoot / React
                 |                             |
                DOM                       React Native
```

## foldkit/strict design

A strict view is a function from a Model and a host-neutral builder to a node. Its generic `Node` and `Attribute` parameters prevent a view typed as `StrictView<Model, Message>` from depending on either adapter's concrete node representation (`packages/foldkit/src/strict/strict.ts`, `StrictView`).

The tag subset contains twelve HTML names, grouped here by their native interpretation:

- Containers: `div`, `ul`, and `li`.
- Text: `span`, `p`, `h1`, `h2`, `h3`, and `label`.
- Controls and images: `button`, `input`, and `img`.

The complete tag Schema is `StrictTag` in `packages/foldkit/src/strict/strict.ts`; the native interpretation is `renderElement` in `packages/native/src/react.tsx`. `keyed` identifies repeated entities, and `empty` represents omitted content. `Checked` selects a boolean input whose toggle reports `OnClick`; other inputs use `Value` and `OnInput` (`packages/foldkit/src/strict/strict.ts`, `StrictHtmlBuilder`).

`StrictStyle` is a Schema for a constrained style record with React Native layout semantics. Numeric lengths represent density-independent pixels and become CSS pixels on the web. The Schema also describes transforms and CSS-style transitions, with millisecond timing values converted by the web adapter (`packages/foldkit/src/strict/strict.ts`, `StrictStyle` and `StrictTransform`; `packages/foldkit/src/strict/webStyle.ts`, `toCssProperties`).

The builder adds portable interaction descriptions:

- Navigation uses keyed `screen` descriptions inside `stack`, and keyed `tab` descriptions inside `tabs`. `Title` labels navigation chrome, `OnDismissed` reports a dismissal count, and `SelectedTab` pairs with `OnSelectTab` (`packages/foldkit/src/strict/strict.ts`).
- Gestures describe `Tap`, `LongPress`, `Pan`, and `Swipe`. A completed pan reports translation and velocity through `PanEnd`; optional `trackX` and `trackY` bind movement to host-owned animated values (`packages/foldkit/src/strict/gesture.ts`).
- Animation descriptions include `Entering` and `Exiting`, while `AnimatedStyle` maps a keyed animated number to styles. Commands use the `AnimatedValues` service for animation or assignment, and `BackgroundRuntime` for worklet computation (`packages/foldkit/src/strict/animation.ts`, `packages/foldkit/src/strict/strict.ts`).
- `StrictIcon` describes an iOS symbol with optional platform alternatives. `TabIcon` attaches it to a tab (`packages/foldkit/src/strict/icon.ts`, `packages/foldkit/src/strict/strict.ts`).
- `mapMessages` gives a child view a builder that lifts its event and gesture Messages into the parent's Message type (`packages/foldkit/src/strict/mapMessages.ts`).

The web adapter supplies layout resets and its own navigation chrome. A stack renders its last screen with a back button when dismissal is available; tabs render the selected body and a tab bar. `OnSubmitEditing` maps Enter through `OnKeyDownPreventDefault`, not through form submission (`packages/foldkit/src/strict/web.ts`, `toStrictHtml`). Bound elements use one scoped Mount for gesture and animation bindings, with listener cleanup when that Mount releases (`packages/foldkit/src/strict/webBindings.ts`, `renderStrictElement`).

### Why a strict HTML subset rather than new primitives

The proposed vocabulary lets Foldkit users reuse the shape of an HTML view while choosing a smaller contract that both hosts implement. The branch demonstrates that choice directly: `examples/counter/src/strictView.ts` uses familiar element builders, and both `toStrictHtml` in `packages/foldkit/src/strict/web.ts` and `makeNativeBuilder` in `packages/native/src/builder.ts` implement `StrictHtmlBuilder`.

This is a design choice for maintainers to accept or revise. Separate native primitive names would make platform differences more visible, but would require a different shared view vocabulary. The current names convey portable intent rather than full HTML semantics; a native `input` with `Checked` becomes a switch (`packages/native/src/react.tsx`, `renderElement`).

### Tradeoffs

- The subset cannot express the full browser builder. It has no `Class` or arbitrary DOM attributes, so shared views use the typed style and event surface instead (`packages/foldkit/src/strict/strict.ts`, `StrictHtmlBuilder`).
- Web appearance follows adapter defaults. Layout resets and navigation chrome are installed by `toStrictHtml`, so a strict view does not inherit ordinary browser element defaults unchanged (`packages/foldkit/src/strict/web.ts`).
- Gesture bindings affect browser interaction on the bound element: the adapter applies `touch-action: none` and `user-select: none` when gestures are present (`packages/foldkit/src/strict/webBindings.ts`).
- `Exiting` does not delay web removal. The web binding implementation supports entering keyframes but has no exit-retention lifecycle (`packages/foldkit/src/strict/web.ts`, `toStrictHtml` documentation; `packages/foldkit/src/strict/webBindings.ts`, `Bindings`).
- Shared view source does not imply identical rendering or execution. Web stack rendering selects the last screen, while native navigation renders the screen collection; web background work executes on the main thread (`packages/foldkit/src/strict/web.ts`, `packages/native/src/navigation.tsx`, `packages/foldkit/src/strict/webAnimation.ts`).

## Native package architecture

### Program and rendering

`makeNativeProgram` starts the shared core and exposes a native node store. Its renderer evaluates the configured view and publishes `NativeNode` snapshots, notifying subscribers after publication. Subsequent dirty Models schedule a frame with `requestAnimationFrame`; `getModel` reads live state, while `getSnapshot` and `render` read the latest published frame (`packages/native/src/runtime.ts`).

The core is configured as an `Element` with `Schema.Void` Flags and no Ports, and DevTools is disabled. The animation service Layer is merged with application resources, while optional Subscriptions and ManagedResources are forwarded to the core. `dispose` interrupts the runtime fiber (`packages/native/src/runtime.ts`, `makeNativeProgram`). The Model Schema is optional here, with a permissive `Schema.declare` fallback; `makeApplication` requires a Model Schema (`packages/native/src/runtime.ts`, `NativeProgramConfig`; `packages/foldkit/src/runtime/makeApplication.ts`, `BaseApplicationConfig`).

`FoldkitRoot` subscribes through React's `useSyncExternalStore` and renders the snapshot inside a `GestureHandlerRootView`. React holds adapter state, while Foldkit owns the application Model (`packages/native/src/react.tsx`, `FoldkitRoot`). The tag mapping is:

| Strict tag                             | Native interpretation                                      |
| -------------------------------------- | ---------------------------------------------------------- |
| `div`, `ul`, `li`                      | `View`, or `Pressable` when `OnClick` is present           |
| `span`, `p`, `h1`, `h2`, `h3`, `label` | `Text`; heading tags receive the header accessibility role |
| `button`                               | `Pressable` with the button accessibility role             |
| `input` with `Checked`                 | `Switch`                                                   |
| Other `input`                          | `NativeTextInput`, wrapping React Native `TextInput`       |
| `img`                                  | `Image` with a URI source                                  |

These mappings and text-style propagation are implemented in `packages/native/src/react.tsx`, primarily `renderElement` and `splitStyle`.

### Navigation and input

Native navigation uses `ScreenStack` and `ScreenStackItem` from `react-native-screens`. Screen keys come from strict descriptions, and the stack reports dismissal counts as Messages. Tabs use `Tabs.Host` with a Model-derived selection request and `preventNativeSelection={true}`; selection attempts dispatch through `OnSelectTab` (`packages/native/src/navigation.tsx`, `NativeStack` and `NativeTabs`).

Text input has a revision protocol to prevent an older rendered frame from replacing a newer native edit. Each edit advances a runtime revision; `makeNativeBuilder` stamps input nodes with the latest revision. `NativeTextInput` retains native text until a frame reaches that revision, then accepts the Model value, including a clear (`packages/native/src/runtime.ts`, `recordInputEvent`; `packages/native/src/builder.ts`, `buildElement`; `packages/native/src/textInput.tsx`, `NativeTextInput`).

Tab icons use SF Symbols on iOS. On Android, `materialSymbol` is checked against `MaterialIcons.glyphMap` and rasterized through `@expo/vector-icons` using `getImageSource`; the resulting image source is passed to native tabs. Android does not render the name directly, which explains the narrower statement in the `StrictIcon` documentation (`packages/native/src/navigation.tsx`, `packages/native/src/tabIcons.ts`, `packages/foldkit/src/strict/icon.ts`).

### Gestures and animation

The package depends on Gesture Handler 3 and uses its hook-based recognizers. Its composition gives long press priority, combines pan and swipe, and dispatches recognized facts to Foldkit. Tracked pans update animated values on the UI thread and schedule the completed pan Message back onto the React Native runtime (`packages/native/package.json`, `packages/native/src/gestures.tsx`, especially `ComposedGestures` and `TrackedPanBridge`).

Reanimated 4 supplies shared values and the native animation implementations. `makeNativeAnimationHost` maintains a registry keyed by animated value name and lazily creates one background worklet runtime. `NativeAnimatedElement` installs style mappers and maps layout descriptions to Reanimated animations (`packages/native/package.json`, `packages/native/src/animationHost.ts`, `packages/native/src/animated.tsx`).

Worklet functions must have serializable inputs and captures, and begin with the worklet directive (`packages/foldkit/src/strict/animation.ts`, `AnimatedStyleBinding` and `BackgroundRuntime`). The Expo example uses `babel-preset-expo`; its Babel configuration is the native compilation path, while the web showcase uses Vite and its background fallback invokes the function as ordinary JavaScript (`examples/native-showcase/babel.config.js`, `examples/strict-showcase/vite.config.ts`, `packages/foldkit/src/strict/webAnimation.ts`).

### Host and publication

`makeNativeHost` provides a timer-based deferred drain scheduler. It returns no current URL, installs no navigation listeners, and rejects hydration. It also disables development mode and provides no Model preservation or DevTools connection (`packages/native/src/host.ts`). These are limits of this host implementation, not promises that every capability of `RuntimeHost` is implemented on native.

`@foldkit/native` is a private workspace package at version `0.0.0`, exporting its raw TypeScript source entry, `packages/native/src/index.ts`. It has a typecheck script but no package build or publication setup, and Changesets ignores it (`packages/native/package.json`, `.changeset/config.json`). Its public barrel exposes the builder and node types alongside `makeNativeProgram`, `FoldkitRoot`, and the animation host (`packages/native/src/index.ts`). Publication requires a separate decision and packaging work.

## How Elm Architecture principles are preserved

Application state follows the Foldkit loop. Events enqueue Messages, update returns the next Model and Commands, and the runtime executes those Commands before enqueueing their results. Subscriptions feed the same queue (`packages/foldkit/src/runtime/runtime.ts`, `processMessagePlain`, `forkCommand`, and `forkSubscriptionFibers` usage). Native event handlers call `dispatch`; they do not receive a Model setter (`packages/native/src/react.tsx`).

Messages record facts rather than imperative UI instructions. For example: `DismissedScreens` records a dismissal count, and `EndedCardPan` records the completed pan. The showcase's update function decides how those facts change application state (`examples/strict-showcase/src/showcase.ts`). Child programs are connected through `Update.foldChild`, and their view events are lifted through `mapMessages` (`examples/strict-showcase/src/showcase.ts`, `examples/strict-showcase/src/showcaseStrictView.ts`).

The proposed boundary is that the Model remains the source of truth for application decisions, while host state represents presentation and in-flight input. Application side effects belong in Commands, with ongoing sources handled by Subscriptions and resource lifetimes handled by ManagedResources. The following exceptions and tensions need explicit acceptance:

- **Animated values.** Shared values never enter the Model, and a tracked pan changes them without one Message per frame. The example puts the dismissal decision in update, returns `AnimateCard`, and accepts `CompletedAnimateCard` only for the current request ID. This keeps application decisions in the Model, but does not make every visible frame reconstructible from it (`packages/foldkit/src/strict/animation.ts`, `packages/native/src/gestures.tsx`, `examples/strict-showcase/src/animations/program.ts`).
- **Native dismissal.** Swipe-back can dismiss a screen before update processes the resulting Message because `preventNativeDismiss` is false. The Model catches up from `onDismissed`; the showcase removes the reported number of screens while retaining its root. A dismissible screen therefore cannot assume that update may veto an already completed dismissal. A future veto policy needs a different adapter contract (`packages/native/src/navigation.tsx`, `NativeStack`; `examples/strict-showcase/src/showcase.ts`, `DismissedScreens`).
- **Retained text.** `NativeTextInput` temporarily owns the latest native text while an older Model frame is pending. The revision protocol bounds that ownership: a sufficiently recent frame makes the Model value authoritative. It is an input synchronization mechanism, not a second application form Model (`packages/native/src/textInput.tsx`).
- **Background worklets.** Computation runs outside the main application runtime, but the calling Command owns the result Message. `CountPrimes` catches failure and returns `FailedCountPrimes`; update stores success or failure in the Model. Worklets should remain serializable computations, without hidden application state or direct Model mutation (`packages/foldkit/src/strict/animation.ts`, `BackgroundRuntime`; `examples/strict-showcase/src/animations/program.ts`, `CountPrimes`).

## Verification

### Manual exercise

The branch author reports running `examples/native-showcase` manually on iOS and Android simulators. The exercised areas were:

- Navigation.
- Gestures.
- Animations.
- Text input.
- Tab icons.

There is no automated record of those runs. This is author-reported validation, not a result established by the source files. The application exercised is wired in `examples/native-showcase/App.tsx`; its Expo dependencies are declared in `examples/native-showcase/package.json`. No typecheck or test pass is claimed here.

### Existing checks

The existing CI workflow has a full-workspace typecheck job step and an affected-package alternative. The native package and both showcases are workspace members with typecheck scripts, so those steps are the existing route for checking their TypeScript when selected (`.github/workflows/ci.yml`, steps `Typecheck` and `Typecheck affected packages`; `pnpm-workspace.yaml`; `packages/native/package.json`; `examples/native-showcase/package.json`; `examples/strict-showcase/package.json`). The workflow also has full and affected-package test steps; their presence is configuration evidence, not an execution result (`.github/workflows/ci.yml`, steps `Test` and `Test affected packages`).

Existing runtime tests provide a browser regression net around the extraction. For example:

- Message order and deferred drains are exercised in `packages/foldkit/src/runtime/messageProcessing.test.ts`.
- Embedded runtime disposal and Subscription cleanup are exercised in `packages/foldkit/src/runtime/embed.test.ts`.
- Hydration handoff and refusal cases are exercised in `packages/foldkit/src/runtime/hydrateBoot.test.ts`.
- ManagedResource acquisition and release are exercised in `packages/foldkit/src/runtime/managedResourceLifecycle.test.ts`.

### Missing coverage

These gaps exist:

- There are no test files under `packages/foldkit/src/strict/` or `packages/foldkit/src/runtime-core/`.
- There are no test files under `packages/native/`. Its renderer and native host, along with the navigation and input protocols, therefore have no dedicated tests in that package.
- There are no test files under `examples/strict-showcase/` or `examples/native-showcase/`, and neither has a matching spec in `packages/examples-e2e/e2e/`.
- Runtime test sources under `packages/foldkit/src/runtime/` do not reference `platform`, `makeBrowserHost`, or `makeRuntimeCore`. Existing browser tests exercise the integrated runtime, rather than directly testing the new platform boundary.

Before acceptance, add focused tests for the new contracts and record simulator scenarios with results. Typechecking cannot establish native gesture ordering or text-input synchronization.

## Known gaps

- **Deep links.** The native host returns `Option.none` from `currentUrl` and installs no navigation listeners. `NativeProgramConfig` has no routing option. Strict stacks and tabs therefore do not provide deep-link handling (`packages/native/src/host.ts`, `packages/native/src/runtime.ts`).
- **Mount on native.** Neither `StrictHtmlBuilder` nor `NativeBuilder` exposes Mount operations. The native node representation has no Mount lifecycle field; the web adapter's internal Mount is a browser implementation detail (`packages/foldkit/src/strict/strict.ts`, `packages/native/src/builder.ts`, `packages/native/src/node.ts`, `packages/foldkit/src/strict/webBindings.ts`).
- **DevTools on native.** `makeNativeProgram` sets `devTools: false`, its replay bridge does nothing, and `makeNativeHost.connectDevTools` returns an empty Effect. The shared core's DevTools machinery does not amount to a native DevTools integration (`packages/native/src/runtime.ts`, `packages/native/src/host.ts`).
- **Web exit animations.** `Exiting` is accepted as a description but does not retain an element for removal animation (`packages/foldkit/src/strict/web.ts`, `packages/foldkit/src/strict/webBindings.ts`).
- **Web Worker BackgroundRuntime.** The web service schedules two animation frames and then invokes the worklet on the main thread. It has no Web Worker implementation, so expensive work can block subsequent UI work (`packages/foldkit/src/strict/webAnimation.ts`, `background.run`).
- **Metro branch identity.** The Vite plugin brands view results with function identity, but the Expo Metro and Babel configurations install no equivalent transform. Native node descriptions and their React interpreter do not carry that branded identity contract; native reconciliation uses component types and positions with explicit keys where supplied (`packages/vite-plugin-foldkit/src/viewIdentity.ts`, `transformViewIdentity`; `examples/native-showcase/metro.config.js`; `examples/native-showcase/babel.config.js`; `packages/native/src/node.ts`; `packages/native/src/react.tsx`).
- **Website registration and example e2e.** Neither new showcase appears in `ExampleSlug` or the source-loader registry, and neither has an e2e spec. The existing Playwright setup expects a browser example, so Expo needs a separate testing decision (`packages/website/src/page/example/meta.ts`, `packages/website/src/page/example/sources.ts`, `packages/examples-e2e/e2e/`, `packages/examples-e2e/playwright.config.ts`).
- **Android Material icons.** The implemented path depends on `@expo/vector-icons/MaterialIcons` and accepts names from that glyph map. There is no general Android symbol-name resolver or portable drawable API in this implementation (`packages/native/src/tabIcons.ts`, `packages/native/package.json`).
- **Native render completion.** The native renderer settles pending render commits after publishing a snapshot, without a React commit acknowledgment. Consumers should not infer that a native view has finished committing from this signal alone (`packages/native/src/runtime.ts`, `renderFrame` and `settlePendingCommit`; `packages/native/src/react.tsx`, `FoldkitRoot`).

## Open questions for maintainers

1. Should `foldkit/runtime-core` be public as an experimental entry now, or should the host contract remain internal while it is refined? The decision concerns the platform types exported in `packages/foldkit/src/runtime-core/public.ts`.
2. Should `@foldkit/native` live in this monorepo or in a sibling repository, and should its first upstream form remain private or become a published package? The current manifest exports source and pins a native dependency set, while the example targets Expo 58 (`packages/native/package.json`, `examples/native-showcase/package.json`).
3. Should strict views use the proposed HTML subset, or a new vocabulary of portable primitives? The choice should account for familiar syntax and the semantic differences in the native tag mapping (`packages/foldkit/src/strict/strict.ts`, `packages/native/src/react.tsx`).
4. Should host-owned animated values and temporary native input state be accepted as presentation state outside the Model, or should the contract require more of that state to pass through Messages? The current boundary is implemented by `TrackedPanBridge` and `NativeTextInput` (`packages/native/src/gestures.tsx`, `packages/native/src/textInput.tsx`).
5. Should native swipe-back complete before the Model catches up, or should dismissal be prevented until update accepts it? The current stack uses native dismissal, while tabs already prevent native selection (`packages/native/src/navigation.tsx`).
6. Should native adoption require a Metro equivalent of Vite's branch identity, or may the experimental renderer document positional reconciliation with explicit entity keys? The missing transform affects the identity model exposed by `packages/vite-plugin-foldkit/src/viewIdentity.ts` and the native representation in `packages/native/src/node.ts`.
7. Should `routing`, `slow`, `freezeModel`, and `devTools` stay in `RuntimeCoreConfig`, or should some become host capabilities? The current config retains all four, while the native wrapper exposes only part of that surface (`packages/foldkit/src/runtime/runtime.ts`, `packages/native/src/runtime.ts`).
8. Should website registration and automated coverage be prerequisites for landing the showcases, or follow a private experimental landing? The decision includes a browser e2e path for the strict showcase and a separate native test strategy (`packages/website/src/page/example/meta.ts`, `packages/website/src/page/example/sources.ts`, `packages/examples-e2e/playwright.config.ts`).

## Suggested upstreaming plan

The following steps split the branch by reviewable contracts rather than copying its five commits unchanged. Each step should include the checks needed to establish its behavior before the next step depends on it.

1. **Internal runtime extraction.** Land the host and renderer split with the browser implementations, withholding the public runtime-core export. This can stand alone because browser entry points construct both dependencies, and it unblocks isolated testing of the lifecycle boundary (`packages/foldkit/src/runtime/platform.ts`, `packages/foldkit/src/runtime/browserRuntime.ts`, `packages/foldkit/src/runtime/browserHost.ts`, `packages/foldkit/src/runtime/browserRenderer.ts`).
2. **Experimental runtime-core entry.** Land the public export after agreeing on the platform contract and adding direct boundary tests. This can stand alone as an extension point for host authors, and it unblocks a native renderer without making strict views part of the core runtime (`packages/foldkit/src/runtime-core/public.ts`, `packages/foldkit/package.json`, `.changeset/native-runtime-core.md`).
3. **Strict controls and web adapter.** Land the basic strict tag and style surface with the four program/view extractions, deferring navigation and motion portions of the current implementation. This step can be exercised entirely in a browser and establishes the shared view vocabulary before native packaging (`packages/foldkit/src/strict/strict.ts`, `packages/foldkit/src/strict/web.ts`, `examples/counter/src/strictView.ts`, `examples/form/src/strictView.ts`, `examples/stopwatch/src/strictView.ts`, `examples/todo/src/strictView.ts`).
4. **Strict navigation and gestures.** Land stack and tab descriptions with their web implementations, including icon data and focused interaction tests. These descriptions already have a browser interpretation, so this step does not require native dependencies; it unblocks review of navigation ownership independently of animation (`packages/foldkit/src/strict/gesture.ts`, `packages/foldkit/src/strict/icon.ts`, `packages/foldkit/src/strict/web.ts`, `packages/foldkit/src/strict/webGestures.ts`).
5. **Animation services and web showcase.** Land keyed animation services and bindings after settling the host-state boundary, and include the web showcase with registration and e2e coverage. The web implementation supplies both services independently of React Native, allowing maintainers to review the background fallback and web exit policy before native integration (`packages/foldkit/src/strict/animation.ts`, `packages/foldkit/src/strict/webAnimation.ts`, `packages/foldkit/src/strict/webBindings.ts`, `examples/strict-showcase/src/entry.ts`).
6. **Native interpreter and Expo showcase.** Land the package with its native host and adapters after deciding its publication status. The preceding contracts make this a host implementation that can be reviewed separately; record simulator coverage and add protocol tests before using it as a supported native path (`packages/native/src/runtime.ts`, `packages/native/src/react.tsx`, `packages/native/src/navigation.tsx`, `packages/native/src/textInput.tsx`, `examples/native-showcase/App.tsx`).
