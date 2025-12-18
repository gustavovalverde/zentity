//! Full Date of Birth Encryption Operations
//!
//! Provides FHE-based operations for full DOB (YYYYMMDD format as u32).
//! This enables precise age calculations (age in days, not just years).

use super::{get_key_store, setup_for_verification};
use crate::error::FheError;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tfhe::prelude::*;
use tfhe::FheUint32;

/// YYYYMMDD integer format encoding multipliers.
///
/// Dates are encoded as: `year * YEAR_MULTIPLIER + month * MONTH_MULTIPLIER + day`
///
/// Example: 2025-12-07 = 2025 * 10000 + 12 * 100 + 7 = 20251207
const YEAR_MULTIPLIER: u32 = 10000;
const MONTH_MULTIPLIER: u32 = 100;

/// Validates date components are within acceptable ranges.
fn validate_date_components(year: u32, month: u32, day: u32) -> Result<(), FheError> {
    if !(1900..=2100).contains(&year) {
        return Err(FheError::InvalidInput(format!(
            "Year out of range (1900-2100): {}",
            year
        )));
    }
    if !(1..=12).contains(&month) {
        return Err(FheError::InvalidInput(format!(
            "Month out of range (1-12): {}",
            month
        )));
    }
    if !(1..=31).contains(&day) {
        return Err(FheError::InvalidInput(format!(
            "Day out of range (1-31): {}",
            day
        )));
    }
    Ok(())
}

/// Encodes date components into YYYYMMDD integer format.
fn encode_date(year: u32, month: u32, day: u32) -> u32 {
    year * YEAR_MULTIPLIER + month * MONTH_MULTIPLIER + day
}

/// Decodes YYYYMMDD integer into (year, month, day) components.
fn decode_date(date_int: u32) -> (u32, u32, u32) {
    let year = date_int / YEAR_MULTIPLIER;
    let month = (date_int % YEAR_MULTIPLIER) / MONTH_MULTIPLIER;
    let day = date_int % MONTH_MULTIPLIER;
    (year, month, day)
}

/// Parses date string into YYYYMMDD integer.
///
/// Supported formats (tried in order):
/// 1. ISO 8601: YYYY-MM-DD (e.g., "2025-12-07")
/// 2. Regional: DD/MM/YYYY (e.g., "07/12/2025")
/// 3. Integer: YYYYMMDD (e.g., "20251207")
pub fn parse_date_to_int(date_str: &str) -> Result<u32, FheError> {
    // Try YYYY-MM-DD format (ISO 8601)
    if date_str.contains('-') {
        let parts: Vec<&str> = date_str.split('-').collect();
        if parts.len() != 3 {
            return Err(FheError::InvalidInput(format!(
                "Invalid date format: {}. Expected YYYY-MM-DD",
                date_str
            )));
        }

        let year: u32 = parts[0]
            .parse()
            .map_err(|_| FheError::InvalidInput(format!("Invalid year in date: {}", date_str)))?;
        let month: u32 = parts[1]
            .parse()
            .map_err(|_| FheError::InvalidInput(format!("Invalid month in date: {}", date_str)))?;
        let day: u32 = parts[2]
            .parse()
            .map_err(|_| FheError::InvalidInput(format!("Invalid day in date: {}", date_str)))?;

        validate_date_components(year, month, day)?;
        return Ok(encode_date(year, month, day));
    }

    // Try DD/MM/YYYY format (regional)
    if date_str.contains('/') {
        let parts: Vec<&str> = date_str.split('/').collect();
        if parts.len() != 3 {
            return Err(FheError::InvalidInput(format!(
                "Invalid date format: {}. Expected DD/MM/YYYY",
                date_str
            )));
        }

        let day: u32 = parts[0]
            .parse()
            .map_err(|_| FheError::InvalidInput(format!("Invalid day in date: {}", date_str)))?;
        let month: u32 = parts[1]
            .parse()
            .map_err(|_| FheError::InvalidInput(format!("Invalid month in date: {}", date_str)))?;
        let year: u32 = parts[2]
            .parse()
            .map_err(|_| FheError::InvalidInput(format!("Invalid year in date: {}", date_str)))?;

        validate_date_components(year, month, day)?;
        return Ok(encode_date(year, month, day));
    }

    // Try direct YYYYMMDD integer
    let date_int: u32 = date_str.parse().map_err(|_| {
        FheError::InvalidInput(format!(
            "Invalid date format: {}. Expected YYYY-MM-DD, DD/MM/YYYY, or YYYYMMDD",
            date_str
        ))
    })?;

    // Validate the integer format
    let (year, month, day) = decode_date(date_int);
    validate_date_components(year, month, day)?;

    Ok(date_int)
}

/// Get current date as YYYYMMDD integer
pub fn get_current_date_int() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");

    // Simple calculation (not accounting for leap seconds, etc.)
    let days_since_epoch = now.as_secs() / 86400;

    // Convert to date (simplified - using a basic algorithm)
    let mut year = 1970u32;
    let mut remaining_days = days_since_epoch as u32;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let days_in_months: [u32; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1u32;
    for days_in_month in days_in_months.iter() {
        if remaining_days < *days_in_month {
            break;
        }
        remaining_days -= *days_in_month;
        month += 1;
    }

    let day = remaining_days + 1;

    encode_date(year, month, day)
}

fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

/// Encrypt a full date of birth (YYYYMMDD) using the specified client key
pub fn encrypt_dob(dob: u32, client_key_id: &str) -> Result<String, FheError> {
    // Validate date format
    let (year, month, day) = decode_date(dob);
    validate_date_components(year, month, day)?;

    let key_store = get_key_store();

    let client_key = key_store
        .get_client_key(client_key_id)
        .ok_or_else(|| FheError::KeyNotFound(client_key_id.to_string()))?;

    let encrypted = FheUint32::encrypt(dob, &client_key);

    // Serialize to bytes using bincode 2.x serde API
    let bytes = bincode::serde::encode_to_vec(&encrypted, bincode::config::standard())?;

    // Encode as base64
    Ok(BASE64.encode(&bytes))
}

/// Verify precise age on encrypted full DOB
///
/// This checks if the person is at least `min_age` years old as of `current_date`.
/// Both dates should be in YYYYMMDD format.
///
/// The `current_date` is validated to ensure it's not stale (max 1 day tolerance
/// for timezone differences). This prevents manipulation of age calculations.
pub fn verify_age_precise(
    ciphertext_b64: &str,
    current_date: u32,
    min_age: u16,
    client_key_id: &str,
) -> Result<bool, FheError> {
    // Validate that current_date is recent (within 1 day tolerance for timezone)
    let actual_date = get_current_date_int();
    let date_diff = actual_date.saturating_sub(current_date);
    if date_diff > 1 {
        return Err(FheError::InvalidInput(format!(
            "current_date is stale: provided {}, actual {}",
            current_date, actual_date
        )));
    }

    let client_key = setup_for_verification(client_key_id)?;

    // Decode base64
    let bytes = BASE64.decode(ciphertext_b64)?;

    // Deserialize to FheUint32 using bincode 2.x serde API
    let (encrypted_dob, _): (FheUint32, _) =
        bincode::serde::decode_from_slice(&bytes, bincode::config::standard())?;

    // Calculate the threshold DOB for minimum age requirement.
    //
    // For YYYYMMDD format, subtracting `min_age * YEAR_MULTIPLIER` gives correct cutoff:
    // Example: today=20251207, min_age=18 -> threshold=20071207
    // Anyone born on/before 2007-12-07 is at least 18.
    let threshold_dob = current_date - (min_age as u32) * YEAR_MULTIPLIER;

    // Check if encrypted_dob <= threshold_dob (person is old enough)
    let encrypted_is_adult = encrypted_dob.le(threshold_dob);

    // Decrypt only the boolean result
    let is_over_age: bool = encrypted_is_adult.decrypt(&client_key);

    Ok(is_over_age)
}
