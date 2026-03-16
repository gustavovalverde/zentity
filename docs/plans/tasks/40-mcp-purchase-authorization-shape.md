# Task 40: MCP Purchase Authorization Shape

> Phase 2 of [Cross-App Auth Hardening](../cross-app-auth-hardening.md)
> Finding: #11 (RAR shape mismatch)

## Status: Not started

## Problem

The MCP purchase tool sends `authorization_details` with flat fields:

```json
{ "type": "purchase", "merchant": "...", "amount": 42, "currency": "USD", "item": "..." }
```

The web app universally expects the nested RAR shape:

```json
{ "type": "purchase", "merchant": "...", "item": "...", "amount": { "value": "9.99", "currency": "USD" } }
```

This mismatch causes:

- **Boundary evaluation** skips amount checks (`purchase.amount.value` → `(42).value` → `undefined`)
- **Email notifications** omit the purchase amount
- **Approval UI** doesn't show the amount
- **Push notifications** lose the amount

## Solution

Change the purchase tool's `authorizationDetails` construction to use the nested shape. The `amount` parameter (number) must be converted to `{ value: string, currency: string }`.

Canonical shape (from demo-rp Aether AI and all web app consumers):

```json
{
  "type": "purchase",
  "merchant": "Merchant Name",
  "item": "Item Name",
  "amount": { "value": "9.99", "currency": "USD" }
}
```

The `value` field is a **string** (not number) — this matches the RAR convention for monetary amounts and what `Number.parseFloat()` in boundary evaluation expects.

## Acceptance criteria

- [ ] Purchase tool sends `authorization_details` with `amount: { value: string, currency: string }`
- [ ] `amount` at the top level of the detail object is the nested object, not a flat number
- [ ] Test: verify the shape matches what `boundary-evaluation.ts` reads (`purchase.amount.value`, `purchase.amount.currency`)

## Notes

- This depends on Phase 1 (MCP HTTP auth) being complete for end-to-end testing
- The `amount` Zod schema in the tool definition stays as `z.number()` — the conversion to `{ value: string, currency }` happens inside the tool handler
