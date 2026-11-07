---
'foldkit': minor
---

Strict views add `createStrictLazy` and `createStrictKeyedLazy`. They reuse a view's node while the builder, the view function, and its arguments are unchanged, so a screen whose Model fields did not change is not rebuilt. On native, the renderer also skips the reused subtree. `mapMessages` returns the same builder for the same parent builder and function, so nodes built with a mapped builder can be reused. Hosts that implement `StrictHtmlBuilder` add a `lazy` hook.
