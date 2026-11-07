import {
  Array,
  Clock,
  Duration,
  Effect,
  Layer,
  Number,
  Schema,
  Stream,
} from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import {
  AnimatedValue,
  AnimatedValues,
  BackgroundRuntime,
  PanEnd,
  Spring,
  Timing,
} from 'foldkit/strict'
import { modifyFields } from 'foldkit/struct'

const PRIME_LIMIT = 2000000
const DISMISS_DISTANCE = 100
const DISMISS_VELOCITY = 700
const FLY_OUT_DISTANCE = 420
const FLY_OUT_DURATION_MS = 250
const SPINNER_INTERVAL_MS = 120
const SPINNER_STEP_DEGREES = 90

export const cardOffset = AnimatedValue.key('showcase/cardOffset', 0)

// MODEL

const BoxState = Schema.Literals(['Compact', 'Expanded'])
const CardDecision = Schema.Literals(['FlewOut', 'SprangBack'])
const CardMotion = defineTaggedUnion({
  Idle: {},
  Animating: { requestId: Schema.Number, decision: CardDecision },
})
export const PrimeState = defineTaggedUnion({
  Idle: {},
  Running: { angle: Schema.Number },
  Succeeded: { count: Schema.Number, elapsedMs: Schema.Number },
  Failed: { reason: Schema.String },
})
const Item = Schema.Struct({ id: Schema.Number })

export const Model = Schema.Struct({
  box: BoxState,
  completedTransitions: Schema.Number,
  items: Schema.Array(Item),
  nextItemId: Schema.Number,
  cardMotion: CardMotion,
  nextAnimationId: Schema.Number,
  flyOuts: Schema.Number,
  springBacks: Schema.Number,
  primes: PrimeState,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedToggleBox: {},
  EndedBoxTransition: {},
  ClickedAddItem: {},
  ClickedRemoveItem: { id: Schema.Number },
  EndedCardPan: { event: PanEnd },
  CompletedAnimateCard: {
    requestId: Schema.Number,
    isFinished: Schema.Boolean,
  },
  CompletedResetCard: {},
  ClickedCountPrimes: {},
  CompletedCountPrimes: { count: Schema.Number, elapsedMs: Schema.Number },
  FailedCountPrimes: { reason: Schema.String },
  TickedSpinner: {},
})
export type Message = typeof Message.Type

export type Requirements = AnimatedValues | BackgroundRuntime

// BLOCK

export const AnimationsKey = Symbol('Animations')
export const AnimationsBlock = Block.make('Animations', {
  key: AnimationsKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element' },
  effects: { services: [AnimatedValues, BackgroundRuntime] },
  Model,
  Message,
})

const {
  makeCommand,
  makeComposition,
  makeFieldsStep,
  makeNoopStep,
  makeSubscriptions,
} = AnimationsBlock

export const AnimationsComposition = makeComposition()

// COMMAND

const AnimateCard = makeCommand('AnimateCard', {
  args: {
    requestId: Schema.Number,
    target: Schema.Number,
    decision: CardDecision,
  },
  messages: [Message.CompletedAnimateCard],
  handler: function* () {
    const values = yield* AnimatedValues

    return ({ requestId, target, decision }) =>
      Effect.gen(function* () {
        const animation =
          decision === 'FlewOut'
            ? Timing({ durationMs: FLY_OUT_DURATION_MS })
            : Spring({ damping: 20, stiffness: 180 })
        const result = yield* values.animateTo(cardOffset, target, animation)

        return Message.CompletedAnimateCard({
          requestId,
          isFinished: result.isFinished,
        })
      })
  },
})

const ResetCard = makeCommand('ResetCard', {
  messages: [Message.CompletedResetCard],
  handler: function* () {
    const values = yield* AnimatedValues

    return () =>
      values.set(cardOffset, 0).pipe(Effect.as(Message.CompletedResetCard()))
  },
})

const countPrimes = (limit: number): number => {
  'worklet'
  let count = limit >= 2 ? 1 : 0
  for (let candidate = 3; candidate <= limit; candidate += 2) {
    let isPrime = true
    const maximumDivisor = Math.sqrt(candidate)
    for (let divisor = 3; divisor <= maximumDivisor; divisor += 2) {
      if (candidate % divisor === 0) {
        isPrime = false
        break
      }
    }
    if (isPrime) {
      count += 1
    }
  }
  return count
}

const CountPrimes = makeCommand('CountPrimes', {
  messages: [Message.CompletedCountPrimes, Message.FailedCountPrimes],
  handler: function* () {
    const runtime = yield* BackgroundRuntime

    return () =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis
        const count = yield* runtime.run(countPrimes, PRIME_LIMIT)
        const completedAt = yield* Clock.currentTimeMillis

        return Message.CompletedCountPrimes({
          count,
          elapsedMs: completedAt - startedAt,
        })
      }).pipe(
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedCountPrimes({ reason: globalThis.String(error) }),
          ),
        ),
      )
  },
})

// INIT

export const init = AnimationsComposition.makeInit(() => ({
  model: {
    box: 'Compact',
    completedTransitions: 0,
    items: [Item.make({ id: 0 })],
    nextItemId: 1,
    cardMotion: CardMotion.Idle(),
    nextAnimationId: 0,
    flyOuts: 0,
    springBacks: 0,
    primes: PrimeState.Idle(),
  },
}))

// UPDATE

export const update = AnimationsComposition.makeUpdate({
  ClickedToggleBox: makeFieldsStep(() => ({
    box: box => (box === 'Compact' ? 'Expanded' : 'Compact'),
  })),

  EndedBoxTransition: makeFieldsStep(() => ({
    completedTransitions: Number.increment,
  })),

  ClickedAddItem: makeFieldsStep(model => ({
    items: Array.append(Item.make({ id: model.nextItemId })),
    nextItemId: Number.increment,
  })),

  ClickedRemoveItem: makeFieldsStep.fromMessage(({ id }) => ({
    items: Array.filter(item => item.id !== id),
  })),

  EndedCardPan: (model, { event }) => {
    const isDismissal =
      Math.abs(event.translationX) > DISMISS_DISTANCE ||
      Math.abs(event.velocityX) > DISMISS_VELOCITY
    const direction =
      event.translationX === 0
        ? Math.sign(event.velocityX)
        : Math.sign(event.translationX)
    const target = isDismissal ? direction * FLY_OUT_DISTANCE : 0
    const decision = isDismissal ? 'FlewOut' : 'SprangBack'
    const requestId = model.nextAnimationId

    return {
      model: modifyFields(model, {
        cardMotion: () => CardMotion.Animating({ requestId, decision }),
        nextAnimationId: Number.increment,
      }),
      commands: [AnimateCard({ requestId, target, decision })],
    }
  },

  CompletedAnimateCard: (model, { requestId, isFinished }) => {
    if (
      model.cardMotion._tag !== 'Animating' ||
      model.cardMotion.requestId !== requestId
    ) {
      return { model }
    }

    const { decision } = model.cardMotion
    const nextModel = modifyFields(model, {
      cardMotion: () => CardMotion.Idle(),
      flyOuts: flyOuts =>
        flyOuts + (isFinished && decision === 'FlewOut' ? 1 : 0),
      springBacks: springBacks =>
        springBacks + (isFinished && decision === 'SprangBack' ? 1 : 0),
    })

    if (isFinished) {
      return { model: nextModel, commands: [ResetCard()] }
    } else {
      return { model: nextModel }
    }
  },

  CompletedResetCard: makeNoopStep(),

  ClickedCountPrimes: model => {
    if (model.primes._tag === 'Running') {
      return { model }
    }

    return {
      model: modifyFields(model, {
        primes: () => PrimeState.Running({ angle: 0 }),
      }),
      commands: [CountPrimes()],
    }
  },

  CompletedCountPrimes: makeFieldsStep.fromMessage(({ count, elapsedMs }) => ({
    primes: () => PrimeState.Succeeded({ count, elapsedMs }),
  })),

  FailedCountPrimes: makeFieldsStep.fromMessage(({ reason }) => ({
    primes: () => PrimeState.Failed({ reason }),
  })),

  TickedSpinner: makeFieldsStep(() => ({
    primes: primes =>
      PrimeState.match(primes, {
        Idle: () => primes,
        Succeeded: () => primes,
        Failed: () => primes,
        Running: ({ angle }) =>
          PrimeState.Running({ angle: angle + SPINNER_STEP_DEGREES }),
      }),
  })),
})

// SUBSCRIPTION

export const subscriptions = makeSubscriptions(entry => ({
  spinner: entry('Spinner', {
    messages: [Message.TickedSpinner],
    when: model => model.primes._tag === 'Running',
    handler: function* () {
      return () =>
        Stream.tick(Duration.millis(SPINNER_INTERVAL_MS)).pipe(
          Stream.drop(1),
          Stream.map(Message.TickedSpinner),
        )
    },
  }),
}))

// EFFECTS

export const EffectsLayer = Layer.mergeAll(
  AnimateCard.layer,
  ResetCard.layer,
  CountPrimes.layer,
  subscriptions.layer,
)
