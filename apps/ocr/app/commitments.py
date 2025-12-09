"""
Privacy-Preserving Commitments Module

Generates cryptographic commitments (hashes) for identity verification
without storing raw PII. Implements the zkKYC data handling principles:

- Document Hash: SHA256(doc_number + user_salt) - prevents duplicate signups
- Name Commitment: SHA256(normalized_name + user_salt) - enables name verification

Properties:
- Non-reversible: Cannot recover original data from hash
- Deterministic: Same input always produces same output
- Salted: Per-user salt prevents rainbow table attacks
"""

import hashlib
import secrets
import re
from typing import Optional


def generate_user_salt() -> str:
    """
    Generate a cryptographically secure random salt for a user.

    This salt should be stored securely and used for all commitments
    for this user. Deleting the salt effectively "forgets" the user's
    identity (GDPR right to erasure).

    Returns:
        32-byte hex string (64 characters)
    """
    return secrets.token_hex(32)


def normalize_document_number(doc_number: str) -> str:
    """
    Normalize document number for consistent hashing.

    Removes all non-alphanumeric characters and converts to uppercase.
    This ensures that "001-1234567-8" and "00112345678" produce the same hash.

    Args:
        doc_number: Raw document number string

    Returns:
        Normalized document number (uppercase, alphanumeric only)
    """
    if not doc_number:
        return ""
    # Remove all non-alphanumeric characters
    normalized = re.sub(r'[^A-Za-z0-9]', '', doc_number)
    return normalized.upper()


def normalize_name(full_name: str) -> str:
    """
    Normalize name for consistent hashing.

    - Strips whitespace
    - Converts to uppercase
    - Collapses multiple spaces
    - Removes accents/diacritics for consistency

    This ensures that "Juan Pérez" and "JUAN PEREZ" produce the same hash.

    Args:
        full_name: Raw name string

    Returns:
        Normalized name (uppercase, trimmed, no accents)
    """
    if not full_name:
        return ""

    import unicodedata

    # Normalize unicode and remove accents
    normalized = unicodedata.normalize('NFD', full_name)
    normalized = ''.join(
        char for char in normalized
        if unicodedata.category(char) != 'Mn'  # Mn = Mark, Nonspacing (accents)
    )

    # Uppercase and collapse whitespace
    normalized = ' '.join(normalized.upper().split())

    return normalized


def hash_document_number(doc_number: str, user_salt: str) -> str:
    """
    Generate a one-way hash of document number.

    This hash is used to:
    1. Prevent duplicate signups (same document = same hash)
    2. Verify document ownership without storing the document number

    Args:
        doc_number: Raw document number
        user_salt: User's unique salt

    Returns:
        SHA256 hex digest (64 characters)
    """
    normalized = normalize_document_number(doc_number)
    if not normalized:
        raise ValueError("Document number cannot be empty")

    # Format: "NORMALIZED_DOC:salt"
    data = f"{normalized}:{user_salt}"
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def generate_name_commitment(full_name: str, user_salt: str) -> str:
    """
    Generate a cryptographic commitment for a name.

    This commitment enables name verification:
    - Relying party asks: "Is this user named Juan Perez?"
    - We compute: hash = SHA256(normalize("Juan Perez") + salt)
    - We compare: hash == stored_commitment
    - We return: { matches: true/false } without revealing the actual name

    Args:
        full_name: Raw full name
        user_salt: User's unique salt

    Returns:
        SHA256 hex digest (64 characters)
    """
    normalized = normalize_name(full_name)
    if not normalized:
        raise ValueError("Name cannot be empty")

    # Format: "NORMALIZED_NAME:salt"
    data = f"{normalized}:{user_salt}"
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def verify_name_claim(
    claimed_name: str,
    stored_commitment: str,
    user_salt: str
) -> bool:
    """
    Verify if a claimed name matches the stored commitment.

    This is used by relying parties to verify a user's name without
    us ever revealing or storing the actual name.

    Args:
        claimed_name: The name being claimed
        stored_commitment: The stored name commitment hash
        user_salt: User's unique salt

    Returns:
        True if the claimed name matches the commitment
    """
    claimed_commitment = generate_name_commitment(claimed_name, user_salt)
    return secrets.compare_digest(claimed_commitment, stored_commitment)


def verify_document_claim(
    claimed_doc_number: str,
    stored_hash: str,
    user_salt: str
) -> bool:
    """
    Verify if a claimed document number matches the stored hash.

    Args:
        claimed_doc_number: The document number being claimed
        stored_hash: The stored document hash
        user_salt: User's unique salt

    Returns:
        True if the claimed document matches the hash
    """
    claimed_hash = hash_document_number(claimed_doc_number, user_salt)
    return secrets.compare_digest(claimed_hash, stored_hash)


class IdentityCommitments:
    """
    Container for all identity commitments generated from a document.

    This is what gets stored in the database instead of raw PII.
    """

    def __init__(
        self,
        document_hash: str,
        name_commitment: str,
        user_salt: str,
        document_type: Optional[str] = None,
        issuing_country_commitment: Optional[str] = None,
    ):
        self.document_hash = document_hash
        self.name_commitment = name_commitment
        self.user_salt = user_salt
        self.document_type = document_type
        self.issuing_country_commitment = issuing_country_commitment

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "document_hash": self.document_hash,
            "name_commitment": self.name_commitment,
            "document_type": self.document_type,
            "issuing_country_commitment": self.issuing_country_commitment,
            # Note: user_salt is intentionally excluded from serialization
            # It should be stored separately and securely
        }


def generate_issuing_country_commitment(issuing_country_code: str, user_salt: str) -> str:
    """
    Generate a cryptographic commitment for issuing country code.

    This commitment enables fraud detection:
    - Mismatch between issuing country and nationality may indicate fraud
    - Can verify claims about issuing country without storing the code

    Args:
        issuing_country_code: ISO 3166-1 alpha-3 code of issuing country
        user_salt: User's unique salt

    Returns:
        SHA256 hex digest (64 characters)
    """
    if not issuing_country_code:
        raise ValueError("Issuing country code cannot be empty")

    # Normalize to uppercase
    normalized = issuing_country_code.upper().strip()

    # Format: "ISSUING_CODE:salt"
    data = f"{normalized}:{user_salt}"
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def generate_identity_commitments(
    document_number: str,
    full_name: str,
    user_salt: Optional[str] = None,
    document_type: Optional[str] = None,
    issuing_country_code: Optional[str] = None,
) -> IdentityCommitments:
    """
    Generate all identity commitments from document data.

    This is the main entry point for creating privacy-preserving
    identity records from raw document data.

    Args:
        document_number: Raw document number
        full_name: Raw full name
        user_salt: Optional existing salt (generates new if not provided)
        document_type: Optional document type (cedula, passport, etc.)
        issuing_country_code: Optional ISO 3166-1 alpha-3 issuing country code

    Returns:
        IdentityCommitments object with all hashes
    """
    if user_salt is None:
        user_salt = generate_user_salt()

    issuing_commitment = None
    if issuing_country_code:
        issuing_commitment = generate_issuing_country_commitment(
            issuing_country_code, user_salt
        )

    return IdentityCommitments(
        document_hash=hash_document_number(document_number, user_salt),
        name_commitment=generate_name_commitment(full_name, user_salt),
        user_salt=user_salt,
        document_type=document_type,
        issuing_country_commitment=issuing_commitment,
    )
