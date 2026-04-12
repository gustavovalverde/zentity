import type { Eip712TypedData } from "../types";

import { describe, expect, it, vi } from "vitest";

import { eip712AuthClient } from "../client";

const WALLET_NONDETERMINISTIC_ERROR = /wallet_nondeterministic/i;

interface BetterFetchResponse<T> {
  data: T | null;
  error: {
    message?: string;
    code?: string;
  } | null;
}

function createTypedData(): Eip712TypedData {
  return {
    domain: {
      name: "Zentity",
      version: "1",
      chainId: 1,
    },
    types: {
      WalletAuth: [
        { name: "address", type: "address" },
        { name: "nonce", type: "string" },
      ],
    },
    primaryType: "WalletAuth",
    message: {
      address: "0x0000000000000000000000000000000000000001",
      nonce: "nonce-1",
    },
  };
}

function createActions(
  fetchMock: (
    path: string,
    options?: Record<string, unknown>
  ) => Promise<BetterFetchResponse<unknown>>
) {
  return eip712AuthClient().getActions(
    fetchMock as unknown as <T>(
      path: string,
      options?: Record<string, unknown>
    ) => Promise<BetterFetchResponse<T>>
  );
}

describe("eip712AuthClient signUp determinism", () => {
  it("blocks registration when signatures are non-deterministic", async () => {
    const typedData = createTypedData();
    const fetchMock = vi.fn(
      (
        path: string,
        _options?: Record<string, unknown>
      ): Promise<BetterFetchResponse<unknown>> => {
        if (path === "/eip712/nonce") {
          return Promise.resolve({
            data: { nonce: "nonce-1", typedData },
            error: null,
          });
        }
        return Promise.resolve({
          data: null,
          error: { message: "unexpected path" },
        });
      }
    );

    const signTypedData = vi
      .fn<(_: Eip712TypedData) => Promise<string>>()
      .mockResolvedValueOnce("0xaaa")
      .mockResolvedValueOnce("0xbbb");

    const actions = createActions(fetchMock);

    await expect(
      actions.signUp.eip712({
        address: typedData.message.address as string,
        chainId: typedData.domain.chainId,
        signTypedData,
      })
    ).rejects.toThrow(WALLET_NONDETERMINISTIC_ERROR);

    expect(signTypedData).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/eip712/nonce",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("registers using the verified deterministic signature", async () => {
    const typedData = createTypedData();
    const fetchMock = vi.fn(
      (
        path: string,
        _options?: Record<string, unknown>
      ): Promise<BetterFetchResponse<unknown>> => {
        if (path === "/eip712/nonce") {
          return Promise.resolve({
            data: { nonce: "nonce-1", typedData },
            error: null,
          });
        }
        if (path === "/sign-up/eip712/register") {
          return Promise.resolve({
            data: { token: "token-1", user: { id: "user-1" } },
            error: null,
          });
        }
        return Promise.resolve({
          data: null,
          error: { message: "unexpected path" },
        });
      }
    );

    const signTypedData = vi
      .fn<(_: Eip712TypedData) => Promise<string>>()
      .mockResolvedValue("0xsame");

    const actions = createActions(fetchMock);
    const result = await actions.signUp.eip712({
      address: typedData.message.address as string,
      chainId: typedData.domain.chainId,
      signTypedData,
    });

    expect(result).toEqual({
      token: "token-1",
      user: { id: "user-1" },
    });
    expect(signTypedData).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const registerCall = fetchMock.mock.calls[1];
    const registerOptions = registerCall?.[1] as
      | { body?: Record<string, unknown> }
      | undefined;

    expect(registerCall?.[0]).toBe("/sign-up/eip712/register");
    expect(registerOptions?.body).toMatchObject({
      signature: "0xsame",
      address: typedData.message.address as string,
      chainId: typedData.domain.chainId,
      nonce: "nonce-1",
    });
  });
});
