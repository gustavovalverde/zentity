---
"@zentity/sdk": minor
---

Remove the `ensureOpaqueReady`, `startOpaqueLogin`, `finishOpaqueLogin`, `OpaqueStartResult`, and `OpaqueFinishResult` exports from `@zentity/sdk/fpa`. They only renamed `@serenity-kit/opaque`; import `client` and `ready` from that package instead.

CIBA authorization and token responses are now validated: a response without `auth_req_id` or `access_token` throws instead of producing a token set with an undefined access token. Agent registration response errors now read `Invalid host registration response: ...` and `Invalid session registration response: ...`. `createJwksTokenVerifier` keeps one key set and passes `jwksTtlMs` to jose as `cacheMaxAge`, so jose also refetches on an unknown `kid` after its cooldown.
