//! Date of Birth Operations (`dobDays`)
//!
//! Provides FHE-based age verification using full DOB precision.
//! DOB is represented as days since 1900-01-01 (UTC), stored as u32.
//! This enables precise age calculations including month and day.

use super::{decode_tfhe_binary, encode_tfhe_binary, setup_for_verification};
use crate::error::FheError;
use tfhe::prelude::*;
use tfhe::{CompressedPublicKey, FheUint32};

/// Maximum valid DOB in days (far future limit)
///
/// With a 1900 base, this is intentionally generous; DOB values are
/// additionally constrained by application logic (e.g., must not be in the future).
const MAX_DOB_DAYS: u32 = 150_000;

const DAYS_IN_MONTHS: [u32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

fn validate_dob_days(days: u32) -> Result<(), FheError> {
    if days > MAX_DOB_DAYS {
        return Err(FheError::InvalidInput(format!(
            "DOB days must be 0-{} (got {})",
            MAX_DOB_DAYS, days
        )));
    }
    Ok(())
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn days_in_month(year: i32, month: u32) -> Result<u32, FheError> {
    if !(1..=12).contains(&month) {
        return Err(FheError::InvalidInput(format!(
            "Month must be 1-12 (got {})",
            month
        )));
    }
    if month == 2 && is_leap_year(year) {
        return Ok(29);
    }
    Ok(DAYS_IN_MONTHS[(month - 1) as usize])
}

fn ymd_to_days_since_base(year: i32, month: u32, day: u32) -> Result<u32, FheError> {
    if year < 1900 {
        return Err(FheError::InvalidInput(format!(
            "Year must be >= 1900 (got {})",
            year
        )));
    }
    if !(1..=31).contains(&day) {
        return Err(FheError::InvalidInput(format!(
            "Day must be 1-31 (got {})",
            day
        )));
    }

    let dim = days_in_month(year, month)?;
    if day > dim {
        return Err(FheError::InvalidInput(format!(
            "Invalid date {}-{:02}-{:02}",
            year, month, day
        )));
    }

    let mut days: u32 = 0;
    for y in 1900..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }
    for m in 1..month {
        days += days_in_month(year, m)?;
    }
    days += day - 1;
    Ok(days)
}

fn days_since_base_to_ymd(mut days: u32) -> Result<(i32, u32, u32), FheError> {
    let mut year: i32 = 1900;
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year = year
            .checked_add(1)
            .ok_or_else(|| FheError::InvalidInput("Year overflow".to_string()))?;
    }

    let mut month: u32 = 1;
    loop {
        let dim = days_in_month(year, month)?;
        if days < dim {
            break;
        }
        days -= dim;
        month = month
            .checked_add(1)
            .ok_or_else(|| FheError::InvalidInput("Month overflow".to_string()))?;
        if month > 12 {
            return Err(FheError::InvalidInput(
                "Invalid day count for date conversion".to_string(),
            ));
        }
    }

    let day = days
        .checked_add(1)
        .ok_or_else(|| FheError::InvalidInput("Day overflow".to_string()))?;
    Ok((year, month, day))
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
    let (current_year, month, day) = days_since_base_to_ymd(current_days)?;
    let cutoff_year = current_year - i32::from(min_age);
    if cutoff_year < 1900 {
        return Err(FheError::InvalidInput(format!(
            "Cutoff year must be >= 1900 (got {})",
            cutoff_year
        )));
    }

    let mut cutoff_day = day;
    if month == 2 && day == 29 && !is_leap_year(cutoff_year) {
        cutoff_day = 28;
    }

    let cutoff_days = ymd_to_days_since_base(cutoff_year, month, cutoff_day)?;

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
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }

    let year: i32 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let day: u32 = parts[2].parse().ok()?;

    if year < 1900 {
        return None;
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    // Simple days calculation for tests (proleptic Gregorian).
    ymd_to_days_since_base(year, month, day).ok()
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
}
