import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth-config";

describe("Better Auth schema", () => {
  it("covers every table and column Better Auth and its plugins write", async () => {
    const { checkSchema } = await auth.$context;

    expect(checkSchema).toBeDefined();
    await expect(Promise.resolve(checkSchema?.())).resolves.toBeUndefined();
  });
});
