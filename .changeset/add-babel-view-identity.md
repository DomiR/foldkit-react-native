---
'@foldkit/vite-plugin': minor
---

Add a Babel plugin subpath for Metro that applies Foldkit view identity branding to native modules and leaves worklet functions untouched.

Package-root detection walks `node_modules` from the application root through its ancestors and does not read `NODE_PATH`.
