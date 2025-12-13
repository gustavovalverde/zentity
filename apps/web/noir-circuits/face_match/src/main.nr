// Face Match Verification Circuit
// Proves that a face similarity score meets or exceeds a threshold without revealing the exact score
//
// Public inputs:
//   - threshold: The minimum similarity threshold (scaled integer 0-10000 for 0.00%-100.00%)
//   - nonce: Challenge nonce for replay resistance
//
// Private inputs:
//   - similarity_score: The actual face similarity score (scaled integer 0-10000)
//
// Output:
//   - Returns true if similarity_score >= threshold

fn main(
    similarity_score: Field,    // Private: actual similarity score (scaled 0-10000)
    threshold: pub Field,       // Public: minimum threshold (scaled 0-10000)
    nonce: pub Field            // Public: challenge nonce (replay resistance)
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;

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
    let result = main(8000, 6000, 12345);
    assert(result == true);
}

#[test]
fn test_face_match_exactly_at_threshold() {
    // Score equals threshold exactly
    let result = main(6000, 6000, 99999);
    assert(result == true);
}

#[test]
fn test_face_match_below_threshold() {
    // Score 55.00%, threshold 60.00%
    let result = main(5500, 6000, 11111);
    assert(result == false);
}

#[test]
fn test_face_match_perfect_score() {
    // 100% match
    let result = main(10000, 6000, 22222);
    assert(result == true);
}

#[test]
fn test_face_match_zero_score() {
    // 0% match, any positive threshold
    let result = main(0, 1, 33333);
    assert(result == false);
}

#[test]
fn test_face_match_zero_threshold() {
    // Any score passes with 0 threshold
    let result = main(0, 0, 44444);
    assert(result == true);
}

#[test]
fn test_face_match_high_precision() {
    // Test precision: 73.45% vs 73.44%
    let result = main(7345, 7344, 55555);
    assert(result == true);

    let result2 = main(7343, 7344, 66666);
    assert(result2 == false);
}

#[test(should_fail_with = "Similarity score must be 0-10000")]
fn test_invalid_score_fails() {
    // Score out of range
    let _ = main(10001, 6000, 77777);
}

#[test(should_fail_with = "Threshold must be 0-10000")]
fn test_invalid_threshold_fails() {
    // Threshold out of range
    let _ = main(8000, 10001, 88888);
}
