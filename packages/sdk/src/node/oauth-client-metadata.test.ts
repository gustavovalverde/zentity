import { describe, expect, it } from "vitest";
import {
  buildLoopbackClientRegistration,
  normalizeUrl,
} from "./oauth-client-metadata";

describe("oauth client metadata helpers", () => {
  it("builds a loopback registration request with the default redirect URI", () => {
    expect(
      buildLoopbackClientRegistration({
        clientName: "Example CLI",
        grantTypes: ["authorization_code", "refresh_token"],
        scope: "openid offline_access",
      })
    ).toEqual({
      application_type: "native",
      client_name: "Example CLI",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://127.0.0.1/callback"],
      response_types: ["code"],
      scope: "openid offline_access",
      token_endpoint_auth_method: "none",
    });
  });

  it("registers CIBA clients for poll delivery", () => {
    expect(
      buildLoopbackClientRegistration({
        clientName: "Example CLI",
        grantTypes: ["authorization_code", "urn:openid:params:grant-type:ciba"],
        scope: "openid",
      })
    ).toMatchObject({ backchannel_token_delivery_mode: "poll" });
  });

  it("normalizes trailing slashes from URLs", () => {
    expect(normalizeUrl("https://example.com/base///")).toBe(
      "https://example.com/base"
    );
  });
});
