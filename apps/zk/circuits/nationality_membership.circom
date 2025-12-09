pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

/**
 * Nationality Membership Proof Circuit
 *
 * Proves that a nationality code is a member of a predefined set (e.g., EU countries)
 * without revealing which specific country.
 *
 * Uses a Merkle tree where:
 * - Leaves are Poseidon hashes of nationality codes
 * - Root represents a specific country group (EU, Schengen, etc.)
 *
 * Public inputs: merkleRoot
 * Private inputs: nationalityCode, pathElements, pathIndices
 * Output: isMember (1 if nationality is in the set)
 */

// Merkle tree depth (supports up to 2^8 = 256 countries per group)
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input root;
    signal output isValid;

    component hashers[levels];
    component muxLeft[levels];
    component muxRight[levels];
    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);

        // Use Mux1 to select left and right inputs based on pathIndices
        // If pathIndex is 0, current hash goes left, sibling goes right
        // If pathIndex is 1, sibling goes left, current hash goes right
        muxLeft[i] = Mux1();
        muxLeft[i].c[0] <== hashes[i];
        muxLeft[i].c[1] <== pathElements[i];
        muxLeft[i].s <== pathIndices[i];

        muxRight[i] = Mux1();
        muxRight[i].c[0] <== pathElements[i];
        muxRight[i].c[1] <== hashes[i];
        muxRight[i].s <== pathIndices[i];

        hashers[i].inputs[0] <== muxLeft[i].out;
        hashers[i].inputs[1] <== muxRight[i].out;
        hashes[i + 1] <== hashers[i].out;
    }

    // Check if computed root matches expected root
    component isEqual = IsEqual();
    isEqual.in[0] <== hashes[levels];
    isEqual.in[1] <== root;
    isValid <== isEqual.out;
}

template NationalityMembership(levels) {
    // Public inputs
    signal input merkleRoot;

    // Private inputs
    signal input nationalityCode;  // ISO 3166-1 numeric code (e.g., 214 for DOM, 840 for USA)
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // Output
    signal output isMember;

    // Hash the nationality code to get the leaf
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== nationalityCode;

    // Check Merkle membership
    component merkleChecker = MerkleTreeChecker(levels);
    merkleChecker.leaf <== leafHasher.out;
    merkleChecker.root <== merkleRoot;
    for (var i = 0; i < levels; i++) {
        merkleChecker.pathElements[i] <== pathElements[i];
        merkleChecker.pathIndices[i] <== pathIndices[i];
    }

    isMember <== merkleChecker.isValid;
}

// Main component with 8 levels (supports up to 256 countries)
component main {public [merkleRoot]} = NationalityMembership(8);
