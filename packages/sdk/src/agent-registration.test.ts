import { exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import type { DpopClient } from "./rp/dpop-client.js";
import {
  AgentRegistrationError,
  buildHostKeyNamespace,
  registerAgentSession,
  registerHost,
  signAgentAssertion,
  type HostKeyMaterial,
} from "./agent-registration.js";

function createDpopClient(): Pick<DpopClient, "proofFor" | "withNonceRetry"> {
  return {
    proofFor: vi.fn(async (_method, _url, _accessToken, nonce) =>
      nonce ? `dpop-${nonce}` : "dpop-initial"
    ),
    withNonceRetry: vi.fn(async (attempt) => {
      const initial = await attempt();
      if (
        initial.response.status !== 400 &&
        initial.response.status !== 401
      ) {
        return initial;
      }

      const nonce = initial.response.headers.get("DPoP-Nonce");
      return nonce ? attempt(nonce) : initial;
    }),
  };
}

async function createHostKey(): Promise<HostKeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  return {
    privateKey: await exportJWK(privateKey),
    publicKey: await exportJWK(publicKey),
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("agent registration", () => {
  it("builds host key namespaces from client and account subjects", () => {
    expect(
      buildHostKeyNamespace({ clientId: "client-1", accountSub: "user-1" })
    ).toBe("client-1:user-1");
    expect(buildHostKeyNamespace({ clientId: "client-1" })).toBe("client-1");
  });

  it("registers hosts with DPoP nonce retry and client attestation headers", async () => {
    const dpopClient = createDpopClient();
    const hostKey = await createHostKey();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
          status: 401,
          headers: { "DPoP-Nonce": "nonce-1" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hostId: "host-123",
            did: "did:key:zHost",
            created: true,
            attestation_tier: "self-declared",
          }),
          { status: 201 }
        )
      );

    const host = await registerHost({
      accessToken: "bootstrap-token",
      clientAttestationJwt: "client-attestation",
      clientAttestationPopJwt: "client-attestation-pop",
      dpopClient,
      endpoint: "https://issuer.example/api/auth/agent/host/register",
      fetch: fetchFn,
      hostKey,
      hostName: "Test Host",
    });

    expect(host).toEqual({
      hostId: "host-123",
      did: "did:key:zHost",
      created: true,
      attestationTier: "self-declared",
    });
    expect(dpopClient.proofFor).toHaveBeenLastCalledWith(
      "POST",
      "https://issuer.example/api/auth/agent/host/register",
      "bootstrap-token",
      "nonce-1"
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const retryInit = fetchFn.mock.calls[1]?.[1] as RequestInit;
    expect(retryInit.headers).toMatchObject({
      Authorization: "DPoP bootstrap-token",
      DPoP: "dpop-nonce-1",
      "OAuth-Client-Attestation": "client-attestation",
      "OAuth-Client-Attestation-PoP": "client-attestation-pop",
    });
    expect(JSON.parse(String(retryInit.body))).toMatchObject({
      name: "Test Host",
      did: expect.stringMatching(/^did:key:z/),
    });
  });

  it("throws AgentRegistrationError when host registration fails", async () => {
    await expect(
      registerHost({
        accessToken: "bootstrap-token",
        dpopClient: createDpopClient(),
        endpoint: "https://issuer.example/register",
        fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(
          new Response("Missing required scope", { status: 403 })
        ),
        hostKey: await createHostKey(),
        hostName: "Test Host",
      })
    ).rejects.toMatchObject({
      name: "AgentRegistrationError",
      status: 403,
      responseBody: "Missing required scope",
    } satisfies Partial<AgentRegistrationError>);
  });

  it("registers sessions with a host attestation JWT and ephemeral did:key", async () => {
    const dpopClient = createDpopClient();
    const hostKey = await createHostKey();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          did: "did:key:zSession",
          sessionId: "session-123",
          status: "active",
          grants: [{ capability: "purchase", status: "active" }],
        }),
        { status: 201 }
      )
    );

    const session = await registerAgentSession({
      accessToken: "bootstrap-token",
      display: { name: "Claude Code", runtime: "node", version: "1.0.0" },
      dpopClient,
      endpoint: "https://issuer.example/api/auth/agent/register",
      fetch: fetchFn,
      hostId: "host-123",
      hostKey,
      requestedCapabilities: ["purchase", "my_profile"],
    });

    const requestBody = JSON.parse(
      String((fetchFn.mock.calls[0]?.[1] as RequestInit).body)
    ) as Record<string, unknown>;
    const hostPublicKey = await importJWK(hostKey.publicKey, "EdDSA");
    const { payload: hostAttestationClaims } = await jwtVerify(
      String(requestBody.hostJwt),
      hostPublicKey,
      {
        issuer: "host-123",
        subject: "agent-registration",
        typ: "host-attestation+jwt",
      }
    );

    expect(hostAttestationClaims.iss).toBe("host-123");
    expect(requestBody).toMatchObject({
      did: expect.stringMatching(/^did:key:z/),
      requestedCapabilities: ["purchase", "my_profile"],
      display: { name: "Claude Code", runtime: "node", version: "1.0.0" },
    });
    expect(session).toMatchObject({
      display: { name: "Claude Code", runtime: "node", version: "1.0.0" },
      grants: [{ capability: "purchase", status: "active" }],
      hostId: "host-123",
      sessionDid: "did:key:zSession",
      sessionId: "session-123",
      status: "active",
    });
    expect(session.sessionPrivateKey.kty).toBe("OKP");
    expect(session.sessionPublicKey.kty).toBe("OKP");
  });

  it("signs agent assertions with stable task metadata", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const assertion = await signAgentAssertion({
      bindingMessage: "Authorize purchase",
      hostId: "host-123",
      jti: "jti-123",
      sessionId: "session-123",
      sessionPrivateKey: await exportJWK(privateKey),
      taskId: "task-123",
    });

    const { payload: agentAssertionClaims, protectedHeader } = await jwtVerify(
      assertion,
      publicKey,
      {
        issuer: "session-123",
        typ: "agent-assertion+jwt",
      }
    );

    expect(protectedHeader.alg).toBe("EdDSA");
    expect(agentAssertionClaims).toMatchObject({
      host_id: "host-123",
      jti: "jti-123",
      task_hash: await sha256Hex("Authorize purchase"),
      task_id: "task-123",
    });
  });
});
