import { NextResponse } from "next/server";

import { getAppOrigin } from "@/lib/auth/origin";

// The CIBA plugin issues 32-character alphanumeric auth_req_id values.
const AUTH_REQ_ID_PATTERN = /^[A-Za-z0-9]{32}$/;

/**
 * The CIBA plugin links notifications to `/approve?auth_req_id=…`; the approval
 * page lives at `/approve/[authReqId]`.
 */
export function GET(request: Request) {
  const authReqId = new URL(request.url).searchParams.get("auth_req_id");
  if (!(authReqId && AUTH_REQ_ID_PATTERN.test(authReqId))) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "auth_req_id is missing or malformed",
      },
      { status: 400 }
    );
  }
  return NextResponse.redirect(
    new URL(`/approve/${authReqId}`, getAppOrigin())
  );
}
