# React Native support

## Overview

This fork adds experimental React Native support to Foldkit through a portable runtime core, a strict cross-host view contract, and a private `@foldkit/native` host for Expo applications.

The mental model is one Foldkit program and one strict view. The program owns the Model, Messages, Commands, Subscriptions, and other application behavior. The strict view describes layout, controls, navigation, gestures, styles, and animations once. The web adapter renders that view in the strict showcase, while the native host renders the same view in the Expo showcase on iOS and Android.

The shared example programs and strict views live in `examples/counter`, `examples/form`, `examples/stopwatch`, and `examples/todo`. The strict showcase composes those modules with a larger navigation, gesture, and animation demonstration. The native showcase imports that same showcase program and strict view.

## Status

Everything here is experimental and unreleased:

- All workspace packages and examples typecheck.
- Foldkit's test suite passes.
- The native showcase was verified by hand on iOS and Android.
- `@foldkit/native` is private and has no npm release.
- The new `foldkit` entry points (`foldkit/runtime-core`, `foldkit/strict`, `foldkit/strict/web`) carry minor Changesets but have not been published.

## Architecture

Both hosts render the same program and strict view, and both run on the same runtime core:

```text
                  program.ts + strictView.ts
                     |                  |
          foldkit/strict/web      @foldkit/native
          (browser host and       (React Native host
           renderer)               and renderer)
                     |                  |
                     +--> runtime core <+
          (Message queue, Commands, Subscriptions,
           ManagedResources, Ports, DevTools store)
```

### Runtime core and platforms

`packages/foldkit/src/runtime/runtime.ts` contains the platform-independent runtime core. It runs the Message queue, Commands, Subscriptions, ManagedResources, Ports, and DevTools store against platform-supplied rendering and services.

`foldkit/runtime-core` is the experimental entry point for another platform. Its contract in `packages/foldkit/src/runtime/platform.ts` supplies a renderer, host services, boot resolution, scheduling, resource handling, and DevTools connection. The browser Runtime is one implementation of that contract through `browserRuntime.ts`, `browserHost.ts`, `browserRenderer.ts`, and `browserDrainScheduler.ts`.

The native host uses `makeRuntimeCore` from `foldkit/runtime-core`. `makeNativeProgram` supplies a native renderer and host, starts the scoped runtime, publishes native node snapshots, dispatches Messages, and interrupts the runtime on `dispose`.

### Strict views

`foldkit/strict` defines a portable `StrictView<Model, Message>` and a `StrictHtmlBuilder` shared by host adapters. Its `StrictStyle` Schema uses React Native layout semantics, with numeric lengths represented as density-independent values and rendered as CSS pixels on the web.

The strict builder includes the shared element tags, keyed elements, text input, controls, stacks, tabs, screen and tab Titles, TabIcon data, and Message-producing event attributes. It also defines these portable contracts:

- Stacks and tabs with Model-selected navigation and dismissal Messages.
- `Tap`, `LongPress`, `Pan`, and `Swipe` gestures, including portable pan translation and velocity values.
- Spring and timing animations, transforms, entering and exiting animations, `AnimatedValues`, and `BackgroundRuntime` worklets.
- `StrictIcon` data for iOS SF Symbols, Android Material symbol names, and web glyphs.

### Web adapter

`foldkit/strict/web` exports `toStrictHtml`. It adapts the existing web `HtmlBuilder` to the strict builder, applies layout defaults and control resets, converts strict styles to CSS, renders stack headers and tab bars, and connects strict gestures and animations to the browser host.

The web showcase uses `toStrictHtml` in `examples/strict-showcase/src/main.ts`. Its Vite configuration uses `@foldkit/vite-plugin` and the shared aliases from `examples/vite.aliases.ts`.

### Native host

`@foldkit/native` is the private React Native renderer in `packages/native/src`. `FoldkitRoot` subscribes to native frames and renders the node tree inside `GestureHandlerRootView`. The host maps strict elements to React Native `View`, `Text`, `Pressable`, `Switch`, `Image`, and `TextInput` components.

The native renderer includes `react-native-screens` stacks and tabs, native back and dismissal Messages, safe-area and scroll handling, iOS SF Symbol tab icons, cached Android Material tab images, React Native Gesture Handler bridges, Reanimated layout and style animation, Worklets background execution, and a revision-aware text input adapter.

The native package and the native showcase pin these host versions: React `19.3.0`, React Native `0.88.1`, `react-native-screens` `~4.30.1`, `react-native-gesture-handler` `~3.3.0`, `react-native-reanimated` `4.7.1`, `react-native-worklets` `0.13.0`, and `@expo/vector-icons` `^15.1.1`. The showcase also pins Expo `~58.0.23`.

## Packages and entry points

| Package or path | Provides |
| --- | --- |
| `foldkit/runtime-core` | Experimental runtime core and platform contracts for rendering and host services. |
| `foldkit/strict` | Portable strict builder, style Schema, navigation, gestures, animations, icons, and Message mapping. |
| `foldkit/strict/web` | `toStrictHtml` and browser animation support for strict views. |
| `@foldkit/native` | Private React Native builder, runtime, React root, navigation, gestures, animations, text input, and tab icon host code. |
| `examples/*/src/program.ts` | The Model, Messages, init, update, Commands, and Subscriptions for the shared examples. |
| `examples/*/src/strictView.ts` | The strict view for the shared counter, form, stopwatch, and todo examples. |
| `examples/strict-showcase` | Vite web application that demonstrates the shared examples, navigation, gestures, styles, and animations. |
| `examples/native-showcase` | Expo application that renders the showcase through `@foldkit/native`. |

The four shared examples export `./program` and `./strictView` from their package manifests. This lets both showcases import the same application behavior and strict views without importing the browser view modules.

## Running the showcases

Run these commands from the repository root after the workspace dependencies are available:

- `pnpm dev:example:strict-showcase` runs `vite` for `strict-showcase-example`.
- `pnpm dev:example:native-showcase` runs `expo start` for `native-showcase-example`.

The native example also defines `pnpm --filter native-showcase-example ios`, which runs `expo start --ios`. Its Expo entry point is `examples/native-showcase/index.ts`, and its root component is `examples/native-showcase/App.tsx`.

The web entry point is `examples/strict-showcase/src/entry.ts`. `App.tsx` calls `makeNativeProgram` with the showcase `Model`, `init`, `update`, `subscriptions`, and `showcaseStrictView`, then renders the returned program with `FoldkitRoot`.

## What is not done yet

- The website does not register the strict or native showcases in `packages/website/src/page/example/meta.ts` or `packages/website/src/page/example/sources.ts`.
- `packages/examples-e2e` has no coverage for either showcase.
- The repository has no automated native tests for the native host or native showcase.

## Keeping up with upstream

The fork merges `foldkit/foldkit` main into its main branch without rebasing. The runtime split moved code out of `packages/foldkit/src/runtime/runtime.ts`, and the shared example split moved program code out of the examples' `main.ts` files. Git cannot follow code split from one file into several, so upstream changes to that code need porting by hand:

- When upstream edits lines the fork moved, the merge stops with a conflict in `runtime.ts` or `main.ts`. Keep the fork's version of that file and apply upstream's change to the new file, such as `browserRuntime.ts` or `program.ts`.
- When upstream adds code next to moved lines without touching them, the merge can succeed and leave that code in the old file. Read upstream's diff to those files on every merge and move such code where it belongs.
