// Identity Binding Circuit
//
// Proves that a proof is bound to a specific user identity by verifying a
// cryptographic commitment. This circuit is auth-mode agnostic - the binding
// secret is derived differently per authentication mode (passkey PRF, OPAQUE
// export key, or wallet signature), but the circuit logic is identical.
//
// Public inputs:
//   - nonce: Challenge nonce for replay resistance
//   - binding_commitment: Expected Poseidon2(binding_secret || user_id_hash || document_hash)
//
// Private inputs:
//   - binding_secret: Auth-mode-specific cryptographic secret
//   - user_id_hash: Hash of the user ID
//   - document_hash: Document commitment from OCR
//
// Output:
//   - Returns true if the binding commitment is valid
//
// Security properties:
//   - Binding secret never leaves the client (privacy)
//   - Commitment binds proof to specific user + document (integrity)
//   - Nonce prevents replay attacks (freshness)
//   - Auth mode is NOT revealed (privacy improvement)

use nodash::poseidon2;

fn main(
    binding_secret: Field,           // Private: auth-mode-specific secret
    user_id_hash: Field,             // Private: hash of user ID
    document_hash: Field,            // Private: document commitment
    nonce: pub Field,                // Public: challenge nonce (replay resistance)
    binding_commitment: pub Field    // Public: pre-computed commitment to verify
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;

    // Compute binding commitment from private inputs
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
    let binding_secret: Field = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    let user_id: Field = 12345;
    let user_id_hash = hash_user_id(user_id);
    let document_hash: Field = 0xdeadbeef;
    let nonce: Field = 99999;

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let result = main(binding_secret, user_id_hash, document_hash, nonce, binding_commitment);
    assert(result == true);
}

#[test]
fn test_opaque_binding() {
    let binding_secret: Field = 0xfedcba0987654321fedcba0987654321;
    let user_id: Field = 67890;
    let user_id_hash = hash_user_id(user_id);
    let document_hash: Field = 0xcafebabe;
    let nonce: Field = 11111;

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let result = main(binding_secret, user_id_hash, document_hash, nonce, binding_commitment);
    assert(result == true);
}

#[test]
fn test_wallet_binding() {
    let binding_secret: Field = 0xabcdef123456789abcdef123456789ab;
    let user_id: Field = 13579;
    let user_id_hash = hash_user_id(user_id);
    let document_hash: Field = 0xf00df00d;
    let nonce: Field = 22222;

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let result = main(binding_secret, user_id_hash, document_hash, nonce, binding_commitment);
    assert(result == true);
}

#[test(should_fail_with = "Binding commitment mismatch")]
fn test_wrong_commitment_fails() {
    let binding_secret: Field = 0x1234;
    let user_id_hash: Field = 0x5678;
    let document_hash: Field = 0x9abc;
    let nonce: Field = 33333;
    let wrong_commitment: Field = 0xbad;

    let _ = main(binding_secret, user_id_hash, document_hash, nonce, wrong_commitment);
}

#[test(should_fail_with = "Binding commitment mismatch")]
fn test_different_secret_fails() {
    let binding_secret: Field = 0x1234;
    let user_id_hash: Field = 0x5678;
    let document_hash: Field = 0x9abc;
    let nonce: Field = 44444;

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let different_secret: Field = 0x4321;
    let _ = main(different_secret, user_id_hash, document_hash, nonce, binding_commitment);
}

#[test(should_fail_with = "Binding commitment mismatch")]
fn test_different_user_fails() {
    let binding_secret: Field = 0x1234;
    let user_id: Field = 11111;
    let user_id_hash = hash_user_id(user_id);
    let document_hash: Field = 0x9abc;
    let nonce: Field = 55555;

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let different_user: Field = 22222;
    let different_user_hash = hash_user_id(different_user);
    let _ = main(binding_secret, different_user_hash, document_hash, nonce, binding_commitment);
}

#[test(should_fail_with = "Binding commitment mismatch")]
fn test_different_document_fails() {
    let binding_secret: Field = 0x1234;
    let user_id_hash: Field = 0x5678;
    let document_hash: Field = 0x9abc;
    let nonce: Field = 66666;

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let different_document: Field = 0xdef0;
    let _ = main(binding_secret, user_id_hash, different_document, nonce, binding_commitment);
}

#[test]
fn test_nonce_uniqueness() {
    let binding_secret: Field = 0xaabbccdd;
    let user_id_hash: Field = 0x11223344;
    let document_hash: Field = 0x55667788;

    let binding_commitment = poseidon2([binding_secret, user_id_hash, document_hash]);

    let result1 = main(binding_secret, user_id_hash, document_hash, 88888, binding_commitment);
    assert(result1 == true);

    let result2 = main(binding_secret, user_id_hash, document_hash, 99999, binding_commitment);
    assert(result2 == true);
}
