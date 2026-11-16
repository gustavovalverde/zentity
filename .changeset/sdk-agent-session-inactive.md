---
"@zentity/sdk": minor
---

`beginCibaApproval` and `requestCibaApproval` throw `CibaAuthorizationError` when bc-authorize refuses a request, with the response `status`, `error`, and `errorDescription`; the message is unchanged. Zentity refuses an Agent-Assertion whose session is unknown, revoked, idle past its TTL, or past its lifetime with `invalid_request` and the description `AGENT_SESSION_INACTIVE_DESCRIPTION` (from `@zentity/sdk/agent-contract`), separate from an assertion that does not match its request. `isAgentSessionInactiveError(error)` recognizes that refusal, so a long-running agent can register a new session, sign the request again, and retry once.
