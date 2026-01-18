# RFC-0019: Mathematical Optimizations for Conditional Logic

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-01-18 |
| **Updated** | 2026-01-18 |
| **Author** | Gustavo Valverde |

## Summary

Replace conditional logic patterns (if/else chains, ternary operators, switch statements) with mathematical approaches where appropriate. This improves performance in hot paths, reduces ZK circuit constraints, and increases code clarity through declarative expressions.

## Problem Statement

The codebase contains several areas where conditional branching could be replaced with mathematical operations:

1. **ZK Circuits**: Conditionals add constraints; arithmetic expressions are cheaper
2. **Merkle Tree Traversal**: Modulo/division can be replaced with faster bitwise operations
3. **Threshold Comparisons**: Direction-based checks use ternaries instead of sign multiplication
4. **Range Validation**: Separate boundary checks instead of clamping functions
5. **Score Classification**: Cascading if/else instead of index-based lookup

**Key principle**: Mathematical expressions are often more performant, testable, and self-documenting than equivalent conditional logic.

## Scope

This RFC covers optimizations in four categories:

| Category | Priority | Impact |
|----------|----------|--------|
| ZK Circuits (Noir) | High | Reduces proof generation time |
| Cryptographic operations | High | Hot path performance |
| State/dispatch logic | Medium | Cognitive load reduction |
| UI/Validation logic | Medium | Code clarity and maintainability |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Bitwise for powers of 2** | `idx & 1` over `idx % 2` | Faster, clearer Merkle intent |
| **Sign multiplication** | `direction * value > threshold` | Single operation vs branch |
| **Clamping pattern** | `Math.max(min, Math.min(max, val))` | Standardized, no branches |
| **Index-based lookup** | Array indexed by `Math.floor(score/step)` | O(1) vs O(n) conditionals |
| **Field arithmetic in ZK** | `a * (1-idx) + b * idx` | Fewer constraints than `if` |

## Proposed Changes

### 1. Merkle Tree Bitwise Operations

**File**: `apps/web/src/lib/privacy/zk/nationality-merkle.ts` (lines 142-148)

```typescript
// Before
let idx = leafIndex;
for (let level = 0; level < TREE_DEPTH; level++) {
  const isRight = idx % 2 === 1;
  const siblingIdx = isRight ? idx - 1 : idx + 1;
  pathElements.push(levels[level][siblingIdx]);
  pathIndices.push(isRight ? 1 : 0);
  idx = Math.floor(idx / 2);
}

// After
let idx = leafIndex;
for (let level = 0; level < TREE_DEPTH; level++) {
  const isRight = idx & 1;
  const siblingIdx = idx ^ 1;
  pathElements.push(levels[level][siblingIdx]);
  pathIndices.push(isRight);
  idx >>= 1;
}
```

**Rationale**:

- `idx & 1` extracts the least significant bit (equivalent to `idx % 2`)
- `idx ^ 1` flips the last bit to get sibling index
- `idx >>= 1` right-shifts (equivalent to `Math.floor(idx / 2)`)
- Standard Merkle tree traversal pattern in cryptographic libraries

### 2. Direction-Based Threshold Checks

**File**: `apps/web/src/lib/trpc/routers/liveness.ts` (lines 287-300)

```typescript
// Before
const yawPassesAbsolute =
  challenge.challengeType === "turn_left"
    ? yaw < -yawThreshold
    : yaw > yawThreshold;

const turnedCorrectDirection =
  challenge.challengeType === "turn_left"
    ? yaw < referenceYaw
    : yaw > referenceYaw;

// After
const direction = challenge.challengeType === "turn_left" ? -1 : 1;
const yawPassesAbsolute = direction * yaw > yawThreshold;
const turnedCorrectDirection = direction * yaw > direction * referenceYaw;
```

**Rationale**:

- Single direction variable eliminates repeated condition evaluation
- Sign multiplication normalizes comparison direction
- Pattern used in game physics and signal processing

### 3. Noir Circuit Merkle Path Selection

**Files**:

- `apps/web/noir-circuits/nationality_membership/src/main.nr` (lines 43-54)
- `apps/web/noir-circuits/address_jurisdiction/src/main.nr` (lines 62-70)

```noir
// Before
for i in 0..TREE_DEPTH {
    let sibling = path_elements[i];
    let (left, right) = if path_indices[i] == 0 {
        (current, sibling)
    } else {
        (sibling, current)
    };
    current = poseidon2([left, right]);
}

// After (verify Noir doesn't already optimize u1 conditionals)
for i in 0..TREE_DEPTH {
    let sibling = path_elements[i];
    let idx = path_indices[i] as Field;
    let left = current * (1 - idx) + sibling * idx;
    let right = sibling * (1 - idx) + current * idx;
    current = poseidon2([left, right]);
}
```

**Rationale**:

- Field arithmetic produces fewer constraints than conditional selection
- `path_indices[i]` is already constrained to {0, 1}
- Standard pattern in Circom/Noir Merkle implementations

**Note**: Noir 0.22+ may already optimize `if` on `u1` types. Verify by comparing constraint counts before/after.

### 4. Score Classification Lookup

**File**: `apps/web/src/components/auth/password-requirements.tsx` (lines 157-171)

```typescript
// Before
const strengthLabel = useMemo(() => {
  if (!password) return " ";
  if (score >= 80) return "Strong";
  if (score >= 55) return "Good";
  if (score >= 30) return "Okay";
  return "Weak";
}, [password, score]);

// After
const STRENGTH_LABELS = ["Weak", "Okay", "Good", "Strong"] as const;
const THRESHOLDS = [30, 55, 80];

const strengthLabel = useMemo(() => {
  if (!password) return " ";
  const index = THRESHOLDS.filter(t => score >= t).length;
  return STRENGTH_LABELS[index];
}, [password, score]);
```

**Rationale**:

- Thresholds and labels are data, not logic
- Adding new levels requires only array changes
- O(k) where k = number of thresholds (constant)

### 5. Range Validation Helper

**File**: `apps/web/src/lib/identity/verification/birth-year.ts`

```typescript
// Before
const epoch = Date.UTC(1900, 0, 1);
const dobMs = Date.UTC(dob.getUTCFullYear(), dob.getUTCMonth(), dob.getUTCDate());
if (dobMs < epoch) return;
const days = Math.floor((dobMs - epoch) / (24 * 60 * 60 * 1000));
return days;

// After (with clamping validation)
const epoch = Date.UTC(1900, 0, 1);
const dobMs = Date.UTC(dob.getUTCFullYear(), dob.getUTCMonth(), dob.getUTCDate());
const days = Math.floor((dobMs - epoch) / (24 * 60 * 60 * 1000));
return days >= 0 ? days : undefined;
```

### 6. Rust Batch Validation

**File**: `apps/fhe/src/routes/batch.rs`

```rust
// Before
if payload.dob_days.is_none()
    && payload.country_code.is_none()
    && payload.compliance_level.is_none()
    && payload.liveness_score.is_none()
{
    return Err(FheError::InvalidInput(...));
}

// After
let has_any = [
    payload.dob_days.is_some(),
    payload.country_code.is_some(),
    payload.compliance_level.is_some(),
    payload.liveness_score.is_some(),
].iter().any(|&v| v);

if !has_any {
    return Err(FheError::InvalidInput(...));
}
```

**Rationale**:

- Declarative check with `.any()`
- Easier to add new fields
- Self-documenting intent

## Code Clarity & Cognitive Load Improvements

Beyond performance, mathematical and declarative approaches reduce cognitive load. The following patterns were identified across the codebase.

### 7. Status/State Lookup Tables

Replace cascading if/else or switch statements with lookup objects.

**File**: `apps/web/src/components/dashboard/verification-progress.tsx` (lines 79-97)

```typescript
// Before
const formatFheError = (issue?: string | null): string | null => {
  if (!issue) return null;
  switch (issue) {
    case "fhe_key_missing":
      return "FHE key registration failed";
    case "fhe_encryption_failed":
      return "FHE encryption failed";
    // ... 5 more cases
    default:
      return issue.replaceAll("_", " ");
  }
};

// After
const FHE_ERROR_MESSAGES: Record<string, string> = {
  fhe_key_missing: "FHE key registration failed",
  fhe_encryption_failed: "FHE encryption failed",
  fhe_service_unavailable: "FHE service unavailable",
  liveness_score_fhe_encryption_failed: "Liveness encryption failed",
  liveness_score_fhe_service_unavailable: "Liveness encryption unavailable",
};

const formatFheError = (issue?: string | null): string | null =>
  !issue ? null : (FHE_ERROR_MESSAGES[issue] ?? issue.replaceAll("_", " "));
```

### 8. Circuit Type Dispatch

**File**: `apps/web/src/lib/trpc/routers/crypto/proof.ts` (lines 112-265)

```typescript
// Before: 8+ if/else if chains
if (circuitType === "age_verification") { /* validation */ }
else if (circuitType === "doc_validity") { /* validation */ }
else if (circuitType === "nationality_membership") { /* validation */ }
else if (circuitType === "face_match") { /* validation */ }

// After: Lookup dispatch
type CircuitValidator = (args: VerifyProofArgs) => Promise<void>;

const circuitValidators: Record<string, CircuitValidator> = {
  age_verification: validateAgeProof,
  doc_validity: validateDocProof,
  nationality_membership: validateNationalityProof,
  face_match: validateFaceProof,
};

const validator = circuitValidators[circuitType];
if (!validator) throw new TRPCError({ code: "BAD_REQUEST" });
await validator(args);
```

### 9. Error Message Pattern Matching

**File**: `apps/web/src/lib/utils/error-messages.ts` (lines 50-115)

```typescript
// Before: 15+ string.includes() checks
if (lower.includes("insufficient funds")) return "Insufficient funds...";
if (lower.includes("rate limit") || lower.includes("too many")) return "Too many attempts...";
if (lower.includes("sendernotallowed") || msg.includes("0x23dada53")) return "ACL denied...";

// After: Regex lookup table
const ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /insufficient funds/i, message: "Insufficient funds for gas fees." },
  { pattern: /rate limit|too many/i, message: "Too many attempts. Please wait." },
  { pattern: /sendernotallowed|0x23dada53/i, message: "ACL permission denied." },
  { pattern: /timeout|etimedout/i, message: "Network is slow. Please retry." },
];

const getUserFriendlyError = (error: unknown): string => {
  const msg = getErrorMessage(error);
  return ERROR_PATTERNS.find(({ pattern }) => pattern.test(msg))?.message ?? msg;
};
```

### 10. Conditional Rendering Config

**File**: `apps/web/src/components/onboarding/face-verification-card.tsx` (lines 87-126)

```typescript
// Before: Multiple {status === "x" ? <Component/> : null} blocks
{status === "idle" ? <ArrowLeftRight /> : null}
{status === "matching" ? <Spinner /> : null}
{status === "matched" ? <Check /> : null}
{status === "no_match" ? <XCircle /> : null}
{status === "error" ? <XCircle /> : null}

// After: Status config object
const STATUS_INDICATORS: Record<FaceMatchStatus, React.ReactNode> = {
  idle: <ArrowLeftRight className="h-6 w-6 text-muted-foreground" />,
  matching: <Spinner className="size-6 text-info" />,
  matched: <Check className="h-6 w-6 text-success" />,
  no_match: <XCircle className="h-6 w-6 text-destructive" />,
  error: <XCircle className="h-6 w-6 text-destructive" />,
};

return <div>{STATUS_INDICATORS[status]}</div>;
```

### 11. Boolean Expression Extraction

**File**: `apps/web/src/components/onboarding/step-account.tsx` (lines 602-677)

```typescript
// Before: Repeated compound conditions in JSX
{status === "idle" && sessionReady && (<Component1 />)}
{status === "idle" && sessionReady && (<Component2 />)}
{status === "idle" && credentialType === null && !isSubmitting && sessionReady && (<Component3 />)}
{status === "idle" && credentialType === "passkey" && !isSubmitting && (<Component4 />)}

// After: Named boolean constants
const isReady = status === "idle" && sessionReady;
const showCredentialChoice = isReady && credentialType === null && !isSubmitting;
const showPasskeyForm = isReady && credentialType === "passkey";
const showPasswordForm = isReady && credentialType === "password" && !isSubmitting;

{isReady && <SessionInfo />}
{showCredentialChoice && <CredentialChoice />}
{showPasskeyForm && <PasskeyForm />}
{showPasswordForm && <PasswordForm />}
```

### 12. Type Guard Utilities

**File**: `apps/web/src/lib/identity/liveness/human-metrics.ts` (lines 56-100)

```typescript
// Before: Repeated typeof checks
if (typeof face?.emotion === "object") { ... }
if (typeof happy?.score === "number") { ... }
if (typeof obj.happy === "number") { ... }

// After: Reusable type guards
const isNumber = (val: unknown): val is number => typeof val === "number";
const isObject = (val: unknown): val is Record<string, unknown> =>
  val !== null && typeof val === "object";

const extractScore = (value: unknown): number => isNumber(value) ? value : 0;
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value : [];

// Usage
const faces = asArray<HumanFaceResult>(res?.face);
const score = extractScore(emotion?.happy);
```

### 13. Fixed-Point Scaling Constants

**File**: Multiple files use `* 10_000` and `/ 10_000` for confidence scores.

```typescript
// Before: Magic numbers scattered
Math.round(input.antispoofScore * 10_000);
Math.round(input.confidence * 10_000);
claimData.confidenceFixed / 10_000;

// After: Named constants and utilities
const CONFIDENCE_SCALE = 10_000;

const toFixedPoint = (value: number): number => Math.round(value * CONFIDENCE_SCALE);
const fromFixedPoint = (value: number): number => value / CONFIDENCE_SCALE;

// Usage
const antispoofFixed = toFixedPoint(input.antispoofScore);
const confidence = fromFixedPoint(claimData.confidenceFixed);
```

### 14. Exponential Backoff Formula

**File**: `apps/web/src/lib/privacy/crypto/tfhe-browser.ts` (lines 159-176)

```typescript
// Before: Inline calculation
const delay = WASM_INIT_BASE_DELAY_MS * 2 ** (attempt - 1);

// After: Named utility
const exponentialBackoff = (attempt: number, baseMs: number, maxMs?: number): number => {
  const delay = baseMs * (2 ** (attempt - 1));
  return maxMs ? Math.min(delay, maxMs) : delay;
};

// Usage
const delay = exponentialBackoff(attempt, 500, 10_000);
```

### 15. Guard State Machine

**File**: `apps/web/src/components/defi-demo/defi-demo-client.tsx` (lines 160-297)

```typescript
// Before: 6 early returns with duplicate card structures
if (!isVerified) { return <Card>...</Card>; }
if (!attestedNetworkId) { return <Card>...</Card>; }
if (!isConnected) { return <Card>...</Card>; }
if (attestationLoading) { return <Card>...</Card>; }
if (needsReAttestation) { return <Card>...</Card>; }
if (walletMismatch) { return <Card>...</Card>; }

// After: State enum with config
type GuardState = "not-verified" | "not-attested" | "not-connected" | "loading" | "needs-reattest" | "wallet-mismatch" | "ready";

const GUARD_CONFIG: Record<Exclude<GuardState, "ready">, { title: string; icon: React.ReactNode }> = {
  "not-verified": { title: "Verification Required", icon: <Lock /> },
  "not-attested": { title: "Attestation Required", icon: <Shield /> },
  "not-connected": { title: "Wallet Required", icon: <Wallet /> },
  "loading": { title: "Loading...", icon: <Spinner /> },
  "needs-reattest": { title: "Re-attestation Required", icon: <RefreshCw /> },
  "wallet-mismatch": { title: "Wrong Wallet", icon: <AlertTriangle /> },
};

const guardState = getGuardState(props);
if (guardState !== "ready") {
  return <GuardCard {...GUARD_CONFIG[guardState]} />;
}
```

## Already Optimal Patterns

The codebase already uses excellent mathematical approaches in several areas:

| Location | Pattern | Status |
|----------|---------|--------|
| `image-processing.ts:34-37` | Bounded crop with `Math.max/min` | ✅ Optimal |
| `noir-worker-manager.ts:203-206` | Safe decrement `Math.max(0, n-1)` | ✅ Optimal |
| `oval-frame.tsx:28-49` | Linear color interpolation | ✅ Optimal |
| `date-parsing.ts:52` | Date encoding `y*10000 + m*100 + d` | ✅ Optimal |
| `claims-signing.ts:221-222` | Fixed-point `Math.round(v * 10_000)` | ✅ Optimal |
| `settings.rs:64` | Rust `.saturating_mul()` | ✅ Optimal |
| `age_verification/main.nr:56` | Arithmetic comparison `>=` | ✅ Optimal |

## Migration Strategy

1. **Phase 1**: High-impact cryptographic paths (Merkle, ZK circuits)
2. **Phase 2**: Liveness/threshold checks
3. **Phase 3**: UI classification logic (low priority)

Each change should:

- Include unit tests covering edge cases
- Verify identical behavior via property-based testing
- For ZK circuits: compare constraint counts before/after

## Performance Considerations

| Optimization | Expected Improvement |
|--------------|---------------------|
| Bitwise Merkle traversal | ~10-20% faster in JS |
| ZK field arithmetic | Fewer constraints (measure per circuit) |
| Sign multiplication | Eliminates branch prediction misses |
| Lookup tables | O(1) vs O(n) for classifications |

## Summary of All Optimizations

| # | Pattern | Location | Category | Priority |
|---|---------|----------|----------|----------|
| 1 | Merkle bitwise ops | `nationality-merkle.ts` | Crypto | High |
| 2 | Direction sign multiplication | `liveness.ts` | Crypto | High |
| 3 | Noir field arithmetic | `nationality_membership/main.nr` | ZK | High |
| 4 | Score classification lookup | `password-requirements.tsx` | UI | Medium |
| 5 | Range validation clamping | `birth-year.ts` | Validation | Medium |
| 6 | Rust `.any()` validation | `batch.rs` | Validation | Medium |
| 7 | Status lookup tables | `verification-progress.tsx` | UI | Medium |
| 8 | Circuit type dispatch | `proof.ts` | Logic | Medium |
| 9 | Error pattern matching | `error-messages.ts` | Logic | Medium |
| 10 | Conditional render config | `face-verification-card.tsx` | UI | Low |
| 11 | Boolean expression extraction | `step-account.tsx` | UI | Low |
| 12 | Type guard utilities | `human-metrics.ts` | Validation | Low |
| 13 | Fixed-point constants | Multiple files | Crypto | Low |
| 14 | Exponential backoff | `tfhe-browser.ts` | Logic | Low |
| 15 | Guard state machine | `defi-demo-client.tsx` | UI | Low |

## Testing Requirements

- [ ] Unit tests for bitwise Merkle operations
- [ ] Property tests: `forall idx, (idx & 1) === (idx % 2 === 1 ? 1 : 0)`
- [ ] ZK constraint count comparison before/after
- [ ] Liveness direction tests with positive/negative yaw values
- [ ] Score classification boundary tests (29, 30, 31, 54, 55, 56, etc.)
- [ ] Lookup table coverage for all status/error types
- [ ] Type guard utilities with edge cases (null, undefined, wrong types)

## References

- [Bitwise Operations for Binary Trees](https://en.wikipedia.org/wiki/Binary_heap#Derivation_of_index_equations)
- [FROST RFC 9591](https://www.rfc-editor.org/rfc/rfc9591.html) - Threshold signatures
- [Noir Docs: Optimizing Circuits](https://noir-lang.org/docs/)
- [Math.sign() MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/sign)

## Appendix: Mathematical Patterns Reference

### Bitwise Operations (Powers of 2)

```typescript
// Modulo 2
x % 2 === 1  →  (x & 1) === 1

// Divide by 2 (floor)
Math.floor(x / 2)  →  x >> 1

// Multiply by 2
x * 2  →  x << 1

// Toggle last bit (sibling in tree)
isRight ? x - 1 : x + 1  →  x ^ 1

// Check power of 2
(x & (x - 1)) === 0
```

### Clamping

```typescript
// Range clamping
if (x < min) x = min;
if (x > max) x = max;
→  Math.max(min, Math.min(max, x))

// Lower bound only
if (x < 0) x = 0;
→  Math.max(0, x)
```

### Direction Normalization

```typescript
// Direction-based comparison
direction === "left" ? value < threshold : value > threshold
→  sign * value > threshold  // where sign = direction === "left" ? -1 : 1
```

### Boolean to Number

```typescript
// Conditional increment
count + (condition ? 1 : 0)
→  count + Number(condition)
→  count + +condition
```
