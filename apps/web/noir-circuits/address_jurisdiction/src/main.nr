// Address Jurisdiction Circuit
// Proves that a user's residential address is in an allowed jurisdiction using Merkle tree
//
// This circuit enables compliance verification (e.g., "user resides in EU")
// without revealing the exact address or specific country.
//
// Use cases:
// - Verify US/EU residency for regulatory compliance
// - Prove residence in allowed jurisdictions for financial services
// - Geographic eligibility for crypto services (e.g., not in OFAC-restricted regions)
//
// Public inputs:
//   - merkle_root: The root of the Merkle tree representing the jurisdiction group
//   - nonce: Challenge nonce for replay resistance
//   - claim_hash: Poseidon2(address_country_code, address_commitment) binding to user claim
//
// Private inputs:
//   - address_country_code: The ISO numeric country code from the address (e.g., 840 for USA)
//   - address_commitment: SHA256 hash of the full address (kept private)
//   - path_elements: The sibling hashes along the Merkle path
//   - path_indices: The direction at each level (0=left, 1=right)
//
// Output:
//   - Returns true if the address country is a member of the allowed jurisdiction group
//
// Note: This is separate from nationality_membership because:
// - Nationality comes from document (passport country)
// - Address jurisdiction comes from residential address
// - A person can have US nationality but EU residence (or vice versa)

use nodash::poseidon2;

// Merkle tree depth (supports up to 2^8 = 256 countries/jurisdictions)
global TREE_DEPTH: u32 = 8;

fn main(
    address_country_code: Field,                // Private: country code from address
    address_commitment: Field,                  // Private: hash of full address
    path_elements: [Field; TREE_DEPTH],         // Private: Merkle path siblings
    path_indices: [u1; TREE_DEPTH],             // Private: path directions
    merkle_root: pub Field,                     // Public: identifies the jurisdiction group
    nonce: pub Field,                           // Public: challenge nonce (replay resistance)
    claim_hash: pub Field                       // Public: claim hash binding to user data
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;

    // Bind proof to user's address claim
    // This ensures the proof is tied to a specific address commitment
    let computed_hash = poseidon2([address_country_code, address_commitment]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");

    // Hash the country code to get the leaf
    let leaf = poseidon2([address_country_code]);

    // Compute the root by traversing up the tree
    let mut current = leaf;

    for i in 0..TREE_DEPTH {
        let sibling = path_elements[i];

        // Order the pair based on path index (0=current is left, 1=current is right)
        let (left, right) = if path_indices[i] == 0 {
            (current, sibling)
        } else {
            (sibling, current)
        };

        // Hash the pair to get parent
        current = poseidon2([left, right]);
    }

    // Check if computed root matches expected root
    current == merkle_root
}

#[test]
fn test_us_jurisdiction() {
    // Test with USA (ISO 3166-1 numeric: 840)
    let address_country_code: Field = 840;

    // Create a simple test path
    let path_elements: [Field; TREE_DEPTH] = [0; TREE_DEPTH];
    let path_indices: [u1; TREE_DEPTH] = [0; TREE_DEPTH];

    // Compute expected root
    let leaf = poseidon2([address_country_code]);
    let mut expected_root = leaf;
    for i in 0..TREE_DEPTH {
        expected_root = poseidon2([expected_root, path_elements[i]]);
    }

    // Create address commitment (simulated hash)
    let address_commitment = 12345;
    let claim_hash = poseidon2([address_country_code, address_commitment]);

    let result = main(
        address_country_code,
        address_commitment,
        path_elements,
        path_indices,
        expected_root,
        99999, // nonce
        claim_hash
    );
    assert(result == true);
}

#[test]
fn test_eu_jurisdiction() {
    // Test with Germany (ISO 3166-1 numeric: 276)
    let address_country_code: Field = 276;

    // Create a simple test path
    let path_elements: [Field; TREE_DEPTH] = [0; TREE_DEPTH];
    let path_indices: [u1; TREE_DEPTH] = [0; TREE_DEPTH];

    // Compute expected root
    let leaf = poseidon2([address_country_code]);
    let mut expected_root = leaf;
    for i in 0..TREE_DEPTH {
        expected_root = poseidon2([expected_root, path_elements[i]]);
    }

    // Create address commitment
    let address_commitment = 67890;
    let claim_hash = poseidon2([address_country_code, address_commitment]);

    let result = main(
        address_country_code,
        address_commitment,
        path_elements,
        path_indices,
        expected_root,
        11111,
        claim_hash
    );
    assert(result == true);
}

#[test]
fn test_wrong_jurisdiction_fails() {
    // User claims to be in USA (840) but the root is for a different group
    let address_country_code: Field = 840;

    // Create a path for USA
    let path_elements: [Field; TREE_DEPTH] = [0; TREE_DEPTH];
    let path_indices: [u1; TREE_DEPTH] = [0; TREE_DEPTH];

    // Compute root for USA
    let leaf = poseidon2([address_country_code]);
    let mut usa_root = leaf;
    for i in 0..TREE_DEPTH {
        usa_root = poseidon2([usa_root, path_elements[i]]);
    }

    // But use a different root (simulating EU-only group)
    let wrong_root = usa_root + 1;

    let address_commitment = 12345;
    let claim_hash = poseidon2([address_country_code, address_commitment]);

    let result = main(
        address_country_code,
        address_commitment,
        path_elements,
        path_indices,
        wrong_root,
        22222,
        claim_hash
    );
    assert(result == false);
}

#[test(should_fail_with = "Claim hash mismatch")]
fn test_tampered_claim_fails() {
    let address_country_code: Field = 840;
    let path_elements: [Field; TREE_DEPTH] = [0; TREE_DEPTH];
    let path_indices: [u1; TREE_DEPTH] = [0; TREE_DEPTH];

    let leaf = poseidon2([address_country_code]);
    let mut expected_root = leaf;
    for i in 0..TREE_DEPTH {
        expected_root = poseidon2([expected_root, path_elements[i]]);
    }

    let address_commitment = 12345;
    // Create claim hash with different country code (simulating tampering)
    let wrong_claim_hash = poseidon2([999, address_commitment]);

    let _ = main(
        address_country_code,
        address_commitment,
        path_elements,
        path_indices,
        expected_root,
        33333,
        wrong_claim_hash
    );
}
