import { describe, expect, it } from "vitest";

import { buildStandaloneApprovalPath } from "@/lib/ciba/approval-path";

describe("buildStandaloneApprovalPath", () => {
  it("returns the standalone approval path without query params", () => {
    expect(buildStandaloneApprovalPath("req-123")).toBe("/approve/req-123");
  });

  it("preserves the cli handoff source query param", () => {
    expect(
      buildStandaloneApprovalPath("req-123", {
        source: "cli_handoff",
      })
    ).toBe("/approve/req-123?source=cli_handoff");
  });
});
