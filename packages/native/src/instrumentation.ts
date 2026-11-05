/** Timing hooks for measuring native runtime updates, views, and commits. All timestamps are performance.now() milliseconds. onCommit fires in a layout effect after React commits the snapshot to the native (Fabric) shadow tree, before the UI thread mounts it. */
export type NativeInstrumentation = Readonly<{
  onUpdate: (startedAt: number, endedAt: number) => void
  onView: (startedAt: number, endedAt: number) => void
  onCommit: (committedAt: number) => void
}>
