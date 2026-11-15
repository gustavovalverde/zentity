import { describe, expect, it } from "vitest";

import { loader as compliance } from "./redirect-compliance";
import { loader as goLive } from "./redirect-go-live";
import { loader as interoperability } from "./redirect-interoperability";

describe("legacy route redirects", () => {
  it.each([
    ["compliance", compliance, "/#compliance"],
    ["interoperability", interoperability, "/#compliance"],
    ["go-live", goLive, "/docs/oauth-integrations"],
  ])("%s answers with a permanent redirect", (_name, loader, location) => {
    const response = loader();
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(location);
  });
});
