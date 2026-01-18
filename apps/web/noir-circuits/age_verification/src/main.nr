// Age Verification Circuit (Days-Based)
// Proves that a person is at least `min_age` years old without revealing their DOB
//
// This circuit uses days since 1900-01-01 (UTC) for precise date-based verification.
// The days-based approach ensures regulatory compliance by preserving full DOB precision
// while still only proving age eligibility (not revealing the exact birth date).
//
// Public inputs:
//   - current_days: Days since 1900-01-01 for the current date
//   - min_age_days: Minimum age in days (min_age * 365.25)
//   - nonce: Challenge nonce for replay resistance
//   - claim_hash: Poseidon2(dob_days, document_hash) binding to OCR claim
//
// Private inputs:
//   - dob_days: Days since 1900-01-01 for birth date (kept private)
//   - document_hash: Commitment to the document (kept private)
//
// Output:
//   - Returns true if age >= min_age
//
// Note: Age calculation uses the formula: (current_days - dob_days) >= min_age_days
// where min_age_days is typically calculated as min_age * 365.25 (accounting for leap years)

use nodash::poseidon2;

fn main(
    dob_days: Field,          // Private: days since base date for DOB
    document_hash: Field,     // Private: document commitment
    current_days: pub Field,  // Public: current date as days since base date
    min_age_days: pub Field,  // Public: minimum age in days (e.g., 18 * 365 = 6570)
    nonce: pub Field,         // Public: challenge nonce (replay resistance)
    claim_hash: pub Field     // Public: claim hash binding to OCR data
) -> pub bool {
    // Nonce is included as public input for replay resistance
    // It doesn't affect the age calculation, but binds the proof to a specific challenge
    let _ = nonce;

    // Bind proof to signed OCR claim
    let computed_hash = poseidon2([dob_days, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");

    // Convert to u32 for safe comparison and arithmetic
    let dob_days_u32 = dob_days as u32;
    let current_days_u32 = current_days as u32;
    let min_age_days_u32 = min_age_days as u32;

    // SECURITY: Prevent wrap-around attack
    // Without this check, a dob_days > current_days would cause Field underflow,
    // resulting in a very large positive "age" that passes any min_age check.
    assert(dob_days_u32 <= current_days_u32, "DOB cannot be in the future");

    // Calculate age in days safely (no overflow possible after assertion)
    let age_days = current_days_u32 - dob_days_u32;

    // Verify age meets minimum requirement
    age_days >= min_age_days_u32
}

// Helper: Convert date components to days since base date
// This is a simplified calculation for testing (not accounting for all leap years)
fn date_to_days(year: u32, month: u32, day: u32) -> u32 {
    // Approximate days from complete years since 1900
    let years_since_epoch = if year >= 1900 { year - 1900 } else { 0 };
    let days_from_years = years_since_epoch * 365 + years_since_epoch / 4; // rough leap year estimate

    // Days from complete months (using 30-day approximation for simplicity)
    let days_from_months = (month - 1) * 30;

    days_from_years + days_from_months + day
}

// Minimum age in days (using 365 days/year for simplicity in tests)
fn min_age_to_days(years: u32) -> u32 {
    years * 365
}

#[test]
fn test_age_verification_adult() {
    // Person born 1990-05-15, current date 2025-01-17, minimum age 18
    // Age = ~35 years, which is >= 18
    let dob: Field = date_to_days(1990, 5, 15) as Field;
    let current: Field = date_to_days(2025, 1, 17) as Field;
    let min_age: Field = min_age_to_days(18) as Field;

    let doc_hash: Field = 999;
    let claim_hash = poseidon2([dob, doc_hash]);
    let result = main(dob, doc_hash, current, min_age, 12345, claim_hash);
    assert(result == true);
}

#[test]
fn test_age_verification_exactly_18() {
    // Person born 2007-01-17, current date 2025-01-17, minimum age 18
    // Age = exactly 18 years
    let dob: Field = date_to_days(2007, 1, 17) as Field;
    let current: Field = date_to_days(2025, 1, 17) as Field;
    let min_age: Field = min_age_to_days(18) as Field;

    let doc_hash: Field = 888;
    let claim_hash = poseidon2([dob, doc_hash]);
    let result = main(dob, doc_hash, current, min_age, 99999, claim_hash);
    assert(result == true);
}

#[test]
fn test_age_verification_under_21() {
    // Person born 2007-01-17, current date 2025-01-17, minimum age 21
    // Age = 18 years, which is < 21
    let dob: Field = date_to_days(2007, 1, 17) as Field;
    let current: Field = date_to_days(2025, 1, 17) as Field;
    let min_age: Field = min_age_to_days(21) as Field;

    let doc_hash: Field = 777;
    let claim_hash = poseidon2([dob, doc_hash]);
    let result = main(dob, doc_hash, current, min_age, 11111, claim_hash);
    assert(result == false);
}

#[test]
fn test_age_verification_minor() {
    // Person born 2010-05-15, current date 2025-01-17, minimum age 18
    // Age = ~14.7 years, which is < 18
    let dob: Field = date_to_days(2010, 5, 15) as Field;
    let current: Field = date_to_days(2025, 1, 17) as Field;
    let min_age: Field = min_age_to_days(18) as Field;

    let doc_hash: Field = 666;
    let claim_hash = poseidon2([dob, doc_hash]);
    let result = main(dob, doc_hash, current, min_age, 22222, claim_hash);
    assert(result == false);
}

#[test]
fn test_day_precision_matters() {
    // Test that being one day short of minimum age fails
    // Use explicit values to avoid approximate date_to_days calculation
    // Scenario: current_days = 20000, dob_days = 13431 (age = 6569 days)
    // min_age_days = 6570 (18 years), so age < min_age by 1 day
    let current: Field = 20000;
    let dob: Field = 13431; // 20000 - 6569 = 13431
    let min_age: Field = 6570; // 18 * 365

    let doc_hash: Field = 555;
    let claim_hash = poseidon2([dob, doc_hash]);
    let result = main(dob, doc_hash, current, min_age, 33333, claim_hash);
    // Age is 6569 days, minimum is 6570, so should fail
    assert(result == false);
}

#[test]
fn test_same_day_birth() {
    // Born today - age 0 days
    let current: Field = date_to_days(2025, 1, 17) as Field;
    let dob: Field = current; // Born today

    let doc_hash: Field = 444;
    let claim_hash = poseidon2([dob, doc_hash]);

    // Should pass for 0 days minimum
    let result = main(dob, doc_hash, current, 0, 33333, claim_hash);
    assert(result == true);

    // Should fail for 1 day minimum
    let result2 = main(dob, doc_hash, current, 1, 44444, claim_hash);
    assert(result2 == false);
}

#[test(should_fail_with = "DOB cannot be in the future")]
fn test_future_dob_fails() {
    // DOB in the future - should fail assertion
    let current: Field = date_to_days(2025, 1, 17) as Field;
    let dob: Field = date_to_days(2030, 1, 1) as Field; // Future date
    let min_age: Field = min_age_to_days(18) as Field;

    let doc_hash: Field = 333;
    let claim_hash = poseidon2([dob, doc_hash]);
    let _ = main(dob, doc_hash, current, min_age, 55555, claim_hash);
}
