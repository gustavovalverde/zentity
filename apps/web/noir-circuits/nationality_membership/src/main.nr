// Nationality Membership Circuit
// Proves that a nationality belongs to a specific group (EU, LATAM, etc.) using Merkle tree
//
// Public inputs:
//   - merkle_root: The root of the Merkle tree representing the country group
//   - nonce: Challenge nonce for replay resistance
//   - claim_hash: Poseidon2(nationality_code, document_hash) binding to OCR claim
//
// Private inputs:
//   - nationality_code: Weighted-sum encoding from @zkpassport/utils (e.g., 4474197 for Germany)
//   - document_hash: Commitment to the document (kept private)
//   - path_elements: The sibling hashes along the Merkle path
//   - path_indices: The direction at each level (0=left, 1=right)
//
// Output:
//   - Returns true if the nationality is a member of the group

use nodash::poseidon2;

// Merkle tree depth (supports up to 2^8 = 256 countries)
global TREE_DEPTH: u32 = 8;

fn main(
    nationality_code: Field,                    // Private: actual nationality code
    document_hash: Field,                       // Private: document commitment
    path_elements: [Field; TREE_DEPTH],         // Private: Merkle path siblings
    path_indices: [u1; TREE_DEPTH],             // Private: path directions
    merkle_root: pub Field,                     // Public: identifies the country group
    nonce: pub Field,                           // Public: challenge nonce (replay resistance)
    claim_hash: pub Field                       // Public: claim hash binding to OCR data
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;
    // Bind proof to signed OCR claim
    let computed_hash = poseidon2([nationality_code, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");
    // Hash the nationality code to get the leaf
    let leaf = poseidon2([nationality_code]);

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
fn test_poseidon_hash() {
    // Test that poseidon2 hashing works as expected
    // Germany: 'D'*65536 + 'E'*256 + 'U' = 68*65536 + 69*256 + 85 = 4474197
    let hash = poseidon2([4474197]);
    assert(hash != 0);
}

#[test]
fn test_merkle_path_computation() {
    // This is a simplified test - in production, the path would be generated
    // by the JavaScript side from the actual Merkle tree

    // Create a simple test case with known values
    // Germany weighted-sum: 'D'*65536 + 'E'*256 + 'U' = 4474197
    let nationality_code: Field = 4474197;

    // Compute the leaf hash
    let leaf = poseidon2([nationality_code]);

    // For testing, we'll create a path that leads to a known root
    // In production, these would come from the actual Merkle tree
    let path_elements: [Field; TREE_DEPTH] = [0; TREE_DEPTH];
    let path_indices: [u1; TREE_DEPTH] = [0; TREE_DEPTH];

    // Compute what the root would be with this path
    let mut expected_root = leaf;
    for i in 0..TREE_DEPTH {
        expected_root = poseidon2([expected_root, path_elements[i]]);
    }

    // Now verify the circuit works (nonce can be any value)
    let doc_hash = 999;
    let claim_hash = poseidon2([nationality_code, doc_hash]);
    let result = main(nationality_code, doc_hash, path_elements, path_indices, expected_root, 12345, claim_hash);
    assert(result == true);
}
