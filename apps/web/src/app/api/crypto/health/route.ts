import { NextResponse } from "next/server";

const FHE_SERVICE_URL = process.env.FHE_SERVICE_URL || "http://localhost:5001";
const ZK_SERVICE_URL = process.env.ZK_SERVICE_URL || "http://localhost:5002";

async function checkService(url: string, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

export async function GET() {
  const [fheHealth, zkHealth] = await Promise.all([
    checkService(FHE_SERVICE_URL),
    checkService(ZK_SERVICE_URL),
  ]);

  const allHealthy = fheHealth?.status === "ok" && zkHealth?.status === "ok";

  return NextResponse.json({
    fhe: fheHealth,
    zk: zkHealth,
    allHealthy,
  });
}
