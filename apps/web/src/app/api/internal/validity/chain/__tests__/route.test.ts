import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIngest } = vi.hoisted(() => ({ mockIngest: vi.fn() }));

vi.mock("@/lib/http/admin-auth", () => ({
  requireAdminApiKey: vi.fn(() => null),
}));
vi.mock("@/lib/identity/validity/chain-ingest", () => ({
  ingestChainValidityEvents: mockIngest,
}));

import { POST } from "../route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/internal/validity/chain", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

describe("POST /api/internal/validity/chain", () => {
  beforeEach(() => {
    mockIngest.mockReset();
    mockIngest.mockResolvedValue({ eventsSeen: 0 });
  });

  it("passes networkId and fromBlock to the ingest", async () => {
    const res = await post({ networkId: "sepolia", fromBlock: 12 });

    expect(res.status).toBe(200);
    expect(mockIngest).toHaveBeenCalledWith({
      networkId: "sepolia",
      fromBlock: 12,
    });
  });

  it("omits fromBlock when absent", async () => {
    await post({ networkId: "sepolia" });

    expect(mockIngest).toHaveBeenCalledWith({ networkId: "sepolia" });
  });

  it.each([
    ["unparseable body", "not json"],
    ["missing networkId", {}],
    ["non-string networkId", { networkId: 7 }],
    ["empty networkId", { networkId: "" }],
    ["string fromBlock", { networkId: "sepolia", fromBlock: "12" }],
    ["negative fromBlock", { networkId: "sepolia", fromBlock: -1 }],
    ["fractional fromBlock", { networkId: "sepolia", fromBlock: 1.5 }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(mockIngest).not.toHaveBeenCalled();
  });
});
