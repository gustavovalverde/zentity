/**
 * Nationality Membership Proof API
 *
 * POST /api/crypto/nationality-proof - Get Merkle proof inputs for client-side proving
 * GET /api/crypto/nationality-proof - List country groups or check membership
 */

import { type NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/api-auth";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";
import {
  generateNationalityProofInputs,
  getCountriesInGroup,
  getMerkleRoot,
  isCountryInGroup,
  listCountryGroups,
} from "@/lib/privacy/country";
import { poseidon2Hash } from "@/lib/privacy/crypto/barretenberg";
import { toServiceErrorPayload } from "@/lib/utils/http-error-payload";

/**
 * POST - Get Merkle proof inputs for nationality membership
 *
 * Body: { nationalityCode: "DEU", groupName: "EU" }
 * Returns: Merkle proof inputs for client-side Noir proving
 *
 * The client will use these inputs with the nationality_membership circuit
 * to generate a ZK proof that their nationality is in the group.
 */
export async function POST(request: NextRequest) {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  try {
    const authResult = await requireSession(request.headers);
    if (!authResult.ok) {
      return authResult.response;
    }

    const body = await request.json();
    const { nationalityCode, groupName } = body;

    // Validate inputs
    if (!nationalityCode) {
      return NextResponse.json(
        {
          error:
            "nationalityCode is required (ISO 3166-1 alpha-3, e.g., 'DEU')",
        },
        { status: 400 }
      );
    }

    if (!groupName) {
      return NextResponse.json(
        {
          error: "groupName is required (EU, SCHENGEN, EEA, LATAM, FIVE_EYES)",
        },
        { status: 400 }
      );
    }

    const startTime = Date.now();

    // Generate Merkle proof inputs for the Noir circuit
    const proofInputs = await generateNationalityProofInputs(
      nationalityCode,
      groupName,
      poseidon2Hash
    );

    return NextResponse.json({
      success: true,
      // Inputs for client-side Noir proving
      nationalityCode: proofInputs.nationalityCode,
      merkleRoot: proofInputs.merkleRoot,
      pathElements: proofInputs.pathElements,
      pathIndices: proofInputs.pathIndices,
      groupName: groupName.toUpperCase(),
      generationTimeMs: Date.now() - startTime,
    });
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to generate proof inputs"
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
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  try {
    const authResult = await requireSession(request.headers);
    if (!authResult.ok) {
      return authResult.response;
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const group = searchParams.get("group");

    // Check membership if both code and group provided
    if (code && group) {
      const isMember = isCountryInGroup(code, group);
      const merkleRoot = isMember
        ? await getMerkleRoot(group, poseidon2Hash)
        : null;
      return NextResponse.json({
        code: code.toUpperCase(),
        group: group.toUpperCase(),
        isMember,
        merkleRoot: merkleRoot ? `0x${merkleRoot.toString(16)}` : null,
      });
    }

    // Get specific group if group provided
    if (group) {
      const countries = getCountriesInGroup(group);
      if (!countries) {
        return NextResponse.json(
          { error: `Unknown group: ${group}` },
          { status: 404 }
        );
      }
      const merkleRoot = await getMerkleRoot(group, poseidon2Hash);
      return NextResponse.json({
        group: group.toUpperCase(),
        countries,
        count: countries.length,
        merkleRoot: `0x${merkleRoot.toString(16)}`,
      });
    }

    // List all groups
    const groups = listCountryGroups();
    const groupsWithRoots = await Promise.all(
      groups.map(async (g) => {
        const root = await getMerkleRoot(g, poseidon2Hash);
        const countries = getCountriesInGroup(g);
        return {
          name: g,
          count: countries?.length ?? 0,
          merkleRoot: `0x${root.toString(16)}`,
        };
      })
    );
    return NextResponse.json({ groups: groupsWithRoots });
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to fetch groups"
    );
    return NextResponse.json(payload, { status });
  }
}
