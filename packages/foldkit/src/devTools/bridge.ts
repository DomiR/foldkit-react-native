import {
  Array,
  Cause,
  Clock,
  Effect,
  HashMap,
  Match,
  Option,
  Order,
  Result,
  Schema,
  Scope,
  SubscriptionRef,
  pipe,
} from 'effect'

import { OptionExt } from '../effectExtensions/index.js'
import * as Serialization from '../serialization.js'
import type { DevToolsChannel, DevToolsRuntimeMetadata } from './channel.js'
import {
  collectMatchingEntries,
  countEntriesByTag,
  findUnanchoredPattern,
  formatIndexNotReadable,
  isIndexReadable,
  matchesAnyPathPattern,
  pageMatchingEntries,
  pathOrder,
  readSummarizedValueAt,
} from './historyQuery.js'
import {
  DevToolsEnvelope,
  DiffValue,
  Event,
  KeyframeInfo,
  MAX_DISPATCH_BATCH_SIZE,
  MessageSchemaResult,
  Request,
  Response,
} from './protocol.js'
import {
  diagnoseVariantPath,
  indexMessageSchemaDocument,
  narrowToVariant,
  splitVariantPath,
} from './schemaSummarize.js'
import {
  toInspectableValue,
  toSerializedCommand,
  toSerializedEntry,
  toSerializedMount,
} from './serialize.js'
import {
  type DevToolsStore,
  INIT_INDEX,
  computeDiff,
  latestEntryIndex,
} from './store.js'
import {
  type PathResolution,
  formatPathNotFound,
  resolvePath,
  summarizeValue,
} from './summarize.js'

/** @internal A decoded Message prepared for one exact runtime occurrence. */
export type PreparedDispatch = Result.Result<
  Effect.Effect<Result.Result<Option.Option<number>, string>>,
  string
>

/** @internal Admits external input before it enters the runtime queue. */
export type PrepareDispatch = (message: unknown) => PreparedDispatch

const generateConnectionId = (timestamp: number): string =>
  `${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const tryDeriveJsonSchemaDocument = (
  schema: Schema.Codec<any, any, any, any>,
): Option.Option<unknown> => {
  try {
    return Option.some(Schema.toJsonSchemaDocument(schema))
  } catch (error) {
    console.warn(
      '[foldkit:devTools] Failed to derive JSON Schema from Message Schema; foldkit_get_message_schema will return None.',
      error,
    )
    return Option.none()
  }
}

/**
 * Start the transport-independent DevTools bridge for a runtime.
 *
 * The bridge keeps one connection id for its entire lifetime, announces each
 * successful channel opening, handles only requests addressed to that id,
 * and emits a disconnect event when its Scope or channel closes.
 *
 * `prepareDispatch` admits a decoded Message for its current runtime
 * occurrence and returns the queued execution whose receipt identifies the
 * exact recorded history entry. The bridge decodes the payload against a
 * JSON-canonical derivation of `maybeMessageSchema` (via
 * `Schema.toCodecJson`), so Message Schemas using `Option`, `Date`, `Map`,
 * and `Set` decode from their JSON-tagged shapes. When `maybeMessageSchema`
 * is `None`, dispatch requests are rejected with an informative error.
 *
 * The bridge also derives a JSON Schema document from `maybeMessageSchema`
 * once at boot to fulfill `RequestGetMessageSchema`. A failed derivation logs
 * a warning and the schema-discovery request returns `None`.
 */
export const startDevToolsBridge = (
  store: DevToolsStore,
  channel: DevToolsChannel,
  readRuntimeMetadata: () => DevToolsRuntimeMetadata,
  maybeMessageSchema: Option.Option<Schema.Codec<any, any, never, never>>,
  prepareDispatch: PrepareDispatch,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const connectionId = generateConnectionId(yield* Clock.currentTimeMillis)
    const capturedContext = yield* Effect.context<never>()
    const scope = yield* Effect.scope
    const maybeDispatchSchema = Option.map(
      maybeMessageSchema,
      Schema.toCodecJson,
    )
    const maybeJsonSchemaDocument = Option.flatMap(
      maybeMessageSchema,
      tryDeriveJsonSchemaDocument,
    )

    let isActive = true
    let hasEmittedDisconnect = false

    const sendEvent = (event: Event): void => {
      channel.send(
        DevToolsEnvelope.Event({
          frame: {
            maybeConnectionId: Option.some(connectionId),
            event,
          },
        }),
      )
    }

    const sendResponse = (id: string, response: Response): void => {
      if (isActive) {
        channel.send(DevToolsEnvelope.Response({ frame: { id, response } }))
      }
    }

    const announceConnected = (): void => {
      if (isActive) {
        const { url, title } = readRuntimeMetadata()
        sendEvent(
          Event.EventConnected({
            runtime: {
              connectionId,
              url,
              title,
            },
          }),
        )
      }
    }

    const handleRequest = (id: string, request: Request) =>
      Effect.gen(function* () {
        const response = yield* dispatchRequest(
          store,
          maybeDispatchSchema,
          maybeJsonSchemaDocument,
          request,
          prepareDispatch,
        )
        sendResponse(id, response)
      })

    const handleEnvelope = (envelope: DevToolsEnvelope): void => {
      DevToolsEnvelope.match<void>(envelope, {
        Request: ({ frame }) => {
          const isForUs = Option.exists(
            frame.maybeConnectionId,
            targetId => targetId === connectionId,
          )
          if (isActive && isForUs) {
            Effect.runForkWith(capturedContext)(
              Effect.forkIn(handleRequest(frame.id, frame.request), scope),
            )
          }
        },
        Response: () => undefined,
        Event: () => undefined,
      })
    }

    const emitDisconnect = (): void => {
      if (!hasEmittedDisconnect) {
        hasEmittedDisconnect = true
        sendEvent(Event.EventDisconnected({ connectionId }))
      }
    }

    const handleDisposed = (): void => {
      if (isActive) {
        isActive = false
        emitDisconnect()
      }
    }

    const unsubscribe = channel.subscribe({
      opened: announceConnected,
      received: handleEnvelope,
      disposed: handleDisposed,
    })

    // NOTE: a disposed runtime must disconnect from the relay and stop
    // answering requests. Without this finalizer, every embed/dispose cycle
    // would leave a ghost connection that keeps responding with dead state.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (isActive) {
          isActive = false
          emitDisconnect()
        }
        unsubscribe()
      }),
    )
  })

const presentResolution = (
  resolution: PathResolution,
  expand: boolean,
): Response =>
  Match.value(resolution).pipe(
    Match.tag('Found', ({ value, atPath }) =>
      Response.ResponseModel({
        value: expand ? value : summarizeValue(value),
        atPath,
        summarized: !expand,
      }),
    ),
    Match.orElse(notFound =>
      Response.ResponseError({ reason: formatPathNotFound(notFound) }),
    ),
  )

const readModelResponse = (
  store: DevToolsStore,
  index: number,
  maybePath: Option.Option<string>,
  expand: boolean,
): Effect.Effect<Response> =>
  Effect.gen(function* () {
    const model = yield* store.getModelAtIndex(index)
    const path = Option.getOrElse(maybePath, () => 'root')
    return presentResolution(
      resolvePath(toInspectableValue(model), path),
      expand,
    )
  }).pipe(
    Effect.catchCause(cause =>
      Effect.succeed(
        Response.ResponseError({
          reason: `Failed to read Model at index ${index}: ${Cause.pretty(cause)}`,
        }),
      ),
    ),
  )

const maybePatternError = (
  maybeChangedPathsMatch: Option.Option<ReadonlyArray<string>>,
): Option.Option<Response> =>
  pipe(
    maybeChangedPathsMatch,
    Option.flatMap(findUnanchoredPattern),
    Option.map(pattern =>
      Response.ResponseError({
        reason: `Invalid changed_paths_match pattern '${pattern}': patterns must start with 'root' or '*', matching the changedPaths alphabet (e.g. 'root.grid', 'root.cards.*.title').`,
      }),
    ),
  )

const toDiffValue = (maybeValue: Option.Option<unknown>): DiffValue =>
  Option.match(maybeValue, {
    onNone: () => DiffValue.Absent(),
    onSome: value => DiffValue.Present({ value: value ?? null }),
  })

const indexResponse = (jsonSchemaDocument: unknown): Response =>
  Option.match(indexMessageSchemaDocument(jsonSchemaDocument), {
    onNone: () =>
      Response.ResponseError({
        reason:
          "Could not index Message Schema: the top-level shape is not a discriminated union of '_tag'-keyed structs. Open an issue if you see this against an Effect Schema released after foldkit's last sync.",
      }),
    onSome: variants =>
      Response.ResponseMessageSchema({
        maybeResult: Option.some(
          MessageSchemaResult.MessageSchemaIndexResult({ index: { variants } }),
        ),
      }),
  })

const narrowResponse = (
  jsonSchemaDocument: unknown,
  variantPath: string,
): Response =>
  Option.match(narrowToVariant(jsonSchemaDocument, variantPath), {
    onNone: () => formatUnknownVariantError(jsonSchemaDocument, variantPath),
    onSome: narrowed =>
      Response.ResponseMessageSchema({
        maybeResult: Option.some(
          MessageSchemaResult.MessageSchemaDocumentResult({
            document: narrowed,
          }),
        ),
      }),
  })

const buildMessageSchemaResponse = (
  maybeJsonSchemaDocument: Option.Option<unknown>,
  maybeVariantTag: Option.Option<string>,
): Response =>
  Option.match(maybeJsonSchemaDocument, {
    onNone: () =>
      Response.ResponseMessageSchema({ maybeResult: Option.none() }),
    onSome: jsonSchemaDocument =>
      Option.match(maybeVariantTag, {
        onNone: () => indexResponse(jsonSchemaDocument),
        onSome: variantTag => narrowResponse(jsonSchemaDocument, variantTag),
      }),
  })

const formatUnknownVariantError = (
  jsonSchemaDocument: unknown,
  variantPath: string,
): Response => {
  const segments = splitVariantPath(variantPath)
  return Option.match(diagnoseVariantPath(jsonSchemaDocument, segments), {
    onNone: () =>
      Response.ResponseError({
        reason: `No Message variant at path '${variantPath}'. The runtime's Message Schema is not a discriminated union of '_tag'-keyed structs.`,
      }),
    onSome: ({ prefix, failingSegment, available }) => {
      const prefixLabel = Array.isReadonlyArrayNonEmpty(prefix)
        ? prefix.join('.')
        : '<top level>'
      const failingIsKnownTag = Option.exists(failingSegment, tag =>
        available.includes(tag),
      )
      const failingTag = Option.getOrElse(failingSegment, () => '')
      const reason = failingIsKnownTag
        ? `No further structure to drill into at path '${variantPath}'. The variant '${failingTag}' at ${prefixLabel} does not carry exactly one tagged-union payload field, which is what the walker steps through. Idiomatic Foldkit Messages have at most one tagged-union field per variant (the 'message' field on Block wrappers, or a single value-type union); state surrounding a Block call belongs as an argument to the child's update/view, not as a sibling field on the parent Message.`
        : `No Message variant at path '${variantPath}'. Available variants at ${prefixLabel}: ${available.join(', ')}.`
      return Response.ResponseError({ reason })
    },
  })
}

const missingMessageSchemaResponse = Response.ResponseError({
  reason:
    'Cannot dispatch: external dispatch is disabled. Pass devTools: { dispatch: true } to Program.make or Program.makeElement.',
})

const formatInvalidMessageReason = (error: unknown, message: unknown): string =>
  `${error instanceof Error ? error.message : String(error)}\n\nReceived (typeof ${typeof message}): ${JSON.stringify(message)}`

/**
 * Fulfill one bridge Request against the DevTools store.
 */
export const dispatchRequest = (
  store: DevToolsStore,
  maybeDispatchSchema: Option.Option<Schema.Codec<any, any, never, never>>,
  maybeJsonSchemaDocument: Option.Option<unknown>,
  request: Request,
  prepareDispatch: PrepareDispatch,
): Effect.Effect<Response> =>
  Request.match<Effect.Effect<Response>>(request, {
    RequestGetModel: ({ maybePath, expand }) =>
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(store.stateRef)
        const index = latestEntryIndex(state)
        return yield* readModelResponse(store, index, maybePath, expand)
      }),

    RequestGetModelAt: ({ index, maybePath, expand }) =>
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(store.stateRef)
        if (!isIndexReadable(state, index)) {
          return Response.ResponseError({
            reason: formatIndexNotReadable(state, index),
          })
        }
        return yield* readModelResponse(store, index, maybePath, expand)
      }),

    RequestListMessages: ({
      limit,
      maybeSinceIndex,
      maybeChangedPathsMatch,
      fromEnd,
    }) =>
      Effect.gen(function* () {
        if (fromEnd && Option.isSome(maybeSinceIndex)) {
          return Response.ResponseError({
            reason:
              'from_end cannot be combined with since_index. Use from_end alone to read the latest entries, or since_index to page forward.',
          })
        }
        const maybeInvalidPattern = maybePatternError(maybeChangedPathsMatch)
        if (Option.isSome(maybeInvalidPattern)) {
          return maybeInvalidPattern.value
        }

        const state = yield* SubscriptionRef.get(store.stateRef)
        const candidates = collectMatchingEntries(
          state,
          maybeSinceIndex,
          maybeChangedPathsMatch,
        )
        const { page, maybeNextIndex } = pageMatchingEntries(
          candidates,
          limit,
          fromEnd,
        )
        const entries = Array.map(page, ({ entry, index }) =>
          toSerializedEntry(entry, index),
        )

        return Response.ResponseMessages({ entries, maybeNextIndex })
      }),

    RequestCountMessagesByTag: ({ maybeSinceIndex, maybeChangedPathsMatch }) =>
      Effect.gen(function* () {
        const maybeInvalidPattern = maybePatternError(maybeChangedPathsMatch)
        if (Option.isSome(maybeInvalidPattern)) {
          return maybeInvalidPattern.value
        }

        const state = yield* SubscriptionRef.get(store.stateRef)
        const candidates = collectMatchingEntries(
          state,
          maybeSinceIndex,
          maybeChangedPathsMatch,
        )
        const scannedFromIndex = Math.max(
          Option.getOrElse(maybeSinceIndex, () => state.startIndex),
          state.startIndex,
        )
        return Response.ResponseMessageCounts({
          counts: countEntriesByTag(candidates),
          totalCount: candidates.length,
          scannedFromIndex,
          scannedToIndex: latestEntryIndex(state),
        })
      }),

    RequestDiffModels: ({ fromIndex, toIndex, maybeChangedPathsMatch }) =>
      Effect.gen(function* () {
        const maybeInvalidPattern = maybePatternError(maybeChangedPathsMatch)
        if (Option.isSome(maybeInvalidPattern)) {
          return maybeInvalidPattern.value
        }

        const state = yield* SubscriptionRef.get(store.stateRef)
        const maybeUnreadableIndex = Array.findFirst(
          [fromIndex, toIndex],
          index => !isIndexReadable(state, index),
        )
        if (Option.isSome(maybeUnreadableIndex)) {
          return Response.ResponseError({
            reason: formatIndexNotReadable(state, maybeUnreadableIndex.value),
          })
        }

        const beforeModel = yield* store.getModelAtIndex(fromIndex)
        const afterModel = yield* store.getModelAtIndex(toIndex)
        // NOTE: the diff must walk the same trees the paths are resolved
        // against. toInspectableValue converts Date/File/Blob/URL instances
        // to plain data, so diffing the transformed trees keeps every
        // emitted path resolvable and lets instance-typed fields (whose raw
        // forms have no enumerable keys) surface as value changes.
        const diff = computeDiff(
          toInspectableValue(beforeModel),
          toInspectableValue(afterModel),
        )
        const maybePatterns = Option.filter(
          maybeChangedPathsMatch,
          Array.isReadonlyArrayNonEmpty,
        )

        const changes = pipe(
          diff.changedPaths,
          Array.fromIterable,
          Array.filter(path =>
            Option.match(maybePatterns, {
              onNone: () => true,
              onSome: patterns => matchesAnyPathPattern(path, patterns),
            }),
          ),
          Array.sort(pathOrder),
          Array.map(path => ({
            path,
            before: toDiffValue(readSummarizedValueAt(beforeModel, path)),
            after: toDiffValue(readSummarizedValueAt(afterModel, path)),
          })),
        )

        return Response.ResponseModelDiff({ fromIndex, toIndex, changes })
      }).pipe(
        Effect.catchCause(cause =>
          Effect.succeed(
            Response.ResponseError({
              reason: `Failed to diff Models between ${fromIndex} and ${toIndex}: ${Cause.pretty(cause)}`,
            }),
          ),
        ),
      ),

    RequestGetMessage: ({ index }) =>
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(store.stateRef)
        const relative = index - state.startIndex
        const maybeEntry = Array.get(state.entries, relative)

        return yield* Option.match(maybeEntry, {
          onNone: () =>
            Effect.succeed(
              Response.ResponseError({
                reason: `No entry at index ${index} (have ${state.startIndex} to ${state.startIndex + state.entries.length - 1})`,
              }),
            ),
          onSome: entry =>
            Effect.succeed(
              Response.ResponseMessage({
                entry: toSerializedEntry(entry, index),
              }),
            ),
        })
      }),

    RequestListKeyframes: () =>
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(store.stateRef)
        const sortedKeyframeIndices = pipe(
          state.keyframes,
          HashMap.keys,
          Array.fromIterable,
          Array.sort(Order.Number),
        )
        const indicesWithInit = Option.match(state.maybeInitModel, {
          onNone: () => sortedKeyframeIndices,
          onSome: () => [INIT_INDEX, ...sortedKeyframeIndices],
        })
        const keyframes = indicesWithInit.map(index =>
          KeyframeInfo.make({ index }),
        )
        return Response.ResponseKeyframes({ keyframes })
      }),

    RequestReplayToKeyframe: ({ keyframeIndex }) =>
      pipe(
        Effect.gen(function* () {
          const state = yield* SubscriptionRef.get(store.stateRef)
          if (!isIndexReadable(state, keyframeIndex)) {
            return Response.ResponseError({
              reason: formatIndexNotReadable(state, keyframeIndex),
            })
          }
          yield* store.jumpTo(keyframeIndex)
          const model = yield* store.getModelAtIndex(keyframeIndex)
          return Response.ResponseReplayed({
            model: toInspectableValue(model),
          })
        }),
        Effect.catchCause(cause =>
          Effect.succeed(
            Response.ResponseError({
              reason: `Failed to replay to keyframe ${keyframeIndex}: ${Cause.pretty(cause)}`,
            }),
          ),
        ),
      ),

    RequestResume: () =>
      Effect.gen(function* () {
        yield* store.resume
        return Response.ResponseResumed()
      }).pipe(
        Effect.catchCause(cause =>
          Effect.succeed(
            Response.ResponseError({
              reason: `Failed to resume: ${Cause.pretty(cause)}`,
            }),
          ),
        ),
      ),

    RequestDispatchMessage: ({ message }) =>
      Option.match(maybeDispatchSchema, {
        onNone: () => Effect.succeed(missingMessageSchemaResponse),
        onSome: dispatchSchema =>
          Effect.suspend(() =>
            Effect.fromResult(
              Serialization.run(
                Schema.decodeUnknownEffect(dispatchSchema)(message),
                'DevTools Message decoding',
              ),
            ),
          ).pipe(
            Effect.matchEffect({
              onFailure: error =>
                Effect.succeed(
                  Response.ResponseError({
                    reason: `Invalid Message: ${formatInvalidMessageReason(error, message)}`,
                  }),
                ),
              onSuccess: (decodedMessage): Effect.Effect<Response> => {
                const prepared = prepareDispatch(decodedMessage)
                if (Result.isFailure(prepared)) {
                  return Effect.succeed(
                    Response.ResponseError({ reason: prepared.failure }),
                  )
                }

                return Effect.map(
                  prepared.success,
                  Result.match({
                    onFailure: reason => Response.ResponseError({ reason }),
                    onSuccess: Option.match({
                      onNone: () =>
                        Response.ResponseError({
                          reason:
                            'Message was not dispatched because its queued admission guard no longer identifies a current occurrence.',
                        }),
                      onSome: acceptedAtIndex =>
                        Response.ResponseDispatched({ acceptedAtIndex }),
                    }),
                  }),
                )
              },
            }),
          ),
      }),

    RequestDispatchMessages: ({ messages }) => {
      if (messages.length > MAX_DISPATCH_BATCH_SIZE) {
        return Effect.succeed(
          Response.ResponseError({
            reason: `Batch too large: ${messages.length} Messages exceeds the limit of ${MAX_DISPATCH_BATCH_SIZE}. No Messages from the batch were dispatched.`,
          }),
        )
      }

      return Option.match(maybeDispatchSchema, {
        onNone: () => Effect.succeed(missingMessageSchemaResponse),
        onSome: dispatchSchema =>
          Effect.gen(function* () {
            const decodeMessage = Schema.decodeUnknownEffect(dispatchSchema)
            const decodedMessages = yield* Effect.forEach(
              messages,
              (message, position) =>
                Effect.mapError(
                  Effect.fromResult(
                    Serialization.run(
                      decodeMessage(message),
                      'DevTools Message decoding',
                    ),
                  ),
                  error =>
                    new Error(
                      `Invalid Message at zero-based batch position ${position}: ${formatInvalidMessageReason(error, message)}\n\nNo Messages from the batch were dispatched.`,
                    ),
                ),
            )
            const preparedDispatches = yield* Effect.forEach(
              decodedMessages,
              (
                decodedMessage,
                position,
              ): Effect.Effect<
                Effect.Effect<Result.Result<Option.Option<number>, string>>,
                Error
              > => {
                const prepared = prepareDispatch(decodedMessage)
                return Result.isFailure(prepared)
                  ? Effect.fail(
                      new Error(
                        `Rejected Message at zero-based batch position ${position}: ${prepared.failure}\n\nNo Messages from the batch were dispatched.`,
                      ),
                    )
                  : Effect.succeed(prepared.success)
              },
            )
            const acceptedAtIndices: Array<number> = []
            for (const [position, dispatch] of preparedDispatches.entries()) {
              const receipt = yield* dispatch
              if (Result.isFailure(receipt)) {
                const recordedPrefix = Array.isArrayEmpty(acceptedAtIndices)
                  ? 'No Messages from the batch were recorded before the runtime terminated.'
                  : `The batch had already recorded history indices ${acceptedAtIndices.join(', ')} before the runtime terminated.`
                return Response.ResponseError({
                  reason: `Runtime terminated while dispatching Message at zero-based batch position ${position}: ${receipt.failure}\n\n${recordedPrefix}`,
                })
              }
              if (Option.isSome(receipt.success)) {
                acceptedAtIndices.push(receipt.success.value)
              }
            }
            return Response.ResponseDispatchedBatch({ acceptedAtIndices })
          }).pipe(
            Effect.catch(error =>
              Effect.succeed(
                Response.ResponseError({
                  reason:
                    error instanceof Error ? error.message : String(error),
                }),
              ),
            ),
          ),
      })
    },

    RequestGetMessageSchema: ({ maybeVariantTag }) =>
      Effect.succeed(
        buildMessageSchemaResponse(maybeJsonSchemaDocument, maybeVariantTag),
      ),

    RequestListRuntimes: () =>
      Effect.succeed(
        Response.ResponseError({
          reason:
            'RequestListRuntimes is plugin-handled and should not reach the runtime bridge',
        }),
      ),

    RequestGetInit: () =>
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(store.stateRef)
        return Response.ResponseInit({
          maybeModel: Option.map(state.maybeInitModel, toInspectableValue),
          commands: Array.map(state.initCommands, toSerializedCommand),
          mountStarts: Array.map(state.initMountStarts, toSerializedMount),
        })
      }),

    RequestGetRuntimeState: () =>
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(store.stateRef)
        const currentIndex = latestEntryIndex(state)
        return Response.ResponseRuntimeState({
          currentIndex,
          startIndex: state.startIndex,
          totalEntries: state.entries.length,
          isPaused: state.isPaused,
          maybePausedAtIndex: OptionExt.when(
            state.isPaused,
            state.pausedAtIndex,
          ),
          hasInitModel: Option.isSome(state.maybeInitModel),
        })
      }),
  })
