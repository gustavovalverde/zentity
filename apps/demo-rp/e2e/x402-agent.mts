import { createServer, type Server } from "node:http";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createAgent } from "@zentity/sdk";
import {
  createDpopClient,
  encodePaymentSignatureHeader,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentRequiredPayload,
  parsePaymentRequiredHeader,
} from "@zentity/sdk/rp";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The x402 agent journey's fixtures: the only payer in this stack. The test
 * signer signs EIP-3009 authorizations for Base Sepolia USDC, and the mock
 * facilitator answers verify and settle, so no chain is involved.
 */

// A well-known test key; it holds no funds anywhere.
const TEST_SIGNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const issuerBaseURL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3100";
const demoRpDbPath = join(import.meta.dirname, "..", ".data", "e2e.db");

export function testSchemeClient(): ExactEvmScheme {
  return new ExactEvmScheme(TEST_SIGNER);
}

/** Facilitator requests the mock received, for checks on what it saw. */
export interface MockFacilitator {
  close(): Promise<void>;
  requests: { body: unknown; path: string }[];
}

export async function startMockFacilitator(
  url = process.env.X402_FACILITATOR_URL ?? "http://127.0.0.1:3199"
): Promise<MockFacilitator> {
  const requests: MockFacilitator["requests"] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    requests.push({ path: req.url ?? "", body });
    res.setHeader("Content-Type", "application/json");
    const network = body.paymentRequirements?.network ?? "eip155:84532";
    res.end(
      JSON.stringify(
        req.url === "/verify"
          ? { isValid: true, payer: TEST_SIGNER.address }
          : {
              success: true,
              payer: TEST_SIGNER.address,
              transaction: `0x${"ab".repeat(32)}`,
              network,
            }
      )
    );
  });
  const { hostname, port } = new URL(url);
  await new Promise<void>((resolve) =>
    server.listen(Number(port), hostname, resolve)
  );
  return {
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** The x402 scenario client and the user's subject at it, from demo-rp's database. */
export async function readX402Client(): Promise<{
  clientId: string;
  loginHint: string;
}> {
  const db = createClient({ url: `file:${demoRpDbPath}` });
  try {
    const client = await db.execute(
      "SELECT clientId FROM dcr_client WHERE scenarioId = 'x402'"
    );
    const account = await db.execute(
      "SELECT accountId FROM account WHERE providerId = 'zentity-x402' ORDER BY createdAt DESC LIMIT 1"
    );
    const clientId = client.rows[0]?.clientId;
    const loginHint = account.rows[0]?.accountId;
    if (typeof clientId !== "string" || typeof loginHint !== "string") {
      throw new Error("Sign in to the x402 scenario before running the agent");
    }
    return { clientId, loginHint };
  } finally {
    db.close();
  }
}

/**
 * An agent for the signed-in user: it fetches `url` and answers the 402 with
 * a Proof-of-Human approval the user gives on Zentity's page.
 */
export async function runX402Agent(input: {
  onPendingApproval: (authReqId: string) => Promise<void>;
  url: string;
}): Promise<Response> {
  const { clientId, loginHint } = await readX402Client();
  const agent = createAgent({
    clientId,
    dpopClient: await createDpopClient(),
    issuerUrl: `${issuerBaseURL}/api/auth`,
    loginHint,
    onPendingApproval: (pending) => input.onPendingApproval(pending.authReqId),
    x402SchemeClient: testSchemeClient(),
  });
  return agent.fetch(input.url, {
    x402: { maxAmount: "0.01", maxIdentityStrength: "cryptographic_chip" },
  });
}

/**
 * The PAYMENT-SIGNATURE a browser wallet would make for a demo-rp 402, signed
 * by the test signer.
 */
export async function signTestPayment(paymentRequiredHeader: string) {
  const paymentRequired: PaymentRequiredPayload = parsePaymentRequiredHeader(
    paymentRequiredHeader
  );
  const payload = await new x402Client()
    .register("eip155:84532", testSchemeClient())
    .createPaymentPayload(paymentRequired);
  return {
    [PAYMENT_SIGNATURE_HEADER]: encodePaymentSignatureHeader(
      payload as Parameters<typeof encodePaymentSignatureHeader>[0]
    ),
  };
}
