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
//   - path_indices: The direction at each level (false=left, true=right)
//
// Output:
//   - Returns true if the nationality is a member of the group

use poseidon::poseidon2::Poseidon2;

// Merkle tree depth (supports up to 2^8 = 256 countries)
global TREE_DEPTH: u32 = 8;

fn main(
    nationality_code: Field, // Private: actual nationality code
    document_hash: Field, // Private: document commitment
    path_elements: [Field; TREE_DEPTH], // Private: Merkle path siblings
    path_indices: [bool; TREE_DEPTH], // Private: path directions
    merkle_root: pub Field, // Public: identifies the country group
    nonce: pub Field, // Public: challenge nonce (replay resistance)
    claim_hash: pub Field, // Public: claim hash binding to OCR data
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;
    // Bind proof to signed OCR claim
    let computed_hash = Poseidon2::hash([nationality_code, document_hash], 2);
    assert(computed_hash == claim_hash, "Claim hash mismatch");
    // Hash the nationality code to get the leaf
    let leaf = Poseidon2::hash([nationality_code], 1);

    // Compute the root by traversing up the tree
    let mut current = leaf;

    for i in 0..TREE_DEPTH {
        let sibling = path_elements[i];

        // Order the pair based on path index (false=current is left, true=current is right)
        let (left, right) = if !path_indices[i] {
            (current, sibling)
        } else {
            (sibling, current)
        };

        // Hash the pair to get parent
        current = Poseidon2::hash([left, right], 2);
    }

    // Check if computed root matches expected root
    current == merkle_root
}

#[test]
fn test_poseidon_hash() {
    // Test that poseidon2 hashing works as expected
    // Germany: 'D'*65536 + 'E'*256 + 'U' = 68*65536 + 69*256 + 85 = 4474197
    let hash = Poseidon2::hash([4474197], 1);
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
    let leaf = Poseidon2::hash([nationality_code], 1);

    // For testing, we'll create a path that leads to a known root
    // In production, these would come from the actual Merkle tree
    let path_elements: [Field; TREE_DEPTH] = [0; TREE_DEPTH];
    let path_indices: [bool; TREE_DEPTH] = [false; TREE_DEPTH];

    // Compute what the root would be with this path
    let mut expected_root = leaf;
    for i in 0..TREE_DEPTH {
        expected_root = Poseidon2::hash([expected_root, path_elements[i]], 2);
    }

    // Now verify the circuit works (nonce can be any value)
    let doc_hash = 999;
    let claim_hash = Poseidon2::hash([nationality_code, doc_hash], 2);
    let result = main(
        nationality_code,
        doc_hash,
        path_elements,
        path_indices,
        expected_root,
        12345,
        claim_hash,
    );
    assert(result == true);
}
