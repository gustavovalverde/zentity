import { NextResponse } from "next/server";
import { getFheServiceUrl, getZkServiceUrl } from "@/lib/service-urls";

const FHE_SERVICE_URL = getFheServiceUrl();
const ZK_SERVICE_URL = getZkServiceUrl();

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
