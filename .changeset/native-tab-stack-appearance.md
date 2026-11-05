---
'@foldkit/native': patch
---

Defer iOS stack changes in hidden tabs until the selected tab finishes appearing. Switching tabs and replacing a screen in one Model update can otherwise leave the root title, a missing back button, and content under the header. The renderer applies the latest Model stack after native appearance. Android stack updates are immediate.
