---
'foldkit': minor
---

Improve strict web accessibility and reduced-motion behavior.

- Checked inputs get `role=switch`.
- Selected tab content gets `role=tabpanel` and is labelled with the tab title.
- Strict transitions and Entering animations honour `prefers-reduced-motion`. Transitions shorten to 1ms so `OnTransitionEnd` still fires, and entering keyframes are skipped.
- `animateTo` jumps to its target under reduced motion.
- Elements with strict transitions render inside a `display: contents` wrapper and carry `data-foldkit-strict-motion`.
