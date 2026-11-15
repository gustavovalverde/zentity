import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

const recordClientMetricServer = vi.fn();
vi.mock("@/lib/observability/metrics", () => ({
  recordClientMetricServer: (...args: unknown[]) =>
    recordClientMetricServer(...args),
}));

import { POST } from "../route";

function post(body: string) {
  return POST(
    new Request("http://localhost/api/status/metrics/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }) as unknown as NextRequest
  );
}

function event(unit: "ms" | "By", value: number | string) {
  const name =
    unit === "ms" ? "client.noir.proof.duration" : "client.noir.proof.bytes";
  return `{"name":"${name}","unit":"${unit}","value":${value}}`;
}

describe("client metrics route", () => {
  beforeEach(() => {
    recordClientMetricServer.mockClear();
  });

  it("records values within the unit limits", async () => {
    const response = await post(
      `{"events":[${event("ms", 1500)},${event("By", 2048)}]}`
    );

    expect(response.status).toBe(202);
    expect(recordClientMetricServer).toHaveBeenCalledTimes(2);
  });

  it("drops values above the unit limits", async () => {
    const response = await post(
      `{"events":[${event("ms", 5 * 60_000 + 1)},${event("By", 50 * 1024 * 1024 + 1)}]}`
    );

    expect(response.status).toBe(202);
    expect(recordClientMetricServer).not.toHaveBeenCalled();
  });

  it("rejects negative and non-finite values before the limit check", async () => {
    expect((await post(`{"events":[${event("ms", -1)}]}`)).status).toBe(400);
    expect((await post(`{"events":[${event("ms", "1e999")}]}`)).status).toBe(
      400
    );
    expect(recordClientMetricServer).not.toHaveBeenCalled();
  });
});
