import { describe, expect, it } from "vitest";

import { buildAgentRuntimePartitionKey } from "./agent-runtime-storage";

describe("buildAgentRuntimePartitionKey", () => {
  it("partitions registered runtimes onto the isolated v2 cache", () => {
    expect(buildAgentRuntimePartitionKey("bank", "registered")).toBe(
      "bank::agent-runtime:v2:registered"
    );
  });

  it("partitions attested runtimes away from the registered cache", () => {
    expect(buildAgentRuntimePartitionKey("bank", "attested")).toBe(
      "bank::agent-runtime:v2:attested"
    );
  });
});
