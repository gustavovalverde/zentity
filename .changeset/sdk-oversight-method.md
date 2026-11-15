---
"@zentity/sdk": minor
---

`OversightMethod` now names the approval methods Zentity records: `capability_grant`, `session`, and `user_verification`. The `biometric` and `email` values are removed; `user_verification` replaces `biometric` and means a passkey assertion with the user-verified flag set, and an approval from an email link is a `session` approval.

`CibaTokenSet` gains `oversight: { method, approved_at }`, read from the CIBA token response, which tells a client how and when the user approved its request. An `oversight` member the SDK does not recognize is ignored.
