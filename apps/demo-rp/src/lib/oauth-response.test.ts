import { describe, expect, it } from "vitest";

import {
  describeOAuthErrorResponse,
  parseOAuthJsonResponse,
} from "./oauth-response";

describe("parseOAuthJsonResponse", () => {
  it("parses JSON object responses", async () => {
    const response = new Response(JSON.stringify({ access_token: "token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(
      parseOAuthJsonResponse(response, "OAuth token exchange")
    ).resolves.toEqual({
      access_token: "token",
    });
  });

  it("throws a useful error for empty bodies", async () => {
    const response = new Response("", { status: 400, statusText: "Bad Request" });

    await expect(
      parseOAuthJsonResponse(response, "OAuth token exchange")
    ).rejects.toThrow(
      "OAuth token exchange failed: empty response body (400 Bad Request)"
    );
  });

  it("throws a useful error for invalid JSON", async () => {
    const response = new Response("<!doctype html>", {
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(
      parseOAuthJsonResponse(response, "OAuth token exchange")
    ).rejects.toThrow(
      "OAuth token exchange failed: invalid JSON response (500 Internal Server Error): <!doctype html>"
    );
  });
});

describe("describeOAuthErrorResponse", () => {
  it("prefers OAuth error and description fields", () => {
    const response = new Response(null, {
      status: 400,
      statusText: "Bad Request",
    });

    expect(
      describeOAuthErrorResponse(
        response,
        {
          error: "invalid_grant",
          error_description: "code verifier mismatch",
        },
        "OAuth token exchange"
      )
    ).toBe(
      "OAuth token exchange failed (400): invalid_grant - code verifier mismatch"
    );
  });
});
