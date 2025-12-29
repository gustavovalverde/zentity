"""Name verification endpoint."""

from __future__ import annotations

from fastapi import APIRouter

from ..schemas import VerifyNameRequest, VerifyNameResponse
from ..services.commitments import verify_name_claim


def get_router() -> APIRouter:
    router = APIRouter()

    @router.post("/verify-name", response_model=VerifyNameResponse)
    async def verify_name_endpoint(request: VerifyNameRequest):
        matches = verify_name_claim(
            claimed_name=request.claimed_name,
            stored_commitment=request.stored_commitment,
            user_salt=request.user_salt,
        )
        return VerifyNameResponse(matches=matches)

    return router
