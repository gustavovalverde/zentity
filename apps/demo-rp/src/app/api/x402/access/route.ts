import { NextResponse } from "next/server";
import { z } from "zod";
import type { X402Resource } from "@/data/x402";
import { findResource } from "@/data/x402";
import { checkOnChainAttestation, getRegistryAddress } from "@/lib/chain";
import { settlePayment, verifyPayment } from "@/lib/facilitator";
import { getStoredDpopJkt } from "@/lib/poh-client";
import { verifyPohToken } from "@/lib/poh-verifier";
import { buildRouteConfig } from "@/lib/x402-server";

const bodySchema = z.object({
  resourceId: z.string().min(1),
  pohToken: z.string().optional(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

function toBase64(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function buildPaymentRequired(resource: X402Resource) {
  const routeConfig = buildRouteConfig(resource);

  const accepts = Array.isArray(routeConfig.accepts)
    ? routeConfig.accepts
    : [routeConfig.accepts];

  const body = {
    x402Version: 2,
    accepts,
    resource: { url: resource.endpoint },
    description: routeConfig.description,
    ...(routeConfig.extensions ? { extensions: routeConfig.extensions } : {}),
  };

  const response = NextResponse.json(body, { status: 402 });
  response.headers.set("PAYMENT-REQUIRED", toBase64(body));
  return response;
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
):
  | { ok: true; walletAddress: string }
  | { ok: false; response: NextResponse } {
  if (!verification.payer) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "payment_payer_unavailable",
          detail:
            "Payment verification did not return the payer address required for on-chain attestation.",
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
            "On-chain attestation must match the wallet that signed the payment.",
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

async function resolveOnChain(
  walletAddress: string | undefined
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const registry = getRegistryAddress();

  if (!registry) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "registry_not_configured",
          detail:
            "Set IDENTITY_REGISTRY_ADDRESS to the deployed IdentityRegistry contract.",
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
          detail: "On-chain attestation requires a wallet address.",
          contract: registry,
        },
        { status: 403 }
      ),
    };
  }

  const attested = await checkOnChainAttestation(walletAddress);

  if (attested === null) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "chain_unavailable",
          detail: "On-chain attestation check failed — chain unreachable.",
          address: walletAddress,
          contract: registry,
        },
        { status: 503 }
      ),
    };
  }

  if (!attested) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "not_attested_on_chain",
          address: walletAddress,
          contract: registry,
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    data: { status: "attested", address: walletAddress, contract: registry },
  };
}

function buildSuccess(
  resource: X402Resource,
  settlement?: {
    transaction?: string | undefined;
    network?: string | undefined;
  },
  poh?: {
    tier: number;
    verified: boolean;
    sybil_resistant: boolean;
    method: string | null;
  },
  onChain?: Record<string, unknown>
) {
  const body = {
    access: "granted",
    resource: resource.name,
    data: resource.responseData,
    ...(settlement ? { settlement } : {}),
    ...(poh ? { poh } : {}),
    ...(onChain ? { onChain } : {}),
  };

  const response = NextResponse.json(body);
  response.headers.set(
    "PAYMENT-RESPONSE",
    toBase64(settlement ?? { success: true })
  );
  return response;
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

  // Check for PAYMENT-SIGNATURE header (real x402 payment)
  const paymentSignature = request.headers.get("PAYMENT-SIGNATURE");

  // No payment → 402
  if (!paymentSignature) {
    return buildPaymentRequired(resource);
  }

  // Verify payment via the x402 facilitator
  const routeConfig = buildRouteConfig(resource);
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
    const settlement = await settlePayment(paymentSignature, paymentRequirements);
    if (!settlement.success) {
      return buildSettlementFailedResponse(settlement);
    }

    return buildSuccess(resource, {
      transaction: settlement.transaction,
      network: settlement.network,
    });
  }

  // Compliance-gated resources require BOTH payment AND a PoH token
  if (!body.pohToken) {
    return NextResponse.json(
      { error: "compliance_required", required: resource.requiredTier },
      { status: 403 }
    );
  }

  const verified = await verifyPohToken(body.pohToken).catch(
    (e: unknown) => e as Error
  );
  if (verified instanceof Error) {
    return NextResponse.json(
      { error: "invalid_poh_token", detail: verified.message },
      { status: 401 }
    );
  }

  if (verified.cnf?.jkt) {
    const storedJkt = await getStoredDpopJkt();
    if (!storedJkt || verified.cnf.jkt !== storedJkt) {
      return NextResponse.json(
        { error: "dpop_binding_mismatch" },
        { status: 401 }
      );
    }
  }

  if (verified.poh.tier < resource.requiredTier) {
    return NextResponse.json(
      {
        error: "insufficient_tier",
        required: resource.requiredTier,
        actual: verified.poh.tier,
      },
      { status: 403 }
    );
  }

  let onChain: Record<string, unknown> | undefined;
  if (resource.requireOnChain) {
    const verifiedWallet = resolveVerifiedOnChainWallet(
      verification,
      body.walletAddress
    );
    if (!verifiedWallet.ok) {
      return verifiedWallet.response;
    }

    const chain = await resolveOnChain(verifiedWallet.walletAddress);
    if (!chain.ok) {
      return chain.response;
    }
    onChain = chain.data;
  }

  const settlement = await settlePayment(paymentSignature, paymentRequirements);
  if (!settlement.success) {
    return buildSettlementFailedResponse(settlement);
  }

  return buildSuccess(
    resource,
    { transaction: settlement.transaction, network: settlement.network },
    verified.poh,
    onChain
  );
}
