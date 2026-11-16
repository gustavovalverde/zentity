---
"@zentity/sdk": patch
---

`agent.requestCapability` reuses a cached token set only when a capability grant approved it, and only for a request with the same action, audience, scope, resource, and authorization details. A manually approved token set is never reused, so one user approval cannot stand in for a later request with different details.
