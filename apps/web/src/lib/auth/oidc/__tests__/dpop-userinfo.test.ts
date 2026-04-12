import { describe, expect, it, vi } from "vitest";

// Mock the HAIP validator before importing the module under test
const validateDpopMock = vi.fn();

vi.mock("@better-auth/haip", () => ({
  createDpopAccessTokenValidator: () => validateDpopMock,
}));

// Mock jose's decodeJwt
const decodeJwtMock = vi.fn();

vi.mock("jose", () => ({
  decodeJwt: (token: string) => decodeJwtMock(token),
}));

const { rewriteDpopForUserinfo } = await import("../haip/dpop-userinfo");

function makeRequest(
  authorization: string,
  url = "https://zentity.xyz/api/auth/oauth2/userinfo"
) {
  return new Request(url, {
    method: "GET",
    headers: { authorization },
  });
}

describe("rewriteDpopForUserinfo", () => {
  it("passes Bearer requests through unchanged", async () => {
    const request = makeRequest("Bearer eyJtoken");
    const result = await rewriteDpopForUserinfo(request);
    expect(result.headers.get("authorization")).toBe("Bearer eyJtoken");
    expect(validateDpopMock).not.toHaveBeenCalled();
  });

  it("rewrites DPoP to Bearer after validating the proof", async () => {
    decodeJwtMock.mockReturnValue({
      sub: "u1",
      azp: "client-1",
      cnf: { jkt: "thumbprint" },
    });
    validateDpopMock.mockResolvedValue(undefined);

    const request = makeRequest("DPoP eyJtoken");
    const result = await rewriteDpopForUserinfo(request);

    expect(result.headers.get("authorization")).toBe("Bearer eyJtoken");
    expect(validateDpopMock).toHaveBeenCalledWith({
      request,
      tokenPayload: { sub: "u1", azp: "client-1", cnf: { jkt: "thumbprint" } },
    });
  });

  it("throws when DPoP proof validation fails", async () => {
    decodeJwtMock.mockReturnValue({ sub: "u1", cnf: { jkt: "thumbprint" } });
    validateDpopMock.mockRejectedValue(
      new Error("DPoP proof key does not match token binding")
    );

    const request = makeRequest("DPoP eyJbadtoken");
    await expect(rewriteDpopForUserinfo(request)).rejects.toThrow(
      "DPoP proof key does not match token binding"
    );
  });

  it("rewrites to Bearer when JWT decoding fails (lets better-auth handle error)", async () => {
    decodeJwtMock.mockImplementation(() => {
      throw new Error("Invalid JWT");
    });

    const request = makeRequest("DPoP not-a-jwt");
    const result = await rewriteDpopForUserinfo(request);

    expect(result.headers.get("authorization")).toBe("Bearer not-a-jwt");
    expect(validateDpopMock).not.toHaveBeenCalled();
  });

  it("passes requests without Authorization header through", async () => {
    const request = new Request("https://zentity.xyz/api/auth/oauth2/userinfo");
    const result = await rewriteDpopForUserinfo(request);
    expect(result).toBe(request);
  });
});
