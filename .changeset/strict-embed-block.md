---
'foldkit': minor
---

Strict views add `h.block(binding, model, view, options?)`. A Block program's strict view renders a child Block's strict view at that position, and Messages from the child view reach the child Block through its Binding. Pass `{ key }` for one occurrence of a keyed Binding. Each child Message carries its occurrence's generation, so a Message from a replaced child view is dropped. On the web, `h.block` renders through the web builder's `h.block`. Platform hosts resolve child Blocks with `makeBlockScopes` from `foldkit/runtime-core`, read live generations and admit view Messages through the renderer context's `blockOccurrences`. Hosts that implement `StrictHtmlBuilder` add a `block` method.
