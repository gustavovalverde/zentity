---
"@zentity/sdk": minor
---

`signAgentAssertion` signs over the whole CIBA request: it takes the request's `scope`, and its `acrValues` and `authorizationDetails` when sent, beside `bindingMessage`, and sets `task_hash` to `taskHash` of that request instead of the SHA-256 of the binding message. Zentity refuses an assertion whose hash does not match the request with `invalid_request` "Agent-Assertion does not match this request", so sign the assertion after building the request and send the request unchanged.

`createAgent` takes `signAgentAssertion`, a function that signs each request as the agent sends it, in place of a prebuilt `agentAssertion` on `requestApproval`.
