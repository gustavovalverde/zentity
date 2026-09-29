import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.zentity.xyz",
  },
}));

import { GET } from "./route";

const AUTH_REQ_ID = "zxwWW9Kt6ZeAGooMAJ8m1vtMSROi427C";

function approvalLink(query: string): Request {
  return new Request(`http://0.0.0.0:3000/approve${query}`);
}

describe("CIBA approval link", () => {
  it("redirects the notification link to the approval page", () => {
    const response = GET(approvalLink(`?auth_req_id=${AUTH_REQ_ID}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://app.zentity.xyz/approve/${AUTH_REQ_ID}`
    );
  });

  it.each([
    ["missing", ""],
    ["too short", "?auth_req_id=abc123"],
    ["path traversal", "?auth_req_id=..%2F..%2Fdashboard%2Fsettings%2Fxx"],
    ["an absolute URL", "?auth_req_id=https%3A%2F%2Fevil.example%2F12345678"],
  ])("rejects a %s auth_req_id without redirecting", (_label, query) => {
    const response = GET(approvalLink(query));

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });
});
