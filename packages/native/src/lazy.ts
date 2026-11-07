import type { NativeNode } from './node'

type LazyNode<Message> = Extract<
  NativeNode<Message>,
  Readonly<{ _tag: 'Lazy' }>
>

/** Returns the node a chain of Lazy nodes reuses. @internal */
export const unwrapLazy = <Message>(
  node: NativeNode<Message>,
): Exclude<NativeNode<Message>, LazyNode<Message>> =>
  node._tag === 'Lazy' ? unwrapLazy(node.node) : node
