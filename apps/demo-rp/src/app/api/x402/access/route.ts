import {
  asObjectRecord,
  createPaymentRequired,
  createProofOfHumanTokenVerifier,
  encodePaymentResponseHeader,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type ProofOfHumanClaims,
  parsePaymentSignatureHeader,
  type VerifiedProofOfHumanToken,
} from "@zentity/sdk/rp";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { X402Resource } from "@/data/x402";
import { findResource } from "@/data/x402";
import { env } from "@/lib/env";
import { settlePayment, verifyPayment } from "@/lib/facilitator";
import {
  getMirrorAddress,
  readOnChainCompliance,
} from "@/lib/on-chain-compliance";
import { getStoredDpopJkt } from "@/lib/poh-client";
import { buildRouteConfig, type X402RouteConfig } from "@/lib/x402-server";

const bodySchema = z.object({
  resourceId: z.string().min(1),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

type SettlementResult = Awaited<ReturnType<typeof settlePayment>>;

let proofOfHumanTokenVerifier:
  | ReturnType<typeof createProofOfHumanTokenVerifier>
  | undefined;

function getProofOfHumanTokenVerifier() {
  proofOfHumanTokenVerifier ??= createProofOfHumanTokenVerifier({
    issuer: env.NEXT_PUBLIC_ZENTITY_URL,
    jwksUrl: new URL("/api/auth/oauth2/jwks", env.ZENTITY_URL),
  });
  return proofOfHumanTokenVerifier;
}

function buildPaymentRequired(
  resource: X402Resource,
  routeConfig: X402RouteConfig
) {
  return createPaymentRequired({
    accepts: Array.isArray(routeConfig.accepts)
      ? routeConfig.accepts
      : [routeConfig.accepts],
    resource: { url: resource.endpoint },
    ...(routeConfig.description
      ? { description: routeConfig.description }
      : {}),
    ...(routeConfig.extensions ? { extensions: routeConfig.extensions } : {}),
  });
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

function resolveVerifiedOnChainWallet(
  verification: { payer?: string | undefined },
  requestedWalletAddress: string | undefined
): { ok: true; walletAddress: string } | { ok: false; response: NextResponse } {
  if (!verification.payer) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "payment_payer_unavailable",
          detail:
            "Payment verification did not return the payer address required for on-chain compliance.",
        },
        { status: 502 }
      ),
    };
  }

  if (
    requestedWalletAddress &&
    verification.payer.toLowerCase() !== requestedWalletAddress.toLowerCase()
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "wallet_address_mismatch",
          detail:
            "On-chain compliance must match the wallet that signed the payment.",
          payer: verification.payer,
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    walletAddress: verification.payer,
  };
}

async function validateOnChainCompliance(
  walletAddress: string | undefined,
  minComplianceLevel: number
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const mirrorAddress = getMirrorAddress();

  if (!mirrorAddress) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "identity_registry_mirror_not_configured",
          detail:
            "Set BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR to the deployed IdentityRegistryMirror contract.",
        },
        { status: 503 }
      ),
    };
  }

  if (!walletAddress) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "wallet_address_required",
          detail: "On-chain compliance requires a wallet address.",
          contract: mirrorAddress,
        },
        { status: 403 }
      ),
    };
  }

  const compliance = await readOnChainCompliance(
    walletAddress,
    minComplianceLevel
  );

  if (compliance === null) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "chain_unavailable",
          detail: "On-chain compliance check failed — chain unreachable.",
          address: walletAddress,
          contract: mirrorAddress,
        },
        { status: 503 }
      ),
    };
  }

  if (!compliance.compliant) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "not_compliant_on_chain",
          address: walletAddress,
          minComplianceLevel,
          contract: mirrorAddress,
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    data: { status: "compliant", ...compliance },
  };
}

function getProofOfHumanTokenFromPayment(
  paymentSignature: string
): string | undefined {
  try {
    const paymentPayload = parsePaymentSignatureHeader(paymentSignature);
    const extension = asObjectRecord(paymentPayload.extensions?.zentity);
    const pohToken = extension?.pohToken;
    return typeof pohToken === "string" ? pohToken : undefined;
  } catch {
    return undefined;
  }
}

function buildSuccess(
  resource: X402Resource,
  settlement: SettlementResult,
  poh?: ProofOfHumanClaims,
  onChain?: Record<string, unknown>
) {
  const body = {
    access: "granted",
    resource: resource.name,
    data: resource.responseData,
    settlement,
    ...(poh ? { poh } : {}),
    ...(onChain ? { onChain } : {}),
  };

  const response = NextResponse.json(body);
  response.headers.set(
    PAYMENT_RESPONSE_HEADER,
    encodePaymentResponseHeader(settlement)
  );
  return response;
}

async function validatePohToken(
  pohToken: string | undefined,
  resource: X402Resource
): Promise<
  | { ok: true; verified: VerifiedProofOfHumanToken }
  | { ok: false; response: NextResponse }
> {
  if (!pohToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "compliance_required", required: resource.requiredTier },
        { status: 403 }
      ),
    };
  }

  let verified: VerifiedProofOfHumanToken;
  try {
    verified = await getProofOfHumanTokenVerifier().verify(pohToken);
  } catch (error) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "invalid_poh_token",
          detail: error instanceof Error ? error.message : "Invalid PoH token",
        },
        { status: 401 }
      ),
    };
  }

  if (verified.cnf?.jkt) {
    const storedJkt = await getStoredDpopJkt();
    if (!storedJkt || verified.cnf.jkt !== storedJkt) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "dpop_binding_mismatch" },
          { status: 401 }
        ),
      };
    }
  }

  if (verified.poh.tier < resource.requiredTier) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "insufficient_tier",
          required: resource.requiredTier,
          actual: verified.poh.tier,
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, verified };
}

export async function POST(request: Request) {
  const clonedRequest = request.clone();
  const parsed = bodySchema.safeParse(
    await clonedRequest.json().catch(() => null)
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

  const paymentSignature = request.headers.get(PAYMENT_SIGNATURE_HEADER);

  // No payment → 402
  if (!paymentSignature) {
    return buildPaymentRequired(resource, routeConfig);
  }

  // Verify payment via the x402 facilitator
  const paymentRequirements = Array.isArray(routeConfig.accepts)
    ? routeConfig.accepts[0]
    : routeConfig.accepts;

  const verification = await verifyPayment(
    paymentSignature,
    paymentRequirements
  );
  if (!verification.isValid) {
    return NextResponse.json(
      {
        error: "payment_invalid",
        detail: verification.invalidReason ?? "Payment verification failed",
      },
      { status: 402 }
    );
  }

  // Payment-only resources: payment is sufficient
  if (resource.requiredTier === 0) {
    const settlement = await settlePayment(
      paymentSignature,
      paymentRequirements
    );
    if (!settlement.success) {
      return buildSettlementFailedResponse(settlement);
    }

    return buildSuccess(resource, settlement);
  }

  const pohToken = getProofOfHumanTokenFromPayment(paymentSignature);
  const pohResult = await validatePohToken(pohToken, resource);
  if (!pohResult.ok) {
    return pohResult.response;
  }
  const verified = pohResult.verified;

  let onChain: Record<string, unknown> | undefined;
  if (resource.requireOnChain) {
    const verifiedWallet = resolveVerifiedOnChainWallet(
      verification,
      body.walletAddress
    );
    if (!verifiedWallet.ok) {
      return verifiedWallet.response;
    }

    const chain = await validateOnChainCompliance(
      verifiedWallet.walletAddress,
      resource.requiredTier
    );
    if (!chain.ok) {
      return chain.response;
    }
    onChain = chain.data;
  }

  const settlement = await settlePayment(paymentSignature, paymentRequirements);
  if (!settlement.success) {
    return buildSettlementFailedResponse(settlement);
  }

  return buildSuccess(resource, settlement, verified.poh, onChain);
}
