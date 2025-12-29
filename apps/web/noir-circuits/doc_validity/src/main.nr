// Document Validity Circuit
// Proves that a document has not expired without revealing the actual expiry date
//
// Public inputs:
//   - current_date: Today's date as YYYYMMDD integer (e.g., 20251212)
//   - nonce: Challenge nonce for replay resistance
//   - claim_hash: Poseidon2(expiry_date, document_hash) binding to OCR claim
//
// Private inputs:
//   - expiry_date: The document's expiry date as YYYYMMDD integer
//   - document_hash: Commitment to the document (kept private)
//
// Output:
//   - Returns true if the document is valid (expiry_date >= current_date)

use nodash::poseidon2;

fn main(
    expiry_date: Field,        // Private: actual expiry date (YYYYMMDD)
    document_hash: Field,      // Private: document commitment
    current_date: pub Field,   // Public: current date for verification
    nonce: pub Field,          // Public: challenge nonce (replay resistance)
    claim_hash: pub Field      // Public: claim hash binding to OCR data
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;

    // Bind proof to signed OCR claim
    let computed_hash = poseidon2([expiry_date, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");

    // Document is valid if expiry date is >= current date
    // Using u32 comparison for date integers
    let is_valid = expiry_date as u32 >= current_date as u32;

    is_valid
}

#[test]
fn test_valid_document() {
    // Document expires in 2027, current date is 2025-12-12
    let doc_hash = 999;
    let claim_hash = poseidon2([20271231, doc_hash]);
    let result = main(20271231, doc_hash, 20251212, 12345, claim_hash);
    assert(result == true);
}

#[test]
fn test_valid_document_same_day() {
    // Document expires today
    let doc_hash = 888;
    let claim_hash = poseidon2([20251212, doc_hash]);
    let result = main(20251212, doc_hash, 20251212, 99999, claim_hash);
    assert(result == true);
}

#[test]
fn test_expired_document() {
    // Document expired in 2024, current date is 2025-12-12
    let doc_hash = 777;
    let claim_hash = poseidon2([20241231, doc_hash]);
    let result = main(20241231, doc_hash, 20251212, 11111, claim_hash);
    assert(result == false);
}

#[test]
fn test_recently_expired() {
    // Document expired yesterday
    let doc_hash = 666;
    let claim_hash = poseidon2([20251211, doc_hash]);
    let result = main(20251211, doc_hash, 20251212, 22222, claim_hash);
    assert(result == false);
}

#[test]
fn test_far_future_expiry() {
    // Document valid until 2030
    let doc_hash = 555;
    let claim_hash = poseidon2([20301231, doc_hash]);
    let result = main(20301231, doc_hash, 20251212, 33333, claim_hash);
    assert(result == true);
}
