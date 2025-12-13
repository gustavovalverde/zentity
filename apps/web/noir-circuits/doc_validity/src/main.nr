// Document Validity Circuit
// Proves that a document has not expired without revealing the actual expiry date
//
// Public inputs:
//   - current_date: Today's date as YYYYMMDD integer (e.g., 20251212)
//   - nonce: Challenge nonce for replay resistance
//
// Private inputs:
//   - expiry_date: The document's expiry date as YYYYMMDD integer
//
// Output:
//   - Returns true if the document is valid (expiry_date >= current_date)

fn main(
    expiry_date: Field,        // Private: actual expiry date (YYYYMMDD)
    current_date: pub Field,   // Public: current date for verification
    nonce: pub Field           // Public: challenge nonce (replay resistance)
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;

    // Document is valid if expiry date is >= current date
    // Using u32 comparison for date integers
    let is_valid = expiry_date as u32 >= current_date as u32;

    is_valid
}

#[test]
fn test_valid_document() {
    // Document expires in 2027, current date is 2025-12-12
    let result = main(20271231, 20251212, 12345);
    assert(result == true);
}

#[test]
fn test_valid_document_same_day() {
    // Document expires today
    let result = main(20251212, 20251212, 99999);
    assert(result == true);
}

#[test]
fn test_expired_document() {
    // Document expired in 2024, current date is 2025-12-12
    let result = main(20241231, 20251212, 11111);
    assert(result == false);
}

#[test]
fn test_recently_expired() {
    // Document expired yesterday
    let result = main(20251211, 20251212, 22222);
    assert(result == false);
}

#[test]
fn test_far_future_expiry() {
    // Document valid until 2030
    let result = main(20301231, 20251212, 33333);
    assert(result == true);
}
