//! Full Date of Birth Encryption Operations
//!
//! Provides FHE-based operations for full DOB (YYYYMMDD format as u32).
//! This enables precise age calculations (age in days, not just years).

use super::get_key_store;
use crate::error::FheError;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::time::Instant;
use tfhe::prelude::*;
use tfhe::{set_server_key, FheUint32};

/// Parse ISO 8601 date string (YYYY-MM-DD) to YYYYMMDD integer
pub fn parse_date_to_int(date_str: &str) -> Result<u32, FheError> {
    // Try YYYY-MM-DD format
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

        // Validate ranges
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

        return Ok(year * 10000 + month * 100 + day);
    }

    // Try DD/MM/YYYY format
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

        // Validate ranges
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

        return Ok(year * 10000 + month * 100 + day);
    }

    // Try direct YYYYMMDD integer
    let date_int: u32 = date_str.parse().map_err(|_| {
        FheError::InvalidInput(format!(
            "Invalid date format: {}. Expected YYYY-MM-DD, DD/MM/YYYY, or YYYYMMDD",
            date_str
        ))
    })?;

    // Validate the integer format
    let year = date_int / 10000;
    let month = (date_int % 10000) / 100;
    let day = date_int % 100;

    if !(1900..=2100).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(FheError::InvalidInput(format!(
            "Invalid YYYYMMDD date: {}",
            date_int
        )));
    }

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

    year * 10000 + month * 100 + day
}

fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

/// Encrypt a full date of birth (YYYYMMDD) using the specified client key
pub fn encrypt_dob(dob: u32, client_key_id: &str) -> Result<String, FheError> {
    // Validate date format
    let year = dob / 10000;
    let month = (dob % 10000) / 100;
    let day = dob % 100;

    if !(1900..=2100).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(FheError::InvalidInput(format!(
            "Invalid YYYYMMDD date: {}",
            dob
        )));
    }

    let key_store = get_key_store();

    let client_key = key_store
        .get_client_key(client_key_id)
        .ok_or_else(|| FheError::KeyNotFound(client_key_id.to_string()))?;

    let encrypted = FheUint32::encrypt(dob, &client_key);

    // Serialize to bytes
    let bytes = bincode::serialize(&encrypted)?;

    // Encode as base64
    Ok(BASE64.encode(&bytes))
}

/// Verify precise age on encrypted full DOB
///
/// This checks if the person is at least `min_age` years old as of `current_date`.
/// Both dates should be in YYYYMMDD format.
pub fn verify_age_precise(
    ciphertext_b64: &str,
    current_date: u32,
    min_age: u16,
    client_key_id: &str,
) -> Result<(bool, u64), FheError> {
    let start = Instant::now();

    let key_store = get_key_store();

    // Set server key for this thread
    set_server_key(key_store.get_server_key().clone());

    let client_key = key_store
        .get_client_key(client_key_id)
        .ok_or_else(|| FheError::KeyNotFound(client_key_id.to_string()))?;

    // Decode base64
    let bytes = BASE64.decode(ciphertext_b64)?;

    // Deserialize to FheUint32
    let encrypted_dob: FheUint32 = bincode::deserialize(&bytes)?;

    // Calculate the minimum DOB for someone who is min_age years old
    // If current_date is 20251207 and min_age is 18, then:
    // min_dob = 20251207 - (18 * 10000) = 20071207
    // Someone born on or before 20071207 is at least 18
    let min_years_ago = (min_age as u32) * 10000;
    let threshold_dob = current_date - min_years_ago;

    // Check if encrypted_dob <= threshold_dob (person is old enough)
    let encrypted_is_adult = encrypted_dob.le(threshold_dob);

    // Decrypt only the boolean result
    let is_over_age: bool = encrypted_is_adult.decrypt(&client_key);

    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok((is_over_age, elapsed_ms))
}
