---
"@zentity/sdk": minor
---

`PaymentAuthorizationSchema` now refuses a `payment_authorization` entry with a field it does not define, at every level (`chain`, `amount`, and `expires_at` included), instead of dropping the field. Zentity answers such a request with `invalid_authorization_details` (RFC 9396 §5).

`PAYMENT_AUTHORIZATION_CAPABILITY` (`payment_authorization:sign`) names the agent capability only. It is no longer an OAuth scope: send a payment with `scope=openid` and register the client with `authorization_details_types: ["payment_authorization"]`.
