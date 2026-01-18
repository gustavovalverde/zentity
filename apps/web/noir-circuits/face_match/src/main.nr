// Face Match Verification Circuit
// Proves that a face similarity score meets or exceeds a threshold without revealing the exact score
//
// Public inputs:
//   - threshold: The minimum similarity threshold (scaled integer 0-10000 for 0.00%-100.00%)
//   - nonce: Challenge nonce for replay resistance
//   - claim_hash: Poseidon2(similarity_score, document_hash) binding to OCR claim
//
// Private inputs:
//   - similarity_score: The actual face similarity score (scaled integer 0-10000)
//   - document_hash: Commitment to the document (kept private)
//
// Output:
//   - Returns true if similarity_score >= threshold

use nodash::poseidon2;

fn main(
    similarity_score: Field,    // Private: actual similarity score (scaled 0-10000)
    document_hash: Field,       // Private: document commitment
    threshold: pub Field,       // Public: minimum threshold (scaled 0-10000)
    nonce: pub Field,           // Public: challenge nonce (replay resistance)
    claim_hash: pub Field       // Public: claim hash binding to OCR data
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;

    // Bind proof to signed OCR claim
    let computed_hash = poseidon2([similarity_score, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");

    // Convert to u32 for safe comparison
    let score_u32 = similarity_score as u32;
    let threshold_u32 = threshold as u32;

    // SECURITY: Validate score is within valid range (0-10000)
    // This prevents malicious inputs that could wrap around
    assert(score_u32 <= 10000, "Similarity score must be 0-10000 (0.00%-100.00%)");
    assert(threshold_u32 <= 10000, "Threshold must be 0-10000 (0.00%-100.00%)");

    // Verify similarity meets threshold
    score_u32 >= threshold_u32
}

#[test]
fn test_face_match_above_threshold() {
    // Score 80.00%, threshold 60.00%
    let doc_hash = 999;
    let claim_hash = poseidon2([8000, doc_hash]);
    let result = main(8000, doc_hash, 6000, 12345, claim_hash);
    assert(result == true);
}

#[test]
fn test_face_match_exactly_at_threshold() {
    // Score equals threshold exactly
    let doc_hash = 888;
    let claim_hash = poseidon2([6000, doc_hash]);
    let result = main(6000, doc_hash, 6000, 99999, claim_hash);
    assert(result == true);
}

#[test]
fn test_face_match_below_threshold() {
    // Score 55.00%, threshold 60.00%
    let doc_hash = 777;
    let claim_hash = poseidon2([5500, doc_hash]);
    let result = main(5500, doc_hash, 6000, 11111, claim_hash);
    assert(result == false);
}

#[test]
fn test_face_match_perfect_score() {
    // 100% match
    let doc_hash = 666;
    let claim_hash = poseidon2([10000, doc_hash]);
    let result = main(10000, doc_hash, 6000, 22222, claim_hash);
    assert(result == true);
}

#[test]
fn test_face_match_zero_score() {
    // 0% match, any positive threshold
    let doc_hash = 555;
    let claim_hash = poseidon2([0, doc_hash]);
    let result = main(0, doc_hash, 1, 33333, claim_hash);
    assert(result == false);
}

#[test]
fn test_face_match_zero_threshold() {
    // Any score passes with 0 threshold
    let doc_hash = 444;
    let claim_hash = poseidon2([0, doc_hash]);
    let result = main(0, doc_hash, 0, 44444, claim_hash);
    assert(result == true);
}

#[test]
fn test_face_match_high_precision() {
    // Test precision: 73.45% vs 73.44%
    let doc_hash = 333;
    let claim_hash = poseidon2([7345, doc_hash]);
    let result = main(7345, doc_hash, 7344, 55555, claim_hash);
    assert(result == true);

    let claim_hash2 = poseidon2([7343, doc_hash]);
    let result2 = main(7343, doc_hash, 7344, 66666, claim_hash2);
    assert(result2 == false);
}

#[test(should_fail_with = "Similarity score must be 0-10000")]
fn test_invalid_score_fails() {
    // Score out of range
    let doc_hash = 222;
    let claim_hash = poseidon2([10001, doc_hash]);
    let _ = main(10001, doc_hash, 6000, 77777, claim_hash);
}

#[test(should_fail_with = "Threshold must be 0-10000")]
fn test_invalid_threshold_fails() {
    // Threshold out of range
    let doc_hash = 111;
    let claim_hash = poseidon2([8000, doc_hash]);
    let _ = main(8000, doc_hash, 10001, 88888, claim_hash);
}
