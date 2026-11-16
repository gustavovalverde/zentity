import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import type { IdentityStrength } from "@zentity/sdk/protocol";
import { meetsIdentityStrength } from "@zentity/sdk/protocol";
import {
  assertApprovedRequirement,
  assertIdentityStrength,
  createInMemoryProofOfHumanReplayStore,
  createPaymentRequired,
  createProofOfHumanTokenVerifier,
  encodePaymentResponseHeader,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PROOF_OF_HUMAN_CHALLENGE,
  type ProofOfHumanClaims,
  ProofOfHumanPresentationError,
  parsePaymentSignatureHeader,
  recordProofOfHumanUse,
  type VerifiedProofOfHumanToken,
  verifyProofOfHumanPresentation,
} from "@zentity/sdk/rp";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { X402Resource } from "@/data/x402";
import { findResource } from "@/data/x402";
import { env } from "@/lib/env";
import { settleViaFacilitator, verifyViaFacilitator } from "@/lib/facilitator";
import {
  getMirrorAddress,
  readOnChainCompliance,
} from "@/lib/on-chain-compliance";
import {
  acquirePohToken,
  getProofOfHumanBinding,
  isPohError,
} from "@/lib/poh-client";
import { buildRouteConfig, type X402RouteConfig } from "@/lib/x402-server";

/**
 * The demo merchant. Agents fetch a resource with GET and present a
 * merchant-mode Proof-of-Human token with DPoP. The browser demo posts and
 * this route obtains a client-mode token for the signed-in user server side,
 * so the token never reaches the browser.
 */

const bodySchema = z.object({
  resourceId: z.string().min(1),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

const TRAILING_SLASHES = /\/+$/;

// PoH and DPoP proof `jti` values this instance has seen. One instance only;
// a deployment with several needs a shared store.
const replayStore = createInMemoryProofOfHumanReplayStore();

// The identity registry mirror on Base compares a uint8 level; the wire
// carries only the strength name.
const MIRROR_LEVELS: Record<IdentityStrength, number> = {
  documentary: 1,
  documentary_full: 2,
  cryptographic_chip: 3,
};

function zentityIssuer(): string {
  return env.NEXT_PUBLIC_ZENTITY_URL.replace(TRAILING_SLASHES, "");
}

function zentityJwksUrl(): URL {
  return new URL("/api/auth/oauth2/jwks", env.ZENTITY_URL);
}

function buildPaymentRequired(
  resourceUrl: string,
  routeConfig: X402RouteConfig
) {
  return createPaymentRequired({
    accepts: routeConfig.accepts,
    resource: { url: resourceUrl },
    ...(routeConfig.description
      ? { description: routeConfig.description }
      : {}),
    ...(routeConfig.extensions
      ? {
          extensions: routeConfig.extensions,
          wwwAuthenticate: PROOF_OF_HUMAN_CHALLENGE,
        }
      : {}),
  });
}

function paymentInvalid(detail: string) {
  return NextResponse.json(
    { error: "payment_invalid", detail },
    { status: 402 }
  );
}

function buildSettlementFailedResponse(settlement: {
  errorReason?: string;
  success: boolean;
}) {
  return NextResponse.json(
    {
      error: "settlement_failed",
      detail: settlement.errorReason ?? "Payment settlement failed",
    },
    { status: 402 }
  );
}

function presentationRefusal(error: ProofOfHumanPresentationError) {
  return NextResponse.json(
    { error: error.code, error_description: error.message },
    {
      status: error.status,
      ...(error.wwwAuthenticate
        ? { headers: { "WWW-Authenticate": error.wwwAuthenticate } }
        : {}),
    }
  );
}

function buildSuccess(
  resource: X402Resource,
  settlement: SettleResponse,
  poh?: VerifiedProofOfHumanToken["poh"],
  onChain?: Record<string, unknown>
) {
  const response = NextResponse.json({
    access: "granted",
    resource: resource.name,
    data: resource.responseData,
    settlement,
    ...(poh ? { poh } : {}),
    ...(onChain ? { onChain } : {}),
  });
  response.headers.set(
    PAYMENT_RESPONSE_HEADER,
    encodePaymentResponseHeader(settlement)
  );
  return response;
}

function readPayment(
  paymentSignature: string
): { ok: true; payload: PaymentPayload } | { ok: false; response: Response } {
  try {
    return { ok: true, payload: parsePaymentSignatureHeader(paymentSignature) };
  } catch (error) {
    return {
      ok: false,
      response: paymentInvalid(
        error instanceof Error ? error.message : "Malformed payment payload"
      ),
    };
  }
}

async function settle(
  resource: X402Resource,
  paymentPayload: PaymentPayload,
  routeConfig: X402RouteConfig,
  poh?: VerifiedProofOfHumanToken["poh"],
  onChain?: Record<string, unknown>
): Promise<Response> {
  const settlement = await settleViaFacilitator(
    paymentPayload,
    routeConfig.accepts
  );
  return settlement.success
    ? buildSuccess(resource, settlement, poh, onChain)
    : buildSettlementFailedResponse(settlement);
}

// ─── Agents: merchant-mode Proof-of-Human (GET) ─────────────────────

/**
 * The merchant's checks, in order: the PoH token and the DPoP proof (the
 * proof `jti` recorded), the identity strength, the approved terms against
 * this route and the payment, the facilitator's verification, the PoH `jti`
 * recorded, and settlement. A refused payment leaves the token unspent.
 */
export async function GET(request: Request) {
  const resourceUrl = request.url;
  const resource = findResource(
    new URL(resourceUrl).searchParams.get("resourceId") ?? ""
  );
  if (!resource) {
    return NextResponse.json({ error: "unknown_resource" }, { status: 404 });
  }
  const routeConfig = buildRouteConfig(resource);
  const minimum = resource.requiredIdentityStrength;

  if (
    minimum &&
    resource.requireOnChain &&
    request.headers.has("authorization")
  ) {
    return presentationRefusal(
      new ProofOfHumanPresentationError(
        "invalid_token",
        "This resource checks identity on-chain and accepts no agent token"
      )
    );
  }

  const paymentSignature = request.headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!paymentSignature) {
    return buildPaymentRequired(resourceUrl, routeConfig);
  }

  let claims: VerifiedProofOfHumanToken | undefined;
  const payment = readPayment(paymentSignature);
  try {
    if (minimum) {
      claims = await verifyProofOfHumanPresentation({
        audience: new URL(resourceUrl).origin,
        issuer: zentityIssuer(),
        jwks: zentityJwksUrl(),
        replayStore,
        request,
      });
      assertIdentityStrength(claims, minimum);
    }
    if (!payment.ok) {
      return payment.response;
    }
    if (claims) {
      assertApprovedRequirement(
        claims,
        routeConfig.accepts,
        payment.payload,
        resourceUrl
      );
    }
  } catch (error) {
    if (error instanceof ProofOfHumanPresentationError) {
      return presentationRefusal(error);
    }
    throw error;
  }

  const verification = await verifyViaFacilitator(
    payment.payload,
    routeConfig.accepts
  );
  if (!verification.isValid) {
    return paymentInvalid(
      verification.invalidReason ?? "Payment verification failed"
    );
  }

  if (claims) {
    try {
      await recordProofOfHumanUse(claims, replayStore);
    } catch (error) {
      if (error instanceof ProofOfHumanPresentationError) {
        return presentationRefusal(error);
      }
      throw error;
    }
  }

  return settle(resource, payment.payload, routeConfig, claims?.poh);
}

// ─── The browser demo: client-mode Proof-of-Human (POST) ────────────

function refusal(error: string, status: number, extra = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * Obtains a client-mode PoH token for the signed-in user from Zentity and
 * checks that it is for this client, this user, and this deployment's
 * sign-in key, and that it states the resource's identity strength.
 */
async function checkClientProofOfHuman(
  minimum: IdentityStrength
): Promise<
  { ok: true; poh: ProofOfHumanClaims } | { ok: false; response: Response }
> {
  const binding = await getProofOfHumanBinding();
  if (!binding) {
    return {
      ok: false,
      response: refusal("compliance_required", 403, { required: minimum }),
    };
  }
  const acquired = await acquirePohToken();
  if (isPohError(acquired)) {
    return {
      ok: false,
      response: refusal(acquired.error, acquired.status, {
        ...(acquired.error_description
          ? { error_description: acquired.error_description }
          : {}),
      }),
    };
  }

  let verified: VerifiedProofOfHumanToken;
  try {
    verified = await createProofOfHumanTokenVerifier({
      audience: binding.clientId,
      issuer: zentityIssuer(),
      jwksUrl: zentityJwksUrl(),
    }).verify(acquired.token);
  } catch (error) {
    return {
      ok: false,
      response: refusal("invalid_poh_token", 401, {
        detail: error instanceof Error ? error.message : "Invalid PoH token",
      }),
    };
  }
  if (verified.cnf.jkt !== binding.jkt) {
    return { ok: false, response: refusal("dpop_binding_mismatch", 401) };
  }
  if (verified.sub !== binding.subject) {
    return { ok: false, response: refusal("poh_subject_mismatch", 401) };
  }
  const poh = verified.poh;
  if (
    !(
      "humanity" in poh && meetsIdentityStrength(poh.identity.strength, minimum)
    )
  ) {
    return {
      ok: false,
      response: refusal("insufficient_identity_strength", 403, {
        required: minimum,
      }),
    };
  }
  return { ok: true, poh };
}

function resolveVerifiedOnChainWallet(
  verification: { payer?: string | undefined },
  requestedWalletAddress: string | undefined
): { ok: true; walletAddress: string } | { ok: false; response: Response } {
  if (!verification.payer) {
    return {
      ok: false,
      response: refusal("payment_payer_unavailable", 502, {
        detail:
          "Payment verification did not return the payer address required for on-chain compliance.",
      }),
    };
  }
  if (
    requestedWalletAddress &&
    verification.payer.toLowerCase() !== requestedWalletAddress.toLowerCase()
  ) {
    return {
      ok: false,
      response: refusal("wallet_address_mismatch", 403, {
        detail:
          "On-chain compliance must match the wallet that signed the payment.",
        payer: verification.payer,
      }),
    };
  }
  return { ok: true, walletAddress: verification.payer };
}

async function validateOnChainCompliance(
  walletAddress: string,
  minimum: IdentityStrength
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const mirrorAddress = getMirrorAddress();
  if (!mirrorAddress) {
    return {
      ok: false,
      response: refusal("identity_registry_mirror_not_configured", 503, {
        detail:
          "Set BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR to the deployed IdentityRegistryMirror contract.",
      }),
    };
  }
  const compliance = await readOnChainCompliance(
    walletAddress,
    MIRROR_LEVELS[minimum]
  );
  if (compliance === null) {
    return {
      ok: false,
      response: refusal("chain_unavailable", 503, {
        detail: "On-chain compliance check failed, the chain is unreachable.",
        address: walletAddress,
        contract: mirrorAddress,
      }),
    };
  }
  if (!compliance.compliant) {
    return {
      ok: false,
      response: refusal("not_compliant_on_chain", 403, {
        address: walletAddress,
        required: minimum,
        contract: mirrorAddress,
      }),
    };
  }
  return { ok: true, data: { status: "compliant", ...compliance } };
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(
    await request
      .clone()
      .json()
      .catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = parsed.data;
  const resource = findResource(body.resourceId);
  if (!resource) {
    return NextResponse.json({ error: "unknown_resource" }, { status: 404 });
  }
  const routeConfig = buildRouteConfig(resource);
  const resourceUrl = new URL(
    `/api/x402/access?resourceId=${encodeURIComponent(resource.id)}`,
    request.url
  ).toString();

  const paymentSignature = request.headers.get(PAYMENT_SIGNATURE_HEADER);
  if (!paymentSignature) {
    return buildPaymentRequired(resourceUrl, routeConfig);
  }
  const payment = readPayment(paymentSignature);
  if (!payment.ok) {
    return payment.response;
  }

  const minimum = resource.requiredIdentityStrength;
  let poh: ProofOfHumanClaims | undefined;
  if (minimum) {
    const checked = await checkClientProofOfHuman(minimum);
    if (!checked.ok) {
      return checked.response;
    }
    poh = checked.poh;
  }

  const verification = await verifyViaFacilitator(
    payment.payload,
    routeConfig.accepts
  );
  if (!verification.isValid) {
    return paymentInvalid(
      verification.invalidReason ?? "Payment verification failed"
    );
  }

  let onChain: Record<string, unknown> | undefined;
  if (minimum && resource.requireOnChain) {
    const wallet = resolveVerifiedOnChainWallet(
      verification,
      body.walletAddress
    );
    if (!wallet.ok) {
      return wallet.response;
    }
    const chain = await validateOnChainCompliance(
      wallet.walletAddress,
      minimum
    );
    if (!chain.ok) {
      return chain.response;
    }
    onChain = chain.data;
  }

  return settle(resource, payment.payload, routeConfig, poh, onChain);
}
