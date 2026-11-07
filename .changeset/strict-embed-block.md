---
'foldkit': minor
---

Strict views add `embedBlock` and `embedKeyedBlock`. A Block program's strict view renders a child Block's strict view at a position, and Messages from the child view reach the child Block through its Binding, as they do from a web view rendered with `h.block`. Embedded child views can embed their own children. On the web, an embedded child renders through `h.block`, so its Messages carry their occurrence generation and its Mounts are scoped to the child.
