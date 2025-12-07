pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

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
    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);

        // If pathIndex is 0, leaf is on the left
        // If pathIndex is 1, leaf is on the right
        var leftHash = (1 - pathIndices[i]) * hashes[i] + pathIndices[i] * pathElements[i];
        var rightHash = pathIndices[i] * hashes[i] + (1 - pathIndices[i]) * pathElements[i];

        hashers[i].inputs[0] <== leftHash;
        hashers[i].inputs[1] <== rightHash;
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
