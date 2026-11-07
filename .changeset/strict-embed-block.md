---
'foldkit': minor
---

Strict views add `embedBlock` and `embedKeyedBlock`. A Block program's strict view renders a child Block's strict view at a position, and Messages from the child view reach the child Block through its Binding, as they do from a web view rendered with `h.block`. Embedded child views can embed their own children.
