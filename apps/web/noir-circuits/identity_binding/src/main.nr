// Identity Binding Circuit
//
// Proves that a proof is bound to a specific user identity by verifying a
// cryptographic commitment. This circuit is auth-mode agnostic - the binding
// secret is derived differently per authentication mode, but the circuit
// logic is identical.
//
// Auth Mode Secret Sources:
//   - Passkey: PRF output (32 bytes) from WebAuthn authenticator
//   - OPAQUE:  Export key (64 bytes) from password-authenticated key exchange
//   - Wallet:  EIP-712 signature (65 bytes) from user's crypto wallet
//
// Public inputs:
//   - nonce: Challenge nonce for replay resistance
//   - binding_commitment: Expected Poseidon2(binding_secret || user_id_hash || document_hash)
//   - auth_mode: 0=passkey, 1=opaque, 2=wallet (for audit/verification purposes)
//
// Private inputs:
//   - binding_secret: Auth-mode-specific cryptographic secret (kept private)
//   - user_id_hash: Hash of the user ID (kept private)
//   - document_hash: Document commitment from OCR (kept private)
//
// Output:
//   - Returns true if the binding commitment is valid
//
// Security properties:
//   - Binding secret never leaves the client (privacy)
//   - Commitment binds proof to specific user + document (integrity)
//   - Nonce prevents replay attacks (freshness)
//   - Auth mode is public for verification auditing

use nodash::poseidon2;

fn main(
    binding_secret: Field,           // Private: auth-mode-specific secret
    user_id_hash: Field,             // Private: hash of user ID
    document_hash: Field,            // Private: document commitment
    nonce: pub Field,                // Public: challenge nonce (replay resistance)
    binding_commitment: pub Field,   // Public: pre-computed commitment to verify
    auth_mode: pub Field             // Public: 0=passkey, 1=opaque, 2=wallet
) -> pub bool {
    // Nonce is included as public input for replay resistance
    // It binds this proof to a specific challenge session
    let _ = nonce;

    // Auth mode is public for verification auditing
    // It doesn't affect the binding computation but allows verifiers
    // to understand which authentication method was used
    let auth_mode_u8 = auth_mode as u8;
    assert(auth_mode_u8 <= 2, "Invalid auth mode");

    // Compute binding commitment from private inputs
    // binding_commitment = Poseidon2(binding_secret, user_id_hash, document_hash)
    //
    // This three-way binding ensures:
    // - binding_secret: ties to specific authentication session
    // - user_id_hash: ties to specific user account
    // - document_hash: ties to specific identity document
    let computed_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    // Verify the commitment matches
    assert(computed_commitment == binding_commitment, "Binding commitment mismatch");

    true
}

// Helper function to compute user ID hash (for testing)
fn hash_user_id(user_id: Field) -> Field {
    poseidon2([user_id])
}

#[test]
fn test_passkey_binding() {
    // Simulate passkey PRF output binding
    let binding_secret: Field = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    let user_id: Field = 12345;
    let user_id_hash = hash_user_id(user_id);
    let document_hash: Field = 0xdeadbeef;
    let nonce: Field = 99999;
    let auth_mode: Field = 0; // passkey

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let result = main(
        binding_secret,
        user_id_hash,
        document_hash,
        nonce,
        binding_commitment,
        auth_mode
    );
    assert(result == true);
}

#[test]
fn test_opaque_binding() {
    // Simulate OPAQUE export key binding (use smaller value within field range)
    let binding_secret: Field = 0xfedcba0987654321fedcba0987654321;
    let user_id: Field = 67890;
    let user_id_hash = hash_user_id(user_id);
    let document_hash: Field = 0xcafebabe;
    let nonce: Field = 11111;
    let auth_mode: Field = 1; // opaque

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let result = main(
        binding_secret,
        user_id_hash,
        document_hash,
        nonce,
        binding_commitment,
        auth_mode
    );
    assert(result == true);
}

#[test]
fn test_wallet_binding() {
    // Simulate wallet signature binding (use smaller value within field range)
    let binding_secret: Field = 0xabcdef123456789abcdef123456789ab;
    let user_id: Field = 13579;
    let user_id_hash = hash_user_id(user_id);
    let document_hash: Field = 0xf00df00d;
    let nonce: Field = 22222;
    let auth_mode: Field = 2; // wallet

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let result = main(
        binding_secret,
        user_id_hash,
        document_hash,
        nonce,
        binding_commitment,
        auth_mode
    );
    assert(result == true);
}

#[test(should_fail_with = "Binding commitment mismatch")]
fn test_wrong_commitment_fails() {
    let binding_secret: Field = 0x1234;
    let user_id_hash: Field = 0x5678;
    let document_hash: Field = 0x9abc;
    let nonce: Field = 33333;
    let auth_mode: Field = 0;

    // Use wrong commitment
    let wrong_commitment: Field = 0xbad;

    let _ = main(
        binding_secret,
        user_id_hash,
        document_hash,
        nonce,
        wrong_commitment,
        auth_mode
    );
}

#[test(should_fail_with = "Binding commitment mismatch")]
fn test_different_secret_fails() {
    let binding_secret: Field = 0x1234;
    let user_id_hash: Field = 0x5678;
    let document_hash: Field = 0x9abc;
    let nonce: Field = 44444;
    let auth_mode: Field = 0;

    // Compute commitment with correct secret
    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    // Try to verify with different secret
    let different_secret: Field = 0x4321;
    let _ = main(
        different_secret,
        user_id_hash,
        document_hash,
        nonce,
        binding_commitment,
        auth_mode
    );
}

#[test(should_fail_with = "Binding commitment mismatch")]
fn test_different_user_fails() {
    let binding_secret: Field = 0x1234;
    let user_id: Field = 11111;
    let user_id_hash = hash_user_id(user_id);
    let document_hash: Field = 0x9abc;
    let nonce: Field = 55555;
    let auth_mode: Field = 0;

    // Compute commitment with correct user
    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    // Try to verify with different user
    let different_user: Field = 22222;
    let different_user_hash = hash_user_id(different_user);
    let _ = main(
        binding_secret,
        different_user_hash,
        document_hash,
        nonce,
        binding_commitment,
        auth_mode
    );
}

#[test(should_fail_with = "Binding commitment mismatch")]
fn test_different_document_fails() {
    let binding_secret: Field = 0x1234;
    let user_id_hash: Field = 0x5678;
    let document_hash: Field = 0x9abc;
    let nonce: Field = 66666;
    let auth_mode: Field = 0;

    // Compute commitment with correct document
    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    // Try to verify with different document
    let different_document: Field = 0xdef0;
    let _ = main(
        binding_secret,
        user_id_hash,
        different_document,
        nonce,
        binding_commitment,
        auth_mode
    );
}

#[test(should_fail_with = "Invalid auth mode")]
fn test_invalid_auth_mode_fails() {
    let binding_secret: Field = 0x1234;
    let user_id_hash: Field = 0x5678;
    let document_hash: Field = 0x9abc;
    let nonce: Field = 77777;
    let invalid_auth_mode: Field = 5; // Invalid (only 0, 1, 2 allowed)

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let _ = main(
        binding_secret,
        user_id_hash,
        document_hash,
        nonce,
        binding_commitment,
        invalid_auth_mode
    );
}

#[test]
fn test_nonce_uniqueness() {
    // Verify that different nonces produce valid proofs
    // (nonce doesn't affect commitment, only replay protection)
    let binding_secret: Field = 0xaabbccdd;
    let user_id_hash: Field = 0x11223344;
    let document_hash: Field = 0x55667788;
    let auth_mode: Field = 1;

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    // First nonce
    let result1 = main(
        binding_secret,
        user_id_hash,
        document_hash,
        88888,
        binding_commitment,
        auth_mode
    );
    assert(result1 == true);

    // Different nonce should also work (commitment unchanged)
    let result2 = main(
        binding_secret,
        user_id_hash,
        document_hash,
        99999,
        binding_commitment,
        auth_mode
    );
    assert(result2 == true);
}
