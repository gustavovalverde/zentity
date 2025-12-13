// Nationality Membership Circuit
// Proves that a nationality belongs to a specific group (EU, LATAM, etc.) using Merkle tree
//
// Public inputs:
//   - merkle_root: The root of the Merkle tree representing the country group
//   - nonce: Challenge nonce for replay resistance
//
// Private inputs:
//   - nationality_code: The ISO numeric country code (e.g., 276 for Germany)
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
    merkle_root: pub Field,                     // Public: identifies the country group
    path_elements: [Field; TREE_DEPTH],         // Private: Merkle path siblings
    path_indices: [u1; TREE_DEPTH],             // Private: path directions
    nonce: pub Field                            // Public: challenge nonce (replay resistance)
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;
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
    let hash = poseidon2([276]); // Germany
    assert(hash != 0);
}

#[test]
fn test_merkle_path_computation() {
    // This is a simplified test - in production, the path would be generated
    // by the JavaScript side from the actual Merkle tree

    // Create a simple test case with known values
    let nationality_code: Field = 276; // Germany

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
    let result = main(nationality_code, expected_root, path_elements, path_indices, 12345);
    assert(result == true);
}
