/**
 * Nationality Membership Proof API
 *
 * POST /api/crypto/nationality-proof - Generate ZK proof that nationality is in a country group
 * GET /api/crypto/nationality-proof - List country groups or check membership
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { toServiceErrorPayload } from "@/lib/http-error-payload";
import {
  checkNationalityMembershipZk,
  generateNationalityProofZk,
  getNationalityGroupZk,
  listNationalityGroupsZk,
} from "@/lib/zk-client";

/**
 * POST - Generate nationality membership ZK proof
 *
 * Body: { nationalityCode: "DEU", groupName: "EU" }
 * Returns proof that nationality is in the group without revealing which country
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const body = await request.json();
    const { nationalityCode, groupName } = body;

    // Validate inputs
    if (!nationalityCode) {
      return NextResponse.json(
        {
          error:
            "nationalityCode is required (ISO 3166-1 alpha-3, e.g., 'DEU')",
        },
        { status: 400 },
      );
    }

    if (!groupName) {
      return NextResponse.json(
        {
          error: "groupName is required (EU, SCHENGEN, EEA, LATAM, FIVE_EYES)",
        },
        { status: 400 },
      );
    }

    const result = await generateNationalityProofZk({
      nationalityCode,
      groupName,
    });

    return NextResponse.json({
      success: true,
      proof: result.proof,
      publicSignals: result.publicSignals,
      isMember: result.isMember,
      groupName: result.groupName,
      merkleRoot: result.merkleRoot,
      generationTimeMs: result.generationTimeMs,
      solidityCalldata: result.solidityCalldata,
    });
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to generate proof",
    );
    return NextResponse.json(payload, { status });
  }
}

/**
 * GET - List country groups or check membership
 *
 * Query params:
 * - No params: List all available groups
 * - group=EU: Get countries in a specific group
 * - code=DEU&group=EU: Check if country is in group (without proof)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const group = searchParams.get("group");

    // Check membership if both code and group provided
    if (code && group) {
      const result = await checkNationalityMembershipZk({ code, group });
      return NextResponse.json(result);
    }

    // Get specific group if group provided
    if (group) {
      const result = await getNationalityGroupZk({ group });
      return NextResponse.json(result);
    }

    // List all groups
    const result = await listNationalityGroupsZk();
    return NextResponse.json(result);
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to fetch groups",
    );
    return NextResponse.json(payload, { status });
  }
}
