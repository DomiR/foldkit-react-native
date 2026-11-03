/** A cancellable task boundary for a Message queue that has exhausted its budget.
 * @experimental The runtime platform contract may change between releases. */
export type DrainScheduler = Readonly<{
  schedule: () => void
  dispose: () => void
}>
