"""
ZK Proof Integration - Face Match Zero-Knowledge Proof Generation

This module integrates with the ZK service to generate cryptographic proofs
that a face similarity score meets a minimum threshold without revealing
the exact score.

Privacy Design:
- The exact similarity score is kept private
- Only the threshold and isMatch boolean are public
- The proof is cryptographically verifiable
- No biometric data leaves the service
"""

import os
import httpx
from typing import Optional

# ZK Service URL (defaults to local service)
ZK_SERVICE_URL = os.getenv("ZK_SERVICE_URL", "http://localhost:5002")
ZK_PROOF_TIMEOUT = float(os.getenv("ZK_PROOF_TIMEOUT", "30.0"))


async def generate_face_match_proof(
    similarity_score: float,
    threshold: float = 0.6,
) -> dict:
    """
    Generate a ZK proof that similarity_score >= threshold.

    This calls the ZK service to generate a Groth16 proof that can be
    verified by any relying party without revealing the exact score.

    Args:
        similarity_score: The face comparison confidence (0.0-1.0)
        threshold: Minimum threshold for match (0.0-1.0), default 0.6

    Returns:
        dict with:
        - success: bool
        - proof: Groth16 proof object (if successful)
        - publicSignals: Array of public signals
        - isMatch: bool
        - threshold: float
        - generationTimeMs: int
        - error: optional error message
    """
    try:
        async with httpx.AsyncClient(timeout=ZK_PROOF_TIMEOUT) as client:
            response = await client.post(
                f"{ZK_SERVICE_URL}/facematch/generate",
                json={
                    "similarityScore": similarity_score,
                    "threshold": threshold,
                },
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    "success": True,
                    "proof": data.get("proof"),
                    "publicSignals": data.get("publicSignals"),
                    "isMatch": data.get("isMatch"),
                    "threshold": data.get("threshold"),
                    "generationTimeMs": data.get("generationTimeMs"),
                    "solidityCalldata": data.get("solidityCalldata"),
                }
            else:
                return {
                    "success": False,
                    "error": f"ZK service error: {response.status_code}",
                }

    except httpx.ConnectError:
        return {
            "success": False,
            "error": "ZK service unavailable",
        }
    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "ZK proof generation timed out",
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"ZK proof generation failed: {str(e)}",
        }


async def verify_face_match_proof(
    proof: dict,
    public_signals: list,
) -> dict:
    """
    Verify a face match ZK proof.

    Args:
        proof: Groth16 proof object
        public_signals: Array of public signals

    Returns:
        dict with:
        - success: bool
        - isValid: bool
        - threshold: float (extracted from public signals)
        - verificationTimeMs: int
        - error: optional error message
    """
    try:
        async with httpx.AsyncClient(timeout=ZK_PROOF_TIMEOUT) as client:
            response = await client.post(
                f"{ZK_SERVICE_URL}/facematch/verify",
                json={
                    "proof": proof,
                    "publicSignals": public_signals,
                },
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    "success": True,
                    "isValid": data.get("isValid"),
                    "threshold": data.get("threshold"),
                    "verificationTimeMs": data.get("verificationTimeMs"),
                }
            else:
                return {
                    "success": False,
                    "error": f"ZK service error: {response.status_code}",
                }

    except httpx.ConnectError:
        return {
            "success": False,
            "error": "ZK service unavailable",
        }
    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "ZK proof verification timed out",
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"ZK proof verification failed: {str(e)}",
        }
