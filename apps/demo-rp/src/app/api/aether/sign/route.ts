import { requestCibaApproval } from "@zentity/sdk";
import {
  intentHash,
  intentHashToWireString,
  networkToChainReference,
  PAYMENT_AUTHORIZATION_CAPABILITY,
  type PaymentAuthorization,
  paymentUriToCaip10,
  SignedPayloadSchema,
} from "@zentity/sdk/protocol";
import { createWalletSpendRequest } from "@zentity/sdk/rp";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prepareAgentAssertionForScenario } from "@/lib/agent-runtime";
import { getAuth } from "@/lib/auth";
import { readDcrClient } from "@/lib/dcr";
import { env } from "@/lib/env";
import { parseProblemFromBody, type ServiceProblem } from "@/lib/problem-json";
import { settlePayment, ZpayError } from "@/lib/zpay-client";
import { getZpayDpopClient } from "@/lib/zpay-dpop";

/**
 * POST /api/aether/sign — the BFF orchestrator for an agent-initiated spend
 * (PRD-43 Phase 3).
 *
 * Drives the full trust boundary: rebuild the canonical payment_authorization
 * RAR from the prepared payment, obtain a DPoP-bound `at+jwt` carrying it via
 * CIBA (zentity mints the RAR, pins `aud` to the wallet, caps the lifetime at
 * 120s), present it to the wallet `/v1/payments/sign`, and forward the signed
 * bytes to zpay `/settle`.
 *
 * One seed-derived DPoP key binds the chain: it signs the CIBA token request
 * (so the issuer pins the token's `cnf.jkt` to it), the wallet call, and
 * `/settle`. The RAR is rebuilt server-side from the prepared tuple, never
 * trusted from the client; the wallet re-checks the intent hash regardless.
 *
 * Errors: the wallet's and facilitator's RFC-7807 `kind`/`remediation`/
 * `Retry-After` pass through verbatim (D-H). BFF-only failures use BFF tags
 * (`session_required`, `invalid_request`, `approval_failed`).
 */

const requestSchema = z.object({
  payment_uri: z.string().min(1),
  payment_id: z.string().min(1),
  network: z.enum(["mainnet", "testnet", "regtest"]),
  target_expiry_height: z.number().int().nonnegative(),
  amount_zat: z.number().int().nonnegative(),
  merchant: z.string().min(1).optional(),
});

const AETHER_SCENARIO = "aether" as const;

function problemResponse(
  problem: ServiceProblem,
  status: number
): NextResponse {
  const body: Record<string, unknown> = {
    error: problem.kind,
    error_description: problem.detail ?? problem.title,
  };
  if (problem.remediation) {
    body.remediation = problem.remediation;
  }
  const init: ResponseInit = { status };
  if (problem.retryAfterSeconds !== undefined) {
    init.headers = { "Retry-After": String(problem.retryAfterSeconds) };
  }
  return NextResponse.json(body, init);
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", error_description: parsed.error.message },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  const email = session?.user?.email;
  if (!(session?.user?.id && email)) {
    return NextResponse.json(
      {
        error: "session_required",
        error_description:
          "Sign in before signing a payment; the agent grant is bound to your identity.",
      },
      { status: 401 }
    );
  }

  // Rebuild the canonical RAR from the prepared tuple (server-trusted).
  const reference = networkToChainReference(input.network);
  const recipient = paymentUriToCaip10(input.payment_uri, reference);
  const intentWire = intentHashToWireString(
    intentHash({
      chainNamespace: "zcash",
      chainReference: reference,
      recipientCaip10: recipient,
      amountValue: BigInt(input.amount_zat),
      amountUnit: "base",
      paymentId: input.payment_id,
      expiryHeight: BigInt(input.target_expiry_height),
    })
  );
  const rar: PaymentAuthorization = {
    type: "payment_authorization",
    chain: { namespace: "zcash", reference },
    recipient,
    amount: { currency: "ZEC", value: String(input.amount_zat), unit: "base" },
    payment_id: input.payment_id,
    intent_hash: intentWire,
    expires_at: { kind: "block_height", value: input.target_expiry_height },
  };

  const bindingMessage = `Authorize payment of ${input.amount_zat} zatoshi${
    input.merchant ? ` to ${input.merchant}` : ""
  }`;

  // Obtain the RAR-bearing token via CIBA. The seed DPoP key authenticates the
  // token request, so the issuer pins cnf.jkt to it (and to the wallet call).
  let accessToken: string;
  try {
    const [client, agentAssertion, dpopClient] = await Promise.all([
      readDcrClient(AETHER_SCENARIO),
      prepareAgentAssertionForScenario({
        bindingMessage,
        scenarioId: AETHER_SCENARIO,
        userId: session.user.id,
      }),
      getZpayDpopClient(),
    ]);
    if (!client) {
      throw new Error("Aether OAuth client is not registered");
    }
    const tokenSet = await requestCibaApproval({
      bindingMessage,
      cibaEndpoint: `${env.ZENTITY_URL}/api/auth/oauth2/bc-authorize`,
      tokenEndpoint: `${env.ZENTITY_URL}/api/auth/oauth2/token`,
      clientId: client.clientId,
      dpopSigner: dpopClient,
      loginHint: email,
      scope: `openid ${PAYMENT_AUTHORIZATION_CAPABILITY}`,
      authorizationDetails: [rar],
      // No `resource`: the issuer authoritatively pins aud=wallet thumbprint
      // for the payment grant regardless of what the client requests (D-5).
      ...(agentAssertion ? { agentAssertion } : {}),
    });
    accessToken = tokenSet.accessToken;
  } catch (err) {
    return NextResponse.json(
      {
        error: "approval_failed",
        error_description:
          err instanceof Error ? err.message : "CIBA approval failed",
      },
      { status: 502 }
    );
  }

  return presentToWalletAndSettle(accessToken, input);
}

/**
 * Present the token to the wallet `/sign`, then settle the signed bytes on
 * zpay. The wallet's and facilitator's RFC-7807 problems pass through verbatim
 * (D-H); BFF-only failures use BFF tags.
 */
async function presentToWalletAndSettle(
  accessToken: string,
  input: z.infer<typeof requestSchema>
): Promise<NextResponse> {
  const dpopClient = await getZpayDpopClient();
  const walletEndpoint = `${env.ZSPEND_URL}/v1/payments/sign`;
  const spend = await createWalletSpendRequest({
    accessToken,
    dpopClient,
    walletEndpoint,
    paymentRequest: { scheme: "zip321", value: input.payment_uri },
    paymentId: input.payment_id,
    targetExpiryHeight: input.target_expiry_height,
    network: input.network,
  });
  const signRes = await fetch(walletEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...spend.headers },
    body: JSON.stringify(spend.body),
  }).catch(() => null);
  if (!signRes) {
    return NextResponse.json(
      {
        error: "wallet_unreachable",
        error_description: "wallet did not respond",
      },
      { status: 502 }
    );
  }
  if (!signRes.ok) {
    // Read the body once: parseProblemFromBody handles the problem+json case and
    // the same string is the fallback detail when it is not problem+json.
    const raw = await signRes.text().catch(() => "");
    const problem = parseProblemFromBody(
      signRes.headers,
      raw,
      "wallet sign failed"
    );
    return problem
      ? problemResponse(problem, signRes.status)
      : NextResponse.json(
          { error: "wallet_sign_failed", error_description: raw.slice(0, 300) },
          { status: signRes.status }
        );
  }

  const body = (await signRes.json()) as { signed_payload?: unknown };
  const signedPayload = SignedPayloadSchema.parse(body.signed_payload);
  const rawTxHex = Buffer.from(signedPayload.bytes, "base64").toString("hex");

  try {
    const settleUrl = `${env.ZPAY_URL}/x402/v2/settle`;
    const settlement = await settlePayment({
      dpopProof: await dpopClient.proofFor("POST", settleUrl),
      paymentId: input.payment_id,
      rawTxHex,
    });
    return NextResponse.json({
      payment_id: settlement.payment_id,
      transaction_id: settlement.broadcast_outcome.transaction_id ?? null,
      broadcast_kind: settlement.broadcast_outcome.kind,
      signed_payload: {
        format: signedPayload.format,
        tx_id: signedPayload.tx_id,
        fee: signedPayload.fee,
        expires_at: signedPayload.expires_at,
      },
    });
  } catch (err) {
    if (err instanceof ZpayError && err.problem) {
      return problemResponse(err.problem, err.status || 502);
    }
    return NextResponse.json(
      {
        error: "settle_failed",
        error_description: err instanceof Error ? err.message : "settle failed",
      },
      { status: 502 }
    );
  }
}
