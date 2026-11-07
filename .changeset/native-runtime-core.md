---
'foldkit': minor
---

Add an experimental `foldkit/runtime-core` entry for platform renderers and hosts. It runs Foldkit's Message queue, Commands, Subscriptions, ManagedResources, Ports, and DevTools store with platform-supplied rendering and services. A runtime started without a Block graph receives its services, including Command handler Layers, through `applicationLayer`.
