/**
 * Nationality Membership Proof API
 *
 * POST /api/crypto/nationality-proof - Generate ZK proof that nationality is in a country group
 * GET /api/crypto/nationality-proof - List country groups or check membership
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const ZK_SERVICE_URL = process.env.ZK_SERVICE_URL || "http://localhost:5002";

/**
 * POST - Generate nationality membership ZK proof
 *
 * Body: { nationalityCode: "DEU", groupName: "EU" }
 * Returns proof that nationality is in the group without revealing which country
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { nationalityCode, groupName } = body;

    // Validate inputs
    if (!nationalityCode) {
      return NextResponse.json(
        { error: "nationalityCode is required (ISO 3166-1 alpha-3, e.g., 'DEU')" },
        { status: 400 }
      );
    }

    if (!groupName) {
      return NextResponse.json(
        { error: "groupName is required (EU, SCHENGEN, EEA, LATAM, FIVE_EYES)" },
        { status: 400 }
      );
    }

    // Call ZK service to generate proof
    const response = await fetch(`${ZK_SERVICE_URL}/nationality/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nationalityCode: nationalityCode.toUpperCase(),
        groupName: groupName.toUpperCase(),
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "ZK service error" }));
      return NextResponse.json(error, { status: response.status });
    }

    const result = await response.json();

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
    console.error("[Nationality Proof] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate proof" },
      { status: 500 }
    );
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
    // Verify authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const group = searchParams.get("group");

    // Check membership if both code and group provided
    if (code && group) {
      const response = await fetch(
        `${ZK_SERVICE_URL}/nationality/check?code=${encodeURIComponent(code)}&group=${encodeURIComponent(group)}`
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "ZK service error" }));
        return NextResponse.json(error, { status: response.status });
      }

      return NextResponse.json(await response.json());
    }

    // Get specific group if group provided
    if (group) {
      const response = await fetch(
        `${ZK_SERVICE_URL}/nationality/groups/${encodeURIComponent(group)}`
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "ZK service error" }));
        return NextResponse.json(error, { status: response.status });
      }

      return NextResponse.json(await response.json());
    }

    // List all groups
    const response = await fetch(`${ZK_SERVICE_URL}/nationality/groups`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "ZK service error" }));
      return NextResponse.json(error, { status: response.status });
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("[Nationality Proof] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch groups" },
      { status: 500 }
    );
  }
}
