//! Date of Birth Operations (`dobDays`)
//!
//! Provides FHE-based age verification using full DOB precision.
//! DOB is represented as days since 1900-01-01 (UTC), stored as u32.
//! This enables precise age calculations including month and day.

use super::{decode_tfhe_binary, encode_tfhe_binary, setup_for_verification};
use crate::error::FheError;
use jiff::civil::{date, Date};
use jiff::Span;
use tfhe::prelude::*;
use tfhe::{CompressedPublicKey, FheUint32};

/// Maximum valid DOB in days (far future limit)
///
/// With a 1900 base, this is intentionally generous; DOB values are
/// additionally constrained by application logic (e.g., must not be in the future).
const MAX_DOB_DAYS: u32 = 150_000;

/// Day 0 of `dobDays`.
const BASE_DATE: Date = date(1900, 1, 1);

fn validate_dob_days(days: u32) -> Result<(), FheError> {
    if days > MAX_DOB_DAYS {
        return Err(FheError::InvalidInput(format!(
            "DOB days must be 0-{} (got {})",
            MAX_DOB_DAYS, days
        )));
    }
    Ok(())
}

/// Latest `dobDays` that is at least `min_age` years old on `current_days`.
///
/// The cutoff is `current_days` minus `min_age` calendar years. Feb 29 falls back
/// to Feb 28 when the cutoff year has no Feb 29.
fn cutoff_days(current_days: u32, min_age: u16) -> Result<u32, FheError> {
    let current = Span::new()
        .try_days(i64::from(current_days))
        .and_then(|days| BASE_DATE.checked_add(days))
        .map_err(|_| {
            FheError::InvalidInput(format!(
                "Current date is out of range (got {current_days} days)"
            ))
        })?;
    Span::new()
        .try_years(i64::from(min_age))
        .and_then(|years| current.checked_sub(years))
        .ok()
        .and_then(days_since_base)
        .ok_or_else(|| {
            FheError::InvalidInput(format!(
                "Cutoff date must be on or after {BASE_DATE} (current day {current_days}, minimum age {min_age})"
            ))
        })
}

/// `dobDays` for `date`, or `None` when it is before the base date.
fn days_since_base(date: Date) -> Option<u32> {
    u32::try_from(date.since(BASE_DATE).ok()?.get_days()).ok()
}

/// Encrypt a date of birth (`dobDays`: days since 1900-01-01) using the provided public key
pub fn encrypt_dob_days(
    dob_days: u32,
    public_key: &CompressedPublicKey,
) -> Result<Vec<u8>, FheError> {
    validate_dob_days(dob_days)?;

    let encrypted = FheUint32::try_encrypt(dob_days, public_key)
        .map_err(|error| FheError::Tfhe(error.to_string()))?;

    encode_tfhe_binary(&encrypted)
}

/// Verify age on encrypted DOB (`dobDays`).
///
/// This performs precise age verification using full date precision.
/// The cutoff is calculated using calendar semantics:
/// - cutoff_date = current_date minus `min_age` years
/// - A person is old enough if `dob_days <= cutoff_date`
///
/// Returns an encrypted boolean that must be decrypted by the client.
pub fn verify_age_from_dob(
    ciphertext: &[u8],
    current_days: u32,
    min_age: u16,
    key_id: &str,
) -> Result<Vec<u8>, FheError> {
    let cutoff_days = cutoff_days(current_days, min_age)?;

    setup_for_verification(key_id)?;

    let encrypted_dob: FheUint32 = decode_tfhe_binary(ciphertext)?;

    // Check if DOB <= cutoff (born on or before cutoff means old enough)
    let encrypted_is_adult = encrypted_dob.le(cutoff_days);

    encode_tfhe_binary(&encrypted_is_adult)
}

/// Convert a date string (YYYY-MM-DD) to `dobDays` (days since 1900-01-01).
/// This is a utility for testing; the web frontend handles actual conversion.
#[cfg(test)]
fn date_to_days_since_base(date: &str) -> Option<u32> {
    days_since_base(date.parse().ok()?)
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::get_test_keys;
    use super::*;
    use tfhe::FheBool;

    #[test]
    fn encrypt_and_verify_dob_roundtrip() {
        let (client_key, public_key, key_id) = get_test_keys();

        // Person born 1990-05-15
        let dob_days = date_to_days_since_base("1990-05-15").unwrap();
        let ciphertext = encrypt_dob_days(dob_days, &public_key).unwrap();

        // Current date: 2025-01-17
        let current_days = date_to_days_since_base("2025-01-17").unwrap();
        let result_ciphertext =
            verify_age_from_dob(&ciphertext, current_days, 18, &key_id).unwrap();

        let encrypted: FheBool = decode_tfhe_binary(&result_ciphertext).unwrap();
        let is_adult = encrypted.decrypt(&client_key);

        assert!(is_adult, "Person born 1990 should be adult in 2025");
    }

    #[test]
    fn verify_age_exactly_18() {
        let (client_key, public_key, key_id) = get_test_keys();

        // Person born 2007-01-17 (exactly 18 on 2025-01-17)
        let dob_days = date_to_days_since_base("2007-01-17").unwrap();
        let ciphertext = encrypt_dob_days(dob_days, &public_key).unwrap();

        let current_days = date_to_days_since_base("2025-01-17").unwrap();
        let result_ciphertext =
            verify_age_from_dob(&ciphertext, current_days, 18, &key_id).unwrap();

        let encrypted: FheBool = decode_tfhe_binary(&result_ciphertext).unwrap();
        let is_adult = encrypted.decrypt(&client_key);

        assert!(is_adult, "Person exactly 18 should pass age check");
    }

    #[test]
    fn verify_age_minor_fails() {
        let (client_key, public_key, key_id) = get_test_keys();

        // Person born 2010-05-15 (14 years old in 2025)
        let dob_days = date_to_days_since_base("2010-05-15").unwrap();
        let ciphertext = encrypt_dob_days(dob_days, &public_key).unwrap();

        let current_days = date_to_days_since_base("2025-01-17").unwrap();
        let result_ciphertext =
            verify_age_from_dob(&ciphertext, current_days, 18, &key_id).unwrap();

        let encrypted: FheBool = decode_tfhe_binary(&result_ciphertext).unwrap();
        let is_adult = encrypted.decrypt(&client_key);

        assert!(!is_adult, "Minor should fail age check");
    }

    #[test]
    fn verify_age_day_precision_matters() {
        let (client_key, public_key, key_id) = get_test_keys();

        // Person born 2007-01-18 (one day short of 18 on 2025-01-17)
        let dob_days = date_to_days_since_base("2007-01-18").unwrap();
        let ciphertext = encrypt_dob_days(dob_days, &public_key).unwrap();

        let current_days = date_to_days_since_base("2025-01-17").unwrap();
        let result_ciphertext =
            verify_age_from_dob(&ciphertext, current_days, 18, &key_id).unwrap();

        let encrypted: FheBool = decode_tfhe_binary(&result_ciphertext).unwrap();
        let is_adult = encrypted.decrypt(&client_key);

        // With day precision, this should fail (they're not quite 18 yet)
        assert!(
            !is_adult,
            "Person one day short of 18 should fail precise age check"
        );
    }

    #[test]
    fn verify_age_21_threshold() {
        let (client_key, public_key, key_id) = get_test_keys();

        // Person born 2004-01-01 (21 in 2025)
        let dob_days = date_to_days_since_base("2004-01-01").unwrap();
        let ciphertext = encrypt_dob_days(dob_days, &public_key).unwrap();

        let current_days = date_to_days_since_base("2025-01-17").unwrap();

        // Should pass 21
        let result_21 = verify_age_from_dob(&ciphertext, current_days, 21, &key_id).unwrap();
        let encrypted_21: FheBool = decode_tfhe_binary(&result_21).unwrap();
        assert!(
            encrypted_21.decrypt(&client_key),
            "Person born 2004-01-01 should be 21+ in 2025"
        );

        // Should fail 25
        let result_25 = verify_age_from_dob(&ciphertext, current_days, 25, &key_id).unwrap();
        let encrypted_25: FheBool = decode_tfhe_binary(&result_25).unwrap();
        assert!(
            !encrypted_25.decrypt(&client_key),
            "Person born 2004 should not be 25+ in 2025"
        );
    }

    #[test]
    fn date_to_days_conversion() {
        // 1900-01-01 should be day 0
        assert_eq!(date_to_days_since_base("1900-01-01"), Some(0));

        // 1900-01-02 should be day 1
        assert_eq!(date_to_days_since_base("1900-01-02"), Some(1));

        // 1990-05-15 should be around 33000 days
        let days_1990 = date_to_days_since_base("1990-05-15").unwrap();
        assert!(
            (30_000..40_000).contains(&days_1990),
            "1990-05-15 should be ~33000 days: got {}",
            days_1990
        );
    }

    #[test]
    fn cutoff_keeps_the_calendar_day() {
        let current = date_to_days_since_base("2025-01-17").unwrap();
        assert_eq!(
            cutoff_days(current, 18).unwrap(),
            date_to_days_since_base("2007-01-17").unwrap()
        );
    }

    #[test]
    fn cutoff_for_feb_29_falls_back_to_feb_28_in_common_years() {
        let current = date_to_days_since_base("2024-02-29").unwrap();
        assert_eq!(
            cutoff_days(current, 18).unwrap(),
            date_to_days_since_base("2006-02-28").unwrap()
        );
        // 2004 is a leap year, so Feb 29 exists.
        assert_eq!(
            cutoff_days(current, 20).unwrap(),
            date_to_days_since_base("2004-02-29").unwrap()
        );
    }

    #[test]
    fn cutoff_before_the_base_date_is_rejected() {
        let first_valid = date_to_days_since_base("1918-01-01").unwrap();
        assert_eq!(cutoff_days(first_valid, 18).unwrap(), 0);
        assert!(cutoff_days(first_valid - 1, 18).is_err());
    }

    #[test]
    fn out_of_range_current_day_is_rejected() {
        assert!(cutoff_days(u32::MAX, 18).is_err());
    }
}
