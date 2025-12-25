import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/api-auth";

import { db } from "./kyc-db";

interface KycStatusResponse {
  documentUploaded: boolean;
  documentVerified: boolean;
  selfieUploaded: boolean;
  selfieVerified: boolean;
  faceMatchScore: number | null;
  kycCompleted: boolean;
  kycLevel: "none" | "basic" | "enhanced" | "full";
  updatedAt: string | null;
}

export async function GET(): Promise<
  NextResponse<KycStatusResponse | { error: string }>
> {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const stmt = db.prepare(`
      SELECT
        document_uploaded,
        document_verified,
        selfie_uploaded,
        selfie_verified,
        face_match_score,
        kyc_completed,
        kyc_level,
        updated_at
      FROM kyc_status
      WHERE user_id = ?
    `);

    const status = stmt.get(authResult.session.user.id) as
      | {
          document_uploaded: number;
          document_verified: number;
          selfie_uploaded: number;
          selfie_verified: number;
          face_match_score: number | null;
          kyc_completed: number;
          kyc_level: string;
          updated_at: string | null;
        }
      | undefined;

    if (!status) {
      return NextResponse.json({
        documentUploaded: false,
        documentVerified: false,
        selfieUploaded: false,
        selfieVerified: false,
        faceMatchScore: null,
        kycCompleted: false,
        kycLevel: "none" as const,
        updatedAt: null,
      });
    }

    return NextResponse.json({
      documentUploaded: Boolean(status.document_uploaded),
      documentVerified: Boolean(status.document_verified),
      selfieUploaded: Boolean(status.selfie_uploaded),
      selfieVerified: Boolean(status.selfie_verified),
      faceMatchScore: status.face_match_score,
      kycCompleted: Boolean(status.kyc_completed),
      kycLevel: status.kyc_level as "none" | "basic" | "enhanced" | "full",
      updatedAt: status.updated_at,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to retrieve KYC status" },
      { status: 500 },
    );
  }
}
