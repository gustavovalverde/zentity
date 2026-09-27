import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth-config";

const BASE_URL = "http://localhost:3000/api/auth";

describe("admin impersonation", () => {
  it.each([
    "/admin/impersonate-user",
    "/admin/stop-impersonating",
  ])("does not serve %s", async (path) => {
    const response = await auth.handler(
      new Request(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ userId: "someone-else" }),
      })
    );

    expect(response.status).toBe(404);
  });
});
