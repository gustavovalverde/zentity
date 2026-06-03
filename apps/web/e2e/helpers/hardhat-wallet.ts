import type { Page } from "@playwright/test";
import type { Hex, PrivateKeyAccount } from "viem";

import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEFAULT_HARDHAT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_HARDHAT_CHAIN_ID = 31_337;
const WALLET_RDNS = "xyz.zentity.hardhat";
const WALLET_UUID = "76709d2e-21c7-4d04-a39c-c50b35df8d77";
const WALLET_ICON =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='6'%20fill='%232563eb'/%3E%3Cpath%20d='M8%2017h16v7H8zM10%208h12v7H10z'%20fill='white'/%3E%3C/svg%3E";

interface RpcRequest {
  method: string;
  params?: unknown[];
}

interface TransactionRequest {
  data?: Hex;
  from?: string;
  gas?: string | number | bigint;
  gasPrice?: string | number | bigint;
  maxFeePerGas?: string | number | bigint;
  maxPriorityFeePerGas?: string | number | bigint;
  nonce?: string | number | bigint;
  to?: Hex;
  value?: string | number | bigint;
}

interface Eip712TypedData {
  domain?: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: string;
  types: Record<string, readonly unknown[]>;
}

interface HardhatWalletOptions {
  chainId?: number;
  privateKey?: Hex;
  rpcUrl?: string;
}

function asHexPrivateKey(value: string): Hex {
  return value.startsWith("0x") ? (value as Hex) : (`0x${value}` as Hex);
}

function normalizeTypedData(value: unknown): Eip712TypedData {
  const typedData =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (
    !typedData ||
    typeof typedData !== "object" ||
    !("message" in typedData) ||
    !("primaryType" in typedData) ||
    !("types" in typedData)
  ) {
    throw new Error("Invalid EIP-712 typed data payload");
  }
  const parsed = typedData as Eip712TypedData;
  const { EIP712Domain: _domain, ...types } = parsed.types;
  return { ...parsed, types };
}

async function rpc(rpcUrl: string, method: string, params: unknown[] = []) {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    result?: unknown;
  };
  if (payload.error) {
    throw new Error(payload.error.message ?? `RPC ${method} failed`);
  }
  return payload.result;
}

async function signAndSendTransaction({
  account,
  params,
  rpcUrl,
}: {
  account: PrivateKeyAccount;
  params: unknown[];
  rpcUrl: string;
}) {
  const transaction = params[0] as TransactionRequest | undefined;
  if (!transaction) {
    throw new Error("eth_sendTransaction requires a transaction payload");
  }
  if (
    transaction.from &&
    transaction.from.toLowerCase() !== account.address.toLowerCase()
  ) {
    throw new Error(`Hardhat test wallet cannot send from ${transaction.from}`);
  }

  return await rpc(rpcUrl, "eth_sendTransaction", [
    {
      data: transaction.data,
      gas: transaction.gas,
      gasPrice: transaction.gasPrice,
      from: transaction.from ?? account.address,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      nonce: transaction.nonce,
      to: transaction.to,
      value: transaction.value,
    },
  ]);
}

function createWalletRequestHandler({
  account,
  chainId,
  rpcUrl,
}: {
  account: PrivateKeyAccount;
  chainId: number;
  rpcUrl: string;
}) {
  const chainIdHex = `0x${chainId.toString(16)}`;

  return async (_source: unknown, request: RpcRequest) => {
    const params = request.params ?? [];
    switch (request.method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return [account.address];
      case "eth_chainId":
        return chainIdHex;
      case "net_version":
        return String(chainId);
      case "personal_sign": {
        const message = params[0] as string;
        const payload = message?.startsWith("0x")
          ? { raw: message as Hex }
          : message;
        return await account.signMessage({ message: payload });
      }
      case "eth_sign":
        return await account.signMessage({
          message: { raw: params[1] as Hex },
        });
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4": {
        const typedData = normalizeTypedData(params[1]);
        return await account.signTypedData(
          typedData as Parameters<typeof account.signTypedData>[0]
        );
      }
      case "eth_sendTransaction":
        return await signAndSendTransaction({ account, params, rpcUrl });
      case "wallet_addEthereumChain":
      case "wallet_switchEthereumChain":
        return null;
      case "wallet_getCapabilities":
        return {};
      case "wallet_requestPermissions":
        return [
          {
            caveats: [],
            date: Date.now(),
            id: "eth_accounts",
            parentCapability: "eth_accounts",
          },
        ];
      case "wallet_watchAsset":
        return true;
      default:
        return await rpc(rpcUrl, request.method, params);
    }
  };
}

export async function installHardhatWallet(
  page: Page,
  options: HardhatWalletOptions = {}
) {
  const chainId = options.chainId ?? DEFAULT_HARDHAT_CHAIN_ID;
  const rpcUrl =
    options.rpcUrl ??
    process.env.NEXT_PUBLIC_LOCAL_RPC_URL ??
    process.env.LOCAL_RPC_URL ??
    process.env.SYNPRESS_NETWORK_RPC_URL ??
    DEFAULT_HARDHAT_RPC_URL;
  const privateKey = asHexPrivateKey(
    options.privateKey ??
      process.env.E2E_SENDER_PRIVATE_KEY ??
      DEFAULT_HARDHAT_PRIVATE_KEY
  );
  const account = privateKeyToAccount(privateKey);
  const chainIdHex = `0x${chainId.toString(16)}`;

  await page.exposeBinding(
    "__hardhatWalletRequest",
    createWalletRequestHandler({ account, chainId, rpcUrl })
  );
  await page.addInitScript(
    ({ address, chainIdHex: browserChainIdHex, icon, rdns, uuid }) => {
      type Listener = (...args: unknown[]) => void;
      const listeners = new Map<string, Set<Listener>>();
      const emit = (event: string, ...args: unknown[]) => {
        for (const listener of listeners.get(event) ?? []) {
          listener(...args);
        }
      };
      const on = (event: string, listener: Listener) => {
        const eventListeners = listeners.get(event) ?? new Set<Listener>();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
      };
      const removeListener = (event: string, listener: Listener) => {
        listeners.get(event)?.delete(listener);
      };
      const request = async ({
        method,
        params = [],
      }: {
        method: string;
        params?: unknown[];
      }) => {
        const result = await (
          window as typeof window & {
            __hardhatWalletRequest: (request: RpcRequest) => Promise<unknown>;
          }
        ).__hardhatWalletRequest({ method, params });
        if (method === "eth_requestAccounts") {
          emit("accountsChanged", [address]);
          emit("connect", { chainId: browserChainIdHex });
        }
        if (method === "wallet_switchEthereumChain") {
          emit("chainChanged", browserChainIdHex);
        }
        return result;
      };
      const provider = {
        addListener: on,
        chainId: browserChainIdHex,
        enable: () =>
          request({ method: "eth_requestAccounts" }) as Promise<string[]>,
        isConnected: () => true,
        isMetaMask: true,
        on,
        removeListener,
        request,
        selectedAddress: address,
        send: (methodOrPayload: string | RpcRequest, params?: unknown[]) =>
          typeof methodOrPayload === "string"
            ? request({ method: methodOrPayload, params })
            : request(methodOrPayload),
        sendAsync: (
          payload: RpcRequest & { id?: number; jsonrpc?: string },
          callback: (error: Error | null, response: unknown) => void
        ) => {
          request(payload)
            .then((result) =>
              callback(null, {
                id: payload.id,
                jsonrpc: payload.jsonrpc ?? "2.0",
                result,
              })
            )
            .catch((error) => callback(error as Error, null));
        },
      };
      Object.defineProperty(window, "ethereum", {
        configurable: true,
        value: provider,
      });
      const announcement = {
        info: {
          icon,
          name: "Hardhat Test Wallet",
          rdns,
          uuid,
        },
        provider,
      };
      const announce = () => {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: announcement,
          })
        );
      };
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    {
      address: account.address,
      chainIdHex,
      icon: WALLET_ICON,
      rdns: WALLET_RDNS,
      uuid: WALLET_UUID,
    }
  );

  return { address: account.address, chainId, rpcUrl };
}

export async function connectHardhatWallet(page: Page, chainId: number) {
  await page
    .waitForFunction(
      () => Boolean((window as Window & { ethereum?: unknown }).ethereum),
      null,
      { timeout: 10_000 }
    )
    .catch(() => undefined);
  await page
    .waitForFunction(
      () => Boolean((window as Window & { __appkit?: unknown }).__appkit),
      null,
      { timeout: 15_000 }
    )
    .catch(() => undefined);

  const accounts = await page.evaluate(async () => {
    const ethereum = (window as Window & { ethereum?: unknown }).ethereum as
      | { request: (request: RpcRequest) => Promise<unknown> }
      | undefined;
    const result = await ethereum?.request({ method: "eth_requestAccounts" });
    return Array.isArray(result) ? (result as string[]) : [];
  });
  if (accounts.length === 0) {
    throw new Error("Hardhat wallet did not expose an account");
  }

  await page
    .evaluate(
      ({ address, activeChainId }) => {
        const appkit = (
          window as Window & {
            __appkit?: {
              close?: () => void;
              getActiveChainNamespace?: () => string;
              setCaipAddress?: (
                address: string,
                namespace?: string,
                sync?: boolean
              ) => void;
              setStatus?: (status: string, namespace?: string) => void;
            };
          }
        ).__appkit;
        const namespace = appkit?.getActiveChainNamespace?.() ?? "eip155";
        appkit?.setCaipAddress?.(
          `eip155:${activeChainId}:${address}`,
          namespace,
          true
        );
        appkit?.setStatus?.("connected", namespace);
        appkit?.close?.();
      },
      { activeChainId: chainId, address: accounts[0] }
    )
    .catch(() => undefined);
}
