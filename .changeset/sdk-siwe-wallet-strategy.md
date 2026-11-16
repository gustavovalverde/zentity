---
"@zentity/sdk": minor
---

First-party wallet sign-in now signs a Sign-In with Ethereum (EIP-4361) message, so `WalletAuthorizationStrategy` takes `signMessage(message)` instead of `signTypedData(typedData)`. Implement it with EIP-191 `personal_sign`, for example viem's `account.signMessage({ message })`; the challenge endpoint now answers with `challenge_type: "siwe"` and a `message` string, and expects `siwe_signature` back.
