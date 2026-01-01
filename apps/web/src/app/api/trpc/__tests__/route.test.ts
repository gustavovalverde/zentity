/**
 * Integration test for tRPC route handler.
 * Tests that Set-Cookie headers are properly included in HTTP responses.
 *
 * This test exists because:
 * - cookies().set() from next/headers doesn't work inside tRPC handlers
 * - We use ctx.resHeaders to set cookies, which must be merged into the response
 * - Response headers from fetchRequestHandler may be immutable
 */

import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

// Create a minimal tRPC setup that sets a cookie
type TestContext = { resHeaders: Headers };

const t = initTRPC.context<TestContext>().create();

// Simulate middleware that spreads context (like withTracing and withLogging)
const withMiddleware = t.middleware(async ({ ctx, next }) => {
  // This is what our middleware does - spreads ctx
  return next({
    ctx: {
      ...ctx,
      extraField: "added by middleware",
    },
  });
});

const testRouter = t.router({
  setCookie: t.procedure.use(withMiddleware).mutation(({ ctx }) => {
    // Log what we received
    console.log("ctx.resHeaders type:", typeof ctx.resHeaders);
    console.log(
      "ctx.resHeaders is Headers:",
      ctx.resHeaders instanceof Headers,
    );

    // This simulates what createPasskeySession does
    ctx.resHeaders.append(
      "Set-Cookie",
      "better-auth.session_token=test123; HttpOnly; SameSite=Lax; Path=/",
    );
    return { success: true };
  }),
});

describe("tRPC route handler - Set-Cookie propagation", () => {
  it("preserves resHeaders through middleware chain", async () => {
    const resHeaders = new Headers();

    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/setCookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      router: testRouter,
      createContext: async () => ({ resHeaders }),
    });

    // Check if cookie was added to our shared resHeaders
    const cookieInResHeaders = resHeaders.get("Set-Cookie");
    console.log("Cookie in resHeaders (shared object):", cookieInResHeaders);

    // Merge into response
    resHeaders.forEach((value, key) => {
      response.headers.append(key, value);
    });

    const setCookie = response.headers.get("Set-Cookie");
    console.log("Cookie in response after merge:", setCookie);

    // The key assertion - the SHARED resHeaders object should have the cookie
    expect(cookieInResHeaders).toContain("better-auth.session_token=");
    expect(setCookie).toContain("better-auth.session_token=");
  });

  it("FAILS: simulates what happens if resHeaders falls back to new Headers()", async () => {
    // This simulates the bug: if createTrpcContext doesn't receive resHeaders,
    // it creates a NEW Headers() which is disconnected from the route handler's resHeaders
    const routeHandlerHeaders = new Headers();

    // Simulate what happens if createTrpcContext gets called with undefined resHeaders
    const createContextBuggy = async () => {
      const argsResHeaders = undefined; // This is the bug scenario
      return {
        resHeaders: argsResHeaders ?? new Headers(), // Creates a NEW disconnected Headers!
      };
    };

    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/setCookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      router: testRouter,
      createContext: createContextBuggy,
    });

    // Merge route handler's headers into response
    routeHandlerHeaders.forEach((value, key) => {
      response.headers.append(key, value);
    });

    // This will be empty because the cookie was added to a DIFFERENT Headers object
    const cookieInRouteHandlerHeaders = routeHandlerHeaders.get("Set-Cookie");
    console.log(
      "Cookie in routeHandlerHeaders (BUGGY):",
      cookieInRouteHandlerHeaders,
    );

    // This SHOULD fail - showing the bug where cookie goes to wrong Headers object
    expect(cookieInRouteHandlerHeaders).toBeNull(); // The bug - cookie is NOT in our shared headers!
  });
});
