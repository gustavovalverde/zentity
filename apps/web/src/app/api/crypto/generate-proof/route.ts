import { type NextRequest, NextResponse } from "next/server";

const ZK_SERVICE_URL = process.env.ZK_SERVICE_URL || "http://localhost:5002";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { birthYear, currentYear, minAge = 18 } = body;

    if (!birthYear || !currentYear) {
      return NextResponse.json(
        { error: "birthYear and currentYear are required" },
        { status: 400 },
      );
    }

    const response = await fetch(`${ZK_SERVICE_URL}/generate-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ birthYear, currentYear, minAge }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.error || "ZK service error" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to connect to ZK service" },
      { status: 503 },
    );
  }
}
