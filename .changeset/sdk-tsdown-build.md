---
"@zentity/sdk": patch
---

The SDK build moves from tsup to tsdown. Entry points, the `exports` map, and the public types are unchanged. The CommonJS output now shares code between entry points, so a class such as `IntentHashError` is the same object whether it is required from `@zentity/sdk` or `@zentity/sdk/protocol`. Built files import Node built-ins with the `node:` prefix, and the shared chunk file names inside `dist` change. No source maps are published.
