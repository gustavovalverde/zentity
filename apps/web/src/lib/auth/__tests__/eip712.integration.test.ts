import type { Eip712TypedData } from "@/lib/auth/eip712/types";

import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { accounts, verifications, walletAddresses } from "@/lib/db/schema/auth";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const AUTH_BASE = "http://localhost:3000/api/auth";
const CHAIN_ID = 1;
const WALLET = privateKeyToAccount(generatePrivateKey());
const OTHER_WALLET = privateKeyToAccount(generatePrivateKey());

async function post(
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await auth.handler(
    new Request(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

async function registerWallet(address: string): Promise<void> {
  const userId = await createTestUser({
    email: `${address.slice(2, 10).toLowerCase()}@wallet.zentity.app`,
  });
  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "eip712",
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  await db
    .insert(walletAddresses)
    .values({
      userId,
      address,
      chainId: CHAIN_ID,
      isPrimary: true,
      createdAt: new Date().toISOString(),
    })
    .run();
}

async function requestNonce(address: string) {
  const { json } = await post("/eip712/nonce", { address, chainId: CHAIN_ID });
  return {
    nonce: json.nonce as string,
    typedData: json.typedData as Eip712TypedData,
  };
}

function sign(typedData: Eip712TypedData) {
  return WALLET.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType as "WalletAuth",
    message: typedData.message as { address: `0x${string}`; nonce: string },
  });
}

function verify(nonce: string, signature: string) {
  return post("/sign-in/eip712/verify", {
    address: WALLET.address,
    chainId: CHAIN_ID,
    nonce,
    signature,
  });
}

describe("EIP-712 wallet sign-in nonce", () => {
  beforeEach(async () => {
    await resetDatabase();
    await registerWallet(WALLET.address);
  });

  it("signs in once per nonce", async () => {
    const { nonce, typedData } = await requestNonce(WALLET.address);
    const signature = await sign(typedData);

    const first = await verify(nonce, signature);
    expect(first.status).toBe(200);

    const replay = await verify(nonce, signature);
    expect(replay.status).toBe(401);
  });

  it("rejects a nonce issued for another wallet", async () => {
    const { nonce } = await requestNonce(OTHER_WALLET.address);
    const { typedData } = await requestNonce(WALLET.address);
    const signature = await sign({
      ...typedData,
      message: { ...typedData.message, nonce },
    });

    const { status } = await verify(nonce, signature);
    expect(status).toBe(401);
  });

  it("rejects an expired nonce", async () => {
    const { nonce, typedData } = await requestNonce(WALLET.address);
    const signature = await sign(typedData);
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.identifier, `eip712:${nonce}`))
      .run();

    const { status } = await verify(nonce, signature);
    expect(status).toBe(401);
  });

  it("creates one session when the same nonce is redeemed concurrently", async () => {
    const { nonce, typedData } = await requestNonce(WALLET.address);
    const signature = await sign(typedData);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => verify(nonce, signature))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});
