// Age Verification Circuit
// Proves that a person is at least `min_age` years old without revealing their birth year
//
// Public inputs:
//   - current_year: The current year (e.g., 2025)
//   - min_age: The minimum age threshold (e.g., 18, 21, 25)
//   - nonce: Challenge nonce for replay resistance
//   - claim_hash: Poseidon2(birth_year, document_hash) binding to OCR claim
//
// Private inputs:
//   - birth_year: The person's birth year (kept private)
//   - document_hash: Commitment to the document (kept private)
//
// Output:
//   - Returns true if age >= min_age

use nodash::poseidon2;

fn main(
    birth_year: Field,        // Private: actual birth year
    document_hash: Field,     // Private: document commitment
    current_year: pub Field,  // Public: current year for verification
    min_age: pub Field,       // Public: minimum age threshold
    nonce: pub Field,         // Public: challenge nonce (replay resistance)
    claim_hash: pub Field     // Public: claim hash binding to OCR data
) -> pub bool {
    // Nonce is included as public input for replay resistance
    // It doesn't affect the age calculation, but binds the proof to a specific challenge
    let _ = nonce;

    // Bind proof to signed OCR claim
    let computed_hash = poseidon2([birth_year, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");
    // Convert to u32 for safe comparison and arithmetic
    let birth_year_u32 = birth_year as u32;
    let current_year_u32 = current_year as u32;
    let min_age_u32 = min_age as u32;

    // SECURITY: Prevent wrap-around attack
    // Without this check, a birth_year > current_year would cause Field underflow,
    // resulting in a very large positive "age" that passes any min_age check.
    assert(birth_year_u32 <= current_year_u32, "Birth year cannot be in the future");

    // Calculate age safely in u32 (no overflow possible after assertion)
    let age = current_year_u32 - birth_year_u32;

    // Verify age meets minimum requirement
    age >= min_age_u32
}

#[test]
fn test_age_verification_adult() {
    // Person born in 1990, current year 2025, minimum age 18
    // Age = 2025 - 1990 = 35, which is >= 18
    let doc_hash = 999;
    let claim_hash = poseidon2([1990, doc_hash]);
    let result = main(1990, doc_hash, 2025, 18, 12345, claim_hash); // nonce can be any value
    assert(result == true);
}

#[test]
fn test_age_verification_exactly_18() {
    // Person born in 2007, current year 2025, minimum age 18
    // Age = 2025 - 2007 = 18, which is >= 18
    let doc_hash = 888;
    let claim_hash = poseidon2([2007, doc_hash]);
    let result = main(2007, doc_hash, 2025, 18, 99999, claim_hash);
    assert(result == true);
}

#[test]
fn test_age_verification_under_21() {
    // Person born in 2007, current year 2025, minimum age 21
    // Age = 2025 - 2007 = 18, which is < 21
    let doc_hash = 777;
    let claim_hash = poseidon2([2007, doc_hash]);
    let result = main(2007, doc_hash, 2025, 21, 11111, claim_hash);
    assert(result == false);
}

#[test]
fn test_age_verification_minor() {
    // Person born in 2010, current year 2025, minimum age 18
    // Age = 2025 - 2010 = 15, which is < 18
    let doc_hash = 666;
    let claim_hash = poseidon2([2010, doc_hash]);
    let result = main(2010, doc_hash, 2025, 18, 22222, claim_hash);
    assert(result == false);
}

#[test]
fn test_same_year_birth() {
    // Born this year - age 0
    let doc_hash = 555;
    let claim_hash = poseidon2([2025, doc_hash]);
    let result = main(2025, doc_hash, 2025, 0, 33333, claim_hash);
    assert(result == true);

    let result2 = main(2025, doc_hash, 2025, 1, 44444, claim_hash);
    assert(result2 == false);
}

#[test(should_fail_with = "Birth year cannot be in the future")]
fn test_future_birth_year_fails() {
    // Person "born" in the future - should fail assertion
    let doc_hash = 444;
    let claim_hash = poseidon2([2030, doc_hash]);
    let _ = main(2030, doc_hash, 2025, 18, 55555, claim_hash);
}
