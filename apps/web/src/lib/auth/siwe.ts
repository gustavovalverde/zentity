"use client";

import { SiweMessage } from "siwe";

import { authClient } from "@/lib/auth/auth-client";

const SIWE_STATEMENT = "Sign in to Zentity.";
const SIWE_BASE_PATH = "/api/auth/siwe";

type SignMessageFn = (params: { message: string }) => Promise<string>;

function getWindowOrigin(): { origin: string; host: string } {
  if (globalThis.window === undefined) {
    throw new Error("SIWE requires a browser environment.");
  }
  return {
    origin: globalThis.window.location.origin,
    host: globalThis.window.location.host,
  };
}

async function requestSiweNonce(params: {
  address: string;
  chainId: number;
}): Promise<string> {
  const response = await fetch(`${SIWE_BASE_PATH}/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      walletAddress: params.address,
      chainId: params.chainId,
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    nonce?: string;
    error?: string;
  } | null;

  if (!(response.ok && payload?.nonce)) {
    throw new Error(payload?.error || "Failed to request nonce.");
  }

  return payload.nonce;
}

async function verifySiweMessage(params: {
  message: string;
  signature: string;
  address: string;
  chainId: number;
  email?: string;
}): Promise<void> {
  const response = await fetch(`${SIWE_BASE_PATH}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      message: params.message,
      signature: params.signature,
      walletAddress: params.address,
      chainId: params.chainId,
      ...(params.email ? { email: params.email } : {}),
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "SIWE failed.");
  }
}

export async function signInWithSiwe(params: {
  address: string;
  chainId: number;
  signMessage: SignMessageFn;
  statement?: string;
  email?: string;
  force?: boolean;
}): Promise<void> {
  const existingSession = await authClient.getSession();
  if (!params.force && existingSession.data?.user?.id) {
    return;
  }

  const { origin, host } = getWindowOrigin();
  const nonce = await requestSiweNonce({
    address: params.address,
    chainId: params.chainId,
  });

  const message = new SiweMessage({
    domain: host,
    address: params.address,
    statement: params.statement ?? SIWE_STATEMENT,
    uri: origin,
    version: "1",
    chainId: params.chainId,
    nonce,
  });

  const preparedMessage = message.prepareMessage();
  const signature = await params.signMessage({ message: preparedMessage });

  await verifySiweMessage({
    message: preparedMessage,
    signature,
    address: params.address,
    chainId: params.chainId,
    email: params.email,
  });

  authClient.$store.notify("$sessionSignal");
}
