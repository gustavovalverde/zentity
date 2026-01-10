# RFC-0015: FROST Threshold Registrar

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2025-01-06 |
| **Updated** | 2026-01-10 |
| **Author** | Gustavo Valverde |

## Summary

Decentralize the attestation signing authority by replacing the single registrar private key with a FROST threshold signing scheme. Instead of one server holding the registrar key, a threshold (t-of-n) of distributed signers must collaborate to authorize on-chain attestations. This eliminates single points of compromise and enables multi-party governance of the attestation process.

## Problem Statement

Currently, the `IdentityRegistry` contract is controlled by a single registrar address derived from `REGISTRAR_PRIVATE_KEY`. This creates:

- **Single point of compromise**: If the key is leaked, attackers can forge attestations
- **No separation of duties**: One entity controls all attestations
- **Key management burden**: Secure storage of a high-value private key
- **No audit trail for signing**: No visibility into who authorized each attestation

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Signing scheme** | FROST (t-of-n) | RFC 9591 standard, produces standard Schnorr signatures |
| **FROST library** | ZcashFoundation/frost (frost-secp256k1 + frost-ed25519) | Supports secp256k1 + ed25519 ciphersuites |
| **On-chain verification** | ecrecover trick for Schnorr | ~3,300 gas, no protocol changes needed |
| **Contract approach** | New SchnorrRegistrar contract | IdentityRegistry unchanged; SchnorrRegistrar becomes authorized registrar |
| **Signer infrastructure** | Distributed services with mTLS | Each signer runs independently; coordinator aggregates |

**Key material outputs**

- **Group verifying key** (`group_pubkey`): used by the SchnorrRegistrar contract on-chain.
- **Public key package** (`public_key_package`): used by signers/coordinator during signing sessions.

## Architecture Overview

```text
┌──────────────────────────────────────────────────────────────────┐
│                    Threshold Registrar Flow                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Attestation Request                                              │
│         ↓                                                         │
│  ┌─────────────────┐                                              │
│  │ FROST Coordinator│ ← Collects t-of-n partial signatures        │
│  └────────┬────────┘                                              │
│           │                                                       │
│  ┌────────┴────────┬──────────────┬──────────────┐                │
│  ↓                 ↓              ↓              ↓                │
│  Signer 1       Signer 2      Signer 3      Signer N              │
│  (Zentity)      (Auditor)     (Partner)     (...)                 │
│           │                                                       │
│  ┌────────┴────────┐                                              │
│  │ Aggregate FROST │ → Single Schnorr signature                   │
│  │    Signature    │                                              │
│  └────────┬────────┘                                              │
│           ↓                                                       │
│  ┌────────────────────┐                                           │
│  │ SchnorrRegistrar   │ ← New contract: verifies Schnorr sig      │
│  │    Contract        │   then calls IdentityRegistry             │
│  └────────┬───────────┘                                           │
│           ↓                                                       │
│  ┌────────────────────┐                                           │
│  │  IdentityRegistry  │ ← Existing contract (unchanged)           │
│  │    (fhEVM)         │   SchnorrRegistrar added as registrar     │
│  └────────────────────┘                                           │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Why This Approach

- **No protocol changes**: Works on any EVM chain via ecrecover precompile
- **IdentityRegistry unchanged**: Deploy new SchnorrRegistrar; add it as authorized registrar
- **Standard Schnorr output**: FROST produces signatures verifiable by standard algorithms
- **Composable**: Can add/remove signers by deploying new SchnorrRegistrar with new group key

## Schnorr Verification on Ethereum

Schnorr signatures CAN be verified on Ethereum via the `ecrecover` precompile trick:

- **Gas cost**: ~3,300 gas total
- **No protocol changes**: Uses existing ecrecover (0x01) precompile
- **Reference**: [hackmd.io/@0xbobby/Bk-bez9xkl](https://hackmd.io/@0xbobby/Bk-bez9xkl)

### How It Works

Standard Schnorr verification: Given public key `P`, message `m`, signature `(R, s)`:

1. Compute `e = H(R || P || m)`
2. Verify `s*G == R + e*P`

The ecrecover trick reformulates this into a form that ecrecover can verify:

```solidity
uint256 constant Q = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

function verifySchnorr(
    bytes32 pubkeyX,
    uint8 pubkeyParity,  // 27 or 28
    bytes32 message,
    bytes32 e,           // Schnorr challenge
    bytes32 s            // Schnorr signature
) internal pure returns (bool) {
    bytes32 sp = bytes32(Q - mulmod(uint256(s), uint256(pubkeyX), Q));
    bytes32 ep = bytes32(Q - mulmod(uint256(e), uint256(pubkeyX), Q));
    return ecrecover(sp, pubkeyParity, pubkeyX, ep) == address(0);
}
```

### fhEVM Contract Status

- **Current**: Simple `msg.sender` checks via `onlyRegistrar` modifier
- **NOT upgradeable**: Contracts are immutable
- **Extension path**: Deploy SchnorrRegistrar; call `addRegistrar(schnorrRegistrarAddress)`

## Smart Contract Design

### SchnorrRegistrar.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "../interfaces/IIdentityRegistry.sol";
import {einput} from "fhevm/lib/TFHE.sol";

/**
 * @title SchnorrRegistrar
 * @notice Verifies FROST Schnorr signatures and forwards attestations to IdentityRegistry
 * @dev Uses ecrecover trick for gas-efficient Schnorr verification (~3,300 gas)
 */
contract SchnorrRegistrar {
    uint256 constant Q = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    IIdentityRegistry public immutable identityRegistry;
    bytes32 public immutable frostGroupPubkeyX;
    uint8 public immutable frostGroupPubkeyParity;

    event AttestationSubmitted(address indexed user, bytes32 indexed messageHash);
    error InvalidSchnorrSignature();
    error ZeroAddress();

    constructor(address _identityRegistry, bytes32 _pubkeyX, uint8 _pubkeyParity) {
        if (_identityRegistry == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(_identityRegistry);
        frostGroupPubkeyX = _pubkeyX;
        frostGroupPubkeyParity = _pubkeyParity;
    }

    /**
     * @notice Submit attestation with FROST Schnorr signature
     */
    function attestWithSchnorr(
        address user,
        bytes32 e,
        bytes32 s,
        einput encryptedBirthYearOffset,
        einput encryptedCountryCode,
        einput encryptedComplianceLevel,
        einput encryptedLivenessScore,
        bytes32 proofSetHash,
        bytes32 policyHash,
        bytes calldata inputProof
    ) external {
        bytes32 messageHash = keccak256(abi.encodePacked(
            user, encryptedBirthYearOffset, encryptedCountryCode,
            encryptedComplianceLevel, encryptedLivenessScore,
            proofSetHash, policyHash
        ));

        if (!_verifySchnorr(messageHash, e, s)) {
            revert InvalidSchnorrSignature();
        }

        emit AttestationSubmitted(user, messageHash);

        identityRegistry.attestIdentity(
            user, encryptedBirthYearOffset, encryptedCountryCode,
            encryptedComplianceLevel, encryptedLivenessScore,
            proofSetHash, policyHash, inputProof
        );
    }

    function _verifySchnorr(bytes32 message, bytes32 e, bytes32 s) internal view returns (bool) {
        bytes32 sp = bytes32(Q - mulmod(uint256(s), uint256(frostGroupPubkeyX), Q));
        bytes32 ep = bytes32(Q - mulmod(uint256(e), uint256(frostGroupPubkeyX), Q));
        return ecrecover(sp, frostGroupPubkeyParity, frostGroupPubkeyX, ep) == address(0);
    }

    function getGroupPubkey() external view returns (bytes32 x, uint8 parity) {
        return (frostGroupPubkeyX, frostGroupPubkeyParity);
    }
}
```

### IIdentityRegistry Interface

```solidity
interface IIdentityRegistry {
    function attestIdentity(
        address user,
        einput encryptedBirthYearOffset,
        einput encryptedCountryCode,
        einput encryptedComplianceLevel,
        einput encryptedLivenessScore,
        bytes32 proofSetHash,
        bytes32 policyHash,
        bytes calldata inputProof
    ) external;

    function addRegistrar(address registrar) external;
    function removeRegistrar(address registrar) external;
}
```

## Configuration

```bash
# apps/web/.env (current signer wiring)

SIGNER_COORDINATOR_URL=http://localhost:5002
SIGNER_ENDPOINTS=https://signer1.example.com,https://signer2.example.com,https://signer3.example.com
INTERNAL_SERVICE_TOKEN=...            # required in production
INTERNAL_SERVICE_TOKEN_REQUIRED=1

# Registrar config (future wiring)
FROST_REGISTRAR_ENABLED=true
FROST_GROUP_PUBKEY_X=0x...            # Group public key X coordinate
FROST_GROUP_PUBKEY_PARITY=27          # Y parity (27 or 28)
FROST_SCHNORR_REGISTRAR=0x...         # SchnorrRegistrar contract address
```

## Implementation Files

### New Files

| Category | Files |
|----------|-------|
| **Contracts** | `registrar/SchnorrRegistrar.sol`, `interfaces/ISchnorrRegistrar.sol`, `test/SchnorrRegistrar.t.sol` |
| **Signer service** | `apps/signer/` (coordinator + signer binaries) |
| **Coordinator client** | `apps/web/src/lib/recovery/frost-service.ts` |
| **Provider (planned)** | `apps/web/src/lib/blockchain/providers/frost-provider.ts` |

### Modified Files

- `apps/web/src/lib/utils/service-urls.ts` - Signer URL resolution
- `apps/web/src/lib/blockchain/providers/base-provider.ts` - Add FROST account option (planned)
- `apps/web/src/lib/blockchain/config/networks.ts` - Add FROST configuration (planned)
- `contracts/deploy/` - Deploy SchnorrRegistrar (planned)

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| **Signer compromise** | t-of-n threshold; single signer compromise insufficient |
| **Network interception** | mTLS between coordinator and signers |
| **Replay attacks** | Session-bound nonces; never reuse |
| **Key storage** | HSM or secure enclave for production signers |
| **Coordinator DoS** | Authentication required; per-signer rate limits |

### Audit Trail

All signing sessions logged with: session ID, message hash, participating signers, timestamps, success/failure.

### Key Rotation

1. Perform new DKG with (potentially different) signers
2. Deploy new SchnorrRegistrar with new group key
3. Add new registrar to IdentityRegistry
4. Remove old registrar (optional)

## Gas Costs

| Operation | Gas |
|-----------|-----|
| Schnorr verification | ~3,300 |
| keccak256 hash | ~30 + 6/word |
| **Total overhead** | ~3,500 |

## Migration Path

### Phase 1: Parallel Operation

- Deploy SchnorrRegistrar
- Add as additional registrar
- Route new attestations through FROST
- Keep existing registrar as fallback

### Phase 2: Full Migration

- Validate FROST signing reliability
- Remove single-key registrar
- SchnorrRegistrar becomes sole registrar

### Phase 3: Multi-Org Signers

- Onboard external signer operators (auditors, partners)
- Increase threshold as appropriate
- Formalize signing governance

## Deployment Process

1. **Generate FROST key shares** (offline ceremony or DKG)
2. **Distribute key shares** to signer operators
3. **Deploy SchnorrRegistrar** with group public key
4. **Add SchnorrRegistrar as registrar** on IdentityRegistry
5. **Configure coordinator** with signer endpoints
6. **Test end-to-end** attestation flow

## Shared Infrastructure

Client-side WASM bindings are deferred. Current implementation uses the signer service (`apps/signer`) and the coordinator client in `apps/web/src/lib/recovery/frost-service.ts`. WASM bindings will be revisited if/when browser signers are needed.

## References

- [RFC 9591: Two-Round Threshold Schnorr Signatures with FROST](https://datatracker.ietf.org/doc/rfc9591/)
- [ZcashFoundation/frost](https://github.com/ZcashFoundation/frost)
- [Schnorr verification via ecrecover](https://hackmd.io/@0xbobby/Bk-bez9xkl)
- [ERC-7816 (closed)](https://github.com/ethereum/ERCs/pull/713) - Proposed Schnorr precompile (not adopted)
- [The ZF FROST Book](https://frost.zfnd.org/)
- [RFC-0014: FROST Social Recovery](0014-frost-social-recovery.md)
