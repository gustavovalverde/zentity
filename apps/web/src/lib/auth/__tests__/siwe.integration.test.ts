import type { Hex } from "viem";

import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";
import { parseSignature, serializeSignature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { accounts, verifications, walletAddresses } from "@/lib/db/schema/auth";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const AUTH_BASE = "http://localhost:3000/api/auth";
const CHAIN_ID = 1;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SECP256K1_ORDER =
  0xff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_fe_ba_ae_dc_e6_af_48_a0_3b_bf_d2_5e_8c_d0_36_41_41n;
const WALLET = privateKeyToAccount(generatePrivateKey());
const OTHER_WALLET = privateKeyToAccount(generatePrivateKey());
const APP_URL = new URL(env.NEXT_PUBLIC_APP_URL);
const NONCE_PATTERN = /^[a-zA-Z0-9]{32}$/;
const UNSTABLE_SIGNATURE_ERROR = /not stable/;

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

async function requestChallenge(
  flow: "sign-in" | "sign-up",
  address: string = WALLET.address
): Promise<string> {
  const { status, json } = await post(`/${flow}/siwe/challenge`, {
    address,
    chainId: CHAIN_ID,
  });
  if (status !== 200) {
    throw new Error(`Challenge request failed with ${status}`);
  }
  return json.message as string;
}

function nonceOf(message: string): string {
  return parseSiweMessage(message).nonce as string;
}

/** Rebuilds an issued message with some fields changed, as a relay would. */
function rebuild(
  message: string,
  changes: Partial<Parameters<typeof createSiweMessage>[0]>
): string {
  const parsed = parseSiweMessage(message);
  return createSiweMessage({
    address: parsed.address as Hex,
    chainId: parsed.chainId as number,
    domain: parsed.domain as string,
    nonce: parsed.nonce as string,
    uri: parsed.uri as string,
    version: "1",
    ...(parsed.expirationTime ? { expirationTime: parsed.expirationTime } : {}),
    ...(parsed.issuedAt ? { issuedAt: parsed.issuedAt } : {}),
    ...(parsed.scheme ? { scheme: parsed.scheme } : {}),
    ...(parsed.statement ? { statement: parsed.statement } : {}),
    ...changes,
  });
}

function completeSignIn(message: string, signature: string) {
  return post("/sign-in/siwe/complete", { message, signature });
}

describe("Sign-In with Ethereum challenge", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("names the app origin, the purpose, the wallet, and a short expiry", async () => {
    const message = await requestChallenge("sign-in");
    const parsed = parseSiweMessage(message);

    expect(parsed).toMatchObject({
      address: WALLET.address,
      chainId: CHAIN_ID,
      domain: APP_URL.host,
      scheme: APP_URL.protocol.slice(0, -1),
      statement: "Sign in to Zentity with this wallet.",
      uri: APP_URL.origin,
      version: "1",
    });
    expect(parsed.nonce).toMatch(NONCE_PATTERN);
    expect(
      (parsed.expirationTime as Date).getTime() -
        (parsed.issuedAt as Date).getTime()
    ).toBe(CHALLENGE_TTL_MS);
  });

  it("refuses an address that is not an Ethereum address", async () => {
    const { status } = await post("/sign-in/siwe/challenge", {
      address: "0x1234",
      chainId: CHAIN_ID,
    });

    expect(status).toBe(400);
  });

  it("states a different purpose for sign-up", async () => {
    const message = await requestChallenge("sign-up");

    expect(parseSiweMessage(message).statement).toBe(
      "Create a Zentity account with this wallet."
    );
  });
});

describe("Sign-In with Ethereum sign-in", () => {
  beforeEach(async () => {
    await resetDatabase();
    await registerWallet(WALLET.address);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs in once per challenge", async () => {
    const message = await requestChallenge("sign-in");
    const signature = await WALLET.signMessage({ message });

    const first = await completeSignIn(message, signature);
    expect(first.status).toBe(200);
    expect(first.json.token).toBeTypeOf("string");

    const replay = await completeSignIn(message, signature);
    expect(replay.status).toBe(401);
  });

  it("rejects a message rebuilt for another domain", async () => {
    // A phishing server requests a real challenge, then has the victim sign
    // the same fields under its own origin, which wallets show as matching.
    const issued = await requestChallenge("sign-in");
    const relayed = rebuild(issued, {
      domain: "evil.example",
      scheme: "https",
      uri: "https://evil.example",
    });
    const signature = await WALLET.signMessage({ message: relayed });

    const { status, json } = await completeSignIn(relayed, signature);
    expect(status).toBe(401);
    expect(json.message).toBe("Invalid sign-in message");
  });

  it("rejects a challenge issued for another wallet", async () => {
    const issued = await requestChallenge("sign-in", OTHER_WALLET.address);
    const swapped = rebuild(issued, { address: WALLET.address });
    const signature = await WALLET.signMessage({ message: swapped });

    const { status } = await completeSignIn(swapped, signature);
    expect(status).toBe(401);
  });

  it("rejects a signature from a wallet the message does not name", async () => {
    const message = await requestChallenge("sign-in");
    const signature = await OTHER_WALLET.signMessage({ message });

    const { status, json } = await completeSignIn(message, signature);
    expect(status).toBe(401);
    expect(json.message).toBe("Invalid signature");
  });

  it("rejects an expired challenge", async () => {
    const message = await requestChallenge("sign-in");
    const signature = await WALLET.signMessage({ message });
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.identifier, `siwe:${nonceOf(message)}`))
      .run();

    const { status } = await completeSignIn(message, signature);
    expect(status).toBe(401);
  });

  it("enforces the message's expiration time", async () => {
    const message = await requestChallenge("sign-in");
    const signature = await WALLET.signMessage({ message });
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
      .where(eq(verifications.identifier, `siwe:${nonceOf(message)}`))
      .run();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + CHALLENGE_TTL_MS + 1000);

    const { status, json } = await completeSignIn(message, signature);
    expect(status).toBe(401);
    expect(json.message).toBe("Invalid sign-in message");
  });

  it("creates one session when the same challenge is redeemed concurrently", async () => {
    const message = await requestChallenge("sign-in");
    const signature = await WALLET.signMessage({ message });

    const results = await Promise.all(
      Array.from({ length: 4 }, () => completeSignIn(message, signature))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("does not accept a sign-up signature", async () => {
    const message = await requestChallenge("sign-up");
    const signature = await WALLET.signMessage({ message });

    const { status } = await completeSignIn(message, signature);
    expect(status).toBe(401);
  });
});

describe("Sign-In with Ethereum sign-up", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  function completeSignUp(
    message: string,
    signature: string,
    signature2 = signature
  ) {
    return post("/sign-up/siwe/complete", { message, signature, signature2 });
  }

  it("creates a wallet account for the signed address", async () => {
    const message = await requestChallenge("sign-up");
    const signature = await WALLET.signMessage({ message });

    const { status, json } = await completeSignUp(message, signature);
    expect(status).toBe(200);

    const userId = (json.user as { id: string }).id;
    const account = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.userId, userId), eq(accounts.providerId, "eip712"))
      )
      .get();
    const wallet = await db
      .select({ address: walletAddresses.address })
      .from(walletAddresses)
      .where(eq(walletAddresses.userId, userId))
      .get();
    expect(account).toBeDefined();
    expect(wallet?.address).toBe(WALLET.address);
  });

  it("refuses two valid signatures that differ", async () => {
    const message = await requestChallenge("sign-up");
    const signature = await WALLET.signMessage({ message });
    // The same signature with the other s value still recovers the wallet.
    const { r, s, yParity } = parseSignature(signature);
    const flipped = serializeSignature({
      r,
      s: `0x${(SECP256K1_ORDER - BigInt(s)).toString(16).padStart(64, "0")}`,
      yParity: yParity === 0 ? 1 : 0,
    });

    const { status, json } = await completeSignUp(message, signature, flipped);
    expect(status).toBe(400);
    expect(json.message).toMatch(UNSTABLE_SIGNATURE_ERROR);
  });

  it("does not accept a sign-in signature", async () => {
    const message = await requestChallenge("sign-in");
    const signature = await WALLET.signMessage({ message });

    const { status } = await completeSignUp(message, signature);
    expect(status).toBe(401);
  });
});
